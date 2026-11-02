"use client";
import { useQuery } from "@tanstack/react-query";
import { useWorkspaceClient } from "@/components/workspace-provider";
import { fetchCampaignTeam } from "@/lib/campaign-workflow";

export function useCampaignTeam(campaignId: string | null) {
  const supabase = useWorkspaceClient();
  return useQuery({ queryKey: ["campaign-team", campaignId], enabled: !!campaignId, refetchInterval: 30_000,
    queryFn: () => fetchCampaignTeam(supabase, campaignId!) });
}
