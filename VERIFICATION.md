# Multiple allowed Gmail accounts — 2026-10-15

`GOOGLE_ALLOWED_EMAIL` accepts one address or a comma-separated list. The workspace connects one mailbox at a time and supports disconnecting and choosing another allowed account. Settings continues to offer Disconnect when an account needs reconnection. Drafts record the sender, approvals include that sender, and replies/follow-ups stay with the original mailbox.

- All **61 automated tests passed** against isolated PostgreSQL schemas and MinIO prefixes. The 14 additional tests cover address parsing, invalid/unlisted accounts, verified Google identity and audience, account selection, connect/disconnect/switch, refresh-token ownership, legacy draft ownership, sender changes, reply isolation, follow-up restrictions, removed allowed addresses, and stale refresh/disconnect responses.
- TypeScript passed. The isolated production build and HTTP smoke passed, including login, workspace rendering, uploads, background jobs, cron authentication, and persistence after restart.
- Google OAuth and Gmail responses were mocked; no actual Google authorization or email sending occurred. Signed-in browser interaction remains deferred at the user's request.
- The source and setup instructions are ready. Vercel deployment and the user's actual allowed email values still need to be applied. See **Connect Gmail** in [README.md](README.md).

---

# PDF upload deployment fix — 2026-10-15

The reported two-page PDF parses locally to 7,019 readable characters. Running the parser with only the upload route's traced deployment dependencies reproduced `ReferenceError: DOMMatrix is not defined`: `@napi-rs/canvas` was absent from the package.

The upload path now initializes `pdf-parse/worker` before `pdf-parse`, supplies its canvas factory, and uses the embedded worker. Canvas is explicitly external in Next.js configuration. Initialization failures return a server error instead of suggesting that a valid résumé is unreadable; logs record the parsing stage and error type without résumé contents.

- Production build and HTTP smoke passed with the user's exact PDF, including extracted text, encrypted storage, byte-for-byte download, and invalid-PDF rejection without replacing the previous résumé.
- The same PDF parses successfully using only the new upload route's traced dependencies. `tests/pdf-deployment.ts` checks this packaging regression; ordinary full-node_modules tests would miss it.
- All 47 automated tests passed. No production data was changed by these tests. The source changes still require deployment to Vercel.

Run `npx tsx tests/http-smoke.ts` with isolated test services running. It uses a generated PDF fixture by default; optionally set `TEST_RESUME_PDF` to a local PDF path. Personal PDF contents are not included in the repository or test output.

---

# Neon and S3 migration verification — 2026-10-15

The application now uses asynchronous Postgres persistence and encrypted private S3 object storage. Local configuration is `.env`; the former `.env.local` was preserved as `.env.local.unused-backup` so it cannot override `.env`. The requested online workspace starts fresh.

- 42 automated tests passed against isolated PostgreSQL schemas and MinIO object prefixes. They cover existing behavior plus transaction rollback, concurrent owner creation, rate limits, task deduplication/claims, worker leases, storage failures, persistence, setup-token enforcement, cron authentication, and Vercel origin selection.
- TypeScript and the production build passed. The HTTP smoke script builds in an isolated temporary directory and checks signup, login, workspace rendering, profile saves, CSV imports, encrypted résumé upload/download, background jobs, cron authentication, logout, and persistence after a server restart.
- Browser verification signed into the isolated production app and opened the workspace with no console errors.
- The configured Neon database schema was initialized successfully. Subsequent local connections experienced network timeouts; this environment's direct Neon connectivity is intermittent.
- Created the configured `assets` bucket in Neon. Actual encrypted upload/download and presigned GET passed; unsigned reads returned 403. Verification objects were deleted.
- The deployed `/login` now returns 200 and shows first-owner setup. A subsequent production signup-origin check returned 403 because the deployed application origin did not match the public site. The final source includes a tested Vercel-domain fallback, but that finishing change still requires deployment. Set production `APP_URL=https://job-assistant-nine.vercel.app` and ensure the required `.env.example` values, including `APP_SETUP_TOKEN`, are also present in Vercel.
- No existing local workspace was migrated. No employer emails were sent, and no paid AI requests were made.

Run `docker compose -f compose.test.yml up -d`, then `npm test` and `npx tsx tests/http-smoke.ts`. Tests do not use the production `.env`. Run `npm run cloud:check` separately to verify configured Neon services.

---

The earlier verification notes below describe the pre-migration version.

# Verification — 15 October 2026

The job-description guidance, local email generation, editable AI writing instructions, exports, and approval checks are implemented in the source code.

| Check                                                   | Result                                                                    |
| ------------------------------------------------------- | ------------------------------------------------------------------------- |
| Automated behavioral tests (`npm test`)                 | **32 passed; 0 failed**                                                   |
| TypeScript (`npm run typecheck`)                        | Passed                                                                    |
| Production build (`npm run build`)                      | Passed in an isolated copy of the final source and installed dependencies |
| Dependency audit (`npm audit`)                          | 0 reported vulnerabilities                                                |
| Formatting (Prettier on files changed for this feature) | Passed                                                                    |
| Patch whitespace (`git diff --check`)                   | Passed                                                                    |
| Signed-in browser interactions                          | Deferred at the user's request                                            |
| Live OpenRouter and Gmail                               | Not exercised; automated provider tests use mocked responses              |

## What the tests cover

- Job skill coverage does not penalize unrelated candidate skills; aliases, duplicate skills, punctuation boundaries, and unrelated role titles are handled.
- Relevant work examples and requirement excerpts are returned from the supplied text. Skills mentioned only in a negative experience statement are not turned into listed qualifications.
- Local email generation includes the correct company, role, and profile evidence; respects the attachment selection; and makes no external request.
- Unconfirmed profiles, closed vacancies, stale editors, application-template use on follow-ups, and rewriting sent/sending/uncertain emails are rejected.
- Subject/header validation, placeholders, malformed recipients, and missing promised attachments are detected.
- Contact confirmation and its source are enforced on the server; changing a contact after approval blocks sending.
- Manual content changes clear generated evidence; AI writing instructions are preserved after generation.
- AI requests carry the job, confirmed evidence, writing instructions, and actual attachment choice. Invalid evidence or attachment claims leave the existing email unchanged. Stale versions and excessive instructions are rejected before a provider call.
- An empty draft with an outdated profile can be regenerated; its approval stays blocked until current content is reviewed. This includes server-rendered control assertions and a generation action, not browser interaction.
- Existing authentication/encryption, vacancy-source restrictions, CSV imports, failed-feed preservation, résumé extraction, approval integrity, concurrent sends, uncertain sends, and changes during sending continue to pass.

## Limits of this verification

The browser reached `http://localhost:3210/login`; signed-in UI checks were then deferred at the user's request. Clipboard/download behavior, responsive layout, accessibility, and browser console/network behavior for the new screens still need interactive verification. No employer emails were sent.

An audit with zero reported vulnerabilities is not a complete security audit. Keyword matching cannot establish qualification or hiring probability, and checking AI evidence quotes cannot prove every generated claim is true. Review the complete email and original listing.

The production build ran in `/tmp/folio-build-check-2ao5ult4` to avoid replacing the build used by the process already running on port 3210. That running production process was not restarted. To use the updated source in production mode, stop the existing app, run `npm run build`, then `npm start`. Development mode uses `npm run dev` instead. Preserve the existing `.env.local` and data directory.

See [PROMPTS.md](PROMPTS.md) for the workflow, writing-instruction examples, prompt definitions, and content-check limitations.
