# Accounts, private workspaces, and multiple résumés

## Start using the features

1. Start or deploy the updated application with the existing database, storage credentials, and permanent `APP_ENCRYPTION_KEY`.
2. For a new installation, open `/admin/login` and enter the setup token, administrator name, email, and password. Registration is closed after the first administrator exists.
3. For an existing installation, sign in with the original owner password and enter the email you want to use going forward. The original owner becomes the administrator and retains the original workspace. Old session cookies require a fresh login.
4. Open `/admin`, choose **Add user**, enter their name and email, and set storage, AI, and sending allowances. Accounts created here always have the User role.
5. Send the invitation using configured SMTP, or copy the private invitation link and share it with that user. Links expire in 24 hours, are single use, and are replaced when a new link is issued. The user sets their own password; administrators cannot see passwords.
6. Users sign in at `/login`. They can complete **My profile**, add files through **My résumés**, connect their own Gmail account, import companies, and track applications.
7. Use **Manage** in the admin panel to change allowances or disable/reactivate a user. Disabling revokes existing sessions and blocks their queued work and new actions. Reactivating does not revive old session cookies.
8. **Password reset** creates a new private link. Users can also request a reset from login when SMTP delivery is configured. The response never reveals whether an email has an account.
9. **Delete** requires the exact user email. It revokes access and removes that user's database records and stored uploads. Failures leave the account in `deleting` so cleanup can be retried. Administrative audit entries remain, identified by account IDs. Messages already in Gmail are not deleted.

The administrator also has a personal workspace, accessible through **My workspace**. Its data is not shared with other accounts. The administrator dashboard shows account information, aggregate storage/AI usage, failed tasks/imports, and administrative activity; it does not expose private résumés, email bodies, or Gmail credentials.

## Résumé behavior

- **My résumés** accepts PDF, DOCX, and TXT, up to 4 MB per file. Multiple files can be selected and uploaded sequentially. Total storage, including retained CSV uploads, is limited by the administrator's allowance.
- Each upload has a new immutable ID. **Upload new version** preserves the previous file, records the previous ID, increments the version, and carries forward its label/target role.
- The first uploaded résumé supplies the initial profile source and default attachment. Further uploads preserve the profile, confirmation, and default.
- **Make default** chooses the attachment for new applications without changing confirmed profile facts or existing emails.
- **Use for profile** changes the extraction source and requires profile review again. Older files without extracted text may need re-uploading to become profile sources; they remain usable as attachments.
- Select a résumé in application details or directly in the email composer. Existing draft attachments remain fixed until explicitly changed. AI email generation receives the selected file's extracted text alongside confirmed profile facts. AI job analysis records the résumé used and is invalidated when that selection changes.
- Changes to an email's attachment clear approval. Sending retains the existing exact-draft, sender, duplicate-send, and uncertain-outcome protections.
- Deleting a résumé removes its uploaded file and stored extracted text. Unsent drafts referencing it lose the attachment and approval. Sent emails retain their recorded filename/reference. Deletion is blocked while a referenced email is `sending` or `uncertain`.
- Deleting a default clears it; choose another before the next application. Confirmed profile fields previously extracted and saved are independent records and are not erased by deleting their source file.

## Email and Gmail configuration

Optional invitation/reset delivery uses a dedicated SMTP transport, separate from users' connected Gmail mailboxes:

| Variable                | Purpose                                     |
| ----------------------- | ------------------------------------------- |
| `ACCOUNT_SMTP_HOST`     | SMTP host                                   |
| `ACCOUNT_SMTP_PORT`     | Defaults to 587                             |
| `ACCOUNT_SMTP_SECURE`   | `true` for implicit TLS, typically port 465 |
| `ACCOUNT_SMTP_USER`     | SMTP authentication username, when required |
| `ACCOUNT_SMTP_PASSWORD` | SMTP authentication password                |
| `ACCOUNT_MAIL_FROM`     | Invitation/reset sender address             |

With no SMTP configuration, the admin panel provides copyable links. A failed SMTP delivery also keeps the copyable link available. Reset links are never returned from the public password-reset endpoint. Configure SMTP before relying on self-service administrator password recovery.

