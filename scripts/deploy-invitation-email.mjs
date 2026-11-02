import fs from "node:fs";

if (fs.existsSync(".env.local")) process.loadEnvFile(".env.local");
const required = ["SUPABASE_ACCESS_TOKEN", "NEXT_PUBLIC_SUPABASE_URL", "RESEND_API_KEY", "RESEND_FROM_EMAIL", "WORKSPACE_INVITATION_APP_URL"];
for (const name of required) if (!process.env[name]?.trim()) throw Error(`Configure ${name} locally before deploying invitation emails.`);
const origin = new URL(process.env.WORKSPACE_INVITATION_APP_URL);
if (origin.protocol !== "https:" || origin.username || origin.password) throw Error("Set a public HTTPS invitation URL.");
const project = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
const base = `https://api.supabase.com/v1/projects/${project}`;
const headers = { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}` };
const slug = "workspace-invitation-email";
const files = ["workspace-invitation-email/index.ts", "_shared/invitation-handler.ts", "_shared/invitation-email.ts"];
const form = new FormData();
form.set("metadata", JSON.stringify({ name: slug, entrypoint_path: `${slug}/index.ts`, verify_jwt: true }));
for (const file of files) form.append("file", new Blob([fs.readFileSync(`supabase/functions/${file}`)], { type: "application/typescript" }), file);
const apply = process.argv.includes("--apply");
// Bundling first catches missing imports without changing the deployed function
// or server secrets. Never print request bodies, credentials or secret values.
const bundled = await fetch(`${base}/functions/deploy?slug=${slug}&bundleOnly=1`, { method: "POST", headers, body: form, signal: AbortSignal.timeout(120_000) });
if (!bundled.ok) throw Error(`Could not bundle invitation function (${bundled.status}): ${(await bundled.text()).slice(0, 1000)}`);
await bundled.arrayBuffer();
if (!apply) {
  console.log(JSON.stringify({ apply: false, bundle: "passed", function: slug, appURL: origin.origin }));
} else {
  const secrets = ["RESEND_API_KEY", "RESEND_FROM_EMAIL", "WORKSPACE_INVITATION_APP_URL", "WORKSPACE_INVITATION_EMAIL_ENABLED"].map(name => ({ name, value: name === "WORKSPACE_INVITATION_APP_URL" ? origin.origin : process.env[name]?.trim() ?? "true" }));
  const configured = await fetch(`${base}/secrets`, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify(secrets), signal: AbortSignal.timeout(20_000) });
  if (!configured.ok) throw Error(`Could not configure invitation secrets (${configured.status}).`);
  const deployed = await fetch(`${base}/functions/deploy?slug=${slug}`, { method: "POST", headers, body: form, signal: AbortSignal.timeout(120_000) });
  if (!deployed.ok) throw Error(`Could not deploy invitation function (${deployed.status}).`);
  const result = await deployed.json();
  console.log(JSON.stringify({ function: result.slug, status: result.status, version: result.version, verifyJWT: result.verify_jwt }));
}
