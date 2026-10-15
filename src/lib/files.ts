import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { dataDir, get, put, id, now, profile, all, transaction } from "./db";
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
  if (file.size > 8 * 1024 * 1024) throw new AppError("Upload a résumé smaller than 8 MB.");
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
  mkdirSync(path.join(dataDir, "resumes"), { recursive: true, mode: 0o700 });
  writeFileSync(path.join(dataDir, "resumes", fileId), encrypt(buffer.toString("base64")), {
    mode: 0o600,
  });
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
  put("file", meta);
  transaction(() => {
    put("profile", {
      ...profile(),
      resumeId: fileId,
      resumeName: name,
      resumeText: text.slice(0, 60000),
      confirmed: false,
      updatedAt: now(),
    });
    for (const job of all<Job>("job")) put("job", { ...job, match: null });
  });
  return meta;
}
export function readResume(fileId: string) {
  if (!/^[a-f0-9-]{36}$/.test(fileId)) throw new AppError("Invalid résumé reference.");
  const meta = get<ResumeFile>("file", fileId);
  const location = path.join(dataDir, "resumes", fileId);
  if (!meta || !existsSync(location)) throw new AppError("Résumé not found. Upload it again.", 404);
  return { meta, buffer: Buffer.from(decrypt<string>(readFileSync(location, "utf8")), "base64") };
}
