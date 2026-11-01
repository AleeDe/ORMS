import fs from "node:fs";

if (fs.existsSync(".env.local")) process.loadEnvFile(".env.local");
const token = process.env.SUPABASE_ACCESS_TOKEN;
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
if (!token || !url) throw Error("Configure SUPABASE_ACCESS_TOKEN and NEXT_PUBLIC_SUPABASE_URL locally before running this script.");
const project = new URL(url).hostname.split(".")[0];
const endpoint = `https://api.supabase.com/v1/projects/${project}/config/auth`;
const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
const changes = {
  mailer_subjects_confirmation: "Your ORMS verification code",
  mailer_templates_confirmation_content: fs.readFileSync("supabase/templates/confirmation.html", "utf8"),
  mailer_subjects_recovery: "Reset your ORMS password",
  mailer_templates_recovery_content: fs.readFileSync("supabase/templates/recovery.html", "utf8"),
};
const before = await fetch(endpoint, { headers, signal: AbortSignal.timeout(20_000) });
if (!before.ok) throw Error(`Could not inspect email settings (${before.status}).`);
const current = await before.json();
if (!current.smtp_host || current.mailer_autoconfirm) throw Error("Enable SMTP and require email confirmation before applying these templates.");
if (!process.argv.includes("--apply")) {
  console.log(JSON.stringify({ apply: false, siteURL: current.site_url, updatesNeeded: Object.entries(changes).filter(([key, value]) => current[key] !== value).map(([key]) => key) }));
} else {
  const response = await fetch(endpoint, { method: "PATCH", headers, body: JSON.stringify(changes), signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw Error(`Could not configure authentication emails (${response.status}).`);
  console.log("Configured signup OTP and scanner-safe password reset emails. SMTP credentials and other auth settings were preserved.");
}
