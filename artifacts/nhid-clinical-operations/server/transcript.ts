/**
 * Transcript tokenizer.
 *
 * The policy controls are about *when* something was said and *who* said it —
 * "was automation disclosed before PHI was requested", "was an escalation
 * request honored afterwards". Answering that needs turns, not a character
 * offset into a blob, so every detector works against this structure.
 */

export type Speaker = "agent" | "caller" | "unknown";

export type Turn = {
  /** 0-based position in the conversation. */
  index: number;
  speaker: Speaker;
  /** Speaker label exactly as it appeared, when there was one. */
  label: string | null;
  text: string;
  /** Lowercased `text`, precomputed because every detector needs it. */
  lower: string;
};

export type ParsedTranscript = {
  turns: Turn[];
  /** True when at least one turn carried an explicit `Speaker:` label. */
  hasSpeakerLabels: boolean;
};

const AGENT_LABELS =
  /^(agent|assistant|ai|bot|system|ivr|virtual assistant|receptionist|operator|clinic|representative|rep)$/i;
const CALLER_LABELS = /^(caller|customer|patient|user|human|client|member)$/i;

const LABELLED_LINE = /^\s*([A-Za-z][A-Za-z0-9 ._-]{0,30}?)\s*:\s*(.+)$/;

function classify(label: string | null): Speaker {
  if (!label) return "unknown";
  const trimmed = label.trim();
  if (AGENT_LABELS.test(trimmed)) return "agent";
  if (CALLER_LABELS.test(trimmed)) return "caller";
  return "unknown";
}

/**
 * Splits a transcript into turns.
 *
 * Handles the two shapes that actually turn up: line-per-turn with optional
 * `Speaker:` labels, and a single unlabelled paragraph (which is split into
 * sentences so ordering questions can still be answered, just without
 * attribution).
 */
export function parseTranscript(transcript: string): ParsedTranscript {
  const lines = transcript
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  const source =
    lines.length > 1
      ? lines
      : (lines[0] ?? "")
          .split(/(?<=[.!?])\s+/)
          .map(part => part.trim())
          .filter(Boolean);

  const turns: Turn[] = [];
  let hasSpeakerLabels = false;
  let lastSpeaker: Speaker = "unknown";

  source.forEach(raw => {
    const match = LABELLED_LINE.exec(raw);
    let label: string | null = null;
    let text = raw;

    // Only treat "Foo: bar" as a speaker label when Foo looks like a name
    // rather than the start of a sentence ("Note: we will call back").
    if (match && match[1].split(/\s+/).length <= 3) {
      label = match[1];
      text = match[2];
      hasSpeakerLabels = true;
    }

    let speaker = classify(label);

    // Unlabelled turns in an otherwise labelled transcript continue the
    // previous speaker; a fully unlabelled transcript alternates from the
    // agent, which is the near-universal convention for these recordings.
    if (speaker === "unknown") {
      speaker = label
        ? "unknown"
        : hasSpeakerLabels
          ? lastSpeaker
          : turns.length % 2 === 0
            ? "agent"
            : "caller";
    }

    lastSpeaker = speaker;
    turns.push({
      index: turns.length,
      speaker,
      label,
      text,
      lower: text.toLowerCase(),
    });
  });

  return { turns, hasSpeakerLabels };
}

const NEGATION =
  /\b(?:never|not|non|no need|don't|do not|won't|will not|would not|wouldn't|cannot|can't|shall not|isn't|aren't|without|rather than|instead of)\b/;

/**
 * True when a negation cue appears shortly before `at` in the same turn.
 *
 * This is what stops "we will never ask for your date of birth" being scored
 * as a PHI request. The window is deliberately short — negation scope in
 * speech is local, and a wider window produces false clears.
 */
export function isNegated(lower: string, at: number, window = 60): boolean {
  if (at <= 0) return false;
  const start = Math.max(0, at - window);
  const before = lower.slice(start, at);
  // Don't let a negation leak across a clause boundary.
  const clause =
    before.split(/[.!?;]|\b(?:but|however|although)\b/).pop() ?? "";
  return NEGATION.test(clause);
}

/** First non-negated match of `pattern` in `turns`, or null. */
export function findTurn(
  turns: Turn[],
  pattern: RegExp,
  options: { speaker?: Speaker; allowNegated?: boolean } = {}
): { turn: Turn; match: RegExpExecArray } | null {
  for (const turn of turns) {
    if (options.speaker && turn.speaker !== options.speaker) continue;
    const rx = new RegExp(pattern.source, pattern.flags.replace("g", "") + "g");
    let match: RegExpExecArray | null;
    while ((match = rx.exec(turn.lower)) !== null) {
      if (options.allowNegated || !isNegated(turn.lower, match.index)) {
        return { turn, match };
      }
    }
  }
  return null;
}

/** Short verbatim excerpt around a match, for the evidence trail. */
export function quote(turn: Turn, match: RegExpExecArray, pad = 45): string {
  const start = Math.max(0, match.index - pad);
  const end = Math.min(turn.text.length, match.index + match[0].length + pad);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < turn.text.length ? "…" : "";
  return `${prefix}${turn.text.slice(start, end).trim()}${suffix}`;
}
