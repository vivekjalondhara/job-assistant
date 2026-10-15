"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDownToLine } from "lucide-react";
import { MAX_CSV_BYTES, type CsvImport } from "@/lib/csv-import-types";
import { HttpError, readJsonResponse } from "@/lib/http-client";
import { Button } from "./ui";

async function request<T>(body: object) {
  return readJsonResponse<T>(
    await fetch("/api/imports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

function uploadFile(file: File, url: string, progress: (percent: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.timeout = 15 * 60 * 1000;
    xhr.setRequestHeader("Content-Type", "text/csv");
    xhr.setRequestHeader("Cache-Control", "private, no-store");
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) progress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new HttpError("The file upload failed. Please retry.", xhr.status));
    xhr.onerror = () =>
      reject(
        new Error(
          "Could not reach file storage. Check your connection. If this persists, the owner should check storage upload permissions.",
        ),
      );
    xhr.ontimeout = () =>
      reject(new Error("The upload timed out. Please retry on a stable connection."));
    xhr.send(file);
  });
}

export function CsvImportPanel({ onChanged }: { onChanged: () => Promise<void> }) {
  const [imports, setImports] = useState<CsvImport[]>([]);
  const [upload, setUpload] = useState<{ name: string; percent: number } | null>(null);
  const [error, setError] = useState("");
  const [statusError, setStatusError] = useState("");
  const [retrying, setRetrying] = useState("");
  const pending = useRef<{ file: File; id: string; url: string; uploaded: boolean } | null>(null);
  const signatures = useRef<string | null>(null);
  const load = useCallback(async () => {
    const result = await readJsonResponse<{ imports: CsvImport[] }>(
      await fetch("/api/imports", { cache: "no-store" }),
    );
    setImports(result.imports);
    setStatusError("");
    const next = result.imports
      .map((item) => `${item.id}:${item.processed}:${item.status}`)
      .join("|");
    if (signatures.current !== null && signatures.current !== next) await onChanged();
    signatures.current = next;
  }, [onChanged]);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        await load();
      } catch (e) {
        if (!stopped)
          setStatusError(e instanceof Error ? e.message : "Could not load import progress.");
      } finally {
        if (!stopped) timer = setTimeout(poll, 3000);
      }
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [load]);
  useEffect(() => {
    if (!upload) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [upload]);

  async function send(file: File, resume = false) {
    if (upload) return;
    setError("");
    if (!/\.csv$/i.test(file.name) || !file.size || file.size > MAX_CSV_BYTES) {
      setError("Choose a non-empty CSV file up to 50 MB.");
      return;
    }
    setUpload({ name: file.name, percent: 0 });
    try {
      if (!resume || !pending.current) {
        const result = await request<{ import: CsvImport; uploadUrl: string }>({
          action: "start",
          name: file.name,
          size: file.size,
        });
        pending.current = { file, id: result.import.id, url: result.uploadUrl, uploaded: false };
      }
      const current = pending.current!;
      if (!current.uploaded) {
        if (resume)
          current.url = (
            await request<{ uploadUrl: string }>({ action: "resume", id: current.id })
          ).uploadUrl;
        await uploadFile(file, current.url, (percent) => setUpload({ name: file.name, percent }));
        current.uploaded = true;
      }
      // A lost completion response can be retried without uploading or importing twice.
      await request({ action: "complete", id: current.id });
      pending.current = null;
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed. Please retry.");
    } finally {
      setUpload(null);
    }
  }

  async function retry(value: CsvImport) {
    setRetrying(value.id);
    setError("");
    try {
      await request({ action: "retry", id: value.id });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Retry failed.");
    } finally {
      setRetrying("");
    }
  }

  return (
    <div className="csv-import-panel panel" aria-label="CSV import">
      <div className="csv-import-heading">
        <div>
          <strong>Import your company list</strong>
          <p className="small muted">
            CSV files up to 50 MB. Existing companies are kept and duplicates are skipped.
          </p>
        </div>
        <label className={`btn secondary file-button ${upload ? "disabled" : ""}`}>
          <ArrowDownToLine size={16} /> Import CSV
          <input
            type="file"
            accept=".csv,text/csv"
            aria-label="Import CSV"
            disabled={!!upload}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void send(file);
              event.target.value = "";
            }}
          />
        </label>
      </div>
      {upload && (
        <div className="csv-import-progress" role="status">
          <span>
            Uploading {upload.name} · {upload.percent}%
          </span>
          <progress max={100} value={upload.percent} aria-label="CSV upload progress" />
          <span className="small muted">
            Keep this tab open until the upload finishes. Importing then continues in the
            background.
          </span>
        </div>
      )}
      {(error || statusError) && (
        <div className="notice" role="alert">
          <span>{error || statusError}</span>
          {pending.current && !upload && (
            <Button onClick={() => void send(pending.current!.file, true)}>Retry upload</Button>
          )}
        </div>
      )}
      {imports
        .filter((item) => item.status !== "uploading")
        .slice(0, 3)
        .map((item) => (
          <div className="csv-import-result" key={item.id}>
            <div className="csv-import-heading">
              <strong>{item.name}</strong>
              <span>
                {item.status === "completed"
                  ? "Import complete"
                  : item.status === "failed"
                    ? "Import needs attention"
                    : item.status === "queued"
                      ? "Queued for import"
                      : "Importing…"}
              </span>
            </div>
            {["queued", "processing"].includes(item.status) && (
              <progress
                max={item.size}
                value={item.bytesProcessed}
                aria-label={`Import progress for ${item.name}`}
              />
            )}
            <p className="small" role="status">
              {item.processed.toLocaleString()} rows processed · {item.companies.toLocaleString()}{" "}
              added · {item.duplicates.toLocaleString()} duplicates ·{" "}
              {item.rejected.toLocaleString()} invalid
            </p>
            {item.error && (
              <p className="small" role="alert">
                {item.error}
              </p>
            )}
            {item.status === "failed" && item.retryable && (
              <Button busy={retrying === item.id} onClick={() => void retry(item)}>
                Retry import
              </Button>
            )}
            {!!item.issues.length && (
              <details>
                <summary>
                  View invalid rows{item.rejected > item.issues.length ? " (first 20)" : ""}
                </summary>
                <ul>
                  {item.issues.map((issue) => (
                    <li key={issue.row}>
                      Line {issue.row}: {issue.message}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        ))}
    </div>
  );
}
