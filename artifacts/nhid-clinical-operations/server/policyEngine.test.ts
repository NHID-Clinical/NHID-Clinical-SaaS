import { describe, expect, it } from "vitest";
import {
  CONTROL_STATUSES,
  EMAIL_CATEGORIES,
  GRADES,
  PIPELINE_STAGES,
  POLICY_CODES,
} from "../shared/domain";
import {
  buildKnowledgeGroundedDraft,
  categorizeEmail,
  evaluateTranscript,
  type PolicyResult,
} from "./policyEngine";
import { seededKnowledge } from "./operationsData";

const control = (transcript: string, code: string, callId = "CALL-0001") =>
  evaluateTranscript(callId, transcript).policyResults.find(
    result => result.code === code
  ) as PolicyResult;

describe("domain invariants", () => {
  it("keeps the requested pipeline sequence and policy identifiers immutable", () => {
    expect(PIPELINE_STAGES).toEqual([
      "Applied",
      "Vetted",
      "Contract Sent",
      "Integrated",
      "Live",
      "Reporting",
      "Complete",
    ]);
    expect(POLICY_CODES).toEqual([
      "IDG-01",
      "PDX-01",
      "DBC-01",
      "EIT-01",
      "ATR-01",
    ]);
    expect(GRADES).toEqual(["A", "B", "C", "F"]);
    expect(CONTROL_STATUSES).toEqual(["evaluated", "not-evaluated"]);
  });
});

describe("IDG-01 automation disclosure", () => {
  it("passes a disclosure in the opening turn", () => {
    const result = control(
      "Agent: Hello, you are speaking with an automated assistant.\nCaller: Hi.",
      "IDG-01"
    );
    expect(result.grade).toBe("A");
    expect(result.evidence[0].quote).toContain("automated assistant");
  });

  it("recognizes disclosure phrasings the keyword list used to miss", () => {
    const phrasings = [
      "Agent: You are speaking with an automated voice system for the clinic.",
      "Agent: Hi, I'm a bot that helps schedule appointments.",
      "Agent: This call is automated.",
      "Agent: I am a virtual assistant for the practice.",
      "Agent: I'm not a human, I'm here to help you book a visit.",
    ];
    phrasings.forEach(line => {
      expect(control(`${line}\nCaller: Okay.`, "IDG-01").grade).toBe("A");
    });
  });

  it("uses turn position, not a character offset, for the opening window", () => {
    // >260 characters of preamble used to demote this to B.
    const preamble =
      "Agent: Thank you so much for calling the clinic today. ".repeat(6);
    const result = control(
      `${preamble.trim()}\nAgent: I am an automated assistant.`,
      "IDG-01"
    );
    expect(preamble.length).toBeGreaterThan(260);
    expect(result.grade).toBe("A");
  });

  it("fails when automation is never disclosed", () => {
    expect(
      control(
        "Agent: Hello, how can I help with your appointment?\nCaller: I need to reschedule.",
        "IDG-01"
      ).grade
    ).toBe("F");
  });
});

describe("DBC-01 deceptive human impersonation", () => {
  it("catches every phrasing of the same claim", () => {
    const claims = [
      "I am a human, not a bot, I promise.",
      "I'm a person, here to help.",
      "I am a person here to help.",
      "I'm a real person.",
      "I am not a robot.",
      "You are speaking with a real human.",
    ];
    claims.forEach(claim => {
      const result = control(`Agent: ${claim}\nCaller: Okay.`, "DBC-01");
      expect(result.grade, claim).toBe("F");
    });
  });

  it("does not flag an offer to transfer to a person", () => {
    expect(
      control(
        "Agent: I am an automated assistant. Would you like to speak to a real person?\nCaller: Yes.",
        "DBC-01"
      ).grade
    ).toBe("A");
  });

  it("does not blame the system for what the caller says", () => {
    expect(
      control(
        "Agent: I am an automated assistant.\nCaller: I'm a person and I want help.",
        "DBC-01"
      ).grade
    ).toBe("A");
  });
});

describe("PDX-01 PHI request timing", () => {
  it("does not treat a negated mention as a request", () => {
    const result = control(
      "Agent: I am an automated assistant. We will never ask for your date of birth on this line.\nCaller: Good.",
      "PDX-01"
    );
    expect(result.status).toBe("not-evaluated");
  });

  it("detects PHI requests in everyday phrasing", () => {
    const result = control(
      "Agent: Hi there! Can you confirm your DOB and your member ID?\nCaller: Sure.",
      "PDX-01"
    );
    expect(result.status).toBe("evaluated");
    expect(result.grade).toBe("F"); // requested before any disclosure
  });

  it("passes when disclosure precedes the PHI request", () => {
    const result = control(
      "Agent: This call is automated.\nAgent: Please confirm your date of birth.\nCaller: Sure.",
      "PDX-01"
    );
    expect(result.grade).toBe("A");
  });

  it("reports not-evaluated rather than a pass when no PHI is requested", () => {
    const result = control(
      "Agent: I am an automated assistant. How can I help?\nCaller: Just your hours please.",
      "PDX-01"
    );
    expect(result.status).toBe("not-evaluated");
    expect(result.finding).toContain("not a pass");
  });
});