The existing Google client credentials are shared application configuration. Every user's OAuth state, encrypted tokens, drafts, and thread checks belong to their own workspace. The original administrator's `GOOGLE_ALLOWED_EMAIL` behavior is preserved; invited users can authorize their own verified Google mailboxes without editing this environment variable. Google's test-user and public-app verification requirements still apply.

OpenRouter remains server-managed. The effective spending and sending limits are the lower of the user's preferences and the administrator's allowances. Recorded AI cost is not a hard billing cap: missing reported costs and in-flight requests can exceed the recorded allowance. Apply a provider-side budget as well.

## Migration and data boundaries

Initialization performs an idempotent migration under the existing database advisory lock:

- Existing `folio_records` and `folio_tasks` gain `user_id = legacy-owner`; record keys and active-task uniqueness include the user ID.
- The original owner's password hash is migrated to `folio_accounts`, retaining the original password. An email is claimed only after that password is verified.
- All existing résumé object keys stay unchanged, so no binary copy or encryption-key rotation is needed.
- Workspace services require an explicit user context. HTTP entry points derive it from the verified session; browser input never supplies the acting user ID.
- Account status and session version are checked on authenticated requests. Workspace writes recheck account status under the write transaction.
- Scheduled work iterates active accounts fairly using `last_work_at`; HTTP-triggered tasks explicitly retain the initiating user's context. Disabled users are skipped.
- Already-issued signed CSV upload URLs expire after one hour. Account deletion schedules an additional object cleanup after those URLs expire; the worker/cron performs that cleanup.

Preserve a database and storage backup and the existing encryption key when deploying. The migration updates primary keys; an older single-owner binary should not be used against the migrated schema. No production migration or deployment was run as part of local verification.

## Verification

Run the local Postgres and MinIO services from `compose.test.yml`. Tests create isolated schemas and storage prefixes and do not read production `.env` credentials.

- `npm test`: existing behavior plus account lifecycle, user isolation, migration, worker status, allowances, and résumé deletion/default behavior.
- `npm run typecheck`: TypeScript validation.
- `npx tsx tests/http-smoke.ts --serve`: builds a temporary production copy and verifies authenticated HTTP behavior, uploads, background work, and restart persistence. Keeps the isolated server on port 3218 for browser checks.
- While that server runs, `npx tsx tests/multi-user-http.ts`: checks real session cookies, admin access restrictions, invitation replay, cross-user file access, disabled sessions, password reset, and confirmed account deletion.

| Requirement                                                                    | Evidence                                                                 |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| Admin-only account management, one-use/expired invitations, session revocation | `tests/accounts.test.ts`, `tests/multi-user-http.ts`                     |
| User-scoped records, company queries, tasks, file access                       | `tests/multi-user.test.ts`, `tests/multi-user-http.ts`                   |
| Original owner password and workspace survive migration and restart            | `tests/legacy-migration.test.ts`                                         |
| Multiple résumés, stable defaults, attachment approval invalidation            | `tests/multi-user.test.ts`, `tests/career.test.ts`, existing email tests |
| Disabled workspaces stop processing and cannot write                           | `tests/multi-user.test.ts`                                               |
| Administrator allowances constrain storage, AI, and sending                    | `tests/multi-user.test.ts`, existing AI/send tests                       |
| Existing production upload, extraction, cron, and persistence behavior         | `tests/http-smoke.ts`                                                    |

Account isolation and résumé tests were first observed failing before implementation, then passed after implementation. Browser verification uses synthetic accounts and local storage only. Live SMTP delivery and live Google OAuth are not exercised by these checks.

Final local verification: **142 tests passed**, TypeScript passed, isolated production build and HTTP smoke passed, and the multi-user HTTP checks passed. Desktop and mobile browser checks covered admin invitations, user activation, private onboarding, multiple-file résumé upload, default selection, and label editing. The final résumé screen had zero console errors and no horizontal overflow at 390 px. Screenshots are in `output/playwright/admin-users.png`, `output/playwright/resumes-desktop.png`, and `output/playwright/resumes-mobile.png`.
