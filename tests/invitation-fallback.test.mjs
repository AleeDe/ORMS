import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";

const requireTs = createRequire(import.meta.url);
requireTs.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: filename,
}).outputText, filename);
const { handleInvitationEmail } = requireTs("../supabase/functions/_shared/invitation-handler.ts");
const { remoteInvitationEmailConfigured, sendRemoteInvitationEmail } = requireTs("../src/lib/remote-invitation-email.ts");
const workspace = "00000000-0000-4000-8000-000000000001";
const id = "00000000-0000-4000-8000-000000000002";
const token = "a".repeat(64);
const config = { supabaseUrl: "https://db.example", anonKey: "public-test", serviceRoleKey: "private-test", apiKey: "resend-test", sender: "ORMS <test@example.invalid>", appUrl: "https://orms.example", enabled: true };
const request = (body = { id, token }, overrides = {}) => new Request("https://function.example", {
  method: "POST", headers: { Authorization: "Bearer owner-session", "x-orms-workspace": workspace }, body: JSON.stringify(body), ...overrides,
});

async function fixture(run, options = {}) {
  const original = global.fetch, calls = [];
  const row = { id, email: "invited@example.invalid", token_hash: Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))), byte => byte.toString(16).padStart(2, "0")).join(""), expires_at: new Date(Date.now() + 86_400_000).toISOString(), accepted_at: null, revoked_at: null, delivery_status: "link_created", ...options.row };
  global.fetch = async (url, init) => {
    calls.push({ url, ...init });
    if (url.endsWith("/auth/v1/user")) return options.invalidAuth ? new Response("", { status: 401 }) : Response.json({ id: "owner", email: "owner@example.invalid", email_confirmed_at: "2026-01-01", ...options.user });
    if (url.endsWith("/rpc/orms_is_owner")) return Response.json(options.owner !== false);
    if (url.includes("/team_invitations?")) return Response.json(options.noInvitation ? [] : [row]);
    if (url.includes("/workspaces?")) return Response.json([{ name: "Company & Co" }]);
    if (url === "https://api.resend.com/emails") return options.providerFailure ? new Response("", { status: 403 }) : Response.json({ id: "email-id" });
    if (url.endsWith("/rpc/orms_mark_invitation_delivery")) return new Response(null, { status: options.trackingFailure ? 500 : 204 });
    throw Error("Unexpected request");
  };
  try { await run(calls); } finally { global.fetch = original; }
}

test("fallback rejects unauthenticated, unverified and non-owner callers before accessing invitations", async () => {
  await fixture(async calls => {
    assert.equal((await handleInvitationEmail(request({}, { headers: {} }), config)).status, 401);
    assert.equal((await handleInvitationEmail(request({}, { headers: { Authorization: "Bearer x", "x-orms-workspace": "bad" } }), config)).status, 400);
    assert.equal(calls.length, 0);
  });
  for (const options of [{ invalidAuth: true }, { user: { email_confirmed_at: null } }, { owner: false }]) {
    await fixture(async calls => {
      assert([401, 403].includes((await handleInvitationEmail(request(), config)).status));
      assert(!calls.some(call => call.url.includes("/team_invitations?") || call.url.includes("resend.com")));
    }, options);
  }
});

test("fallback binds invitations to the workspace, token and pending expiry before sending", async () => {
  for (const options of [{ noInvitation: true }, { row: { token_hash: "wrong" } }, { row: { expires_at: "2000-01-01" } }, { row: { expires_at: "invalid" } }, { row: { accepted_at: "2026-01-01" } }, { row: { revoked_at: "2026-01-01" } }]) {
    await fixture(async calls => {
      assert.equal((await handleInvitationEmail(request(), config)).status, 410);
      const query = calls.find(call => call.url.includes("/team_invitations?"));
      assert(query.url.includes(`workspace_id=eq.${workspace}`));
      assert.equal(query.headers.Authorization, "Bearer owner-session");
      assert.equal(query.headers.apikey, "public-test");
      assert(!calls.some(call => call.url.includes("resend.com")));
    }, options);
  }
});

test("fallback only emails the stored recipient with a trusted URL and tracks using server credentials", async () => {
  await fixture(async calls => {
    const response = await handleInvitationEmail(request({ id, token, email: "attacker@example.invalid", url: "https://evil.example", workspaceName: "Fake" }), config);
    assert.deepEqual(await response.json(), { delivery: "sent", trackingError: false });
    const sent = calls.find(call => call.url === "https://api.resend.com/emails");
    const body = JSON.parse(sent.body);
    assert.deepEqual(body.to, ["invited@example.invalid"]);
    assert(body.text.includes(`https://orms.example/join/${token}`));
    assert(body.subject.includes("Company & Co"));
    assert(!JSON.stringify(body).includes("evil.example"));
    assert.equal(sent.headers["Idempotency-Key"], `orms-invitation/${id}`);
    const tracked = calls.find(call => call.url.endsWith("/orms_mark_invitation_delivery"));
    assert.equal(tracked.headers.Authorization, "Bearer private-test");
    assert.deepEqual(JSON.parse(tracked.body), { p_id: id, p_status: "sent" });
  });
  await fixture(async calls => {
    assert.deepEqual(await (await handleInvitationEmail(request(), config)).json(), { delivery: "sent", trackingError: false });
    assert(!calls.some(call => call.url.includes("resend.com")));
  }, { row: { delivery_status: "sent" } });
});

test("fallback reports configuration, failures and tracking errors without claiming delivery", async () => {
  await fixture(async calls => {
    assert.deepEqual(await (await handleInvitationEmail(request(undefined, { method: "GET", body: undefined }), config)).json(), { configured: true, enabled: true });
    const paused = await handleInvitationEmail(request(), { ...config, enabled: false });
    assert.equal((await paused.json()).delivery, "not_configured");
    const missing = await handleInvitationEmail(request(), { ...config, apiKey: "" });
    assert.equal((await missing.json()).delivery, "not_configured");
    assert(!calls.some(call => call.url.includes("resend.com")));
    assert.equal((await handleInvitationEmail(request(), { ...config, appUrl: "https://user:pass@evil.example" })).status, 503);
    for (const body of [null, {}, { id, token: "bad" }]) assert.equal((await handleInvitationEmail(request(body), config)).status, 400);
  });
  await fixture(async () => {
    assert.deepEqual(await (await handleInvitationEmail(request(), config)).json(), { delivery: "failed", trackingError: false });
  }, { providerFailure: true });
  await fixture(async () => {
    assert.deepEqual(await (await handleInvitationEmail(request(), config)).json(), { delivery: "sent", trackingError: true });
  }, { trackingFailure: true });
});

test("an uncertain remote response preserves the existing link and never retries creation or delivery", async () => {
  let calls = 0;
  const supabase = { functions: { invoke: async (name, options) => { calls++; assert.equal(name, "workspace-invitation-email"); assert.deepEqual(options.body, { id, token }); throw Error("Connection lost"); } } };
  assert.deepEqual(await sendRemoteInvitationEmail(supabase, { id, token }), { delivery: "failed", trackingError: true });
  assert.equal(calls, 1);
  supabase.functions.invoke = async () => ({ data: { configured: true }, error: null });
  assert.equal(await remoteInvitationEmailConfigured(supabase), true);
  supabase.functions.invoke = async () => ({ data: { configured: true }, error: Error("Bad gateway") });
  assert.equal(await remoteInvitationEmailConfigured(supabase), false);
});
