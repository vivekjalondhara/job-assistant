# Job search and reusable email workflows

Implemented in the existing Next.js application with Neon/Postgres records and private encrypted résumé storage. Existing records remain compatible; no database reset or credential changes are required.

## Daily job search

1. In **My profile**, confirm your experience and set years of experience, target level, countries where you can work, employment type, work arrangement, and minimum annual salary/currency.
2. Open **Job matches** to filter by role/skill, location, work arrangement, employment type and posting age. When a posting date is unavailable, age uses when Folio first saved the job. Name and save searches to reuse them.
3. **Search public careers pages** opens a web search across supported public careers sites, including companies outside your saved list. Discovery does not run a general web crawler or import search results automatically.
4. Choose **Import job link or text**. Individual Ashby, Greenhouse and Lever links support extraction. For other sites, paste the listing text. Review the company, title, source link and requirements before saving. Folio creates the company when needed and returns an existing job for duplicate links or identical descriptions at the same company/title/location.
5. **Today** shows up to five open opportunities, ordered by preference assessment, score and freshness. Submitted, skipped and already-contacted roles are excluded. Save, skip, view details or open the employer's application link. Skipped jobs remain available under **Job matches → Skipped**.

Match labels distinguish **Good match**, **Stretch role**, **Needs checking** and **Outside preferences**. Recognized skill overlap is displayed separately from eligibility. Explicit experience, seniority, eligible countries, employment type, work arrangement and comparable annual salary inform checks. Preferred skill mentions carry less weight. Missing information stays unknown; these local rules do not establish hiring eligibility or predict an offer. Source excerpts are available in the job details. Optional AI analysis also receives structured preferences and requirements.

## Reusable email templates

- Open **Email studio → Email templates** to create, edit or delete your own templates, or customize a starter application, inquiry, referral or follow-up template.
- Supported placeholders: `{{name}}`, `{{signature}}`, `{{company}}`, `{{role}}`, `{{target_role}}`, `{{skills}}`, `{{portfolio}}`, `{{availability}}`, `{{recruiter}}`, `{{work_example}}`.
- Open a direct email or a job application, expand **Use a saved email template**, choose the wording and fill remaining details. Review the rendered preview and choose **Use this template**. Existing text is replaced only after confirmation. The template does not choose a recipient or send a message.
- **Save as reusable template** starts a template from the current editor. Replace specific employer names with placeholders before reuse. Template edits do not modify existing drafts or sent emails.
- Missing placeholders prevent sending. Templates work without OpenRouter. Existing writing-style controls and optional AI editing remain available.
- For direct messages, review the editor, recipient, sender and selected résumé, then click **Send email**. This existing action saves, approves and sends the exact editor snapshot. Job-linked application emails retain their Gmail draft/review/approval workflow.
- Follow-up templates are available on follow-ups prepared from an existing sent application, preserving the original thread and subject. Background jobs never send emails.

## Résumé versions

Uploading another résumé keeps earlier files. Use **My profile → Résumé versions** to label each version and identify its target role. **Use for profile** changes the source résumé and requires renewed profile confirmation; older files uploaded before extracted text was retained may need re-uploading for this action.

Choose a résumé in the email composer and preview the file before sending. Editing an email or uploading another résumé preserves the file already selected for that email. A profile change still requires review. Sent messages retain their original attachment reference.

Job details show confirmed skill examples and suggestions for tailoring a résumé. Edit the document yourself and upload the reviewed version; Folio does not rewrite PDF/DOCX files or invent experience.

## Application tracking

Open a job's **Application notes & reminders** to record formal status, submission date, recruiter, notes, interview date, next action, reminder and résumé. Submission tracking works without creating an email. Status changes retain a timestamped history. These notes do not change the original job facts or invalidate an email's job version.

Due reminders and interviews in the next seven days appear on **Today**, along with unfinished emails, eligible follow-ups and recent reply links to Gmail. Reminders are in-app, not push notifications. Completing a reminder clears its next action and reminder time. Opening an application website does not automatically mark a submission.

Job feed refreshes preserve application records. Gmail reply checks exclude outgoing drafts and the connected mailbox's own messages. Automatic acknowledgements and replies in separate threads still need manual review.

## Verification

`tests/career.test.ts` covers matching, optional versus required qualifications, templates and unfilled fields, job import host restrictions and deduplication, saved searches, application history, résumé preservation, daily ranking, feed preservation and Gmail draft/reply distinction. Existing sending and approval tests continue to use mocks. No real employer messages are needed for validation.

Use `npm test`, `npm run typecheck`, and `npx tsx tests/http-smoke.ts` with the dedicated services from `compose.test.yml`. The HTTP smoke test builds a temporary production copy with isolated test storage; `--serve` keeps it open for browser checks on port 3218.

Verified on 15 October 2026: 132 automated tests passed and TypeScript checks passed. Signed-in browser checks covered profile preference persistence, import preview/save, saved searches, template creation/application, selecting an older résumé, submission tracking without an email, and due reminders. Desktop (1440 px) and mobile (390 px) layouts were inspected, with no browser errors or horizontal page overflow in the checked views. Real Gmail sending and paid AI requests were not exercised.
