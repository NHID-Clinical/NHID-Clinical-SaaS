/**
 * First-time setup progress, shared by the /setup stepper and the dashboard
 * checklist so the two never disagree.
 *
 * Two of the four steps are known to the backend and are read live: whether
 * more than one person has access, and whether any assessment exists. The
 * other two are facts about this browser and are stored here only: which
 * source format the organization chose, and whether someone confirmed the API
 * key is stored. Nothing in this file writes to the server.
 */
import { useCallback, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { useApiKey, useGetMe } from "./use-nhid";
import { useSession } from "./use-session";
import { authApi } from "@/lib/auth-api";
import { monitorApi } from "@/lib/monitoring-api";
import { API_CONNECTED } from "@/lib/config";

export type Vendor = "generic" | "twilio" | "vapi";

/** Read by the Assessments page as the initial value of its vendor select. */
export const VENDOR_KEY = "nhid_setup_vendor";
const SETUP_EVENT = "nhid-setup";

export const VENDORS: { id: Vendor; label: string; blurb: string; fields: string[] }[] = [
  {
    id: "generic",
    label: "Generic transcript export",
    blurb: "Any transcript you already have, in one plain shape.",
    fields: ["external_id", "occurred_at", "ai_assessment", "turns[].speaker / text / offset_ms"],
  },
  {
    id: "twilio",
    label: "Twilio",
    blurb: "Call records exported from Twilio Voice.",
    fields: ["CallSid", "StartTime", "turns[] or transcript segments"],
  },
  {
    id: "vapi",
    label: "VAPI",
    blurb: "End-of-call reports from a VAPI assistant.",
    fields: ["call.id", "call.createdAt", "messages[].role / message / secondsFromStart"],
  },
];

export type StepId = "team" | "source" | "interactions" | "pipeline";

export interface SetupStep {
  id: StepId;
  /** 1-based position, also the `?step=` value. */
  n: number;
  label: string;
  done: boolean;
}

export const STEP_LABELS: Record<StepId, string> = {
  team: "Invite your team",
  source: "Choose your source format",
  interactions: "Your first interactions",
  pipeline: "Connect your pipeline",
};

export const STEP_ORDER: StepId[] = ["team", "source", "interactions", "pipeline"];

function read(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value);
  } catch { /* private mode or blocked storage: the step simply stays undone */ }
  window.dispatchEvent(new Event(SETUP_EVENT));
}

export function readVendor(): Vendor | null {
  const v = read(VENDOR_KEY);
  return v === "generic" || v === "twilio" || v === "vapi" ? v : null;
}

const ackKey = (orgId: string) => `nhid_setup_ack:${orgId}`;
const teamKey = (orgId: string) => `nhid_setup_team:${orgId}`;
const dismissKey = (orgId: string) => `nhid_setup_dismissed:${orgId}`;

export function useSetupProgress() {
  const apiKey = useApiKey();
  const me = useGetMe();
  const session = useSession();
  const orgId = me.data?.org_id ?? null;

  // Re-read localStorage when this tab or another one changes it.
  const [, bump] = useState(0);
  useEffect(() => {
    const tick = () => bump((n) => n + 1);
    window.addEventListener("storage", tick);
    window.addEventListener(SETUP_EVENT, tick);
    return () => {
      window.removeEventListener("storage", tick);
      window.removeEventListener(SETUP_EVENT, tick);
    };
  }, []);

  // Same query keys as Settings and Assessments, so their invalidations reach here.
  const members = useQuery({
    queryKey: ["org-members", apiKey],
    queryFn: () => authApi.listMembers(apiKey!),
    enabled: API_CONNECTED && !!apiKey && !!session.data,
    retry: false,
  });
  const assessments = useQuery({
    queryKey: ["ops-assessments"],
    queryFn: () => monitorApi.listAssessments(apiKey!),
    enabled: API_CONNECTED && !!apiKey,
  });

  const memberCount = members.data?.members.length ?? 0;
  const teamDone = memberCount > 1 || (!!orgId && read(teamKey(orgId)) === "1");
  const vendor = readVendor();
  const assessmentCount = assessments.data?.assessments.length ?? 0;
  const acknowledged = !!orgId && read(ackKey(orgId)) === "1";
  const dismissed = !!orgId && read(dismissKey(orgId)) === "1";

  const doneById: Record<StepId, boolean> = {
    team: teamDone,
    source: vendor !== null,
    interactions: assessmentCount > 0,
    pipeline: acknowledged,
  };
  const steps: SetupStep[] = STEP_ORDER.map((id, i) => ({ id, n: i + 1, label: STEP_LABELS[id], done: doneById[id] }));
  const doneCount = steps.filter((s) => s.done).length;

  const setVendor = useCallback((v: Vendor) => write(VENDOR_KEY, v), []);
  const acknowledge = useCallback(() => { if (orgId) write(ackKey(orgId), "1"); }, [orgId]);
  const markTeam = useCallback(() => { if (orgId) write(teamKey(orgId), "1"); }, [orgId]);
  const dismiss = useCallback(() => { if (orgId) write(dismissKey(orgId), "1"); }, [orgId]);

  return {
    orgId,
    orgName: me.data?.org_name ?? null,
    steps,
    doneCount,
    allDone: doneCount === steps.length,
    dismissed,
    dismiss,
    // Nothing is known yet: the dashboard card waits rather than flashing.
    loading: me.isLoading || (assessments.isLoading && assessments.fetchStatus !== "idle"),
    vendor,
    setVendor,
    acknowledged,
    acknowledge,
    markTeam,
    members,
    memberCount,
    assessments,
    assessmentCount,
    session,
  };
}
