# Job description → reviewed application email

## Workflow

1. Add your résumé and factual work examples in **My profile**. List your skills, target roles, preferred locations, signature, and tone. Review and confirm the profile.
2. Add the employer in **Companies**. If you plan to email, enter a published recruitment address, its source, and confirm it after checking its purpose.
3. In **Job matches → Add a job**, paste the actual job description and enter the exact title, employer, location, and application link.
4. Open the job. **Tailor your application** shows recognized skill overlap, missing profile evidence, relevant work examples, requirements to verify, and suggestions for improving your application.
5. Choose **Prepare email**, then **Write from my profile** for a local draft, or **Generate with AI** for a tailored OpenRouter draft. Both use the saved job and your confirmed profile. Neither sends an email.
6. Review the email and **Before you send** checks. Save edits. You can copy or download the text without connecting Gmail; these exports do not include the résumé attachment.
7. With Gmail connected: **Save to Gmail → review checkbox → Approve this draft → Send approved email**. Changing the email clears approval. Sending remains a separate, explicit action.

The local template respects the tone selected in your profile. The optional writing-instructions field applies to AI generation and rewriting only, and is limited to 1,000 characters.

## Writing instructions you can paste into the app

General application:

```text
Write a concise, professional application for this exact role. Focus on the two most relevant responsibilities in the job description and connect them to examples in my confirmed profile. Keep it under 150 words. Use a friendly tone and end with a polite request for a conversation. Do not add experience, metrics, qualifications, or availability that I have not provided.
```

Project-focused application:

```text
Keep it under 120 words. Focus on my most relevant project: what I built, my contribution, and the outcome stated in my profile. Explain its connection to the job description. Avoid generic praise and long lists of technologies. Use only facts already in my profile.
```

Revision:

```text
Make this draft shorter and more natural. Keep the exact job title, company, and supported work example. Remove repetitive phrases. Do not add new claims or suggest that I already submitted the employer's application form.
```

## Prompts used by the application

The complete, executable system prompts are in [src/lib/prompts.ts](src/lib/prompts.ts). That file is the source of truth; changes there affect the next AI request.

| Prompt                    | Purpose                                                                                                                                                     |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `applicationEmailPrompt`  | Tailor the subject and body to the saved job, connect relevant candidate evidence, respect the selected attachment, and return evidence and review notes.   |
| `jobMatchPrompt`          | Compare confirmed facts with required and preferred qualifications; explain reasons, gaps, and unknowns without treating the score as a hiring probability. |
| `profileExtractionPrompt` | Extract only explicit résumé facts and leave missing values empty for human review.                                                                         |
| `untrustedInputPrompt`    | Treat job descriptions, résumé text, names, and writing preferences as data; reject embedded instructions that ask for invented facts or other actions.     |

Email generation provides the model with:

- Candidate name, headline, location, availability, portfolio, signature, and tone.
- Candidate evidence from experience, projects, education, and explicitly listed skills.
- Company name and the saved job's title, description, and location.
- Local keyword insights, actual résumé attachment selection, optional writing instructions, and the previous draft when revising.

The response must satisfy this structure:

```json
{
  "subject": "One-line subject for the actual role",
  "body": "Complete email with no unfinished placeholders",
  "evidence": [
    {
      "claim": "An experience claim used in the email",
      "sourceQuote": "An exact quote from the supplied candidate evidence"
    }
  ],
  "reviewNotes": ["A substantive detail the candidate needs to verify"]
}
```

## Checks and limitations

- Local scoring uses the share of recognized job skill mentions covered by explicitly listed profile skills. Unrelated candidate skills do not reduce the score. Common aliases such as NodeJS/Node.js and Postgres/PostgreSQL are recognized; duplicate skills do not inflate coverage.
- Keyword coverage is a guide, not a full understanding of a job description. The dictionary is limited, and mentions may describe optional, negated, or historical requirements. Seniority, eligibility, and required versus preferred qualifications still need review. Never add a skill solely to raise the score.
- Local email writing selects short, exact work examples that mention overlapping skills. If none is available, it produces an introduction and asks you to add a relevant example. It does not invent missing evidence.
- AI responses require valid structure and nonempty evidence quotes present in the supplied profile. The app checks placeholders, subject headers, and attachment references. These checks cannot prove that every claim is true or that the quoted evidence logically supports it; read the entire draft.
- Missing recipient, invalid subject/body, placeholders, promised-but-missing attachments, unconfirmed profile/contact, changed inputs, closed jobs, and resolved applications are shown in the composer. Long messages and absent résumés are review reminders.
- Approval and sending independently check content, current facts, and the confirmed recruitment contact on the server. Existing Gmail integrity, duplicate-send, sending-limit, and uncertain-send controls still apply. They cannot guarantee delivery or vacancy availability.
- Rewriting from an old tab is rejected. Sent, sending, and uncertain messages cannot be rewritten. Manual content edits clear old generated evidence so it is not presented as support for newly added claims.
- AI calls require your OpenRouter configuration and use your credits. Local writing does not call OpenRouter. Gmail sending requires a connected account and your explicit approval.

## Verification

Run `npm test`, `npm run typecheck`, `npm run build`, and `npm audit`. The automated suite covers matching, local generation, AI request configuration and rejected outputs, draft integrity, contact validation, authentication/encryption, imports, uploads, and sending safeguards. Provider and Gmail tests use mocked responses and send no real messages. Browser interaction and live-provider checks are separate; a successful build is not proof of either.