describe("EIT-01 escalation handling", () => {
  it("passes when the request is honored afterwards", () => {
    const result = control(
      "Agent: I am an automated assistant.\nCaller: I want to speak to a person.\nAgent: Of course, connecting you now.",
      "EIT-01"
    );
    expect(result.grade).toBe("A");
    expect(result.evidence).toHaveLength(2);
  });

  it("fails when the request is never honored", () => {
    const result = control(
      "Agent: I am an automated assistant.\nCaller: Let me talk to a human.\nAgent: I can help you with that myself.",
      "EIT-01"
    );
    expect(result.grade).toBe("F");
  });

  it("only counts transfer language that comes after the request", () => {
    const result = control(
      "Agent: I can connect you to billing.\nCaller: I want to speak to a manager.\nAgent: I am unable to do that.",
      "EIT-01"
    );
    expect(result.grade).toBe("C");
  });

  it("reports not-evaluated rather than a pass when nobody asks", () => {
    const result = control(
      "Agent: I am an automated assistant.\nCaller: Thanks, that answers it.",
      "EIT-01"
    );
    expect(result.status).toBe("not-evaluated");
    expect(result.finding).toContain("not a pass");
  });
});

describe("ATR-01 audit traceability", () => {
  it("can actually fail — a malformed call id is not traceable", () => {
    expect(
      control("Agent: I am an automated assistant.\nCaller: Hi.", "ATR-01", "a")
        .grade
    ).toBe("F");
    expect(
      control(
        "Agent: I am an automated assistant.\nCaller: Hi.",
        "ATR-01",
        "  "
      ).grade
    ).toBe("F");
  });

  it("fails a single-turn transcript that cannot be reconstructed", () => {
    expect(
      control("An automated assistant handled the call", "ATR-01", "CALL-77")
        .grade
    ).toBe("F");
  });

  it("downgrades an unattributed transcript rather than passing it", () => {
    expect(
      control(
        "I am an automated assistant. How can I help you today? I can book that for you.",
        "ATR-01",
        "CALL-77"
      ).grade
    ).toBe("B");
  });

  it("passes when the identifier and speaker attribution are both present", () => {
    expect(
      control(
        "Agent: I am an automated assistant.\nCaller: Hi.",
        "ATR-01",
        "CALL-77"
      ).grade
    ).toBe("A");
  });
});

describe("overall grading", () => {
  it("excludes not-evaluated controls from the overall grade", () => {
    const report = evaluateTranscript(
      "CALL-991",
      "Agent: Hello, I am an automated assistant.\nCaller: Great, can you book me in?\nAgent: Done."
    );
    const notEvaluated = report.policyResults.filter(
      result => result.status === "not-evaluated"
    );
    expect(notEvaluated.map(result => result.code).sort()).toEqual([
      "EIT-01",
      "PDX-01",
    ]);
    expect(report.evaluatedControls).toBe(3);
    expect(report.overallGrade).toBe("A");
  });

  it("takes the worst evaluated grade", () => {
    const report = evaluateTranscript(
      "CALL-992",
      "Agent: Hello, how can I help with your appointment?\nCaller: Fine."
    );
    expect(report.overallGrade).toBe("F"); // IDG-01 failed
  });

  it("returns a result for all five controls in the canonical order", () => {
    const report = evaluateTranscript(
      "CALL-993",
      "Agent: I am an automated assistant.\nCaller: Hi."
    );
    expect(report.policyResults.map(result => result.code)).toEqual(
      POLICY_CODES
    );
    expect(
      report.policyResults.every(result => GRADES.includes(result.grade))
    ).toBe(true);
  });
});

describe("email categorization", () => {
  it("classifies known commercial topics into permitted categories", () => {
    expect(
      categorizeEmail("Pricing request", "Can you share your cost and package?")
        .category
    ).toBe("Pricing");
    expect(
      categorizeEmail(
        "Need Twilio integration guidance",
        "Our system uses Twilio"
      ).category
    ).toBe("Integration");
    expect(EMAIL_CATEGORIES).toContain(
      categorizeEmail("Hello", "A general question").category
    );
  });

  it("derives confidence from evidence instead of returning a constant", () => {
    const weak = categorizeEmail("Question", "What is the cost?");
    const strong = categorizeEmail(
      "Pricing and cost",
      "Please send your price list, package options and rate card."
    );
    expect(strong.confidence).toBeGreaterThan(weak.confidence);
    expect(categorizeEmail("zzz", "zzz").confidence).toBeLessThan(50);
    expect(strong.confidence).toBeLessThanOrEqual(95);
  });

  it("surfaces competing categories instead of silently dropping them", () => {
    const result = categorizeEmail(
      "Pricing for our Twilio integration",
      "We need cost information for an integration with Twilio."
    );
    expect(result.alternates).toContain("Integration");
    expect(result.matchedTerms.length).toBeGreaterThan(0);
  });
});

describe("knowledge-grounded drafting", () => {
  it("creates a draft without an auto-send instruction", () => {
    const draft = buildKnowledgeGroundedDraft({
      senderName: "Alex Example",
      subject: "Pricing request",
      category: "Pricing",
    });
    expect(draft).toContain("Production packaging is TBD");
    expect(draft).not.toContain("send automatically");
  });

  it("retains the required Tier and 20-question FAQ seed articles", () => {
    const titles = seededKnowledge.map(article => article.title);
    expect(titles).toContain("Tier 0 vs Tier 1");
    expect(titles).toContain("FAQ: Controls, Tiers, and Readiness");
    expect(
      seededKnowledge.find(
        article => article.title === "FAQ: Controls, Tiers, and Readiness"
      )?.body
    ).toContain("20. What happens after the pilot?");
  });
});
