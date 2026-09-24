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
 */

const attested = { status: "measured", wer: 0.11, source: "internal evaluation" };

export const DEMO_INTERACTIONS = [
  {
    external_id: "DEMO-0001",
    occurred_at: "2026-09-02T14:02:00Z",
    ai_assessment: "non_human",
    language: "en-US",
    interpreter_present: false,
    transcription_attestation: attested,
    turns: [
      { speaker: "agent", text: "Good morning, I am an automated system calling on behalf of Northside Clinic about a prior authorization.", offset_ms: 0 },
      { speaker: "human", text: "Okay, what do you need?", offset_ms: 6000 },
      { speaker: "agent", text: "Can you confirm the member ID on the referral?", offset_ms: 9000 },
      { speaker: "human", text: "Yes, one moment.", offset_ms: 13000 },
    ],
  },
  {
    external_id: "DEMO-0002",
    occurred_at: "2026-09-02T15:20:00Z",
    ai_assessment: "non_human",
    language: "en-US",
    transcription_attestation: attested,
    turns: [
      { speaker: "agent", text: "Hi, I'm calling to check on a prior authorization for a patient.", offset_ms: 0 },
      { speaker: "human", text: "Sure, who is this?", offset_ms: 4000 },
      { speaker: "agent", text: "Thanks, I'll wait while you pull that up.", offset_ms: 7000 },
    ],
  },
  {
    external_id: "DEMO-0003",
    occurred_at: "2026-09-03T09:41:00Z",
    ai_assessment: "non_human",
    language: "en-US",
    transcription_attestation: attested,
    turns: [
      { speaker: "agent", text: "Good morning, calling about an authorization request.", offset_ms: 0 },
      { speaker: "human", text: "Who am I speaking with?", offset_ms: 5000 },
      { speaker: "agent", text: "I should mention I am an AI assistant working for the clinic.", offset_ms: 14000 },
      { speaker: "human", text: "Right, go ahead.", offset_ms: 18000 },
    ],
  },
  {
    external_id: "DEMO-0004",
    occurred_at: "2026-09-03T11:05:00Z",
    ai_assessment: "non_human",
    language: "es-US",
    interpreter_present: true,
    transcription_attestation: { status: "attested", wer: 0.23, source: "vendor reported" },
    turns: [
      { speaker: "agent", text: "Hello, can you give me the member ID and date of birth for this claim?", offset_ms: 0 },
      { speaker: "human", text: "Before that, who is calling?", offset_ms: 6000 },
      { speaker: "agent", text: "I am an automated assistant for the provider.", offset_ms: 11000 },
    ],
  },
  {
    external_id: "DEMO-0005",
    occurred_at: "2026-09-04T13:12:00Z",
    ai_assessment: "non_human",
    language: "en-US",
    transcription_attestation: attested,
    turns: [
      { speaker: "agent", text: "I am an AI assistant calling about claim status.", offset_ms: 0 },
      { speaker: "human", text: "I'd rather speak to a human about this one.", offset_ms: 8000 },
      { speaker: "agent", text: "Of course, transferring you to a representative now.", offset_ms: 11000 },
    ],
  },
  {
    external_id: "DEMO-0006",
    occurred_at: "2026-09-04T16:48:00Z",
    ai_assessment: "non_human",
    language: "en-US",
    transcription_attestation: attested,
    turns: [
      { speaker: "agent", text: "I am an automated system calling regarding a denial.", offset_ms: 0 },
      { speaker: "human", text: "Can you transfer me to a real person please?", offset_ms: 9000 },
      { speaker: "agent", text: "I can help you with that instead. What is the claim number?", offset_ms: 12000 },
      { speaker: "human", text: "I asked for a person.", offset_ms: 17000 },
    ],
  },
  {
    external_id: "DEMO-0007",
    occurred_at: "2026-09-05T10:30:00Z",
    ai_assessment: "non_human",
    language: "en-US",
    transcription_attestation: attested,
    turns: [
      { speaker: "agent", text: "I am an AI assistant for the clinic, calling about eligibility.", offset_ms: 0 },
      { speaker: "human", text: "Please get me a supervisor.", offset_ms: 7000 },
    ],
  },
  {
    external_id: "DEMO-0008",
    occurred_at: "2026-09-05T14:15:00Z",
    ai_assessment: "non_human",
    language: "en-US",
    transcription_attestation: null,
    turns: [
      { speaker: "agent", text: "I am an automated system calling about eligibility for a member.", offset_ms: 0 },
      { speaker: "human", text: "Go ahead.", offset_ms: 5000 },
      { speaker: "agent", text: "Thank you, that is all I needed.", offset_ms: 9000 },
    ],
  },
  {
    external_id: "DEMO-0009",
    occurred_at: "2026-09-06T08:55:00Z",
    ai_assessment: "unknown",
    transcription_attestation: attested,
    turns: [
      { speaker: "agent", text: "Morning, following up on a referral.", offset_ms: 0 },
      { speaker: "human", text: "Which patient?", offset_ms: 4000 },
    ],
  },
  {
    external_id: "DEMO-0010",
    occurred_at: "2026-09-06T12:02:00Z",
    ai_assessment: "non_human",
    language: "en-US",
    transcription_attestation: attested,
    turns: [
      { speaker: "agent", text: "I am an automated assistant calling on behalf of Riverside Group.", offset_ms: 0 },
      { speaker: "human", text: "Understood, go ahead.", offset_ms: 5000 },
      { speaker: "agent", text: "I need the claim number and date of birth to proceed.", offset_ms: 8000 },
    ],
  },
];
