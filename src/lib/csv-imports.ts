import { assertStorageAvailable, assertAccountAvailable } from "./account-limits";
import { userId } from "./db";
import { parse, CsvError } from "csv-parse";
import type { Readable } from "node:stream";
import { z } from "zod";
import { activity, get, id, now, put, query, recent, transaction } from "./db";
import { AppError } from "./security";
import { csvKey, csvObjectInfo, csvObjectStream, csvUploadUrl, deleteObject } from "./storage";
import { companyFromCsv, insertCompanyBatch } from "./company-import";
import { CSV_BATCH_BYTES, CSV_BATCH_ROWS, MAX_CSV_BYTES, type CsvImport } from "./csv-import-types";
import type { Company } from "./types";

interface StoredImport extends CsvImport {
  etag: string | null;
  lease: string | null;
  leaseUntil: number;
  attempts: number;
  cleanedAt: string | null;
}

const publicImport = ({
  etag: _etag,
  lease: _lease,
  leaseUntil: _until,
  attempts: _attempts,
  cleanedAt: _cleanedAt,
  ...value
}: StoredImport): CsvImport => value;

export async function listCsvImports() {
  return (await recent<StoredImport>("csv-import", 8)).map(publicImport);
}

export async function startCsvImport(input: unknown) {
  const parsed = z
    .object({ name: z.string().min(1).max(255), size: z.number().int().min(1).max(MAX_CSV_BYTES) })
    .safeParse(input);
  if (!parsed.success) throw new AppError("Choose a non-empty CSV file up to 50 MB.");
  if (!/\.csv$/i.test(parsed.data.name)) throw new AppError("Choose a CSV file.");
  const value: StoredImport = {
    id: id(),
    name: parsed.data.name.replace(/[\r\n/\\]/g, "_"),
    size: parsed.data.size,
    status: "uploading",
    processed: 0,
    bytesProcessed: 0,
    companies: 0,
    duplicates: 0,
    rejected: 0,
    issues: [],
    error: null,
    retryable: false,
    createdAt: now(),
    updatedAt: now(),
    etag: null,
    lease: null,
    leaseUntil: 0,
    attempts: 0,
    cleanedAt: null,
  };
  const uploadUrl = await csvUploadUrl(value.id, value.size);
  await transaction(async () => {
    await assertStorageAvailable(value.size);
    await put("csv-import", value);
  });
  return { import: publicImport(value), uploadUrl };
}

async function requireImport(importId: string) {
  if (!z.uuid().safeParse(importId).success) throw new AppError("Invalid import reference.");
  const value = await get<StoredImport>("csv-import", importId);
  if (!value) throw new AppError("Import not found.", 404);
  return value;
}

export async function resumeCsvUpload(importId: string) {
  const value = await requireImport(importId);
  if (value.status !== "uploading" || value.cleanedAt)
    throw new AppError("This upload is no longer available. Choose the CSV again.");
  const uploadUrl = await csvUploadUrl(value.id, value.size);
  await transaction(async () => {
    const current = await requireImport(importId);
    if (current.status !== "uploading" || current.cleanedAt)
      throw new AppError("This upload is no longer available. Choose the CSV again.");
    await put("csv-import", { ...current, updatedAt: now() });
  });
  return { uploadUrl };
}

export async function completeCsvUpload(importId: string) {
  const value = await requireImport(importId);
  if (value.status !== "uploading") return publicImport(value);
  let object;
  try {
    object = await csvObjectInfo(value.id);
  } catch {
    throw new AppError("The upload has not finished. Please retry the upload.", 409);
  }
  if (object.size !== value.size || object.size > MAX_CSV_BYTES || !object.etag)
    throw new AppError("The uploaded file size does not match. Please upload the CSV again.");
  return transaction(async () => {
    const latest = await requireImport(importId);
    if (latest.status !== "uploading") return publicImport(latest);
    const next: StoredImport = {
      ...latest,
      etag: object.etag!,
      status: "queued",
      updatedAt: now(),
    };
    await put("csv-import", next);
    console.info("csv_import_queued", { id: next.id, bytes: next.size });
    return publicImport(next);
  });
}

