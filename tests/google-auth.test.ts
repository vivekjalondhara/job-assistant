import { test, beforeEach, after } from "./scoped-test";
import assert from "node:assert/strict";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { setupTestStorage } from "./setup";
import { allowedGoogleEmails, isAllowedGoogleEmail } from "../src/lib/google-config";

const cleanup = await setupTestStorage();
const store = await import("../src/lib/db");
const { encrypt } = await import("../src/lib/security");
const { authorizationUrl, googleConfigured, exchangeCode, connection, disconnectGmail } =
  await import("../src/lib/gmail");
const keys = await generateKeyPair("RS256");
const publicJwk = {
  ...(await exportJWK(keys.publicKey)),
  kid: "test-google",
  alg: "RS256",
  use: "sig",
};
const originalFetch = global.fetch;
const scopes =
  "openid email https://www.googleapis.com/auth/gmail.compose https://www.googleapis.com/auth/gmail.readonly";

beforeEach(async () => {
  await store.query("DELETE FROM folio_records; DELETE FROM folio_tasks;");
  process.env.GOOGLE_ALLOWED_EMAIL = "first@example.com,second@example.com";
  process.env.GOOGLE_CLIENT_ID = "test-client";
  process.env.GOOGLE_CLIENT_SECRET = "test-secret";
  process.env.APP_URL = "http://localhost:3210";
  global.fetch = async () => {
    throw new Error("Unexpected external request");
  };
});
after(async () => {
  global.fetch = originalFetch;
  await store.closeDatabase();
  await cleanup();
});

async function oauthMock(
  email: string,
  options: {
    verified?: unknown;
    refreshToken?: string | null;
    audience?: string;
    scope?: string;
  } = {},
) {
  const token = await new SignJWT({ email, email_verified: options.verified ?? true })
    .setProtectedHeader({ alg: "RS256", kid: "test-google" })
    .setIssuer("https://accounts.google.com")
    .setAudience(options.audience || "test-client")
    .setSubject(email)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(keys.privateKey);
  const revocations: string[] = [];
  global.fetch = async (input, init) => {
    const url = String(input);
    if (url === "https://www.googleapis.com/oauth2/v3/certs")
      return Response.json({ keys: [publicJwk] });
    if (url === "https://oauth2.googleapis.com/token") {
      const form = new URLSearchParams(String(init?.body));
      assert.equal(init?.method, "POST");
      assert.equal(form.get("grant_type"), "authorization_code");
      assert.equal(form.get("code"), "test-code");
      assert.equal(form.get("redirect_uri"), "http://localhost:3210/api/auth/google/callback");
      return Response.json({
        id_token: token,
        access_token: `access-${email}`,
        expires_in: 3600,
        ...(options.refreshToken === null
          ? {}
          : { refresh_token: options.refreshToken || `refresh-${email}` }),
        scope: options.scope ?? scopes,
      });
    }
    if (url === "https://oauth2.googleapis.com/revoke") {
      revocations.push(new URLSearchParams(String(init?.body)).get("token")!);
      return new Response(null, { status: 200 });
    }
    throw new Error(`Unexpected request ${url}`);
  };
  return revocations;
}

test("allowed addresses accept one or several exact emails, ignoring case, spacing and duplicates", () => {
  assert.deepEqual(allowedGoogleEmails(" First@Example.com "), ["first@example.com"]);
  assert.deepEqual(allowedGoogleEmails("FIRST@example.com, second@example.com,first@example.com"), [
    "first@example.com",
    "second@example.com",
  ]);
  assert.equal(isAllowedGoogleEmail("SECOND@EXAMPLE.COM"), true);
  for (const email of [
    "third@example.com",
    "first@example.com.attacker.test",
    "first+extra@example.com",
    "f.irst@example.com",
  ])
    assert.equal(isAllowedGoogleEmail(email), false, email);
});

test("empty, malformed and wildcard configurations disable Google connection", () => {
  for (const config of [
    "",
    " , ",
    "*@example.com",
    "first@example.com,invalid",
    "first@example.com;second@example.com",
  ]) {
    process.env.GOOGLE_ALLOWED_EMAIL = config;
    assert.deepEqual(allowedGoogleEmails(), [], config);
    assert.equal(googleConfigured(), false, config);
    assert.throws(() => authorizationUrl("test-state"), /comma-separated/);
  }
});

