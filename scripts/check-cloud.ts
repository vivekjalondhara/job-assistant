import { config } from "dotenv";
import { randomUUID } from "node:crypto";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { GetObjectCommand } from "@aws-sdk/client-s3";
config({ path: ".env", quiet: true });
const { query, closeDatabase } = await import("../src/lib/db");
const { putObject, readObject, deleteObject, storageBucket, storageClient } =
  await import("../src/lib/storage");
const { encrypt, decrypt, secret } = await import("../src/lib/security");
let step = "configuration";
const key = `folio/checks/${randomUUID()}`;
let uploaded = false;
try {
  secret();
  step = "database";
  await query("SELECT 1");
  console.log("Postgres connection and schema: OK");
  step = "object storage upload";
  await putObject(key, encrypt("Folio storage verification"));
  uploaded = true;
  step = "object storage download";
  if (decrypt(await readObject(key)) !== "Folio storage verification")
    throw new Error("Round-trip mismatch");
  // Verify signing with the supplied S3-compatible provider without printing a bearer URL.
  step = "signed download";
  const url = await getSignedUrl(
    storageClient(),
    new GetObjectCommand({ Bucket: storageBucket(), Key: key }),
    { expiresIn: 60 },
  );
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok || decrypt(await response.text()) !== "Folio storage verification")
    throw new Error("Signed download failed");
  step = "private access";
  const unsigned = new URL(url);
  unsigned.search = "";
  const anonymous = await fetch(unsigned, { signal: AbortSignal.timeout(15000) });
  if (![401, 403].includes(anonymous.status)) throw new Error("Bucket must deny anonymous reads");
  console.log(
    "Private S3 upload, download, encryption, signed URL, and anonymous-access denial: OK",
  );
} catch (error) {
  console.error(
    `Cloud check failed at ${step}. Check the corresponding .env values and provider permissions.`,
  );
  console.error(error instanceof Error ? error.name : "Unknown error");
  process.exitCode = 1;
} finally {
  if (uploaded) {
    try {
      await deleteObject(key);
      console.log("Verification object removed.");
    } catch {
      console.error("Could not remove the verification object; check storage delete permissions.");
      process.exitCode = 1;
    }
  }
  await closeDatabase();
}
