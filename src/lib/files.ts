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
}
export async function uploadResume(file: File) {
  if (file.size > 4 * 1024 * 1024) throw new AppError("Upload a résumé smaller than 4 MB.");
  const ext = path.extname(file.name).toLowerCase();
  if (![".pdf", ".docx", ".txt"].includes(ext))
    throw new AppError("Use a PDF, DOCX, or plain text résumé.");
  const buffer = Buffer.from(await file.arrayBuffer());
  let text = "";
  try {
    if (ext === ".pdf") {
      if (buffer.subarray(0, 4).toString() !== "%PDF") throw new Error("Invalid PDF");
      const { PDFParse } = await import("pdf-parse");
      const parser = new PDFParse({ data: buffer });
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
  } catch {
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
    name,
    mime:
      ext === ".pdf"
        ? "application/pdf"
        : ext === ".docx"
          ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          : "text/plain",
    size: file.size,
    createdAt: now(),
  };
  try {
    await transaction(async () => {
      await put("file", meta);
      await put("profile", {
        ...(await profile()),
        resumeId: fileId,
        resumeName: name,
        resumeText: text.slice(0, 60000),
        confirmed: false,
        updatedAt: now(),
      });
      for (const job of await all<Job>("job")) await put("job", { ...job, match: null });
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
