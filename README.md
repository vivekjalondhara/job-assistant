# Folio — your private job assistant

A working local application for organizing your job search: confirm your experience, import companies, find supported vacancies, review matches, write tailored emails with OpenRouter, save Gmail drafts, approve and send, and track replies.

Built for one person. The application and background worker run on your computer, with SQLite persistence. No external account or database is needed for the local workflow. OpenRouter and Gmail each require your own credentials.

## Start the application

Use Node.js 22.16 or newer (tested on Node 22.23.1).

```bash
cd /home/vivek-jalondhara/Documents/JOB/job-assistant
npm ci
cp .env.example .env.local
npm run build
npm start
```

If `.env.local` already exists, edit it instead of copying over it. Open **http://localhost:3210**, and create your private password (at least 12 characters). Use `localhost` consistently; requests from a different origin are rejected.

For development, run `npm run dev` instead of the build/start commands. Both `dev` and `start` launch the web app and worker. Keep the terminal running; scheduled searches and reply checks run only while the worker is running. Ctrl+C stops both. The server binds to `127.0.0.1`.

## Use it, one step at a time

1. **My profile:** upload a PDF, DOCX, or TXT résumé (up to 8 MB). Fill your skills, experience, projects, target roles, location preferences, and signature. AI extraction is optional. Check the facts and confirm your profile. Image-only/scanned résumés need conversion to searchable text first.
2. **Companies:** add companies manually or import a CSV. Supported column names include `Company`, `Website`, `Careers URL`, `Recruitment email`, and `Contact source`. Importing does not verify an email address. The **Import local research** button reads the existing `../product_only_top_20_jobs.csv` without changing that file.
3. **Find vacancies:** enter an official Ashby, Greenhouse, or Lever board URL and run a company check. Other careers sites support manual job entry. Daily scheduled checks can be enabled in Settings.
4. **Review matches:** keyword scores work locally after profile confirmation. With OpenRouter configured, open a job and request AI analysis for reasons, gaps, and unknowns. Scores rank fit; they are not hiring probabilities.
5. **Choose a contact:** the company editor can find published email addresses in saved job descriptions. Review their context and purpose, then confirm an appropriate recruitment contact. When no address is available, use the company's application link.
6. **Prepare an email:** open a job and choose **Prepare email**. Generate a natural draft with OpenRouter, make it shorter, adjust the tone, or write it yourself. Review the quoted profile evidence, recipient, subject, and résumé. Save edits locally.
7. **Save to Gmail:** once connected, save the reviewed email as a real Gmail draft. The attachment is the selected résumé. Check the review box and approve that exact version. Edits clear approval.
8. **Send:** click **Send approved email**. The application rechecks the approved draft against Gmail, current profile/job facts, duplicate sends, and your sending allowance. Supported stale vacancy feeds are rechecked before sending. Sending is always an explicit action.
9. **Track:** view emails and application status separately. Sending an email does not mark an employer's application form as submitted. Mark formal submissions and interviews yourself. Known Gmail application threads are checked for replies and delivery notices.
10. **Follow up:** after the configured delay, prepare one follow-up for an unanswered email. Review, save, approve, and send it using the same process. A detected reply or bounce blocks a follow-up.

## Connect OpenRouter

Set these server-side values in `.env.local`, then restart both processes:

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
2. Configure the OAuth consent screen for your personal application. Add your own Google account as a test user if the app is in Testing.
3. Create an OAuth client of type **Web application**.
4. Register this exact authorized redirect URI:

   `http://localhost:3210/api/auth/google/callback`

5. Set the following in `.env.local`:

   ```dotenv
   GOOGLE_CLIENT_ID=your-client-id
   GOOGLE_CLIENT_SECRET=your-client-secret
   GOOGLE_ALLOWED_EMAIL=your-own-gmail-address
   ```

6. Restart the app and worker. Open **Settings → Connect Gmail**, choose the allowed account, and grant the requested permissions.

The requested scopes are `openid`, `email`, `gmail.compose` (drafts and sending), and `gmail.readonly` (draft integrity and tracked thread reads). Google permissions are broader than the app's thread-checking behavior. The app rejects a Google identity that differs from `GOOGLE_ALLOWED_EMAIL`.

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
- The app is a local single-owner installation, not a publicly deployed or multi-user service. Cloud hosting would require persistent storage, HTTPS, process supervision, backups, and a separate deployment review. Do not place the SQLite data directory on ephemeral serverless storage.

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
| Private local records and encrypted files       | `data/` (excluded from version control)  |

Résumé binaries and Gmail tokens are encrypted; profile text, company/job records, and email drafts are stored in the local database. Protect the computer and its backups accordingly. The encryption key is generated at `data/.encryption-key` unless `APP_ENCRYPTION_KEY` is supplied. Preserve that key: losing it makes encrypted records unreadable.

To back up, stop **both** processes and copy the complete data directory together with your configuration and encryption key to secure storage. Do not copy only an active SQLite main file and omit its WAL. To restore, keep the matching database, uploaded files, and original key together. Do not replace a key on an existing installation.

The browser smoke test workspace is isolated in `output/browser-data`; it is not your real profile. Screenshots are in `output/playwright`. Existing job research outside this application was not modified.

## Verify changes

```bash
npm test
npm run typecheck
npm run build
npm audit
```

Tests cover authentication and encryption, source restrictions, imports, failed feed preservation, confirmation requirements, draft approval invalidation, concurrent send clicks, uncertain send outcomes, changes during sending, OpenRouter request/privacy/accounting behavior, and résumé extraction. Browser checks cover desktop/mobile flows and accessibility. Live credentials are still needed to validate external AI and Gmail integrations end to end.
