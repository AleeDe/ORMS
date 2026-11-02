import fs from "node:fs";
import { spawn } from "node:child_process";
import { campaignPreviewServer } from "../tests/helpers/campaign-preview-server.mjs";

if (process.env.NODE_ENV === "production") throw Error("This preview is local only.");
const preview = await campaignPreviewServer();
const port = process.argv.find(value => value.startsWith("--port="))?.split("=")[1] ?? "3002";
if (!/^\d+$/.test(port) || Number(port) < 1024 || Number(port) > 65535) throw Error("Choose a valid local preview port.");
const app = `http://localhost:${port}`;
const folder = "node_modules/.cache/orms-campaign-workflow-preview";
fs.mkdirSync(folder, { recursive: true });
fs.writeFileSync(`${folder}/state.json`, JSON.stringify({ ...preview.fixture, app, api: preview.url }));
const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", port], {
  stdio: "inherit", windowsHide: true,
  env: { ...process.env, ORMS_WORKFLOW_PREVIEW: "1", NEXT_PUBLIC_SUPABASE_URL: preview.url, NEXT_PUBLIC_SUPABASE_ANON_KEY: "preview-public", NEXT_PUBLIC_APP_URL: app, WORKSPACE_INVITATION_APP_URL: app,
    SUPABASE_SERVICE_ROLE_KEY: "preview-service", SUPABASE_ACCESS_TOKEN: "preview-disabled", RESEND_API_KEY: "", RESEND_FROM_EMAIL: "", WORKSPACE_INVITATION_EMAIL_ENABLED: "false", GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "" },
});
console.log(`\nLocal campaign preview: ${app}/login?next=${encodeURIComponent(`/w/${preview.fixture.workspace}/campaigns/${preview.fixture.campaign}`)}`);
console.log("Accounts: owner@preview.orms, setter@preview.orms, closer@preview.orms, manager@preview.orms, viewer@preview.orms");
console.log("Password: PreviewOnly!123\nAll data is synthetic and resets when stopped. No live service credentials are used.\n");
let stopping = false;
async function stop() { if (stopping) return; stopping = true; child.kill(); await preview.close(); process.exit(0); }
process.on("SIGINT", stop); process.on("SIGTERM", stop);
child.on("exit", () => { if (!stopping) stop(); });
