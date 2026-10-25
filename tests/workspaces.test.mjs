import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";

const requireTs = createRequire(import.meta.url);
requireTs.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: filename,
}).outputText, filename);
const { workspaceHref, workspaceIdFromPath, workspacePath, createWorkspaceFetch } = requireTs("../src/lib/workspace.ts");
const { invitationMessage, sendInvitationEmail } = requireTs("../src/lib/invitation-email.ts");
const a = "00000000-0000-4000-8000-000000000001";
const b = "00000000-0000-4000-8000-000000000002";

test("workspace links retain their scope, queries and public authentication routes", () => {
  assert.equal(workspaceHref(a, "/leads/example?campaign=c"), `/w/${a}/leads/example?campaign=c`);
  assert.equal(workspaceHref(a, "/"), `/w/${a}`);
  for (const href of ["/login?next=%2Fjoin%2Ftoken", "/join/token", "/workspaces", "/api/google/connect", `/w/${b}/tasks`, "https://example.com", "//example.com"]) assert.equal(workspaceHref(a, href), href);
  assert.equal(workspaceIdFromPath(`/w/${a}/tasks`), a);
  assert.equal(workspaceIdFromPath(`/w/${a}extra/tasks`), null);
  assert.equal(workspaceIdFromPath("/w/not-a-uuid/tasks"), null);
  assert.equal(workspacePath(`/w/${a}/campaigns/c`), "/campaigns/c");
  assert.equal(workspacePath(`/w/${a}`), "/");
});

test("requests capture workspace scope before delayed work reaches the network", async () => {
  const original = global.fetch;
  const seen = [];
  global.fetch = async (_input, init) => { seen.push(new Headers(init.headers).get("x-orms-workspace")); return new Response("{}"); };
  try {
    const tabA = createWorkspaceFetch(a), tabB = createWorkspaceFetch(b);
    await tabB("https://db.example/rest/v1/tasks");
    await tabA("https://db.example/rest/v1/tasks", { headers: { "x-orms-workspace": b } });
    await tabB(new Request("https://db.example/rest/v1/tasks"));
    assert.deepEqual(seen, [b, a, b]);
  } finally { global.fetch = original; }
});

test("invitation emails escape organization names and include the matching email and review link", () => {
  const message = invitationMessage({ id: "invite", email: "person@example.invalid", workspaceName: '<img src=x onerror="alert(1)">', inviterEmail: "owner@example.invalid", url: "https://orms.example/join/token" });
  assert(!message.html.includes("<img"));
  assert(message.html.includes("&lt;img"));
  assert(message.text.includes("person@example.invalid"));
  assert(message.text.includes("https://orms.example/join/token"));
});

test("Resend delivery reports missing configuration and failures honestly, and uses an idempotency key", async () => {
  const original = global.fetch, apiKey = process.env.RESEND_API_KEY, sender = process.env.RESEND_FROM_EMAIL, enabled = process.env.WORKSPACE_INVITATION_EMAIL_ENABLED;
  const invite = { id: "invitation-id", email: "recipient@example.invalid", workspaceName: "Example", inviterEmail: "owner@example.invalid", url: "https://orms.example/join/token" };
  try {
    delete process.env.RESEND_API_KEY; delete process.env.RESEND_FROM_EMAIL;
    global.fetch = async () => { throw Error("No request should be made without configuration"); };
    assert.equal(await sendInvitationEmail(invite), "not_configured");
    process.env.RESEND_API_KEY = "fake-test-key"; process.env.RESEND_FROM_EMAIL = "ORMS <invitations@example.invalid>"; process.env.WORKSPACE_INVITATION_EMAIL_ENABLED = "true";
    global.fetch = async (url, options) => {
      assert.equal(url, "https://api.resend.com/emails");
      assert.equal(options.headers["Idempotency-Key"], "orms-invitation/invitation-id");
      assert.deepEqual(JSON.parse(options.body).to, [invite.email]);
      return Response.json({ id: "provider-id" });
    };
    assert.equal(await sendInvitationEmail(invite), "sent");
    global.fetch = async () => Response.json({ message: "Provider rejected" }, { status: 403 });
    assert.equal(await sendInvitationEmail(invite), "failed");
    global.fetch = async () => { throw Error("Network unavailable"); };
    assert.equal(await sendInvitationEmail(invite), "failed");
  } finally {
    global.fetch = original;
    if (apiKey === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = apiKey;
    if (sender === undefined) delete process.env.RESEND_FROM_EMAIL; else process.env.RESEND_FROM_EMAIL = sender;
    if (enabled === undefined) delete process.env.WORKSPACE_INVITATION_EMAIL_ENABLED; else process.env.WORKSPACE_INVITATION_EMAIL_ENABLED = enabled;
  }
});
