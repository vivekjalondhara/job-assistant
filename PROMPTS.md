# Job description → reviewed application email

## Workflow

1. Add your résumé and factual work examples in **My profile**. List your skills, target roles, preferred locations, signature, and tone. Review and confirm the profile.
2. Add the employer in **Companies**. If you plan to email, enter a published recruitment address, its source, and confirm it after checking its purpose.
3. In **Job matches → Add a job**, paste the actual job description and enter the exact title, employer, location, and application link. Use a role such as “Full Stack Software Engineer” in the title field; put website links in the URL fields. URL titles are rejected before writing an email, including for previously saved jobs.
4. Open the job. **Tailor your application** shows recognized skill overlap, missing profile evidence, relevant work examples, requirements to verify, and suggestions for improving your application.
5. Choose **Prepare email**, select a template, tone, and word target, then **Write from my profile** for a local draft, or **Generate with AI** for a tailored OpenRouter draft. Both use the saved job and your confirmed profile. Neither sends an email.
6. Review the email and **Before you send** checks. Save edits. Use **Improve English** to correct grammar, spelling, and phrasing, compare the original and suggested wording side by side, then choose **Use improved version** or **Keep my wording**. Applying a suggestion changes the editor; save it before approval. **Preview email** shows the recipient, subject, message, and selected résumé. You can copy or download the text without connecting Gmail; these exports do not include the résumé attachment.
7. With Gmail connected: **Save to Gmail → review checkbox → Approve this draft → Send approved email**. Changing the email clears approval. Sending remains a separate, explicit action.
8. Open **Email studio → Sent** to read application emails sent through Folio, including their recipient, subject, complete saved body, sent date, and attachment name. This view uses saved application records and does not import your Gmail inbox or messages sent directly in Gmail.

Each application has saved writing settings. Choose **Standard Job Application** (120–180 words), **Short Recruiter Email** (60–100), **Achievement-Focused Application** (120–180), or **Application Follow-Up** (50–90). Follow-ups are available only from eligible sent application emails after the configured delay. Their original email is checked again when rewriting, including after an AI request.

Choose **Professional**, **Concise**, **Friendly**, or **Confident**. You can adjust word targets between 30 and 300, excluding the configured signature. Word targets are review guidance: do not pad sparse evidence, and obey a shorter employer limit. Local drafting preserves complete profile excerpts rather than cutting claims to hit a count.

The recommended writing instructions are prefilled for new applications and can be restored in the composer. Existing custom instructions are retained. Instructions support up to 6,000 characters and apply to AI generation only; the English improver edits the saved message using the selected tone. Template, tone, targets, and instructions persist when you save or generate.

**Improve English** uses a separate editing prompt and works for application emails and follow-ups. It preserves the subject and returns a suggestion without changing the saved draft or Gmail. Numbers (including percent and plus suffixes), email addresses, URLs, and detected signatures are checked for changes; attachment and placeholder checks also apply. Review the meaning and factual claims yourself, since these checks cannot establish that every claim is accurate. The feature requires OpenRouter and supports saved email bodies of 20–8,000 characters. Your existing sending and approval workflow is unchanged.

## Writing instructions you can paste into the app

General application:

```text
Write a concise, professional application for this exact role. Focus on the two most relevant responsibilities in the job description and connect them to examples in my confirmed profile. Keep it under 150 words. Use a friendly tone and end with a polite request for a conversation. Do not add experience, metrics, qualifications, or availability that I have not provided.
```

Full professional application:

