import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, TraceRequest, Plan } from "@/lib/api";

export function useApiKey() {
  const [key, setKey] = useState(() => localStorage.getItem("nhid_api_key"));

  useEffect(() => {
    const handleStorage = () => setKey(localStorage.getItem("nhid_api_key"));
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  return key;
}

export function useCreateOrg() {
  return useMutation({
    mutationFn: (data: { orgName: string; plan: Plan; adminKey: string }) =>
      api.createOrg(data.orgName, data.plan, data.adminKey),
    onSuccess: (data) => {
      localStorage.setItem("nhid_api_key", data.api_key);
      localStorage.setItem("nhid_org", JSON.stringify({ org_id: data.org_id, org_name: data.org_name, plan: data.plan }));
      window.dispatchEvent(new Event("storage"));
    },
  });
}

export function useGetMe() {
  const apiKey = useApiKey();
  return useQuery({
    queryKey: ["orgProfile"],
    queryFn: () => api.getMe(apiKey!),
    enabled: !!apiKey,
  });
}

export function useGetUsage() {
  const apiKey = useApiKey();
  return useQuery({
    queryKey: ["usageSummary"],
    queryFn: () => api.getUsage(apiKey!),
    enabled: !!apiKey,
  });
}

export function useGetRecent(limit = 20) {
  const apiKey = useApiKey();
  return useQuery({
    queryKey: ["recentActivity", limit],
    queryFn: () => api.getRecent(apiKey!, limit),
    enabled: !!apiKey,
  });
}

export function useTrace() {
  const apiKey = useApiKey();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: TraceRequest) => api.trace(apiKey!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["recentActivity"] });
      queryClient.invalidateQueries({ queryKey: ["usageSummary"] });
    },
  });
}

export function useProof(sessionId: string) {
  const apiKey = useApiKey();
  return useQuery({
    queryKey: ["proof", sessionId],
    queryFn: () => api.proof(apiKey!, sessionId),
    enabled: !!apiKey && !!sessionId,
    retry: false,
  });
}
