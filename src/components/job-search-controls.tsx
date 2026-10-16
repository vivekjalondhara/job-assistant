"use client";
import { useState } from "react";
import type { AppState, SavedSearch } from "@/lib/types";
import { employmentTypes, workplaces } from "@/lib/job-preferences";
import { discoveryUrl } from "@/lib/career-tools";
import type { Act } from "./workspace";
import { Button, External } from "./ui";

export type SearchFilters = Pick<
  SavedSearch,
  "query" | "location" | "workplace" | "employmentType" | "maxAgeDays"
>;
export const emptySearch: SearchFilters = {
  query: "",
  location: "",
  workplace: "",
  employmentType: "",
  maxAgeDays: 0,
};
export function JobSearchControls({
  data,
  value,
  onChange,
  act,
  busy,
}: {
  data: AppState;
  value: SearchFilters;
  onChange: (value: SearchFilters) => void;
  act: Act;
  busy: string;
}) {
  const [name, setName] = useState("");
  return (
    <section className="panel search-controls" aria-label="Saved searches and job filters">
      <div className="form-grid">
        <label>
          Role, company or skill
          <input
            value={value.query}
            maxLength={200}
            onChange={(e) => onChange({ ...value, query: e.target.value })}
            placeholder="React developer"
          />
        </label>
        <label>
          Location filter
          <input
            value={value.location}
            maxLength={150}
            onChange={(e) => onChange({ ...value, location: e.target.value })}
            placeholder="City or country"
          />
        </label>
        <label>
          Work arrangement filter
          <select
            value={value.workplace}
            onChange={(e) => onChange({ ...value, workplace: e.target.value })}
          >
            <option value="">Any arrangement</option>
            {workplaces.map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        <label>
          Employment type filter
          <select
            value={value.employmentType}
            onChange={(e) => onChange({ ...value, employmentType: e.target.value })}
          >
            <option value="">Any type</option>
            {employmentTypes.map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        <label>
          Posting or first-seen age
          <select
            value={value.maxAgeDays}
            onChange={(e) => onChange({ ...value, maxAgeDays: Number(e.target.value) })}
          >
            <option value={0}>Any age</option>
            <option value={1}>Last 24 hours</option>
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
          </select>
        </label>
      </div>
      <form
        className="button-row save-search"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await act("search.save", { ...value, name })) setName("");
        }}
      >
        <label>
          Search name
          <input
            value={name}
            maxLength={100}
            required
            placeholder="My frontend search"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <Button type="submit" disabled={!!busy || !name.trim()}>
          Save this search
        </Button>
        <Button type="button" onClick={() => onChange(emptySearch)}>
          Clear filters
        </Button>
      </form>
      {!!data.searches?.length && (
        <div className="saved-searches">
          {data.searches.map((s) => (
            <div key={s.id} className="button-row">
              <Button type="button" onClick={() => onChange(s)}>
                {s.name}
              </Button>
              <button
                type="button"
                className="icon-btn"
                disabled={!!busy}
                aria-label={`Delete search ${s.name}`}
                onClick={() => act("search.delete", { id: s.id })}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      <p className="small muted">
        Discover employers beyond your saved companies. Open a web search, then import a suitable
        listing.
      </p>
      <External
        href={discoveryUrl(
          value.query || data.profile.targetRoles[0] || "",
          value.location || data.profile.preferredLocations[0] || "",
        )}
      >
        Search public careers pages
      </External>
    </section>
  );
}
