import assert from "node:assert/strict";
const origin = "http://localhost:3218";
const post = (url: string, body: unknown, cookie = "") =>
  fetch(origin + url, {
    method: "POST",
    headers: { origin, cookie, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
const get = (url: string, cookie = "") =>
  fetch(origin + url, { headers: { cookie }, redirect: "manual" });
const session = (r: Response) => r.headers.get("set-cookie")!.split(";")[0];
const login = await post("/api/auth/login", {
  email: "admin@example.com",
  password: "smoke-test-password",
});
assert.equal(login.status, 200);
const admin = session(login);
const suffix = Date.now();
const users: { id: string; email: string; cookie: string }[] = [];
for (const name of ["Alice", "Bob"]) {
  const email = `${name.toLowerCase()}-${suffix}@example.com`;
  const invite = await post(
    "/api/admin/users",
    { action: "invite", payload: { name, email } },
    admin,
  );
  assert.equal(invite.status, 201, await invite.clone().text());
  const { user, link } = await invite.json();
  const token = new URL(link).hash.slice(1);
  const activation = await post("/api/auth/activate", { token, password: "secure-user-password" });
  assert.equal(activation.status, 200);
  users.push({ id: user.id, email, cookie: session(activation) });
  assert.equal(
    (await post("/api/auth/activate", { token, password: "another-secure-password" })).status,
    400,
  );
}
const [alice, bob] = users;
assert.equal((await get("/api/admin/users", alice.cookie)).status, 403);
assert.equal(
  (
    await post(
      "/api/admin/users",
      { action: "invite", payload: { name: "Unauthorized", email: `bad-${suffix}@example.com` } },
      alice.cookie,
    )
  ).status,
  403,
);
assert.equal(
  (
    await post(
      "/api/admin/users",
      {
        action: "invite",
        payload: {
          name: "Unauthorized admin",
          email: `bad-admin-${suffix}@example.com`,
          role: "admin",
        },
      },
      admin,
    )
  ).status,
  400,
);
const form = new FormData();
form.set(
  "file",
  new File(["Alice private résumé with React and TypeScript development experience."], "alice.txt"),
);
assert.equal(
  (
    await fetch(origin + "/api/upload", {
      method: "POST",
      headers: { origin, cookie: alice.cookie },
      body: form,
    })
  ).status,
  200,
);
const a = await (await get("/api/state", alice.cookie)).json();
const b = await (await get("/api/state", bob.cookie)).json();
assert.equal(a.resumes.length, 1);
assert.equal(b.resumes.length, 0);
assert.equal((await get(`/api/resume/${a.resumes[0].id}`, bob.cookie)).status, 404);
assert.equal(
  (
    await post(
      "/api/action",
      { action: "resume.default", payload: { id: a.resumes[0].id } },
      bob.cookie,
    )
  ).status,
  404,
);
assert.equal(
  (
    await post(
      "/api/action",
      { action: "resume.delete", payload: { id: a.resumes[0].id } },
      bob.cookie,
    )
  ).status,
  404,
);
assert.equal(
  (
    await post(
      "/api/admin/users",
      { action: "update", id: alice.id, payload: { status: "disabled" } },
      admin,
    )
  ).status,
  200,
);
assert.equal((await get("/api/state", alice.cookie)).status, 401);
assert.equal(
  (
    await post(
      "/api/admin/users",
      { action: "update", id: alice.id, payload: { status: "active" } },
      admin,
    )
  ).status,
  200,
);
assert.equal(
  (await get("/api/state", alice.cookie)).status,
  401,
  "Reactivation must not restore revoked cookies",
);
const reset = await post("/api/admin/users", { action: "resend", id: alice.id }, admin);
assert.equal(reset.status, 200);
const link = (await reset.json()).link;
const activateAgain = await post("/api/auth/activate", {
  token: new URL(link).hash.slice(1),
  password: "replacement-password",
});
assert.equal(activateAgain.status, 200);
assert.equal(
  (await post("/api/auth/login", { email: alice.email, password: "secure-user-password" })).status,
  401,
);
assert.equal(
  (
    await post(
      "/api/admin/users",
      { action: "delete", id: alice.id, confirmation: "wrong@example.com" },
      admin,
    )
  ).status,
  400,
);
assert.equal(
  (
    await post(
      "/api/admin/users",
      { action: "delete", id: alice.id, confirmation: alice.email },
      admin,
    )
  ).status,
  200,
);
assert.equal((await get("/api/state", session(activateAgain))).status, 401);
const summaries = await (await get("/api/admin/users", admin)).json();
assert.ok(!summaries.users.some((u: { id: string }) => u.id === alice.id));
assert.ok(!JSON.stringify(summaries).includes("private résumé"));
await post("/api/admin/users", { action: "delete", id: bob.id, confirmation: bob.email }, admin);
console.log(
  "Multi-user HTTP: invitation, one-use activation, admin authorization, role-spoof rejection, private files, disabled sessions, password reset, and confirmed deletion passed.",
);