test("authorization offers account selection and preserves callback and state", () => {
  const url = new URL(authorizationUrl("test-state"));
  assert.equal(url.origin, "https://accounts.google.com");
  assert.equal(url.searchParams.get("prompt"), "consent select_account");
  assert.equal(url.searchParams.get("state"), "test-state");
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(
    url.searchParams.get("redirect_uri"),
    "http://localhost:3210/api/auth/google/callback",
  );
});

test("either allowed account can connect, disconnect and then switch with its own credentials", async () => {
  const revoked = await oauthMock("FIRST@example.com");
  await exchangeCode("test-code");
  assert.equal((await connection())?.email, "first@example.com");
  assert.equal((await connection())?.needsReconnect, false);
  await disconnectGmail();
  assert.equal(await connection(), null);
  assert.deepEqual(revoked, ["refresh-FIRST@example.com"]);
  await oauthMock("second@example.com");
  await exchangeCode("test-code");
  assert.equal((await connection())?.email, "second@example.com");
  assert.equal((await connection())?.refreshToken, "refresh-second@example.com");
  assert.equal((await connection())?.accessToken, "access-second@example.com");
});

test("unlisted or unverified identities cannot replace an existing connection", async () => {
  await oauthMock("first@example.com");
  await exchangeCode("test-code");
  for (const identity of [
    { email: "outsider@example.com", verified: true },
    { email: "second@example.com", verified: false },
    { email: "second@example.com", verified: "true" },
  ]) {
    await oauthMock(identity.email, identity);
    await assert.rejects(exchangeCode("test-code"), /verified Google account/);
    assert.equal((await connection())?.email, "first@example.com");
  }
});

test("identity audience and required Gmail permissions remain enforced", async () => {
  await oauthMock("first@example.com", { audience: "other-client" });
  await assert.rejects(exchangeCode("test-code"), /aud/);
  assert.equal(await connection(), null);
  await oauthMock("first@example.com", { scope: "openid email" });
  await assert.rejects(exchangeCode("test-code"), /both Gmail permissions/);
  assert.equal(await connection(), null);
});

test("a missing refresh token can reuse only the same account's saved token", async () => {
  await oauthMock("first@example.com");
  await exchangeCode("test-code");
  await oauthMock("first@example.com", { refreshToken: null });
  await exchangeCode("test-code");
  assert.equal((await connection())?.refreshToken, "refresh-first@example.com");
  await oauthMock("second@example.com", { refreshToken: null });
  await assert.rejects(exchangeCode("test-code"), /offline access/);
  assert.equal((await connection())?.email, "first@example.com");
  assert.equal((await connection())?.refreshToken, "refresh-first@example.com");
});

test("disconnect remembers legacy draft ownership and does not remove a newly connected account during revocation", async () => {
  await oauthMock("first@example.com");
  await exchangeCode("test-code");
  await store.put("draft", {
    id: "legacy",
    gmailDraftId: "old-id",
    status: "approved",
    approvedHash: "old-approval",
  });
  let revoked = false;
  global.fetch = async (input, init) => {
    assert.equal(String(input), "https://oauth2.googleapis.com/revoke");
    assert.equal(new URLSearchParams(String(init?.body)).get("token"), "refresh-first@example.com");
    assert.equal(await connection(), null);
    await store.put("secret", {
      id: "gmail",
      value: encrypt({
        email: "second@example.com",
        accessToken: "new-access",
        refreshToken: "new-refresh",
        expiresAt: Date.now() + 3600000,
        needsReconnect: false,
      }),
    });
    revoked = true;
    return new Response(null, { status: 200 });
  };
  await disconnectGmail();
  assert.equal(revoked, true);
  assert.equal((await connection())?.email, "second@example.com");
  const legacy = await store.get<import("../src/lib/types").Draft>("draft", "legacy");
  assert.equal(legacy?.gmailAccountEmail, "first@example.com");
  assert.equal(legacy?.approvedHash, null);
  assert.equal(legacy?.status, "gmail_draft");
});

test("an invited user connects their own verified mailbox without changing the original owner connection", async () => {
  const owner = await connection();
  const secondaryId = store.id();
  await store.query(
    "INSERT INTO folio_accounts(id,email,name,role,status,created_at) VALUES($1,'candidate@example.com','Candidate','user','active',$2)",
    [secondaryId, store.now()],
  );
  await oauthMock("candidate@gmail.com");
  await store.withUser(secondaryId, async () => {
    assert.equal(googleConfigured(), true);
    await exchangeCode("test-code");
    assert.equal((await connection())?.email, "candidate@gmail.com");
  });
  assert.deepEqual(await connection(), owner);
});
