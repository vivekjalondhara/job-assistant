import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";

// Optional browser runner: use an installed Playwright module or PLAYWRIGHT_MODULE.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const origin = process.env.CSV_TEST_ORIGIN || "http://localhost:3218";
assert.ok(
  ["localhost", "127.0.0.1"].includes(new URL(origin).hostname),
  "Use the isolated HTTP smoke server, never production.",
);
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [],
  apiFailures = [],
  requests = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("request", (request) => {
  if (new URL(request.url()).origin !== origin) return;
  requests.push({
    path: new URL(request.url()).pathname,
    method: request.method(),
    bytes: Buffer.byteLength(request.postData() || ""),
  });
});
page.on("response", (response) => {
  if (response.status() >= 400)
    apiFailures.push({ path: new URL(response.url()).pathname, status: response.status() });
});
const eventually = async (check, message, timeout = 120000) => {
  const deadline = Date.now() + timeout;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
};
try {
  await page.goto(origin + "/login");
  await page.getByLabel("Email", { exact: true }).fill("admin@example.com");
  await page.getByLabel("Your password", { exact: true }).fill("smoke-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("link", { name: "My workspace", exact: true }).click();
  await page.getByRole("button", { name: "Companies", exact: true }).waitFor();
  await page.getByRole("button", { name: "Companies", exact: true }).click();
  await page.getByRole("heading", { name: "Your company shortlist." }).waitFor();
  assert.equal(await page.getByLabel("Import CSV", { exact: true }).count(), 1);
  const baseline = await (await page.request.get(origin + "/api/state")).json();
  const runId = Date.now().toString(36);
  const prefix = `CSV test ${runId}`;
  const filename = `browser-50mb-${runId}.csv`;
  const resultCard = page.locator(".csv-import-result").filter({ hasText: filename });
  const bytes = Buffer.alloc(50_000_000, "x");
  let offset = bytes.write("Company,Website,Notes\n");
  for (let i = 0; i < 50000; i++) {
    const length = i === 49999 ? bytes.length - offset : 999;
    bytes.write(`${prefix} company ${i},https://example.com,`, offset);
    bytes[offset + length - 1] = 10;
    offset += length;
  }
  const started = performance.now();
  await page
    .getByLabel("Import CSV", { exact: true })
    .setInputFiles({ name: filename, mimeType: "text/csv", buffer: bytes });
  await resultCard.getByText("Import complete", { exact: true }).waitFor({ timeout: 120000 });
  assert.ok(
    await resultCard
      .getByText("50,000 rows processed · 50,000 added · 0 duplicates · 0 invalid", { exact: true })
      .isVisible(),
  );
  await eventually(
    async () => (await page.locator(".company-card").count()) === 50,
    "Company directory should show 50 records.",
  );
  await eventually(
    async () => await page.getByRole("button", { name: "Next", exact: true }).isEnabled(),
    "Pagination should become ready after refresh.",
  );
  assert.ok(!(await page.getByRole("button", { name: "Previous", exact: true }).isEnabled()));
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await eventually(
    async () => await page.getByRole("button", { name: "Previous", exact: true }).isEnabled(),
    "Pagination should advance.",
  );
  await page.getByLabel("Search companies", { exact: true }).fill(`${prefix} company 12345`);
  await page.getByRole("heading", { name: `${prefix} company 12345`, exact: true }).waitFor();
  await eventually(
    async () => (await page.locator(".company-card").count()) === 1,
    "Search should query the full database.",
  );
  const data = await (await page.request.get(origin + "/api/state")).json();
  assert.equal(data.companyCount, baseline.companyCount + 50000);
  assert.equal(data.companies.length, 100);
  assert.equal(requests.filter((request) => request.path === "/api/upload").length, 0);
  assert.ok(
    requests
      .filter((request) => request.path === "/api/imports" && request.method === "POST")
      .every((request) => request.bytes < 4096),
  );
  mkdirSync("output", { recursive: true });
  await page.screenshot({ path: "output/csv-import-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await eventually(async () => {
    const box = await page.locator(".sidebar").boundingBox();
    return box && box.x + box.width <= 1;
  }, "Mobile navigation should close before capturing the layout.");
  await page.screenshot({ path: "output/csv-import-mobile.png", fullPage: true });
  assert.ok(await resultCard.getByText("Import complete", { exact: true }).isVisible());
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
    false,
    "Mobile page should not overflow horizontally.",
  );
  const before = requests.filter(
    (request) => request.path === "/api/imports" && request.method === "POST",
  ).length;
  await page.getByLabel("Import CSV", { exact: true }).setInputFiles({
    name: "too-large.csv",
    mimeType: "text/csv",
    buffer: Buffer.alloc(50_000_001),
  });
  await page.getByText("Choose a non-empty CSV file up to 50 MB.", { exact: true }).waitFor();
  assert.equal(
    requests.filter((request) => request.path === "/api/imports" && request.method === "POST")
      .length,
    before,
  );
  let interrupted = false;
  const storageFailures = [];
  page.on("requestfailed", (request) =>
    storageFailures.push({
      path: new URL(request.url()).pathname,
      external: new URL(request.url()).origin !== origin,
      method: request.method(),
      reason: request.failure()?.errorText,
    }),
  );
  await page.route("**/*", async (route) => {
    if (
      !interrupted &&
      route.request().method() === "PUT" &&
      new URL(route.request().url()).origin !== origin
    ) {
      interrupted = true;
      await route.abort("failed");
    } else await route.continue();
  });
  const retryFilename = `retry-${runId}.csv`;
  await page.getByLabel("Import CSV", { exact: true }).setInputFiles({
    name: retryFilename,
    mimeType: "text/csv",
    buffer: Buffer.from(`Company\nRetry ${runId}\n`),
  });
  await page.getByRole("button", { name: "Retry upload", exact: true }).click();
  const retried = page.locator(".csv-import-result").filter({ hasText: retryFilename });
  await retried.getByText("Import complete", { exact: true }).waitFor({ timeout: 30000 });
  assert.ok(
    await retried
      .getByText("1 rows processed · 1 added · 0 duplicates · 0 invalid", { exact: true })
      .isVisible(),
  );
  assert.equal(interrupted, true);
  assert.equal(
    storageFailures.filter((failure) => failure.external && failure.method === "PUT").length,
    1,
    "The deliberately interrupted storage upload should fail once.",
  );
  assert.deepEqual(
    storageFailures.filter(
      (failure) =>
        !(failure.external && failure.method === "PUT") &&
        !(
          failure.path === "/api/companies" &&
          failure.method === "GET" &&
          failure.reason === "net::ERR_ABORTED"
        ),
    ),
    [],
    "Only superseded company searches may be cancelled.",
  );
  assert.equal(
    (await (await page.request.get(origin + "/api/state")).json()).companyCount,
    baseline.companyCount + 50001,
  );
  assert.deepEqual(errors, [], "Browser should not throw JavaScript errors.");
  assert.deepEqual(apiFailures, [], "Valid import must not produce failed HTTP responses.");
  console.log(
    JSON.stringify(
      {
        url: origin + "/?view=companies",
        bytes: 50_000_000,
        rows: 50000,
        seconds: Number(((performance.now() - started) / 1000).toFixed(2)),
        pagination: "passed",
        search: "passed",
        oversizedFile: "rejected before request",
        interruptedUpload: "retried successfully, one intentional network failure",
        consoleErrors: errors,
        failedResponses: apiFailures,
        screenshots: ["output/csv-import-desktop.png", "output/csv-import-mobile.png"],
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
