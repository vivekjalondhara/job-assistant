# 50 MB CSV import verification

Implemented on 2026-10-15. The application code is in this workspace; it has not been deployed to Vercel by this task.

## Behavior

- The browser uploads CSV files up to 50,000,000 bytes directly to the existing private S3-compatible bucket using a short-lived signed URL. Vercel receives only metadata.
- Background processing streams the CSV and writes up to 1,000 rows per transaction. Progress and company writes commit together; retries and restarted workers skip already committed records.
- Imports preserve existing companies, leave imported contacts unconfirmed, and report duplicate/invalid counts. Malformed CSV produces a readable error with saved-batch information.
- The interface shows upload/import progress, supports retrying interrupted uploads and failed processing, and searches/paginates the full company list. Workspace responses contain a bounded company subset, plus companies referenced by loaded jobs/drafts. The vacancy form can search beyond that subset.
- Resume uploads still use the 4 MiB limit. Plain-text/HTML proxy errors no longer become JSON parsing errors in upload/action handling.

## Verification

- `node --import tsx --test tests/csv-imports.test.ts`: ten passing integration/behavioral tests with isolated PostgreSQL schemas and private MinIO prefixes. Includes a real 50 MB / 50,000-company file, quoted multiline Unicode cells, duplicate protection, rejected rows, malformed headers/CSV, restart recovery, transactional rollback on checkpoint failure, object replacement detection, transient retry limits, paused automation, pagination, and non-JSON errors.
- The local 50 MB backend scenario completed in approximately 4.5–4.8 seconds. These are local measurements, not production latency guarantees.
- `node --import tsx --test tests/cron.test.ts tests/cloud.test.ts`: 18 passing tests for scheduling, persistence, authentication, worker leases, and unchanged résumé storage.
- Targeted existing core tests passed for CSV compatibility, TXT/DOCX uploads, source behavior, and contact validation.
- `npm run typecheck`: passed.
- `node --import tsx tests/http-smoke.ts --serve`: isolated production build and HTTP smoke passed, including PDF packaging, authentication, existing uploads, persistence, and new import authentication/origin/request-size checks.
- Automated Chromium at `http://localhost:3218/?view=companies`: uploaded an actual 50 MB file, observed **Import complete** with 50,000 added companies, used Next/search, verified the 100-company workspace subset, and rejected a file over 50 MB before any import request. No JavaScript exceptions or unexpected failed HTTP responses.
- A deliberately interrupted storage upload displayed **Retry upload** and completed after retry without duplicate creation. Mobile navigation/search and layout were checked at 390 × 844.
- Screenshots: `output/csv-import-desktop.png` and `output/csv-import-mobile.png`. The connected user Chrome session was unavailable; browser checks used the isolated test server and test credentials, never production data.

The browser runner is `tests/csv-import-browser.mjs`. Run it against a fresh `tests/http-smoke.ts --serve` instance. It uses an installed `playwright` module, or `PLAYWRIGHT_MODULE` pointing to that module. `PLAYWRIGHT_CHROMIUM_EXECUTABLE` can select an installed Chromium executable. It refuses non-local server origins.

## Production setup and remaining rollout

The existing storage bucket was configured to allow signed PUT uploads from `https://job-assistant-nine.vercel.app`, preserving existing CORS rules. A real preflight check returned HTTP 200 with that exact allowed origin and `PUT`, `content-type`, and `cache-control`. The bucket was not made public. No production CSV data was imported.

Deploy the updated application code to the existing Vercel project and reload the Companies page. No additional service or environment variable is required. The new company-name index is initialized through the existing database setup. For another app origin, run `npm run storage:cors -- https://your-app.example`.

Processing is bounded by Vercel's function duration. Unfinished jobs resume on the next status/workspace request, local-worker tick, or cron invocation. With the current daily cron, a terminated run with the browser closed may wait until the next daily invocation; use a more frequent scheduler if faster unattended recovery is needed. See README for CSV validation and temporary-file retention details.
