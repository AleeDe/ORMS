import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import { campaignPreviewServer } from "./helpers/campaign-preview-server.mjs";

test("local preview serves owner Team APIs and campaign invitations without live services", async () => {
  const preview = await campaignPreviewServer();
  try {
    const client = createClient(preview.url, "preview-public", { global: { headers: { "x-orms-workspace": preview.fixture.workspace } }, auth: { persistSession: false, autoRefreshToken: false } });
    const checked = async promise => { const result = await promise; if (result.error) throw result.error; return result.data; };
    await checked(client.auth.signInWithPassword({ email: "owner@preview.orms", password: "PreviewOnly!123" }));
    assert.equal(await checked(client.rpc("orms_is_owner")), true);
    const team = await checked(client.rpc("orms_team_data"));
    assert.equal(team.campaigns.length, 2);
    assert(team.members.some(member => member.user_id === preview.fixture.setter));
    const invitation = await checked(client.rpc("orms_create_invitation", { p_email: "new-member@preview.orms", p_grants: [{ campaign_id: preview.fixture.campaign, role: "member" }] }));
    assert.match(invitation.token, /^[a-f0-9]{64}$/);
    assert.equal((await checked(client.rpc("orms_team_data"))).invitations.length, 1);
    await checked(client.auth.signInWithPassword({ email: "setter@preview.orms", password: "PreviewOnly!123" }));
    assert.equal(await checked(client.rpc("orms_is_owner")), false);
    assert.equal((await client.rpc("orms_team_data")).error?.code, "42501");
  } finally { await preview.close(); }
});
