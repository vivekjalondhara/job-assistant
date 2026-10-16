# Folio — your private job assistant

A private application for organizing your job search: confirm your experience, import companies, find supported vacancies, review matches, write tailored emails with OpenRouter, save Gmail drafts, approve and send, and track replies.

Supports admin-managed user accounts with private workspaces and multiple résumés. Records persist in Neon Postgres; encrypted résumé files persist in a private S3-compatible bucket, including Neon Object Storage. The web app runs on Vercel or locally. OpenRouter uses server-managed credentials; each user connects their own Gmail account. See [accounts and résumé setup](MULTI_USER.md).

The workspace also includes a **Today** shortlist, structured job preferences, saved searches, job-link/text import, reusable email templates, selectable résumé versions, and application notes, interview dates and reminders. See [Job search and reusable email workflows](CAREER_UPGRADES.md) for the full workflow and supported import sources.

## Start the application

Use Node.js 22.16 or newer (tested on Node 22.23.1).

```bash
cd /home/vivek-jalondhara/Documents/JOB/job-assistant
npm ci
cp .env.example .env
npm run db:setup
npm run cloud:check
npm run build
npm start
```

If `.env` already exists, edit it instead of copying over it. Fill the required database, storage, encryption, setup-token, and cron values shown in `.env.example`. Use `.env` for configuration; remove or rename old override files so Next.js does not load stale values. Open **http://localhost:3210**, enter `APP_SETUP_TOKEN`, your name and email, and choose an administrator password (at least 12 characters). Later logins use email and password. Existing owners sign in with their original password and enter an email once to claim it. Use the origin in `APP_URL` consistently.

For development, run `npm run dev`. Local `dev` and `start` launch the web app and worker. The worker reads `.env`. On Vercel, authenticated actions and workspace polling run queued tasks with Next.js `after()`, and a protected cron route starts scheduled checks. Automatic sending is never enabled.

## Deploy on Vercel with Neon

1. Connect a Neon database and copy its pooled connection string into `DATABASE_URL`. Neon connections use the serverless WebSocket driver; ordinary Postgres connections use `pg`. Tables and indexes are initialized automatically, or explicitly with `npm run db:setup`.
2. In the same Neon branch, create a **private** Object Storage bucket named `assets`. Copy `AWS_ENDPOINT_URL_S3`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and `AWS_REGION` from Neon. Set `S3_BUCKET=assets`.
3. Generate separate `APP_ENCRYPTION_KEY`, `APP_SETUP_TOKEN`, and `CRON_SECRET` values using `openssl rand -hex 32`. Keep the encryption key permanent. An existing configured key must not be replaced.
4. Add these values in **Vercel → Project → Settings → Environment Variables**. Set `APP_URL=https://job-assistant-nine.vercel.app` for production. If it is missing or still points to localhost on Vercel, the app falls back to Vercel’s production-domain variable. The local `.env` is ignored by Git and excluded from the function bundle; it is not uploaded automatically.
5. Add the optional OpenRouter and Google values if using those integrations. Set the Google callback to `https://job-assistant-nine.vercel.app/api/auth/google/callback`.
6. Deploy the updated code. Visit `/login`, enter your setup token once, and choose a password. This prevents a stranger from claiming an empty private installation.

`npm run cloud:check` verifies the database and performs an encrypted upload/download, a short-lived signed download, and an anonymous-access check. Its temporary object is deleted and its signed URL is never logged. Application downloads go through the authenticated résumé route, which decrypts the file.

`vercel.json` schedules `/api/cron` daily at 06:00 UTC. While the workspace is open, its authenticated polling also processes queued jobs and schedules reply checks. For more frequent unattended checks, configure a schedule supported by your Vercel plan or an external scheduler that sends `Authorization: Bearer <CRON_SECRET>`. The worker uses a database lease, atomic task claims, and bounded execution. Large feeds can time out safely; existing listings are retained.

See [Cron verification and Vercel setup](CRON_SETUP.md) for the required production settings, IST schedule, authenticated check, and current verification results. Enable **Check companies daily** in Folio Settings; it is off by default.

Résumé uploads are limited to **4 MB** to fit Vercel's request limit. CSV imports support **50 MB** through signed uploads directly to the private object-storage bucket. Run `npm run storage:cors -- https://your-app.vercel.app` once for each app origin (and `http://localhost:3210` for local development) to permit browser uploads; existing bucket CORS rules are preserved. The server encrypts résumé binaries before storing them. Database records, including extracted profile text, are stored in Postgres. Use a separate Neon branch and bucket credentials for preview deployments; previews should not share production data.

## Use it, one step at a time

