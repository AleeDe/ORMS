import { z } from "zod";

export const invitationRequest = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address.").max(254),
  grants: z.array(z.object({
    campaign_id: z.string().uuid("Choose a valid campaign."),
    role: z.enum(["member", "manager", "viewer"]),
  })).min(1, "Choose at least one campaign.").max(100)
    .refine(grants => new Set(grants.map(grant => grant.campaign_id)).size === grants.length, "Choose each campaign once."),
});

export function invitationOrigin(appUrl = process.env.WORKSPACE_INVITATION_APP_URL || process.env.NEXT_PUBLIC_APP_URL) {
  const value = appUrl?.trim() || (process.env.NODE_ENV !== "production" ? "http://localhost:3000" : "");
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw Error();
    return url.origin;
  } catch {
    throw Error("Invitation links are not configured correctly. Check the application's public URL.");
  }
}
