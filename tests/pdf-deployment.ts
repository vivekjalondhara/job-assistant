import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// A real PDF with selectable text; no personal résumé data belongs in fixtures.
export function resumePdf() {
  const stream =
    "BT /F1 12 Tf 50 750 Td (Test Candidate: TypeScript and PostgreSQL developer.) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

// A normal local build can hide missing serverless dependencies because it can
// access all of node_modules. Parse using ONLY the upload route's traced files.
export function verifyPdfDeployment(directory: string, pdf: Buffer) {
  const traceDirectory = path.join(directory, ".next/server/app/api/upload");
  const trace = JSON.parse(readFileSync(path.join(traceDirectory, "route.js.nft.json"), "utf8"));
  const isolated = mkdtempSync(path.join(tmpdir(), "folio-pdf-package-"));
  try {
    for (const file of trace.files as string[]) {
      const source = path.resolve(traceDirectory, file);
      const relative = path.relative(directory, source);
      if (!relative.startsWith("node_modules/")) continue;
      const target = path.join(isolated, relative);
      mkdirSync(path.dirname(target), { recursive: true });
      copyFileSync(source, target);
    }
    const result = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
      import { readFileSync } from 'node:fs';
      const { CanvasFactory, getData } = await import('pdf-parse/worker');
      const { PDFParse } = await import('pdf-parse');
      PDFParse.setWorker(getData());
      const parser = new PDFParse({ data: readFileSync(0), CanvasFactory });
      try {
        const result = await parser.getText();
        if (result.text.trim().length < 30) throw new Error('No readable résumé text');
        console.log(JSON.stringify({ pages: result.total, characters: result.text.trim().length }));
      } finally { await parser.destroy(); }
    `,
      ],
      { cwd: isolated, input: pdf, encoding: "utf8", timeout: 30000 },
    );
    assert.equal(result.status, 0, `PDF extraction with deployed dependencies: ${result.stderr}`);
    console.log("Packaged PDF dependencies passed:", result.stdout.trim());
  } finally {
    rmSync(isolated, { recursive: true, force: true });
  }
}