1. **My profile:** upload a PDF, DOCX, or TXT résumé (up to 4 MB). Fill your skills, experience, projects, target roles, location preferences, and signature. AI extraction is optional. Check the facts and confirm your profile. Image-only/scanned résumés need conversion to searchable text first.
2. **Companies:** add companies manually or upload a CSV with **Import CSV**. Supported column names include `Company`, `Website`, `Careers URL`, `Recruitment email`, and `Contact source`. Importing does not verify an email address. CSV upload progress and background import results appear on Companies. The importer streams the file, writes batches of up to 1,000 rows, skips existing company names, and reports invalid rows. The company directory searches the full database and displays 50 companies per page.
3. **Find vacancies:** enter an official Ashby, Greenhouse, or Lever board URL and run a company check. Other careers sites support manual job entry. Daily scheduled checks can be enabled in Settings.
4. **Review matches:** keyword scores work locally after profile confirmation. With OpenRouter configured, open a job and request AI analysis for reasons, gaps, and unknowns. Scores rank fit; they are not hiring probabilities.
5. **Choose a contact:** the company editor can find published email addresses in saved job descriptions. Review their context and purpose, then confirm an appropriate recruitment contact. When no address is available, use the company's application link.
6. **Prepare an email:** open a job, review **Tailor your application**, and choose **Prepare email**. Choose Standard, Short Recruiter, Achievement-Focused, or an eligible Follow-Up template, then set the tone and word target. Use **Write from my profile** without an API key, or **Generate with AI** with the recommended, editable writing instructions. **Improve English** shows the original and revised wording side by side before you apply it. Review the quoted evidence and **Before you send** checks, then save edits locally. Copy or download the text if you use another email client; attach your résumé separately there. See [PROMPTS.md](PROMPTS.md) for the complete workflow, sample writing instructions, prompt source, and limitations.
7. **Save to Gmail:** once connected, save the reviewed email as a real Gmail draft. The attachment is the selected résumé. Check the review box and approve that exact version. Edits clear approval.
8. **Send:** click **Send approved email**. The application rechecks the approved draft against Gmail, current profile/job facts, duplicate sends, and your sending allowance. Supported stale vacancy feeds are rechecked before sending. Sending is always an explicit action.
9. **Track:** view emails and application status separately. Sending an email does not mark an employer's application form as submitted. Mark formal submissions and interviews yourself. Known Gmail application threads are checked for replies and delivery notices.
10. **Follow up:** after the configured delay, prepare one follow-up for an unanswered email. Review, save, approve, and send it using the same process. A detected reply or bounce blocks a follow-up.

To email someone without adding a company or job, open **Email studio → New email**. Type a recipient in **To**, add a subject, and write your message. A résumé attachment is optional and starts unchecked. Connect Gmail in Settings, review your message and sender, then click **Send email**. This click approves and sends the exact message in the editor; the app saves it to Gmail and checks it before sending, with no separate save or approval steps. Use **Save draft** to keep working without sending. Direct emails do not require a confirmed profile. **Improve English** is available with OpenRouter; profile-based generation and follow-up reminders remain part of job applications. Direct emails appear in Email studio, including Sent, and their known threads are checked for replies. Sending allowances and duplicate-message protection still apply.

## Connect OpenRouter

Set these server-side values in `.env`, then restart both processes:

```dotenv
OPENROUTER_API_KEY=your-key
OPENROUTER_MODEL=your-chosen-model-id
```

