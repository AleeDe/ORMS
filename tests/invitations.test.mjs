import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";

const requireTs = createRequire(import.meta.url);
requireTs.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: filename,
}).outputText, filename);
const { invitationRequest, invitationOrigin } = requireTs("../src/lib/invitations.ts");
const { confirmAuthLink } = requireTs("../src/lib/auth-confirmation.ts");
const { sendInvitationEmail } = requireTs("../src/lib/invitation-email.ts");
const campaign = "00000000-0000-4000-8000-000000000001";
const grants = [{ campaign_id: campaign, role: "member" }];

test("invitation input normalizes email and rejects malformed or ambiguous campaign grants", () => {
  assert.equal(invitationRequest.parse({ email: " Person@Example.com ", grants }).email, "person@example.com");
  for (const input of [null, {}, { email: "bad", grants }, { email: "x@example.com", grants: [] },
    { email: "x@example.com", grants: [{ campaign_id: "bad", role: "member" }] },
    { email: "x@example.com", grants: [{ campaign_id: campaign, role: "owner" }] },
    { email: "x@example.com", grants: [...grants, { campaign_id: campaign, role: "manager" }] }]) {
    assert.equal(invitationRequest.safeParse(input).success, false);
  }
});

test("invitation URLs use the canonical configured origin and reject unsafe or missing production settings", () => {
  assert.equal(invitationOrigin("https://shiftorms.netlify.app/"), "https://shiftorms.netlify.app");
  assert.equal(invitationOrigin("https://orms.shiftdeploy.com/path?q=x"), "https://orms.shiftdeploy.com");
  assert.equal(invitationOrigin("http://localhost:3000"), "http://localhost:3000");
  for (const value of ["invalid", "javascript:alert(1)", "https://user:password@example.com"]) assert.throws(() => invitationOrigin(value));
  const previous = process.env.NODE_ENV;
  try { process.env.NODE_ENV = "production"; assert.throws(() => invitationOrigin("")); }
  finally { if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous; }
});

test("hosted invitation links can be configured while local OAuth keeps the local application URL", () => {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL, invitationUrl = process.env.WORKSPACE_INVITATION_APP_URL;
  try {
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
    process.env.WORKSPACE_INVITATION_APP_URL = "https://shiftorms.netlify.app";
    assert.equal(invitationOrigin(), "https://shiftorms.netlify.app");
    assert.equal(process.env.NEXT_PUBLIC_APP_URL, "http://localhost:3000");
    delete process.env.WORKSPACE_INVITATION_APP_URL;
    assert.equal(invitationOrigin(), "http://localhost:3000");
  } finally {
    if (appUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL; else process.env.NEXT_PUBLIC_APP_URL = appUrl;
    if (invitationUrl === undefined) delete process.env.WORKSPACE_INVITATION_APP_URL; else process.env.WORKSPACE_INVITATION_APP_URL = invitationUrl;
  }
});

test("signup and recovery callbacks exchange PKCE codes as well as token-hash email links", async () => {
  const calls = [];
  const auth = {
    exchangeCodeForSession: async code => { calls.push(["code", code]); return { error: null }; },
    verifyOtp: async input => { calls.push(["hash", input]); return { error: null }; },
  };
  assert.equal(await confirmAuthLink(auth, new URLSearchParams({ code: "pkce-code", next: "/join/invite" })), true);
  assert.equal(await confirmAuthLink(auth, new URLSearchParams({ token_hash: "hash", type: "recovery" })), true);
  assert.equal(await confirmAuthLink(auth, new URLSearchParams({ token_hash: "hash", type: "email" })), true);
  assert.deepEqual(calls, [["code", "pkce-code"], ["hash", { token_hash: "hash", type: "recovery" }], ["hash", { token_hash: "hash", type: "email" }]]);
  assert.equal(await confirmAuthLink(auth, new URLSearchParams({ token_hash: "hash", type: "sms" })), false);
  assert.equal(await confirmAuthLink(auth, new URLSearchParams()), false);
  assert.equal(calls.length, 3);
});

test("expired links, missing browser verifiers and connection errors return a recoverable auth failure", async () => {
  const auth = { exchangeCodeForSession: async () => ({ error: { message: "Verifier missing" } }), verifyOtp: async () => ({ error: { message: "Expired" } }) };
  assert.equal(await confirmAuthLink(auth, new URLSearchParams({ code: "used" })), false);
  assert.equal(await confirmAuthLink(auth, new URLSearchParams({ token_hash: "used", type: "signup" })), false);
  auth.exchangeCodeForSession = async () => { throw Error("Network unavailable"); };
  assert.equal(await confirmAuthLink(auth, new URLSearchParams({ code: "code" })), false);
});

test("transient email failures retry the identical payload and key without duplicating an invitation", async () => {
  const original = { fetch: global.fetch, timeout: global.setTimeout, key: process.env.RESEND_API_KEY, sender: process.env.RESEND_FROM_EMAIL, enabled: process.env.WORKSPACE_INVITATION_EMAIL_ENABLED };
  const invite = { id: "invite", email: "person@example.invalid", workspaceName: "Example", inviterEmail: "owner@example.invalid", url: "https://orms.example/join/token" };
  const calls = [], delays = [];
  try {
    process.env.RESEND_API_KEY = "test-key"; process.env.RESEND_FROM_EMAIL = "ORMS <test@example.invalid>";
    delete process.env.WORKSPACE_INVITATION_EMAIL_ENABLED;
    global.fetch = async () => { throw Error("Email delivery must remain disabled by default"); };
    assert.equal(await sendInvitationEmail(invite), "not_configured");
    process.env.WORKSPACE_INVITATION_EMAIL_ENABLED = "false";
    assert.equal(await sendInvitationEmail(invite), "not_configured");
    process.env.WORKSPACE_INVITATION_EMAIL_ENABLED = "true";
    global.setTimeout = (callback, delay) => { delays.push(delay); queueMicrotask(callback); return 0; };
    for (const first of [429, 503, "network"]) {
      calls.length = 0;
      global.fetch = async (url, options) => {
        calls.push({ url, headers: options.headers, body: options.body });
        if (calls.length === 1) { if (first === "network") throw Error("Response lost"); return new Response("", { status: first }); }
        return Response.json({ id: "provider-id" });
      };
      assert.equal(await sendInvitationEmail(invite), "sent");
      assert.equal(calls.length, 2);
      assert.deepEqual(calls[0], calls[1]);
      assert.equal(calls[0].headers["Idempotency-Key"], "orms-invitation/invite");
    }
    let attempts = 0;
    global.fetch = async () => { attempts++; return Response.json({ message: "Unauthorized" }, { status: 403 }); };
    assert.equal(await sendInvitationEmail(invite), "failed");
    assert.equal(attempts, 1);
    global.fetch = async () => Response.json({ id: {} });
    assert.equal(await sendInvitationEmail(invite), "failed");
    attempts = 0;
    global.fetch = async () => { attempts++; return new Response("", { status: 503 }); };
    assert.equal(await sendInvitationEmail(invite), "failed");
    assert.equal(attempts, 2);
    assert(delays.every(delay => delay === 1000));
  } finally {
    global.fetch = original.fetch; global.setTimeout = original.timeout;
    if (original.key === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = original.key;
    if (original.sender === undefined) delete process.env.RESEND_FROM_EMAIL; else process.env.RESEND_FROM_EMAIL = original.sender;
    if (original.enabled === undefined) delete process.env.WORKSPACE_INVITATION_EMAIL_ENABLED; else process.env.WORKSPACE_INVITATION_EMAIL_ENABLED = original.enabled;
  }
});
