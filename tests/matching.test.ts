import { test } from "node:test";
import assert from "node:assert/strict";
import { matchJob } from "../src/lib/matching";
import { emptyProfile, type Profile } from "../src/lib/types";

const profile: Profile = {
  ...emptyProfile,
  confirmed: true,
  skills: ["Node.js", "PostgreSQL"],
  experience: "2 years of professional software development experience.",
  targetRoles: ["Backend engineer"],
  preferredLocations: ["Remote"],
};
const job = {
  title: "Backend engineer",
  description: "Build Node.js APIs with PostgreSQL. Requires 2+ years of experience.",
  location: "Remote",
  remote: true,
};

test("a junior candidate cannot receive a strong match for a senior role requiring eight years", () => {
  const match = matchJob(
    { ...job, title: "Senior backend engineer", description: job.description.replace("2+", "8+") },
    { ...profile, targetRoles: ["Junior backend engineer"] },
  )!;
  assert.equal(match.rating, "weak");
  assert.ok(match.score < 40);
  assert.match(match.gaps.join(" "), /8 years.*2 years/i);
  assert.match(match.gaps.join(" "), /seniority/i);
  assert.ok(!match.reasons.some((reason) => reason.includes("title overlaps")));
});

test("meeting the stated experience requirement improves fit without unrelated skills affecting it", () => {
  const qualified = matchJob(job, profile)!;
  const short = matchJob({ ...job, description: job.description.replace("2+", "4+") }, profile)!;
  assert.equal(qualified.rating, "strong");
  assert.match(qualified.reasons.join(" "), /experience/i);
  assert.ok(short.score < qualified.score);
  assert.notEqual(short.rating, "strong");
  assert.equal(
    matchJob(job, { ...profile, skills: [...profile.skills, "Python"] })!.score,
    qualified.score,
  );
});

test("missing or ambiguous candidate duration cannot pass a stated experience requirement", () => {
  for (const experience of [
    "Built Node.js APIs with PostgreSQL.",
    "Worked from 2018 to 2026 building Node.js APIs.",
    "2 years of Node.js experience; 8 years of PostgreSQL experience.",
    "I do not have 8 years of experience.",
    "Less than 8 years of experience.",
  ]) {
    const match = matchJob(job, { ...profile, experience })!;
    assert.notEqual(match.rating, "strong", experience);
    assert.match(match.unknowns.join(" "), /experience/i);
  }
});

test("experience ranges, decimals, months, abbreviated years and written numbers affect fit", () => {
  for (const requirement of [
    "Requires 5–8 years of experience.",
    "Requires 5 to 8 years of experience.",
    "Requires 5 yrs of relevant experience.",
    "Requires five years of professional experience.",
    "Requires 60 months of experience.",
    "Requires 5 years working with Node.js.",
    "Requires 5 years of software development.",
    "Requires 5 or more years of experience.",
    "We are looking for someone with 5 years of experience.",
    "Our company requires 5 years of experience.",
    "Requires 5 years of experience, preferably 8 years.",
  ]) {
    const match = matchJob(
      { ...job, description: `Node.js and PostgreSQL. ${requirement}` },
      profile,
    )!;
    assert.ok(match.score < 40, requirement);
    assert.match(match.gaps.join(" "), /5 years.*2 years/i);
  }
  const fractional = matchJob(job, { ...profile, experience: "1.5 years of experience." })!;
  assert.notEqual(fractional.rating, "strong");
  assert.match(fractional.gaps.join(" "), /1\.5 years/);
});

test("preferred qualifications and company ages are not mandatory experience requirements", () => {
  const baseline = matchJob(job, profile)!;
  for (const extra of [
    "Preferably 10 years of experience.",
    "10 years of experience preferred.",
    "10 years of experience is not required.",
    "Our company has 10 years of experience serving customers.",
    "We have been in business for 10 years.",
    "\nPreferred qualifications:\n10 years of experience.",
  ]) {
    const match = matchJob({ ...job, description: `${job.description}\n${extra}` }, profile)!;
    assert.equal(match.score, baseline.score, extra);
    assert.ok(!match.gaps.some((gap) => gap.includes("10 years")), extra);
  }
});

test("alternative qualification paths need review instead of claiming one minimum applies to all", () => {
  const match = matchJob(
    {
      ...job,
      description:
        "Node.js and PostgreSQL. Requires 8 years of experience or a degree with 2 years of experience.",
    },
    profile,
  )!;
  assert.notEqual(match.rating, "strong");
  assert.match(match.unknowns.join(" "), /alternative/i);
  assert.ok(!match.gaps.some((gap) => gap.includes("8 years")));
});

test("seniority preferences and the current headline matter even when years are not specified", () => {
  const seniorJob = {
    ...job,
    title: "Senior backend engineer",
    description: "Build Node.js APIs with PostgreSQL.",
  };
  const junior = matchJob(seniorJob, { ...profile, targetRoles: ["Junior backend engineer"] })!;
  assert.notEqual(junior.rating, "strong");
  assert.match(junior.gaps.join(" "), /seniority/i);
  const aspirational = matchJob(seniorJob, {
    ...profile,
    headline: "Junior backend engineer",
    targetRoles: ["Senior backend engineer"],
  })!;
  assert.notEqual(aspirational.rating, "strong");
  assert.match(aspirational.gaps.join(" "), /headline/i);
  const unknown = matchJob(seniorJob, profile)!;
  assert.notEqual(unknown.rating, "strong");
  assert.match(unknown.unknowns.join(" "), /seniority/i);
});

test("seniority abbreviations match while managers and unrelated engineering roles stay distinct", () => {
  const seniorProfile = {
    ...profile,
    headline: "Senior backend engineer",
    targetRoles: ["Senior backend engineer"],
  };
  assert.ok(
    matchJob({ ...job, title: "Sr. backend engineer" }, seniorProfile)!.reasons.some((reason) =>
      reason.includes("title overlaps"),
    ),
  );
  for (const title of ["Mechanical engineer", "Backend manager"]) {
    const match = matchJob({ ...job, title }, { ...profile, targetRoles: ["Backend engineer"] })!;
    assert.ok(!match.reasons.some((reason) => reason.includes("title overlaps")), title);
  }
});

test("confirmation, missing skills, remote-only requirements, and lower skill coverage still constrain matching", () => {
  assert.equal(matchJob(job, { ...profile, confirmed: false }), null);
  assert.equal(matchJob(job, { ...profile, skills: [] }), null);
  const remote = matchJob({ ...job, remote: false }, { ...profile, remoteOnly: true })!;
  assert.ok(remote.score <= 35);
  assert.match(remote.gaps.join(" "), /Remote/);
  assert.ok(
    matchJob({ ...job, description: `${job.description} AWS required.` }, profile)!.score <
      matchJob(job, profile)!.score,
  );
});