Choose an exact model ID from the [OpenRouter model catalog](https://openrouter.ai/models) with a provider supporting JSON schema structured outputs and the privacy settings below. No model is selected on your behalf and there is no automatic fallback to a different model. Optionally restrict routing with comma-separated `OPENROUTER_PROVIDERS` slugs.

Requests require structured output support, disallow provider data collection, and require Zero Data Retention routing. Provider fallback within the selected model remains allowed. If no eligible endpoint is available, the app shows an error rather than relaxing those settings. See [structured outputs](https://openrouter.ai/docs/guides/features/structured-outputs) and [provider routing](https://openrouter.ai/docs/guides/routing/provider-selection).

Only use the AI actions when you want the relevant résumé/profile and job text sent to OpenRouter and its selected provider. Email generation asks for specific, plain-English writing and checks that returned evidence quotes occur in your profile. This check cannot prove every generated claim is correct: review the full email.

The app records returned model/provider, token counts, and actual reported cost. Missing costs remain unknown, never zero in the ledger. Generation IDs are HMAC-hashed. Prompts, credentials, and raw responses are not logged. Your generated drafts and profile are saved as application records.

The monthly setting stops new calls once recorded usage reaches the chosen amount; in-flight calls and missing cost data mean it is not a hard billing cap. Set an additional budget on your OpenRouter key. OpenRouter generation is implemented and tested with mocked responses; a live request requires your key and selected model.

## Connect Gmail

1. Create a Google Cloud project and enable the **Gmail API**.
2. Configure the OAuth consent screen for your personal application. If the app is in Testing, add **each account you want to connect** under **Google Auth Platform → Audience → Test users**.
3. Create an OAuth client of type **Web application**.
4. Register the exact authorized redirect URI for each environment you use:

   `http://localhost:3210/api/auth/google/callback`

   `https://job-assistant-nine.vercel.app/api/auth/google/callback`

5. Set the following in `.env` locally, or in **Vercel → Project → Settings → Environment Variables → Production** for the deployed app:

   ```dotenv
   GOOGLE_CLIENT_ID=your-client-id
   GOOGLE_CLIENT_SECRET=your-client-secret
   GOOGLE_ALLOWED_EMAIL=first@gmail.com,second@gmail.com
   ```

   Replace the example addresses with your accounts. For just one account, use `GOOGLE_ALLOWED_EMAIL=first@gmail.com`. Keep the variable name singular even for multiple addresses. Use commas; spaces and letter case are ignored. Every entry must be a valid full email address. Wildcards and domain-only entries are rejected. The list controls Gmail connections for the original administrator workspace. Invited users authorize their own verified Gmail mailboxes in separate private workspaces. Account creation is controlled by the admin panel.

   On Vercel, also set `APP_URL=https://job-assistant-nine.vercel.app`. Paste only the comma-separated addresses in the value field for `GOOGLE_ALLOWED_EMAIL` (without quotes or the variable name).

6. Restart the local app and worker, or **redeploy Vercel after changing environment variables and deploying this code**. Open **Settings → Connect Gmail**, choose either allowed account, and grant both requested Gmail permissions.

To switch accounts, use **Settings → Disconnect Gmail → Connect Gmail**, then select the other account. Only one mailbox per user is connected at a time. Disconnect removes its saved credentials and attempts to revoke its Google grant; application history remains in that user’s private workspace. Removing an address from the allowed list also blocks further Gmail operations for that account after restarting/redeploying.

Drafts and sent threads record their owning Gmail address. After switching accounts, saving an unsent email creates a new Gmail draft in the connected account, clears approval, and requires review again. The original draft remains in the previous mailbox. Reply checks and follow-ups use only the account that sent the original application. Older drafts without a recorded sender must be saved again before approval; reconnecting or disconnecting an existing connection records its ownership before switching.

If Google returns you to Folio's password screen, update and restart the app, sign in, and start **Connect Gmail** again. The session must use `SameSite=Lax` so it survives Google's redirect; starting a new connection replaces older session cookies. Always open `http://localhost:3210` rather than `127.0.0.1`, matching `APP_URL` and the registered callback. A failed connection now stays in the workspace and shows the reason, such as missing Gmail permissions or choosing a different account. Select both Gmail permissions on Google's consent screen. Server logs record a sanitized failure stage without OAuth codes or tokens.

The requested scopes are `openid`, `email`, `gmail.compose` (drafts and sending), and `gmail.readonly` (draft integrity and tracked thread reads). Google permissions are broader than the app's thread-checking behavior. The app requires a verified Google identity matching an exact address in `GOOGLE_ALLOWED_EMAIL`.

Google may show an unverified-app warning for a personal project. An external OAuth application left in Testing normally has refresh tokens that expire after seven days for these scopes; reconnect when required. Personal-use exceptions and public distribution have different verification requirements. See [OAuth token expiration](https://developers.google.com/identity/protocols/oauth2#expiration), [verification exceptions](https://support.google.com/cloud/answer/13464323?hl=en), and [Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes).

The application uses the Gmail API, not SMTP or your Google password. Gmail credentials and résumé attachments are encrypted locally. The live OAuth/draft/send lifecycle has not been exercised without your credentials. Automated tests use mocked Gmail responses and send no real messages.

## Supported sources and current limits

- Automatic vacancy feeds: `jobs.ashbyhq.com/<board>`, `boards.greenhouse.io/<board>` or `job-boards.greenhouse.io/<board>`, and `jobs.lever.co/<board>`. Failed scans preserve existing jobs; successful complete scans close missing source jobs.
- Contact discovery searches saved job descriptions. It does not guess addresses, guarantee deliverability, crawl arbitrary company websites, or buy contact data.
- There is no automated submission of employer ATS forms, LinkedIn applications, or CAPTCHA interaction. Use the original application link and record the status.
- Gmail edits after synchronization invalidate the app's approval. Review and save the desired app version to Gmail again. Edits made directly in Gmail are not imported into the composer.
- Send through Folio for automatic tracking. Messages sent directly from Gmail are not automatically reconciled. If a send times out, the draft is held as **uncertain** and cannot be retried through the app. Check Gmail Sent manually; this version has no recovery/reconciliation UI for that state.
- Reply checks inspect metadata in up to 100 known sent application threads per run. Separate-thread responses, some delivery reports, and messages outside those threads can be missed. Automatic acknowledgments are conservatively treated as replies. There is no full inbox AI reader or automatic response sending.
- Only one follow-up per application is supported. Background jobs discover vacancies and check replies; they never send messages.
- The app supports admin-created users with private workspaces. Workspace records and tasks are scoped to the authenticated user; admins manage accounts and allowances without a private-content browser. Neon Postgres and private object storage provide persistence across Vercel instances and deployments.

## Files and data

| Area                                            | Location                                 |
| ----------------------------------------------- | ---------------------------------------- |
| Pages and authenticated API routes              | `src/app`                                |
| Workspace and email composer                    | `src/components`                         |
| OpenRouter prompts and usage accounting         | `src/lib/ai.ts`                          |
| Gmail authorization, drafts, approval, and send | `src/lib/gmail.ts`                       |
| Vacancy connectors and matching                 | `src/lib/jobs.ts`, `src/lib/matching.ts` |
| Persistence and action handlers                 | `src/lib/db.ts`, `src/lib/service.ts`    |
| Scheduled task worker                           | `scripts/worker.ts`                      |
| Behavioral tests                                | `tests/core.test.ts`                     |
| Cloud records and encrypted files               | Neon Postgres and private S3 bucket      |

Résumé binaries and Gmail tokens are encrypted with `APP_ENCRYPTION_KEY`. Profile text, companies, jobs, drafts, and activity are stored in Postgres. Back up the database, object storage, and matching encryption key together. The app never creates a local data directory or encryption-key file at runtime.

## Verify changes

```bash
npm test
npx tsx tests/http-smoke.ts
npm run typecheck
npm run build
npm audit
```

Tests use isolated Postgres schemas and S3 prefixes. Start the services in `compose.test.yml` with `docker compose -f compose.test.yml up -d` before running them; stop them afterward with `docker compose -f compose.test.yml down`. Tests never read the production `.env`. Override only `TEST_DATABASE_URL` and `TEST_S3_*` to use dedicated test services.

Tests cover authentication and encryption, source restrictions, imports, failed feed preservation, confirmation requirements, draft approval invalidation, concurrent send clicks, uncertain send outcomes, changes during sending, OpenRouter request/privacy/accounting behavior, and résumé extraction.  Live credentials are still needed to validate external AI and Gmail integrations end to end.

## Large CSV imports

CSV bytes go from the browser directly to private S3-compatible storage. Authenticated `/api/imports` requests contain metadata only, so the 50 MB file never passes through a Vercel Function request body. The signed upload lasts one hour and is limited to the declared file size. Keep the tab open until uploading completes; import processing runs after the API response. Résumé uploads continue to use `/api/upload`.

The worker streams UTF-8 CSV with BOM and quoted multiline-cell support, validates headers, and commits company batches and progress in the same short transaction. Importing preserves existing company details and leaves new contacts unconfirmed. Rows with missing/overlong names or oversized stored fields are skipped; the first 20 row errors are shown. Malformed CSV syntax stops the import with an explanation; already committed batches remain saved. Re-uploading a corrected file skips existing companies. Individual CSV records are limited to 100,000 characters.

Processing has a bounded execution budget and a database lease. Interrupted jobs resume from their committed record count on the next import/status request, workspace poll, local-worker tick, or cron run. On Vercel, `after()` is bounded by function duration: if the tab is closed and a run exhausts its budget or is terminated, the existing daily cron supplies the next unattended recovery trigger. Configure a more frequent scheduler if prompt unattended recovery is required. Temporary storage/database errors retry across triggers; after three failures, use **Retry import**. Imports remain available when scheduled vacancy automation is paused.

Original CSV objects are private but are not encrypted with the app's résumé encryption key. Completed CSVs become eligible for deletion after one hour; abandoned uploads and failed files after seven days. Cleanup runs with the existing worker and removes only objects recorded for those imports. Import summaries remain in Postgres.

Targeted verification: `node --import tsx --test tests/csv-imports.test.ts`. This uses isolated local Postgres/S3 storage and includes an actual 50,000,000-byte CSV with 50,000 companies, restart recovery, duplicate handling, quoted newlines, malformed CSV errors, and bounded workspace responses. Local timings are not a production speed guarantee.
