import assert from "node:assert/strict";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { cpSync, mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setupTestStorage } from "./setup";
import { emptyProfile } from "../src/lib/types";
import { resumePdf, verifyPdfDeployment } from "./pdf-deployment";
const cleanup = await setupTestStorage();
const directory = mkdtempSync(path.join(tmpdir(), "folio-cloud-http-"));
for (const name of [
  "src",
  "public",
  "next.config.ts",
  "tsconfig.json",
  "package.json",
  "package-lock.json",
])
  if (existsSync(name)) cpSync(name, path.join(directory, name), { recursive: true });
execFileSync("cp", ["-al", path.resolve("node_modules"), path.join(directory, "node_modules")]);
const port = 3218;
const origin = `http://localhost:${port}`;
const env = {
  ...process.env,
  NODE_ENV: "production" as const,
  APP_URL: origin,
  APP_SETUP_TOKEN: "isolated-setup-token-for-smoke-test",
  CRON_SECRET: "isolated-cron-secret",
  GOOGLE_CLIENT_ID: "",
  GOOGLE_CLIENT_SECRET: "",
  GOOGLE_ALLOWED_EMAIL: "",
  OPENROUTER_API_KEY: "",
  OPENROUTER_MODEL: "",
  VERCEL: "",
};
let server: ChildProcess | undefined;
let logs = "";
const launch = (args: string[]) => {
  const child = spawn(
    process.execPath,
    [path.join(directory, "node_modules/next/dist/bin/next"), ...args],
    { cwd: directory, env, stdio: ["ignore", "pipe", "pipe"] },
  );
  child.stdout?.on("data", (chunk) => {
    logs += chunk.toString();
  });
  child.stderr?.on("data", (chunk) => {
    logs += chunk.toString();
  });
  return child;
};
const start = async () => {
  server = launch(["start", "--hostname", "127.0.0.1", "--port", String(port)]);
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error("Test server exited unexpectedly");
    try {
      if ((await fetch(origin + "/login")).status === 200) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Test server did not become ready");
};
const stop = async () => {
  if (server && server.exitCode === null) {
    server.kill("SIGTERM");
    await once(server, "exit");
  }
};
let cookie = "";
const request = (url: string, init: RequestInit = {}) =>
  fetch(origin + url, { ...init, headers: { origin, cookie, ...init.headers } });
const post = (url: string, body: unknown) =>
  request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
try {
  const build = launch(["build"]);
  assert.equal((await once(build, "exit"))[0], 0, "isolated production build");
  const pdf = process.env.TEST_RESUME_PDF ? readFileSync(process.env.TEST_RESUME_PDF) : resumePdf();
  verifyPdfDeployment(directory, pdf);
  await start();
  assert.equal((await request("/api/state")).status, 401);
  assert.equal((await request("/api/imports")).status, 401);
  assert.equal((await request("/api/companies")).status, 401);
  const loginPage = await request("/login");
  assert.match(await loginPage.text(), /Workspace setup token/);
  assert.equal((await post("/api/auth/login", { password: "smoke-test-password" })).status, 403);
  const login = await post("/api/auth/login", {
    password: "smoke-test-password",
    setupToken: env.APP_SETUP_TOKEN,
  });
  assert.equal(login.status, 200);
  cookie = login.headers.get("set-cookie")!.split(";")[0];
  assert.equal(
    (await post("/api/imports", { action: "start", name: "large.csv", size: 50000001 })).status,
    400,
  );
  assert.equal(
    (
      await request("/api/imports", {
        method: "POST",
        headers: { origin: "https://foreign.example", "content-type": "application/json" },
        body: JSON.stringify({ action: "start", name: "companies.csv", size: 100 }),
      })
    ).status,
    403,
  );
  assert.equal(
    (await request("/api/imports", { method: "POST", body: "x".repeat(4097) })).status,
    413,
  );
  assert.equal(
    (await request("/api/imports", { method: "POST", body: "invalid JSON" })).status,
    400,
  );
  assert.equal((await request("/")).status, 200);
  const pdfForm = new FormData();
  pdfForm.set("file", new File([new Uint8Array(pdf)], "resume.pdf", { type: "application/pdf" }));
  const pdfUpload = await request("/api/upload", { method: "POST", body: pdfForm });
  assert.equal(pdfUpload.status, 200, await pdfUpload.text());
  const pdfState = await (await request("/api/state")).json();
  assert.ok(pdfState.profile.resumeText.trim().length >= 30);
  const pdfDownload = await request(`/api/resume/${pdfState.profile.resumeId}`);
  assert.deepEqual(Buffer.from(await pdfDownload.arrayBuffer()), pdf);
  const invalidForm = new FormData();
  invalidForm.set("file", new File(["not a PDF"], "invalid.pdf", { type: "application/pdf" }));
  assert.equal((await request("/api/upload", { method: "POST", body: invalidForm })).status, 400);
  assert.equal(
    (await (await request("/api/state")).json()).profile.resumeId,
    pdfState.profile.resumeId,
  );
  const resumeText =
    "Smoke Test Candidate: built a TypeScript application with PostgreSQL and Node.js.";
  const form = new FormData();
  form.set("file", new File([resumeText], "resume.txt", { type: "text/plain" }));
  assert.equal((await request("/api/upload", { method: "POST", body: form })).status, 200);
  let data = await (await request("/api/state")).json();
  assert.equal(await (await request(`/api/resume/${data.profile.resumeId}`)).text(), resumeText);
  assert.equal(
    (
      await post("/api/action", {
        action: "profile.save",
        payload: {
          ...emptyProfile,
          name: "Smoke Test Candidate",
          skills: ["TypeScript"],
          experience: "Built a TypeScript application with PostgreSQL and Node.js.",
          confirmed: true,
        },
      })
    ).status,
    200,
  );
  const csv = new FormData();
  csv.set("type", "csv");
  csv.set(
    "file",
    new File(["Company,Website\nSmoke Test Company,https://example.com\n"], "companies.csv", {
      type: "text/csv",
    }),
  );
  assert.equal((await request("/api/upload", { method: "POST", body: csv })).status, 200);
  data = await (await request("/api/state")).json();
  assert.equal(data.profile.name, "Smoke Test Candidate");
  assert.equal(data.companies.length, 1);
  assert.equal(
    (await post("/api/action", { action: "company.scan", payload: { id: data.companies[0].id } }))
      .status,
    200,
  );
  for (let i = 0; i < 50; i++) {
    data = await (await request("/api/state")).json();
    if (data.companies[0].checkStatus === "manual") break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(data.companies[0].checkStatus, "manual");
  assert.equal((await request("/api/cron")).status, 401);
  assert.equal(
    (await request("/api/cron", { headers: { authorization: `Bearer ${env.CRON_SECRET}` } }))
      .status,
    200,
  );
  await stop();
  await start();
  data = await (await request("/api/state")).json();
  assert.equal(data.profile.name, "Smoke Test Candidate");
  assert.equal(data.companies.length, 1);
  assert.equal(await (await request(`/api/resume/${data.profile.resumeId}`)).text(), resumeText);
  assert.equal((await post("/api/auth/logout", {})).status, 200);
  cookie = "";
  assert.equal((await request("/api/state")).status, 401);
  console.log(
    "Production HTTP smoke: login, setup-token protection, workspace, PDF and TXT upload/download, invalid-PDF rejection, profile save, CSV import, background jobs, cron auth, logout, and restart persistence passed.",
  );
  if (process.argv.includes("--serve")) {
    console.log(`Isolated browser verification server: ${origin}`);
    await new Promise<void>((resolve) => {
      process.once("SIGTERM", resolve);
      process.once("SIGINT", resolve);
    });
  }
} catch (error) {
  console.error(error);
  console.error(logs.slice(-8000));
  process.exitCode = 1;
} finally {
  await stop();
  await cleanup();
  rmSync(directory, { recursive: true, force: true });
}
