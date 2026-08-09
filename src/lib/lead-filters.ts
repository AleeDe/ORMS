import { SupabaseClient } from "@supabase/supabase-js";

// Shared lead-filter vocabulary.
//
// The Leads page filters `leads` directly, but Campaign Detail paginates
// `campaign_leads`. Rather than duplicate the embed/anti-join rules in two
// shapes, this module resolves a filter set into a list of matching lead ids
// that either page can constrain its own query with.
//
// The anti-joins are the subtle part: an empty embed (`emf:lead_emails()`)
// combined with `.is('emf', null)` is how PostgREST expresses "has NO related
// row". `!inner` is the opposite. Getting this wrong silently returns every
// lead, which looks like the filter simply did nothing.

export type LeadFilters = {
  search: string;
  emailFilter: string;
  websiteFilter: string;
  phoneFilter: string;
  personFilter: string;
  fieldKey: string;
  fieldValue: string;
};

export const EMPTY_LEAD_FILTERS: LeadFilters = {
  search: "",
  emailFilter: "any",
  websiteFilter: "any",
  phoneFilter: "any",
  personFilter: "any",
  fieldKey: "any",
  fieldValue: "",
};

/** True when anything would actually narrow the result set. */
export function hasActiveLeadFilters(f: LeadFilters): boolean {
  return (
    f.search.trim().length >= 2 ||
    f.emailFilter !== "any" ||
    f.websiteFilter !== "any" ||
    f.phoneFilter !== "any" ||
    f.personFilter !== "any" ||
    (f.fieldKey !== "any" && f.fieldValue.trim() !== "")
  );
}

/**
 * Resolves a filter set to the lead ids that match it, or `null` when no filter
 * is active (meaning "do not constrain"). `null` is deliberately distinct from
 * `[]`, which means "a filter ran and matched nothing".
 *
 * `scopeIds` limits the work to leads already on screen — the campaign page
 * passes its own membership so this never scans the whole warehouse.
 */
export async function resolveLeadFilterIds(
  supabase: SupabaseClient,
  f: LeadFilters,
  scopeIds?: string[]
): Promise<string[] | null> {
  if (!hasActiveLeadFilters(f)) return null;
  if (scopeIds && scopeIds.length === 0) return [];

  // Full-field search (name/phone/email/website/custom fields) is an RPC, not a
  // column filter, so it resolves to ids first and intersects with the rest.
  let searchIds: string[] | null = null;
  if (f.search.trim().length >= 2) {
    const { data, error } = await supabase.rpc("search_leads", {
      p_query: f.search.trim(),
      p_limit: 1000,
    });
    if (error) throw error;
    searchIds = ((data ?? []) as { id: string }[]).map((r) => r.id);
    if (searchIds.length === 0) return [];
  }

  // `lead_filter_facts` is a plain view with no FK metadata, so PostgREST cannot
  // embed it (`PGRST200 ... no matches were found`). Query it on its own and
  // intersect by id instead — the same reason the search RPC is resolved first.
  let factIds: string[] | null = null;
  if (f.phoneFilter === "personal" || f.personFilter === "has") {
    let fq = supabase.from("lead_filter_facts").select("lead_id");
    if (f.phoneFilter === "personal") fq = fq.eq("has_personal_phone", true);
    if (f.personFilter === "has") fq = fq.eq("has_person", true);
    const { data, error } = await fq.limit(5000);
    if (error) throw error;
    factIds = ((data ?? []) as { lead_id: string }[]).map((r) => r.lead_id);
    if (factIds.length === 0) return [];
  }

  const embeds: string[] = [];
  if (["valid", "invalid", "has"].includes(f.emailFilter))
    embeds.push("emf:lead_emails!inner(id)");
  if (f.emailFilter === "none") embeds.push("emf:lead_emails()");
  if (f.phoneFilter === "has") embeds.push("phf:lead_phones!inner(id)");
  if (f.phoneFilter === "none") embeds.push("phf:lead_phones()");

  // A specific role does join decision_makers, which is a real table with an FK.
  if (f.personFilter !== "any" && f.personFilter !== "has")
    embeds.push("dmf:decision_makers!inner(role)");

  let q = supabase.from("leads").select(["id", ...embeds].join(", "));

  if (scopeIds) q = q.in("id", scopeIds);
  if (searchIds) q = q.in("id", searchIds);
  if (factIds) q = q.in("id", factIds);

  if (f.emailFilter === "valid") q = q.eq("emf.is_valid_syntax", true);
  if (f.emailFilter === "invalid") q = q.eq("emf.is_valid_syntax", false);
  if (f.emailFilter === "none") q = q.is("emf" as never, null);
  if (f.websiteFilter === "has") q = q.not("website", "is", null);
  if (f.websiteFilter === "none") q = q.is("website", null);
  if (f.phoneFilter === "none") q = q.is("phf" as never, null);
  // "personal" and "has a person" were already applied via factIds above.
  if (f.personFilter !== "any" && f.personFilter !== "has")
    q = q.eq("dmf.role", f.personFilter);
  if (f.fieldKey !== "any" && f.fieldValue.trim())
    q = q.ilike(`custom_fields->>${f.fieldKey}`, `%${f.fieldValue.trim()}%`);

  const { data, error } = await q.limit(5000);
  if (error) throw error;
  return ((data ?? []) as unknown as { id: string }[]).map((r) => r.id);
}
