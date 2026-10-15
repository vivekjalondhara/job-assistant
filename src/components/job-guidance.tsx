import { jobInsights } from "@/lib/job-insights";
import type { Job, Profile } from "@/lib/types";
import { Badge } from "./ui";

export function JobGuidance({ job, profile }: { job: Job; profile: Profile }) {
  const insights = jobInsights(job, profile);
  return (
    <section className="match-card job-guidance" aria-label="Job description guidance">
      <h3>Tailor your application</h3>
      <p className="small muted">
        A local keyword guide. Skill mentions may be required, preferred, or background context;
        check the full listing.
      </p>
      {!profile.confirmed ? (
        <p>Confirm your profile in My profile to compare your experience.</p>
      ) : (
        <>
          <h4>Skills found in your profile</h4>
          <div className="button-row">
            {insights.supported.length ? (
              insights.supported.map((skill) => (
                <Badge key={skill} tone="green">
                  {skill}
                </Badge>
              ))
            ) : (
              <p className="small muted">No recognized overlap yet.</p>
            )}
          </div>
          <h4>Not evidenced in your profile</h4>
          <div className="button-row">
            {insights.missing.length ? (
              insights.missing.map((skill) => (
                <Badge key={skill} tone="amber">
                  {skill}
                </Badge>
              ))
            ) : (
              <p className="small muted">
                No additional recognized skill gaps. This is not a complete qualification check.
              </p>
            )}
          </div>
          {insights.evidence.length > 0 && (
            <>
              <h4>Examples you could emphasize</h4>
              {insights.evidence.map((quote) => (
                <blockquote className="evidence" key={quote}>
                  {quote}
                </blockquote>
              ))}
            </>
          )}
          <h4>How to improve this application</h4>
          <ul>
            {insights.suggestions.map((suggestion) => (
              <li key={suggestion}>{suggestion}</li>
            ))}
          </ul>
        </>
      )}
      {insights.requirements.length > 0 && (
        <details>
          <summary>Requirements to verify in the listing</summary>
          <ul>
            {insights.requirements.map((requirement) => (
              <li key={requirement}>{requirement}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
