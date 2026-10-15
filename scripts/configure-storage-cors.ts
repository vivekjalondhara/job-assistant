import { config } from "dotenv";
import { GetBucketCorsCommand, PutBucketCorsCommand, type CORSRule } from "@aws-sdk/client-s3";
config({ quiet: true });
const { storageClient, storageBucket } = await import("../src/lib/storage");
const { appUrl } = await import("../src/lib/security");

// Preserve other consumers' rules. This allows signed uploads from this app only;
// it does not make the bucket public or grant unauthenticated storage access.
const origin = new URL(process.argv[2] || appUrl()).origin;
const client = storageClient();
let rules: CORSRule[];
try {
  rules =
    (await client.send(new GetBucketCorsCommand({ Bucket: storageBucket() }))).CORSRules || [];
} catch (error) {
  if (!(error instanceof Error) || error.name !== "NoSuchCORSConfiguration") throw error;
  rules = [];
}
const ruleId = `folio-csv-${new URL(origin).host}`.slice(0, 255);
await client.send(
  new PutBucketCorsCommand({
    Bucket: storageBucket(),
    CORSConfiguration: {
      CORSRules: [
        ...rules.filter((rule) => rule.ID !== ruleId),
        {
          ID: ruleId,
          AllowedOrigins: [origin],
          AllowedMethods: ["PUT"],
          AllowedHeaders: ["content-type", "cache-control"],
          MaxAgeSeconds: 3600,
        },
      ],
    },
  }),
);
console.log(`Direct CSV uploads enabled for ${origin}. Existing storage CORS rules preserved.`);
client.destroy();