export async function retryCsvImport(importId: string) {
  return transaction(async () => {
    const value = await requireImport(importId);
    if (value.status !== "failed" || !value.retryable || value.cleanedAt)
      throw new AppError("This import cannot be retried. Upload a corrected CSV instead.");
    const next: StoredImport = {
      ...value,
      status: "queued",
      error: null,
      attempts: 0,
      updatedAt: now(),
    };
    await put("csv-import", next);
    return publicImport(next);
  });
}

async function claimImport(): Promise<StoredImport | null> {
  await assertAccountAvailable();
  return transaction(async () => {
    const result = await query<{ data: StoredImport }>(
      `SELECT data FROM folio_records WHERE user_id=$2 AND kind='csv-import' AND
       (data->>'status'='queued' OR (data->>'status'='processing' AND (data->>'leaseUntil')::bigint < $1))
       ORDER BY sequence LIMIT 1`,
      [Date.now(), userId()],
    );
    if (!result.rows.length) return null;
    const value: StoredImport = {
      ...result.rows[0].data,
      status: "processing",
      lease: id(),
      leaseUntil: Date.now() + 240000,
      error: null,
      updatedAt: now(),
    };
    await put("csv-import", value);
    return value;
  });
}

async function processImport(initial: StoredImport, deadline: number) {
  let value = initial;
  let source: Readable | undefined;
  let parser: ReturnType<typeof parse> | undefined;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, deadline - Date.now()));
  let candidates: Company[] = [],
    issues: CsvImport["issues"] = [];
  let records = 0,
    bytes = value.bytesProcessed,
    batchRows = 0,
    batchBytes = 0,
    rejected = 0;
  let hasHeaders = false;
  const commit = async (status: StoredImport["status"]) => {
    value = await transaction(async () => {
      const current = await requireImport(value.id);
      if (current.lease !== initial.lease)
        throw new AppError("Import ownership changed. It will resume automatically.", 409);
      const added = await insertCompanyBatch(candidates);
      const next: StoredImport = {
        ...current,
        status,
        processed: records,
        bytesProcessed: status === "completed" ? current.size : bytes,
        companies: current.companies + added.companies,
        duplicates: current.duplicates + added.duplicates,
        rejected: current.rejected + rejected,
        issues: [...current.issues, ...issues].slice(0, 20),
        updatedAt: now(),
        error: null,
        attempts: 0,
        lease: status === "processing" ? initial.lease : null,
        leaseUntil: status === "processing" ? Date.now() + 240000 : 0,
      };
      await put("csv-import", next);
      if (status === "completed")
        await activity(
          "Company list imported",
          `${next.companies} companies added; ${next.duplicates} duplicates and ${next.rejected} invalid rows skipped.`,
          "success",
        );
      return next;
    });
    candidates = [];
    issues = [];
    batchRows = 0;
    batchBytes = 0;
    rejected = 0;
  };
  try {
    source = await csvObjectStream(value.id, value.etag!, controller.signal);
    parser = parse({
      bom: true,
      skip_empty_lines: true,
      trim: true,
      info: true,
      max_record_size: 100000,
      columns: (headers: string[]) => {
        const columns = headers.map((header) => header.toLowerCase().trim());
        if (!columns.some((header) => ["company", "company name", "name"].includes(header)))
          throw new AppError("Add a Company, Company name, or Name column to your CSV.");
        if (new Set(columns).size !== columns.length)
          throw new AppError("CSV column names must be unique.");
        hasHeaders = true;
        return columns;
      },
    });
    source.on("error", (error) => parser?.destroy(error));
    source.pipe(parser);
    // Reparse the stream on recovery, skipping committed records. This preserves quoted
    // newlines, BOMs and UTF-8 boundaries without retaining the entire file in memory.
    for await (const item of parser) {
      records++;
      if (records <= initial.processed) continue;
      bytes = item.info.bytes;
      const company = companyFromCsv(item.record);
      batchRows++;
      if (typeof company === "string") {
        rejected++;
        if (issues.length < 20) issues.push({ row: item.info.lines, message: company });
      } else {
        candidates.push(company);
        batchBytes += Buffer.byteLength(JSON.stringify(company));
      }
      if (Date.now() >= deadline - 5000) {
        await commit("queued");
        return;
      }
      if (batchRows >= CSV_BATCH_ROWS || batchBytes >= CSV_BATCH_BYTES) await commit("processing");
    }
    if (!hasHeaders || records === 0) throw new AppError("The CSV has no company rows to import.");
    if (records < initial.processed)
      throw new AppError("The uploaded CSV changed. Upload it again.");
    await commit("completed");
    console.info("csv_import_completed", {
      id: value.id,
      rows: value.processed,
      companies: value.companies,
    });
  } catch (error) {
    const changed = error instanceof Error && error.name === "PreconditionFailed";
    const malformed =
      changed || error instanceof CsvError || (error instanceof AppError && error.status !== 409);
    await transaction(async () => {
      const current = await requireImport(initial.id);
      if (current.lease !== initial.lease) return;
      const attempts = current.attempts + 1;
      await put("csv-import", {
        ...current,
        status: malformed || attempts >= 3 ? "failed" : "queued",
        attempts,
        retryable: !malformed,
        lease: null,
        leaseUntil: 0,
        updatedAt: now(),
        error: changed
          ? "The uploaded CSV changed after import started. Upload the CSV again. Earlier completed batches are saved."
          : error instanceof CsvError
            ? `Could not read the CSV near line ${error.lines || records + 1}. Check quoted cells, column counts, and the 100,000-character row limit. Earlier completed batches are saved.`
            : error instanceof AppError
              ? error.message
              : "Processing was interrupted. Completed batches are saved; retry to continue.",
      });
    });
    console.error("csv_import_interrupted", {
      id: value.id,
      stage: "process",
      error: error instanceof Error ? error.name : "UnknownError",
    });
  } finally {
    clearTimeout(timer);
    source?.destroy();
    parser?.destroy();
  }
}

