import { after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { setupTestStorage } from "./setup";
import { MAX_CSV_BYTES } from "../src/lib/csv-import-types";
import { readJsonResponse } from "../src/lib/http-client";

const cleanup = await setupTestStorage();
const db = await import("../src/lib/db");
const imports = await import("../src/lib/csv-imports");
const { companyPage } = await import("../src/lib/companies");
const { state } = await import("../src/lib/service");
const { runWorker } = await import("../src/lib/worker");
const { storageClient, storageBucket, csvKey } = await import("../src/lib/storage");
const { PutObjectCommand } = await import("@aws-sdk/client-s3");
type Company = import("../src/lib/types").Company;
type CsvImport = import("../src/lib/csv-import-types").CsvImport;

beforeEach(async () => {
  await db.query("DELETE FROM folio_records; DELETE FROM folio_tasks;");
});
after(async () => {
  await db.closeDatabase();
  await cleanup();
});

async function upload(csv: string | Buffer) {
  const bytes = Buffer.isBuffer(csv) ? csv : Buffer.from(csv);
  const result = await imports.startCsvImport({ name: "companies.csv", size: bytes.length });
  const response = await fetch(result.uploadUrl, {
    method: "PUT",
    body: new Uint8Array(bytes),
    headers: { "Content-Type": "text/csv", "Cache-Control": "private, no-store" },
  });
  assert.equal(
    response.status,
    200,
    "signed URL must accept direct uploads without application cookies",
  );
  await imports.completeCsvUpload(result.import.id);
  return result.import.id;
}
const job = async (id: string) => (await db.get<CsvImport>("csv-import", id))!;

test("CSV metadata rejects empty, over-50-MB, and non-CSV uploads without creating an import", async () => {
  for (const input of [
    { name: "file.csv", size: 0 },
    { name: "file.csv", size: MAX_CSV_BYTES + 1 },
    { name: "file.exe", size: 100 },
  ])
    await assert.rejects(imports.startCsvImport(input), /CSV/);
  assert.equal((await imports.listCsvImports()).length, 0);
  const created = await imports.startCsvImport({ name: "file.csv", size: 100 });
  await assert.rejects(imports.completeCsvUpload(created.import.id), /has not finished/);
  assert.equal((await job(created.import.id)).status, "uploading");
});

test("direct upload imports multiple batches, quoted newlines and Unicode, while deduplicating and reporting rejected rows", async () => {
  const rows = Array.from({ length: 2505 }, (_, index) => `Company ${index},https://example.com`);
  rows.splice(1500, 0, '"Café,\n東京",https://example.org');
  rows.push(
    " company 0 ,https://changed.example",
    ",https://missing-name.example",
    "A".repeat(201) + ",",
  );
  const id = await upload("\uFEFFCompany,Website\r\n" + rows.join("\r\n"));
  assert.equal(
    (await imports.completeCsvUpload(id)).status,
    "queued",
    "completion requests are idempotent",
  );
  await Promise.all([imports.runCsvImports(), imports.runCsvImports()]);
  const result = await job(id);
  assert.equal(result.status, "completed");
  assert.equal(result.companies, 2506);
  assert.equal(result.duplicates, 1);
  assert.equal(result.rejected, 2);
  assert.equal(result.processed, 2509);
  assert.equal(result.bytesProcessed, result.size);
  const saved = await companyPage("Company 0");
  assert.equal(saved.companies[0].website, "https://example.com/");
  assert.equal(saved.companies[0].contactConfirmed, false);
  assert.equal((await companyPage("Café")).companies[0].name, "Café,\n東京");
  await imports.runCsvImports();
  assert.equal((await companyPage()).total, 2506);
  assert.equal((await imports.completeCsvUpload(id)).status, "completed");
});

test("invalid headers and malformed quoted cells produce readable failures without silently completing", async () => {
  for (const csv of [
    "Unknown,Website\nExample,https://example.com",
    'Company,Website\n"unclosed,https://example.com',
    "Company,company\nA,B",
    "Company\n",
  ]) {
    const id = await upload(csv);
    await imports.runCsvImports();
    const result = await job(id);
    assert.equal(result.status, "failed");
    assert.equal(result.retryable, false);
    assert.ok(result.error);
    assert.equal(result.companies, 0);
  }
  assert.equal((await companyPage()).total, 0);
});

test("an expired import lease resumes committed progress without double-counting after restart", async () => {
  const csv =
    "Company,Website\n" +
    Array.from({ length: 2200 }, (_, i) => `Resume ${i},https://example.com`).join("\n");
  const id = await upload(csv);
  await imports.runCsvImports();
  const completed = await db.get<Record<string, unknown> & { id: string }>("csv-import", id);
  await db.transaction(async () => {
    await db.query(
      "DELETE FROM folio_records WHERE kind='company' AND (substring(data->>'name' FROM 8))::int >= 1000",
    );
    await db.put("csv-import", {
      ...completed!,
      status: "processing",
      processed: 1000,
      companies: 1000,
      bytesProcessed: 100,
      lease: "abandoned-instance",
      leaseUntil: Date.now() - 1,
    });
  });
  await db.closeDatabase();
  await imports.runCsvImports();
  assert.equal((await job(id)).status, "completed");
  assert.equal((await job(id)).companies, 2200);
  assert.equal((await job(id)).duplicates, 0);
  assert.equal((await companyPage()).total, 2200);
});

test("background imports run while scheduled scanning is paused", async () => {
  const id = await upload("Company\nPaused automation import\n");
  await db.put("settings", { ...(await db.settings()), automationPaused: true });
  await runWorker();
  assert.equal((await job(id)).status, "completed");
  assert.equal((await db.tasks()).length, 0);
});

test("checkpoint failures roll back inserted companies and retry imports each company once", async () => {
  const id = await upload(
    "Company\n" + Array.from({ length: 1200 }, (_, i) => `Atomic ${i}`).join("\n"),
  );
  await db.query(`CREATE FUNCTION fail_import_checkpoint() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.kind='csv-import' AND (NEW.data->>'processed')::int > 0 THEN RAISE EXCEPTION 'test checkpoint failure'; END IF;
    RETURN NEW; END $$;
    CREATE TRIGGER fail_checkpoint BEFORE UPDATE ON folio_records FOR EACH ROW EXECUTE FUNCTION fail_import_checkpoint();`);
  try {
    await imports.runCsvImports();
    assert.equal((await companyPage()).total, 0, "insert and checkpoint must roll back together");
    assert.equal((await job(id)).processed, 0);
    assert.equal((await job(id)).status, "queued");
  } finally {
    await db.query(
      "DROP TRIGGER fail_checkpoint ON folio_records; DROP FUNCTION fail_import_checkpoint();",
    );
  }
  await imports.runCsvImports();
  assert.equal((await job(id)).companies, 1200);
  assert.equal((await job(id)).duplicates, 0);
  assert.equal((await job(id)).status, "completed");
});

test("overwritten CSV objects are rejected after completion and before processing", async () => {
  const id = await upload("Company\nOriginal name\n");
  await storageClient().send(
    new PutObjectCommand({
      Bucket: storageBucket(),
      Key: csvKey(id),
      Body: "Company\nReplaced name\n",
    }),
  );
  await imports.runCsvImports();
  assert.equal((await job(id)).status, "failed");
  assert.equal((await job(id)).retryable, false);
  assert.match((await job(id)).error!, /changed/);
  assert.equal((await companyPage()).total, 0);
});

test("retry limits, manual retry and concurrent imports preserve duplicate counts", async () => {
  const csv = "Company\nConcurrent example\n";
  const first = await upload(csv),
    second = await upload(csv);
  const bucket = process.env.S3_BUCKET;
  process.env.S3_BUCKET = "missing-csv-test-bucket";
  try {
    await imports.runCsvImports();
    await imports.runCsvImports();
    await imports.runCsvImports();
    assert.equal((await job(first)).status, "failed");
    assert.equal((await job(first)).retryable, true);
  } finally {
    process.env.S3_BUCKET = bucket;
  }
  await imports.retryCsvImport(first);
  await Promise.all([imports.runCsvImports(), imports.runCsvImports()]);
  assert.equal((await job(first)).status, "completed");
  assert.equal((await job(second)).status, "completed");
  assert.equal((await job(first)).companies + (await job(second)).companies, 1);
  assert.equal((await job(first)).duplicates + (await job(second)).duplicates, 1);
});

test(
  "a real 50 MB CSV imports 50,000 companies and keeps workspace responses paginated",
  { timeout: 180000 },
  async () => {
    const bytes = Buffer.alloc(MAX_CSV_BYTES, "x");
    let offset = bytes.write("Company,Website,Notes\n");
    const count = 50000;
    for (let i = 0; i < count; i++) {
      const rowBytes =
        i === count - 1 ? bytes.length - offset : Math.floor((bytes.length - 22) / count);
      const prefix = `Large company ${i},https://example.com,`;
      bytes.write(prefix, offset);
      bytes[offset + rowBytes - 1] = 10;
      offset += rowBytes;
    }
    const started = performance.now();
    const id = await upload(bytes);
    await imports.runCsvImports();
    const result = await job(id);
    assert.equal(result.status, "completed", result.error || "import must complete");
    assert.equal(result.size, MAX_CSV_BYTES);
    assert.equal(result.companies, count);
    assert.equal(result.processed, count);
    assert.equal(result.duplicates, 0);
    const first = await companyPage();
    const second = await companyPage("", 2);
    assert.equal(first.total, count);
    assert.equal(first.companies.length, 50);
    assert.equal(
      new Set([...first.companies, ...second.companies].map((company) => company.id)).size,
      100,
    );
    assert.equal(
      (await companyPage("Large company 12345")).companies[0].name,
      "Large company 12345",
    );
    const workspace = await state();
    assert.equal(workspace.companyCount, count);
    assert.equal(workspace.companies.length, 100);
    assert.ok(
      Buffer.byteLength(JSON.stringify(workspace)) < 150000,
      "workspace must not serialize every imported company",
    );
    console.log(
      `50 MB / 50,000 companies: ${((performance.now() - started) / 1000).toFixed(2)} seconds on local Postgres and S3 test storage.`,
    );
  },
);

test("proxy text errors and JSON API errors produce human-readable messages", async () => {
  await assert.rejects(
    readJsonResponse(new Response("Request Entity Too Large", { status: 413 })),
    /too large/,
  );
  await assert.rejects(
    readJsonResponse(new Response("<html>Bad Gateway</html>", { status: 502 })),
    /server could not complete/,
  );
  await assert.rejects(
    readJsonResponse(Response.json({ error: "Choose a CSV file." }, { status: 400 })),
    /Choose a CSV/,
  );
  assert.deepEqual(await readJsonResponse(Response.json({ ok: true })), { ok: true });
});
