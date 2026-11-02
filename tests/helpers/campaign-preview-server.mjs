import { createServer } from "node:http";
import { campaignDatabase, seedCampaign, actor } from "./campaign-database.mjs";

// Development-only Supabase-shaped HTTP adapter over the embedded test DB.
// It binds to loopback, contains synthetic users, and never reads .env files.
export async function campaignPreviewServer() {
  if (process.env.NODE_ENV === "production") throw Error("The campaign preview cannot run in production.");
  const db = await campaignDatabase(), fixture = await seedCampaign(db);
  await db.exec("alter table public.campaigns add column description text,add column default_channel text; alter table public.leads add column website text,add column custom_fields jsonb default '{}',add column address text,add column city text,add column country text,add column dataset_id uuid;");
  const accounts = new Map();
  for (const role of ["owner", "setter", "closer", "secondCloser", "manager", "viewer"]) {
    const id = fixture[role], email = `${role.toLowerCase()}@preview.orms`, label = `Preview ${role}`;
    await db.query("update auth.users set email=$2,raw_user_meta_data=$3 where id=$1", [id, email, { full_name: label }]);
    accounts.set(email, { id, email, role: "authenticated", aud: "authenticated", app_metadata: { provider: "email", providers: ["email"] }, user_metadata: { full_name: label }, email_confirmed_at: new Date().toISOString(), created_at: new Date().toISOString(), identities: [{ id, identity_id: id, user_id: id, provider: "email" }] });
  }
  const byId = new Map([...accounts.values()].map(user => [user.id, user]));
  const token = user => [Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"), Buffer.from(JSON.stringify({ sub: user.id, role: "authenticated", aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600, iat: Math.floor(Date.now() / 1000), email: user.email })).toString("base64url"), "local-preview-only"].join(".");
  const session = user => ({ access_token: token(user), refresh_token: `preview-refresh:${user.id}`, token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user });
  const identify = request => { try { const bearer = request.headers.authorization?.replace(/^Bearer /i, "") ?? ""; return byId.get(JSON.parse(Buffer.from(bearer.split(".")[1], "base64url").toString()).sub); } catch { return undefined; } };
  const tables = new Set(["workspaces", "workspace_members", "campaign_access", "campaigns", "leads", "campaign_leads", "activities", "tasks", "decision_makers", "campaign_work_events"]);
  const identifier = value => { if (!/^[a-z_][a-z_0-9]*$/.test(value)) throw Error("Invalid preview identifier"); return `"${value}"`; };
  async function embed(tx, table, rows, select) {
    for (const row of rows) {
      if (table === "leads") {
        row.lead_emails = []; row.lead_phones = []; row.decision_makers = []; row.datasets = null;
        if (select.includes("campaign_leads")) { row.campaign_leads = (await tx.query("select * from public.campaign_leads where lead_id=$1", [row.id])).rows; await embed(tx, "campaign_leads", row.campaign_leads, "campaigns"); }
      }
      if (table === "campaigns" && select.includes("campaign_leads")) row.campaign_leads = (await tx.query("select * from public.campaign_leads where campaign_id=$1", [row.id])).rows;
      if (row.lead_id && select.includes("leads")) row.leads = (await tx.query("select * from public.leads where id=$1", [row.lead_id])).rows[0] ?? null;
      if (row.campaign_id && select.includes("campaigns")) row.campaigns = (await tx.query("select * from public.campaigns where id=$1", [row.campaign_id])).rows[0] ?? null;
      if (table === "activities" && select.includes("decision_makers")) row.decision_makers = null;
    }
    return rows;
  }
  const server = createServer(async (request, response) => {
    const origin = request.headers.origin;
    if (origin && !["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname)) { response.writeHead(403); response.end(); return; }
    const headers = { "Content-Type": "application/json", "Cache-Control": "no-store", "Access-Control-Allow-Origin": origin ?? "http://localhost:3002", "Access-Control-Allow-Headers": request.headers["access-control-request-headers"] ?? "authorization,apikey,content-type,accept-profile,content-profile,x-client-info,x-orms-workspace,prefer,range,range-unit,x-supabase-api-version", "Access-Control-Allow-Methods": "GET,HEAD,POST,PATCH,DELETE,OPTIONS", "Access-Control-Expose-Headers": "content-range" };
    const send = (data, status = 200, extra = {}) => { response.writeHead(status, { ...headers, ...extra }); response.end(request.method === "HEAD" || status === 204 ? undefined : JSON.stringify(data)); };
    if (request.method === "OPTIONS") { send(null, 204); return; }
    try {
      const url = new URL(request.url, "http://localhost"); let raw = ""; for await (const chunk of request) { raw += chunk; if (raw.length > 100_000) throw Error("Preview request too large"); }
      const body = raw ? JSON.parse(raw) : {}, user = identify(request);
      if (url.pathname === "/auth/v1/token") {
        const account = url.searchParams.get("grant_type") === "refresh_token" ? byId.get(body.refresh_token?.replace("preview-refresh:", "")) : accounts.get(body.email?.toLowerCase());
        if (!account || (url.searchParams.get("grant_type") !== "refresh_token" && body.password !== "PreviewOnly!123")) { send({ code: "invalid_credentials", message: "Use a preview account and PreviewOnly!123." }, 400); return; }
        send(session(account)); return;
      }
      if (url.pathname === "/auth/v1/user") { send(user ?? { code: "bad_jwt", message: "Preview login required" }, user ? 200 : 401); return; }
      if (url.pathname === "/auth/v1/logout") { send(null, 204); return; }
      if (!url.pathname.startsWith("/rest/v1/")) { send({ message: "This preview covers campaign workflows only." }, 404); return; }
      if (!user) { send({ code: "42501", message: "Preview login required" }, 401); return; }
      const workspace = request.headers["x-orms-workspace"] ?? fixture.workspace;
      const route = url.pathname.slice("/rest/v1/".length);
      const result = await actor(db, user.id, workspace, async tx => {
        if (route.startsWith("rpc/")) {
          const name = route.slice(4);
          if (name === "search_leads") return { data: (await tx.query("select id from public.leads where business_name ilike $1 limit 50", [`%${body.p_query ?? ""}%`])).rows };
          if (!["orms_workspaces", "orms_campaign_team", "orms_campaign_work_role", "orms_set_campaign_work_role", "orms_campaign_lead_action", "orms_campaign_performance", "orms_roster", "orms_campaign_workers", "orms_is_owner", "orms_team_data", "orms_create_invitation"].includes(name)) return { data: { message: "This operation is outside the local campaign preview." }, status: 404 };
          const entries = Object.entries(body), args = entries.map(([key], i) => `${identifier(key)} => $${i + 1}`).join(",");
          if (["orms_campaign_team", "orms_roster", "orms_campaign_workers"].includes(name)) return { data: (await tx.query(`select * from public.${identifier(name)}(${args})`, entries.map(([, value]) => value))).rows };
          const { rows } = await tx.query(`select public.${identifier(name)}(${args}) as result`, entries.map(([, value]) => value)); return { data: rows[0].result };
        }
        if (route === "settings") return { data: [{ default_followup_days: 3, outreach_start_time: "09:00", outreach_end_time: "17:00" }] };
        if (!tables.has(route)) return { data: [] };
        const values = [], clauses = [];
        const parameter = value => { values.push(value); return `$${values.length}`; };
        function filter(key, expression) {
          if (expression.startsWith("in.(")) { const options = expression.slice(4, -1).split(",").map(item => item.replace(/^"|"$/g, "")); return `${identifier(key)}::text=any(${parameter(options)}::text[])`; }
          if (expression === "is.null") return `${identifier(key)} is null`;
          if (expression === "not.is.null") return `${identifier(key)} is not null`;
          const at = expression.indexOf("."), operator = { eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=" }[expression.slice(0, at)];
          if (!operator) throw Error("Unsupported preview filter"); return `${identifier(key)} ${operator} ${parameter(expression.slice(at + 1))}`;
        }
        for (const [key, value] of url.searchParams) {
          if (["select", "order", "limit", "offset", "on_conflict"].includes(key)) continue;
          if (key === "or") { clauses.push("(" + value.replace(/^\(|\)$/g, "").split(",").map(term => { const at = term.indexOf("."); return filter(term.slice(0, at), term.slice(at + 1)); }).join(" or ") + ")"); }
          else clauses.push(filter(key, value));
        }
        const where = clauses.length ? ` where ${clauses.join(" and ")}` : "";
        if (request.method === "PATCH") {
          const setters = Object.entries(body).map(([key, value]) => `${identifier(key)}=${parameter(value)}`).join(",");
          return { data: (await tx.query(`update public.${identifier(route)} set ${setters}${where} returning *`, values)).rows };
        }
        if (request.method === "DELETE") return { data: (await tx.query(`delete from public.${identifier(route)}${where} returning *`, values)).rows };
        if (request.method === "POST") {
          const rows = [];
          for (const item of Array.isArray(body) ? body : [body]) { const entries = Object.entries(item); const inserted = await tx.query(`insert into public.${identifier(route)}(${entries.map(([key]) => identifier(key)).join(",")}) values(${entries.map((_, i) => `$${i + 1}`).join(",")}) returning *`, entries.map(([, value]) => value)); rows.push(...inserted.rows); }
          return { data: rows };
        }
        const count = (await tx.query(`select count(*)::integer as total from public.${identifier(route)}${where}`, values)).rows[0].total;
        const order = (url.searchParams.get("order") ?? "").split(",").filter(Boolean).map(item => { const [column, direction] = item.split("."); return `${identifier(column)} ${direction === "desc" ? "desc" : "asc"}`; }).join(",");
        const from = Number(url.searchParams.get("offset") ?? 0), limit = Math.min(Number(url.searchParams.get("limit") ?? 1000), 1000);
        const rows = request.method === "HEAD" ? [] : (await tx.query(`select * from public.${identifier(route)}${where}${order ? ` order by ${order}` : ""} limit ${limit} offset ${from}`, values)).rows;
        await embed(tx, route, rows, url.searchParams.get("select") ?? "");
        return { data: rows, count };
      });
      let data = result.data;
      if (Array.isArray(data) && request.headers.accept?.includes("vnd.pgrst.object")) {
        if (data.length !== 1) { send({ code: "PGRST116", message: "Preview row not found" }, 406); return; } data = data[0];
      }
      send(data, result.status ?? 200, result.count !== undefined ? { "Content-Range": `0-${Math.max(0, Array.isArray(result.data) ? result.data.length - 1 : 0)}/${result.count}` } : {});
    } catch (error) { send({ code: error.code ?? "preview_error", message: error.message }, ["42501", "40001"].includes(error.code) ? 403 : 400); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return { db, fixture, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => server.close(() => db.close().then(resolve))) };
}
