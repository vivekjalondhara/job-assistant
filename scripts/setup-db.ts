import { config } from "dotenv";
config({ path: ".env", quiet: true });
const { initializeDatabase, closeDatabase } = await import("../src/lib/db");
try {
  await initializeDatabase();
  console.log("Neon/Postgres schema is ready.");
} catch (error) {
  console.error("Database setup failed. Check DATABASE_URL, connectivity, and schema permissions.");
  console.error(error instanceof Error ? error.name : "Unknown error");
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
