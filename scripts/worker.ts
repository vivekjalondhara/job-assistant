import { config } from "dotenv";
config({ path: ".env", quiet: true });
const { runWorker } = await import("../src/lib/worker");
const { closeDatabase } = await import("../src/lib/db");
let stopping = false;
process.on("SIGTERM", () => {
  stopping = true;
});
process.on("SIGINT", () => {
  stopping = true;
});
console.log("Folio worker started. Sending remains an explicit user action.");
while (!stopping) {
  try {
    await runWorker();
  } catch {
    console.error("[worker] Task processing failed; retrying on the next tick.");
  }
  if (!stopping) await new Promise((resolve) => setTimeout(resolve, 2500));
}
await closeDatabase();