```text
Start with Dear Hiring Team. Write 120–180 words plus my signature. Introduce the position I am applying for, summarize my current role and years of experience, and highlight relevant technologies and two concrete achievements from my confirmed profile. Keep any supported metrics accurate. Mention my résumé only if attached, then close with thanks and an invitation to discuss the opportunity. Use my actual contact details once, without placeholders. Do not invent facts or use a website URL as the job title.
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
| `polishEmailPrompt`       | Correct the saved email's English while preserving its meaning, subject, and existing facts; return a suggestion for review.                                |
| `untrustedInputPrompt`    | Treat job descriptions, résumé text, names, and writing preferences as data; reject embedded instructions that ask for invented facts or other actions.     |

Email generation provides the model with:

- Candidate name, headline, location, availability, portfolio, signature, and tone.
- Candidate evidence from experience, projects, education, and explicitly listed skills.
- Company name and the saved job's title, description, and location.
- Ranked profile excerpts with source fields, local keyword insights, actual résumé attachment selection, selected template/tone/word targets, writing instructions, and the previous draft when revising.
- The original sent subject and timestamp for eligible follow-ups; no prior interview or conversation is inferred.

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

- Local scoring combines recognized job skill coverage (50 points), title overlap (20), location preferences (10), remote availability (5), and explicitly evidenced experience duration (15). Unrelated candidate skills do not reduce the score. Common aliases such as NodeJS/Node.js and Postgres/PostgreSQL are recognized; duplicate skills do not inflate coverage.
- Title comparisons retain seniority and distinguish management roles. An explicit seniority mismatch caps the score at 59. A stated experience shortfall caps it at 59, or 39 when the gap is at least three years. Missing or ambiguous candidate duration against a stated requirement caps the score at 69 and explains what needs checking. These are ranking rules, not hiring probabilities.
- To compare experience, include an accurate statement such as “2 years of professional software development experience” in your profile's work experience. The matcher reads explicit durations; it does not calculate tenure from employment dates or sum overlapping roles. Multiple different candidate durations and alternative qualification paths need review. It skips recognized preferred requirements and company-history statements. A target role does not establish your actual seniority.
- Keyword coverage is a guide, not a full understanding of a job description. The dictionary and experience parser are limited, and skill mentions may describe optional, negated, or historical requirements. Confirm relevant experience, mandatory skills, eligibility, and salary yourself. AI analysis is a separate model assessment. Never add experience or a skill solely to raise the score.
- Local email writing includes a confirmed background excerpt and prioritizes relevant work examples. When the listing has no recognized skill keywords, it still uses your saved experience and skills instead of producing an empty introduction. It preserves exact excerpts and does not invent missing evidence. Add a short professional summary and specific achievements in My profile for better drafts. Professional tone uses “Dear Hiring Team”; friendly uses “Hi Hiring Team”. Concise tone and the short template include fewer examples. Only 2–4 relevant skills are selected when available. Work examples are ranked by skill and responsibility overlap before measurable impact; their source field and exact excerpt remain available for review.
- AI writing follows the selected template and word target, with a standard default of 120–180 words excluding the signature. It selects up to two evidenced achievements and 2–4 matching skills. Portfolio links already present in the signature should not be repeated.
- AI application responses require valid structure and nonempty evidence quotes present in the supplied profile. Follow-ups without experience claims may have no profile quotes. Numeric claims in evidence must preserve source numbers; generated body numbers must occur in supplied candidate or application facts, and configured signatures must be preserved. The app checks placeholders, subject headers, and attachment references. These checks cannot prove that every claim is true or that the quoted evidence logically supports it; read the entire draft.
- Missing recipient, invalid subject/body, placeholders, promised-but-missing attachments, unconfirmed profile/contact, changed inputs, closed jobs, and resolved applications are shown in the composer. Word-target mismatches, missing exact company/title mentions, repeated signature links or email addresses, and absent résumés are review reminders.
- Approval and sending independently check content, current facts, and the confirmed recruitment contact on the server. Existing Gmail integrity, duplicate-send, sending-limit, and uncertain-send controls still apply. They cannot guarantee delivery or vacancy availability.
- Rewriting from an old tab is rejected. Sent, sending, and uncertain messages cannot be rewritten. Manual content edits clear old generated evidence so it is not presented as support for newly added claims.
- AI calls require your OpenRouter configuration and use your credits. Local writing does not call OpenRouter. Gmail sending requires a connected account and your explicit approval.

## Verification

Run `npm test`, `npm run typecheck`, `npm run build`, and `npm audit`. The automated suite covers matching, local generation, AI request configuration and rejected outputs, draft integrity, contact validation, authentication/encryption, imports, uploads, and sending safeguards. Provider and Gmail tests use mocked responses and send no real messages. Browser interaction and live-provider checks are separate; a successful build is not proof of either.
