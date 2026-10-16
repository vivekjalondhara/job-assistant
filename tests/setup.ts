import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import {
  S3Client,
  CreateBucketCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";
export async function setupTestStorage() {
  // Deliberately never use DATABASE_URL or the application's production bucket.
  // Account tests must never send invitations through inherited SMTP credentials.
  process.env.ACCOUNT_SMTP_HOST = "";
  process.env.ACCOUNT_MAIL_FROM = "";
  const url = new URL(
    process.env.TEST_DATABASE_URL || "postgres://folio:folio-test-only@127.0.0.1:55439/folio_test",
  );
  const schema = `test_${randomUUID().replaceAll("-", "")}`;
  const admin = new Pool({ connectionString: url.toString() });
  await admin.query(`CREATE SCHEMA ${schema}`);
  url.searchParams.set("options", `-c search_path=${schema}`);
  process.env.DATABASE_URL = url.toString();
  process.env.APP_ENCRYPTION_KEY = "ab".repeat(32);
  process.env.AWS_ENDPOINT_URL_S3 = process.env.TEST_S3_ENDPOINT || "http://127.0.0.1:59039";
  process.env.AWS_ACCESS_KEY_ID = process.env.TEST_S3_ACCESS_KEY || "folio-test";
  process.env.AWS_SECRET_ACCESS_KEY = process.env.TEST_S3_SECRET_KEY || "folio-test-only";
  process.env.AWS_REGION = "us-east-1";
  process.env.S3_BUCKET = process.env.TEST_S3_BUCKET || "folio-tests";
  process.env.S3_PREFIX = schema;
  const s3 = new S3Client({
    endpoint: process.env.AWS_ENDPOINT_URL_S3,
    region: "us-east-1",
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });
  try {
    await s3.send(new CreateBucketCommand({ Bucket: process.env.S3_BUCKET }));
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !["BucketAlreadyOwnedByYou", "BucketAlreadyExists"].includes(error.name)
    )
      throw error;
  }
  return async () => {
    const objects = await s3.send(
      new ListObjectsV2Command({ Bucket: process.env.S3_BUCKET, Prefix: schema + "/" }),
    );
    if (objects.Contents?.length)
      await s3.send(
        new DeleteObjectsCommand({
          Bucket: process.env.S3_BUCKET,
          Delete: { Objects: objects.Contents.map(({ Key }) => ({ Key })) },
        }),
      );
    s3.destroy();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  };
}
