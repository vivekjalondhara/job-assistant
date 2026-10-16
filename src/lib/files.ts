import { assertStorageAvailable } from "./account-limits";
import { putObject, readObject, deleteObject, resumeKey } from "./storage";
import path from "node:path";
import { get, put, id, now, profile, all, transaction } from "./db";
import type { Job } from "./types";
import { AppError, encrypt, decrypt } from "./security";
export interface ResumeFile {
  id: string;
  name: string;
  mime: string;
  size: number;
  createdAt: string;
  text?: string;
  label?: string;
  targetRole?: string;
  version?: number;
  previousId?: string;
}
export async function uploadResume(file: File, previousId?: string) {
  const previous = previousId ? await get<ResumeFile>("file", previousId) : null;
  if (previousId && !previous) throw new AppError("Previous résumé not found.", 404);
  if (file.size > 4 * 1024 * 1024) throw new AppError("Upload a résumé smaller than 4 MB.");
  const ext = path.extname(file.name).toLowerCase();
  if (![".pdf", ".docx", ".txt"].includes(ext))
    throw new AppError("Use a PDF, DOCX, or plain text résumé.");
  const buffer = Buffer.from(await file.arrayBuffer());
  let text = "";
  let stage = "validate";
  try {
    if (ext === ".pdf") {
      if (buffer.subarray(0, 4).toString() !== "%PDF") throw new Error("Invalid PDF");
      stage = "pdf-initialize";
      // Load Node canvas globals before PDF.js and embed the worker so serverless
      // tracing cannot omit a worker file resolved dynamically at runtime.
      const { CanvasFactory, getData } = await import("pdf-parse/worker");
      const { PDFParse } = await import("pdf-parse");
      PDFParse.setWorker(getData());
      const parser = new PDFParse({ data: buffer, CanvasFactory });
      stage = "pdf-extract";
      try {
        text = (await parser.getText()).text;
      } finally {
        await parser.destroy();
      }
    } else if (ext === ".docx") {
      if (buffer.subarray(0, 2).toString() !== "PK") throw new Error("Invalid DOCX");
      const { unzipSync, strFromU8 } = await import("fflate");
      const files = unzipSync(buffer, {
        filter: (entry) => entry.name === "word/document.xml" && entry.originalSize < 10000000,
      });
      const document = files["word/document.xml"];
      if (!document) throw new Error("Missing document or document too large");
      text = strFromU8(document)
        .replace(/<w:tab\b[^>]*\/>/g, "\t")
        .replace(/<\/w:p>/g, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'");
    } else {
      text = buffer.toString("utf8");
    }
  } catch (error) {
    // Do not log résumé contents, filenames, or raw parser messages.
    console.error("resume_parse_failed", {
      format: ext,
      stage,
      error: error instanceof Error ? error.name : "UnknownError",
    });
    if (stage === "pdf-initialize")
      throw new AppError(
        "PDF processing is temporarily unavailable. Try a DOCX or TXT résumé.",
        503,
      );
    if (error instanceof Error && error.name === "PasswordException")
      throw new AppError("This PDF is password-protected. Upload an unlocked copy.");
    throw new AppError("Could not read this résumé. Try a text-based PDF, DOCX, or TXT file.");
  }
  if (text.trim().length < 30)
    throw new AppError(
      "This file has too little readable text. Scanned PDFs need OCR; upload DOCX or TXT instead.",
    );
  const fileId = id();
  const name = file.name.replace(/[\r\n/\\]/g, "_").slice(0, 160);
  await putObject(resumeKey(fileId), encrypt(buffer.toString("base64")));
  const meta: ResumeFile = {
    id: fileId,
    version: (previous?.version || (previous ? 1 : 0)) + 1,
    previousId: previous?.id,
    label: previous?.label,
    targetRole: previous?.targetRole,
    name,
    mime:
      ext === ".pdf"
        ? "application/pdf"
        : ext === ".docx"
          ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          : "text/plain",
    size: file.size,
    createdAt: now(),
    text: text.slice(0, 60000),
  };
  try {
    await transaction(async () => {
      if (previousId && !(await get("file", previousId)))
        throw new AppError("Previous résumé was deleted. Upload this as a new résumé.", 409);
      await assertStorageAvailable(file.size);
      const firstUpload = (await all("file")).length === 0;
      await put("file", meta);
      const currentProfile = await profile();
      if (firstUpload && !currentProfile.resumeId) {
        await put("profile", {
          ...currentProfile,
          resumeId: fileId,
          defaultResumeId: currentProfile.defaultResumeId ?? fileId,
          resumeName: name,
          resumeText: text.slice(0, 60000),
          confirmed: false,
          updatedAt: now(),
        });
        for (const job of await all<Job>("job")) await put("job", { ...job, match: null });
      }
    });
  } catch (error) {
    await deleteObject(resumeKey(fileId)).catch(() => {});
    throw error;
  }
  return meta;
}
export async function readResume(fileId: string) {
  if (!/^[a-f0-9-]{36}$/.test(fileId)) throw new AppError("Invalid résumé reference.");
  const meta = await get<ResumeFile>("file", fileId);
  if (!meta) throw new AppError("Résumé not found. Upload it again.", 404);
  const encrypted = await readObject(resumeKey(fileId));
  return { meta, buffer: Buffer.from(decrypt<string>(encrypted), "base64") };
}
export async function selectedResume(
  attach: boolean,
  selectedId: string | undefined,
  fallbackId: string,
) {
  const resumeId = attach ? (selectedId ?? fallbackId) : "";
  const file = resumeId ? await get<ResumeFile>("file", resumeId) : null;
  if (attach && !file) throw new AppError("Choose an uploaded résumé before continuing.");
  return { resumeId, resumeName: file?.name || "" };
}
