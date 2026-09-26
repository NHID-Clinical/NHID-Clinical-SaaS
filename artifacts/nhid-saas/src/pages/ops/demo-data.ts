/**
 * Synthetic demonstration interactions.
 *
 * SYNTHETIC. Not customer data, not observed traffic, not a pilot. This product
 * has zero deployments. These records exist so the monitoring screens can be
 * exercised end to end, and every one is flagged `is_synthetic` on ingestion so
 * the UI and the report say plainly what they are.
 *
 * The set is chosen to cover the cases a reviewer must be able to work, including
 * the three that are easy to get wrong: an escalation that was refused, an
 * escalation whose outcome nobody recorded, and an interaction whose
 * transcription quality is unattested.
 *
 * The records themselves live in `demo-interactions.json` rather than in this
 * file. They are read from there by two consumers that must not disagree: this
 * module, and `nhid-clinical/scripts/build_demo_fixture.py`, which replays them
 * through the real evaluator to produce the recorded output the demo mode
 * renders. Keeping one copy is what stops the fixture drifting from the set it
 * was generated from.
 */

import interactions from "./demo-interactions.json";

export interface DemoTurn {
  speaker: string;
  text: string;
  offset_ms: number | null;
}

export interface DemoInteraction {
  external_id: string;
  occurred_at: string;
  ai_assessment: string;
  language?: string;
  interpreter_present?: boolean;
  transcription_attestation: {
    status: string;
    wer: number | null;
    source: string | null;
  } | null;
  turns: DemoTurn[];
}

export const DEMO_INTERACTIONS = interactions as DemoInteraction[];
