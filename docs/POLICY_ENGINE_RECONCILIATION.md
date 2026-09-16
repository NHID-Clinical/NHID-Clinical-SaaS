# Policy implementations: comparison and reconciliation

Two implementations in this repository encode judgements about the five
NHID-Clinical controls. This records what each actually does, how they differ,
and what reconciliation requires. **Neither has been changed or deleted.**

## Correcting an earlier characterisation

`docs/trustlayer-module-architecture.md` previously described
`policyEngine.ts` as "a *second* implementation of controls the open framework
also defines, which is exactly the drift risk". That framing was too strong and
is corrected here.

They are **not competing implementations of the same function.** They answer
different questions, at different times, for different consumers. The real risk
is narrower — and still real — as set out under *Where they could actually
diverge*.

## What each one is

### Python — `nhid-clinical/saas_layer/voice_policy.py` (451 LOC)

**A runtime enforcement gate.**

- **Input:** live session state plus a transcript chunk, mid-call
- **Output:** an enforcement *decision* — the call path acts on it
- **Evaluation:** ordered ruleset, first matching rule returns
- **Position:** in the call path, invoked from the gateway's voice webhooks
- **Purpose:** stop protected data moving before disclosure
- **Audit:** `build_audit_record()` emits a deterministic ATR-01 record
- **Consumers:** customer-facing

### TypeScript — `artifacts/nhid-clinical-operations/server/policyEngine.ts` (519 LOC)

**A retrospective, explainable scorecard.**

- **Input:** a fully parsed transcript, after the call
- **Output:** an `EvaluationReport` — per-control `status`, an A/B/C/F `grade`,
  a human-readable `finding`, and `evidence[]` with quoted turns
- **Evaluation:** every control graded independently; none short-circuits
- **Position:** not in any call path. Verified confined to
  `nhid-clinical-operations`; imported only by its own `routers.ts` and tests
- **Purpose:** triage aid for operators reviewing sampled Shadow Pilot calls
- **Consumers:** internal staff only

## Side by side

| | Python `voice_policy.py` | TypeScript `policyEngine.ts` |
|---|---|---|
| When | During the call | After the call |
| Answers | "Allow this turn?" | "How did this call go, and why?" |
| Output | Enforcement decision | Graded report with quoted evidence |
| Granularity | First matching rule wins | All five controls graded |
| Explains itself | Audit record | Findings plus evidence quotes |
| In the call path | Yes | No |
| Audience | The system | A human reviewer |
| Customer-facing | Yes | No |

## One discipline the TypeScript side gets right

`policyEngine.ts` distinguishes `not-evaluated` from a pass, and **excludes
not-evaluated controls from the overall grade**:

> `not-evaluated` means nothing in the transcript triggered this control. Such
> results are excluded from `overallGrade` — absence of a trigger is not
> evidence of compliance.

If nobody requested PHI and nobody asked for a human, PDX-01 and EIT-01 are
reported as not evaluated rather than scored an A. A scorecard that rounds
silence up to a pass is making a claim it cannot support.

This is the correct discipline and should be preserved in any reconciliation —
including if the grading logic moves.

## Where they could actually diverge

The risk is not that one duplicates the other. It is that **both encode a view
of what each control means**, and those views can drift apart:

1. **Disclosure timing (IDG-01).** The TS side grades on a character-count
   window so a long greeting does not downgrade a correct disclosure. The
   Python side evaluates disclosure state. If "early enough" is defined
   differently, an operator scorecard can say A while the gate would have
   allowed — or vice versa.

2. **Deceptive artifacts (DBC-01).** Both carry their own phrase and pattern
   sets. Two lists, maintained separately, will diverge.

3. **Escalation (EIT-01).** The TS side distinguishes honoured-immediately from
   acknowledged-anywhere (grade C). The Python side has escalation phrases. The
   thresholds are not shared.

4. **Vocabulary.** Python returns enforcement decisions; TypeScript returns
   A/B/C/F. There is no defined mapping, so no automated check can currently
   assert the two agree on the same transcript.

**Nothing in the code prevents these drifting today**, and neither is derived
from the open framework's specification as a single source.

## Which is authoritative

**Not yet decided, deliberately.**

For runtime enforcement the Python engine is authoritative by position — it is
the one in the call path and the one the product depends on.

That does **not** make the TypeScript grading logic disposable. It does
something the Python engine does not: produce explainable, evidence-quoted
output for a human reviewer, with honest not-evaluated handling. Deleting it
would lose real capability.

Choosing on convenience would be the wrong call.

## Reconciliation, when undertaken

1. **Establish a shared corpus.** A set of transcripts both implementations run
   against, with expected outcomes drawn from the framework specification —
   not from either implementation's current behaviour.
2. **Define a mapping** between enforcement decisions and grades, so
   disagreement is detectable rather than merely possible.
3. **Extract the shared definitions** — disclosure window, deceptive-artifact
   patterns, escalation phrases — into one source both consume, rather than two
   hand-maintained copies.
4. **Add a cross-implementation test** that fails when they disagree on the
   corpus.
5. **Keep the not-evaluated discipline** wherever grading ends up.
6. **Only then** decide whether the TypeScript engine keeps its own logic or
   becomes a presentation layer over the Python verdict.

## Out of scope here

This is documentation. No control logic has been modified, no implementation
removed, and no authority assigned. `policyEngine.test.ts` (28 tests, covering
each of the five controls including not-evaluated handling) is untouched and
passing.
