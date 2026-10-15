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