export async function runCsvImports(budgetMs = 200000) {
  const deadline = Date.now() + Math.min(Math.max(0, budgetMs), 200000);
  while (Date.now() < deadline - 5000) {
    const value = await claimImport();
    if (!value) break;
    await processImport(value, deadline);
    const latest = await requireImport(value.id);
    // Retry transient errors on the next trigger instead of hammering storage/database.
    if (latest.status === "queued") break;
  }
}

export async function cleanupCsvImports() {
  const result = await query<{ data: StoredImport }>(
    `SELECT data FROM folio_records WHERE user_id=$3 AND kind='csv-import' AND data->>'cleanedAt' IS NULL
      AND ((data->>'status'='completed' AND data->>'updatedAt'<$1)
        OR (data->>'status' IN ('uploading','failed') AND data->>'updatedAt'<$2)) LIMIT 20`,
    [
      new Date(Date.now() - 3600000).toISOString(),
      new Date(Date.now() - 7 * 86400000).toISOString(),
      userId(),
    ],
  );
  for (const { data: value } of result.rows) {
    // Recheck under the same lock used by retry/complete so cleanup cannot delete an active file.
    await transaction(async () => {
      const current = await requireImport(value.id);
      if (current.updatedAt !== value.updatedAt || current.status !== value.status) return;
      await deleteObject(csvKey(value.id));
      await put("csv-import", {
        ...current,
        cleanedAt: now(),
        retryable: false,
        ...(current.status === "uploading"
          ? { status: "failed", error: "Upload expired. Choose the CSV again." }
          : {}),
      });
    });
  }
}
