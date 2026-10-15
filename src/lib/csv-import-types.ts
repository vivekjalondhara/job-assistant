export const MAX_CSV_BYTES = 50_000_000;
export const CSV_BATCH_ROWS = 1000;
export const CSV_BATCH_BYTES = 1_000_000;

export interface CsvImport {
  id: string;
  name: string;
  size: number;
  status: "uploading" | "queued" | "processing" | "completed" | "failed";
  processed: number;
  bytesProcessed: number;
  companies: number;
  duplicates: number;
  rejected: number;
  issues: { row: number; message: string }[];
  error: string | null;
  retryable: boolean;
  createdAt: string;
  updatedAt: string;
}
