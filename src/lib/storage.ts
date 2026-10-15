import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Readable } from "node:stream";
import { AppError } from "./security";

let client: S3Client | undefined;
export function storageClient() {
  for (const key of [
    "AWS_ENDPOINT_URL_S3",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_REGION",
  ])
    if (!process.env[key]) throw new Error(`Set ${key} for private S3-compatible résumé storage.`);
  return (client ||= new S3Client({
    endpoint: process.env.AWS_ENDPOINT_URL_S3,
    region: process.env.AWS_REGION,
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  }));
}
export const storageBucket = () => process.env.S3_BUCKET || "assets";
export const resumeKey = (id: string) => `${process.env.S3_PREFIX || "folio"}/resumes/${id}`;
export const csvKey = (id: string) => `${process.env.S3_PREFIX || "folio"}/imports/${id}.csv`;

export async function csvUploadUrl(id: string, size: number) {
  return getSignedUrl(
    storageClient(),
    new PutObjectCommand({
      Bucket: storageBucket(),
      Key: csvKey(id),
      ContentLength: size,
      ContentType: "text/csv",
      CacheControl: "private, no-store",
    }),
    { expiresIn: 3600 },
  );
}

export async function csvObjectInfo(id: string) {
  const result = await storageClient().send(
    new HeadObjectCommand({
      Bucket: storageBucket(),
      Key: csvKey(id),
    }),
    { abortSignal: AbortSignal.timeout(15000) },
  );
  return { size: result.ContentLength, etag: result.ETag };
}

export async function csvObjectStream(id: string, etag: string, signal: AbortSignal) {
  const result = await storageClient().send(
    new GetObjectCommand({
      Bucket: storageBucket(),
      Key: csvKey(id),
      IfMatch: etag,
    }),
    { abortSignal: signal },
  );
  if (!result.Body) throw new AppError("The uploaded CSV could not be read.");
  return result.Body as Readable;
}
export async function putObject(key: string, encrypted: string) {
  await storageClient().send(
    new PutObjectCommand({
      Bucket: storageBucket(),
      Key: key,
      Body: encrypted,
      ContentType: "application/octet-stream",
      CacheControl: "private, no-store",
    }),
    { abortSignal: AbortSignal.timeout(30000) },
  );
}
export async function readObject(key: string) {
  try {
    const response = await storageClient().send(
      new GetObjectCommand({ Bucket: storageBucket(), Key: key }),
      { abortSignal: AbortSignal.timeout(30000) },
    );
    if (!response.Body) throw new Error("Object storage returned an empty body.");
    return await response.Body.transformToString();
  } catch (error) {
    if (error instanceof Error && (error.name === "NoSuchKey" || error.name === "NotFound"))
      throw new AppError("Résumé not found. Upload it again.", 404);
    throw error;
  }
}
export async function deleteObject(key: string) {
  await storageClient().send(new DeleteObjectCommand({ Bucket: storageBucket(), Key: key }), {
    abortSignal: AbortSignal.timeout(30000),
  });
}
