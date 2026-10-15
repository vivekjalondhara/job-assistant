import { Paperclip } from "lucide-react";

export function EmailPreview({
  to,
  subject,
  body,
  resumeName,
  sentAt,
}: {
  to: string;
  subject: string;
  body: string;
  resumeName?: string;
  sentAt?: string | null;
}) {
  return (
    <article className="email-preview" aria-label={sentAt ? "Sent email" : "Email preview"}>
      <dl className="email-preview-details">
        <div>
          <dt>To</dt>
          <dd>{to || "Recipient not added"}</dd>
        </div>
        {sentAt && (
          <div>
            <dt>Sent</dt>
            <dd>
              <time dateTime={sentAt}>{new Date(sentAt).toLocaleString("en-US")}</time>
            </dd>
          </div>
        )}
      </dl>
      <h2>{subject || "Subject not added"}</h2>
      <div className="email-preview-body">{body || "Write your email to preview it here."}</div>
      {resumeName && (
        <p className="email-preview-attachment">
          <Paperclip size={15} /> {resumeName}
        </p>
      )}
    </article>
  );
}
