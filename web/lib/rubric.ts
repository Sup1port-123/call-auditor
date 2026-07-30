// Ported from rubric.py â keep in sync if either side changes.

export type RubricDimension = {
  key: string;
  name: string;
  criteria: string;
  min: number;
  max: number;
};

// Default score range for the built-in dimensions.
export const DEFAULT_MIN = 1;
export const DEFAULT_MAX = 5;

const BASE_DIMENSIONS: Omit<RubricDimension, "min" | "max">[] = [
  {
    key: "opening",
    name: "Opening & Identification",
    criteria:
      "Did the AI greet the customer, identify itself and the company, and state the purpose of the call clearly within the first 20 seconds?",
  },
  {
    key: "language_match",
    name: "Language Adaptation",
    criteria:
      "Did the AI match the customer's language preference (English/Hindi/Hinglish), switch fluidly when the customer switched, and avoid robotic translation artefacts?",
  },
  {
    key: "discovery",
    name: "Needs Discovery",
    criteria:
      "Did the AI ask qualifying questions to understand the customer's situation/need before pitching, rather than launching into a script?",
  },
  {
    key: "product_accuracy",
    name: "Product Knowledge & Accuracy",
    criteria:
      "Were product details, eligibility, fees, and benefits described correctly and without misleading or fabricated claims?",
  },
  {
    key: "objection_handling",
    name: "Objection Handling",
    criteria:
      "When the customer raised concerns or pushed back, did the AI engage with the specific objection, or did it deflect/repeat the script?",
  },
  {
    key: "compliance",
    name: "Compliance & Disclosures",
    criteria:
      "Did the AI mention required disclosures (interest rates, terms, recording disclosure, identity verification) where applicable, and avoid prohibited promises (guaranteed approval, fixed returns, etc.)?",
  },
  {
    key: "tone_empathy",
    name: "Tone & Empathy",
    criteria:
      "Was the AI polite, patient, and empathetic? Did it acknowledge customer emotion (frustration, hesitation) rather than ignoring it?",
  },
  {
    key: "flow",
    name: "Conversation Flow",
    criteria:
      "Was the conversation coherent? Minimal awkward silences, no talking over the customer, smooth turn-taking, graceful interruption handling.",
  },
  {
    key: "closing",
    name: "Closing & Next Steps",
    criteria:
      "Did the AI summarize what was discussed, confirm next steps (link sent, callback scheduled, application initiated), and end the call professionally?",
  },
  {
    key: "goal",
    name: "Goal Achievement",
    criteria:
      "Did the AI accomplish the call's apparent objective: qualified the lead, completed the sale, scheduled a callback, or properly disqualified an unfit prospect?",
  },
];

export const RUBRIC_DIMENSIONS: RubricDimension[] = BASE_DIMENSIONS.map((d) => ({
  ...d,
  min: DEFAULT_MIN,
  max: DEFAULT_MAX,
}));

// ---------- Script Compliance Checks -----------------------------------------
// Binary pass/fail checks evaluated against every call transcript.
// These verify that the agent followed the mandatory Gromo call script.

export type ComplianceCheckDef = {
  key: string;
  name: string;
  instruction: string;
};

/**
 * Mandatory script compliance checks for every call.
 * Each returns pass/fail + an evidence quote from the transcript.
 */
export const SCRIPT_COMPLIANCE_CHECKS: ComplianceCheckDef[] = [
  {
    key: "self_introduction",
    name: "Agent Name Introduction",
    instruction:
      "Did the agent introduce themselves by their own personal name at any point in the call? " +
      "(e.g. 'Main Priya bol rahi hoon' or 'This is Rahul speaking'.) " +
      "Mark FAIL if the agent never mentioned their own name.",
  },
  {
    key: "gromo_mention",
    name: "Gromo Company Mention",
    instruction:
      "Did the agent explicitly say the word 'Gromo' at any point during the call? " +
      "Mark FAIL if the company name was never mentioned.",
  },
  {
    key: "issue_confirmation",
    name: "Customer Issue Confirmation",
    instruction:
      "Did the agent confirm or repeat back the customer's specific issue, query, or reason for calling? " +
      "(e.g. 'Aap loan ke baare mein jaanna chahte hain, sahi hai?') " +
      "Mark FAIL if the agent never acknowledged what the customer was calling about.",
  },
  {
    key: "resolution_provided",
    name: "Resolution / Solution Provided",
    instruction:
      "Did the agent provide a clear solution, answer, or resolution to the customer's issue? " +
      "Acknowledgment alone is not enough â the agent must have addressed the issue concretely. " +
      "Mark FAIL if no resolution was offered.",
  },
  {
    key: "closing_assistance",
    name: "Further Assistance + Good Point Close",
    instruction:
      "Before ending the call, did the agent: " +
      "(1) ask whether the customer needed any further help (e.g. 'Kya aur koi madad chahiye?'), AND " +
      "(2) close the call properly on a positive/good note? " +
      "Mark FAIL if either sub-check was missed.",
  },
  {
    key: "feedback_capture",
    name: "Feedback Capture",
    instruction:
      "Did the agent ask the customer for feedback on the call or service quality before closing? " +
      "(e.g. a satisfaction rating request, 'Aaj ki call kaisi lagi?', or similar.) " +
      "Mark FAIL if no feedback was solicited.",
  },
];

// ---------- Inbound-specific Compliance Checks --------------------------------
// Additional binary checks applied ONLY to Inbound Support calls.
// Covers: query reason identification, callback protocol, script adherence.

export const INBOUND_COMPLIANCE_CHECKS: ComplianceCheckDef[] = [
  {
    key: "identified_query_type",
    name: "Identified Customer Query Type",
    instruction:
      "Did the agent correctly identify and acknowledge the specific reason the GP (customer) was calling? " +
      "Examples: loan status enquiry, app login issue, payout delay, product information, callback request, complaint. " +
      "The agent should have explicitly confirmed the query type before proceeding to resolution. " +
      "Mark FAIL if the agent never established or confirmed the reason for the call.",
  },
  {
    key: "asked_gp_reason_before_callback",
    name: "Asked GP Reason Before Arranging Callback",
    instruction:
      "If the call involved arranging a callback, scheduling a follow-up, or transferring/escalating to another team: " +
      "did the agent FIRST ask the GP's specific reason or concern before arranging it? " +
      "(e.g. 'Aapko kaunsi problem aa rahi hai?' before saying 'Main callback schedule karta hoon'.) " +
      "Mark FAIL if a callback or escalation was arranged without the agent first understanding the GP's reason. " +
      "Mark PASS with evidence 'not applicable â no callback arranged' if no callback occurred on this call.",
  },
  {
    key: "followed_inbound_script",
    name: "Followed Complete Inbound Call Script",
    instruction:
      "Did the agent follow the complete inbound call script as specified in the knowledge base? " +
      "Mandatory script steps: (1) greeting with agent's own name + Gromo company name, " +
      "(2) proactively ask and identify the GP's query, " +
      "(3) provide resolution or correctly escalate per KB protocol, " +
      "(4) ask if further assistance is needed, " +
      "(5) request call feedback, " +
      "(6) professional closing. " +
      "Mark FAIL if any of these mandatory steps from the KB was clearly skipped or done incorrectly.",
  },
];

/** Returns true if the agent name indicates an inbound support agent. */
export function isInboundAgent(agentName?: string | null): boolean {
  if (!agentName) return false;
  return agentName.toLowerCase().includes("inbound");
}

/**
 * Returns the appropriate compliance checks for the given agent.
 * Inbound agents get the base 6 checks + 3 inbound-specific checks (9 total).
 * Outbound agents get just the base 6.
 */
export function getComplianceChecks(agentName?: string | null): ComplianceCheckDef[] {
  if (isInboundAgent(agentName)) {
    return [...SCRIPT_COMPLIANCE_CHECKS, ...INBOUND_COMPLIANCE_CHECKS];
  }
  return SCRIPT_COMPLIANCE_CHECKS;
}


// ---- Per-agent rubric parsing / validation --------------------------------

function slugifyKey(source: string, taken: Set<string>): string {
  let base = source
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  if (!base) base = "dimension";
  let key = base;
  let i = 2;
  while (taken.has(key)) key = `${base}_${i++}`;
  taken.add(key);
  return key;
}

export function sanitizeRubric(input: unknown): RubricDimension[] {
  if (!Array.isArray(input)) return [];
  const taken = new Set<string>();
  const out: RubricDimension[] = [];
  for (const item of input) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const name = String(o.name ?? "").trim();
    if (!name) continue;
    const criteria = String(o.criteria ?? "").trim();
    let min = Math.round(Number(o.min));
    let max = Math.round(Number(o.max));
    if (!Number.isFinite(min)) min = DEFAULT_MIN;
    if (!Number.isFinite(max)) max = DEFAULT_MAX;
    if (min < 0) min = 0;
    if (max > 100) max = 100;
    if (max <= min) max = min + 1;
    const provided =
      typeof o.key === "string" && o.key.trim() ? o.key : name;
    const key = slugifyKey(provided, taken);
    out.push({ key, name, criteria, min, max });
  }
  return out.slice(0, 40);
}

export function parseRubricJson(
  raw: string | null | undefined,
): RubricDimension[] | null {
  if (!raw) return null;
  try {
    const dims = sanitizeRubric(JSON.parse(raw));
    return dims.length > 0 ? dims : null;
  } catch {
    return null;
  }
}

export type AuditPreset = {
  key: string;
  name: string;
  description: string;
  emphasis_keys: string[];
  instructions: string;
};

export const AUDIT_PRESETS: Record<string, AuditPreset> = {
  general: {
    key: "general",
    name: "General quality",
    description: "Balanced evaluation across all 10 dimensions.",
    emphasis_keys: [],
    instructions: "Evaluate the call holistically. No single dimension is privileged.",
  },
  sales: {
    key: "sales",
    name: "Sales effectiveness",
    description: "How well did the AI sell? Focus on discovery, objections, closing, conversion.",
    emphasis_keys: ["opening", "discovery", "objection_handling", "closing", "goal"],
    instructions:
      "This is a SALES audit. Pay particular attention to how the AI moved the customer toward conversion: hook, qualifying questions, handling pushback, and closing the loop. Weight sales-execution dimensions heavily in the overall_score.",
  },
  support: {
    key: "support",
    name: "Customer support",
    description: "Was the AI helpful and empathetic? Focus on tone, language, accuracy.",
    emphasis_keys: ["language_match", "tone_empathy", "flow", "product_accuracy"],
    instructions:
      "This is a SUPPORT audit. Pay particular attention to how the AI handled the customer's emotional state, language preference, and information needs. Weight empathy, language adaptation, and product accuracy heavily in the overall_score.",
  },
  compliance: {
    key: "compliance",
    name: "Compliance audit",
    description: "Did the AI stay within regulatory bounds? Focus on disclosures, accuracy.",
    emphasis_keys: ["compliance", "product_accuracy", "opening", "closing"],
    instructions:
      "This is a COMPLIANCE audit. Be strict on missing disclosures, misleading claims, and prohibited language (guaranteed approval, fixed returns, etc.). Weight compliance and product accuracy heavily in the overall_score; minor flow issues are secondary.",
  },
  onboarding: {
    key: "onboarding",
    name: "Lead qualification",
    description: "Did the AI properly qualify the lead? Focus on discovery, accuracy, next steps.",
    emphasis_keys: ["discovery", "product_accuracy", "goal", "closing"],
    instructions:
      "This is a LEAD QUALIFICATION audit. Focus on whether the AI gathered enough info to qualify (or correctly disqualify) the customer and moved them to the right next step. Weight discovery, goal achievement, and closing heavily in the overall_score.",
  },
};

export const STRICTNESS_LEVELS: Record<string, string> = {
  lenient:
    "Be generous. Give benefit of the doubt for minor issues. Reserve scores of 1-2 for serious failures only; most adequate calls should land at 3-4.",
  standard:
    "Use the full 1-5 range. Don't cluster everything around 3-4. Score 1-2 for clear failures, 4-5 for genuinely good or excellent execution.",
  strict:
    "Be tough. Reserve 4-5 only for genuinely excellent execution. Default to 2-3 for adequate-but-unremarkable performance. Score 1-2 readily for any clear failure.",
};

const SYSTEM_PROMPT_TEMPLATE = `You are an expert QA auditor for AI-driven outbound calls in the Indian fintech sector (loans, credit cards, insurance, investment products). The calls are between an AI sales/support agent and a human customer, often code-switching between Hindi, English, and Hinglish.

You will be given a timestamped transcript. Speaker labels (Speaker A, Speaker B, etc.) may or may not be present:
- If labels ARE present, they were produced by automatic diarization and are usually reliable but can occasionally be wrong. Determine which speaker is the AI based on the opening turns (the AI typically greets and identifies the company), then evaluate that speaker's behavior. If diarization looks broken, note it in the rationales.
- If labels are NOT present, infer who is speaking from context â the AI is the caller.

CRITICAL â NON-INTERACTION CALLS:
Before scoring anything, check whether an actual two-way conversation took place between the agent and the customer. A non-interaction call is one where:
- The customer immediately put the call on hold and no real dialogue occurred
- The call was silent or disconnected before the customer spoke substantively
- The transcript contains only the agent's greeting plus hold/system messages with no customer response

If this is a non-interaction call:
- Set overall_score to 1
- Set every rubric dimension score to null with rationale "No customer interaction occurred â call was on hold or silent"
- Set summary to clearly explain that no real conversation took place. ALWAYS include the exact phrase "no customer interaction" in the summary â the system uses this phrase to detect and exclude the call from agent quality metrics.
- Set all script_compliance checks to passed: false with evidence "No customer interaction â agent had no opportunity to fulfill this check"
- Do NOT reward the agent for a polite greeting on a call where the customer never engaged

AUDIT FOCUS:
{focus_block}

SCORING:
- Score each dimension ONLY within the range shown beside it in the RUBRIC below, written as [score MIN-MAX]. The MIN is the worst, the MAX is the best. Use the full range; never go below a dimension's MIN or above its MAX.
- {strictness_block}
- Give a 1-2 sentence rationale grounded in evidence. For any non-null score, quote at least one timestamp [MM:SS] from the transcript so the audit is verifiable. Do not invent timestamps; if the transcript lacks them, paraphrase the specific moment.
- If a dimension is genuinely not applicable (e.g. no objection was raised), score it null and say so in the rationale.

Then provide:
- overall_score (1-5; weight dimensions marked [PRIMARY FOCUS] more heavily, while compliance and product accuracy always carry weight regardless of focus)
- summary (2-3 sentences on how the call went)
- strengths (what the AI did well)
- what_was_lacking (concrete failures or missed opportunities)
- improvement_recommendations (3-5 actionable bullets for the AI team)

RUBRIC:
{rubric}

SCRIPT COMPLIANCE CHECKS:
Beyond the rubric scores, evaluate whether the agent followed the mandatory Gromo call script. For each check below, determine pass (true) or fail (false), and provide a direct quote from the transcript (with timestamp if available) as evidence. If a check fails, quote the moment where it was expected but missing.

{compliance_block}

Be specific, fair, and direct. Indian fintech compliance standards apply. Do not be lenient on misleading product claims or guaranteed-approval language.

Respond with VALID JSON ONLY matching this exact shape:
{
  "scores": {
    <dimension_key>: { "score": <integer within that dimension's MIN-MAX, or null>, "rationale": "<string>" }
  },
  "overall_score": <1-5>,
  "summary": "<string>",
  "strengths": "<string>",
  "what_was_lacking": "<string>",
  "improvement_recommendations": [ "<string>", ... ],
  "script_compliance": {
{compliance_json_shape}
  }{call_reason_field}
}`;

function formatRubric(
  rubric: RubricDimension[],
  emphasisKeys: string[],
): string {
  return rubric
    .map((d) => {
      const marker = emphasisKeys.includes(d.key) ? " [PRIMARY FOCUS]" : "";
      return `- ${d.key} (${d.name}) [score ${d.min}-${d.max}]${marker}: ${d.criteria}`;
    })
    .join("\n");
}

function formatComplianceBlock(checks: ComplianceCheckDef[]): string {
  return checks
    .map((c, i) => `${i + 1}. ${c.key} â "${c.name}": ${c.instruction}`)
    .join("\n");
}

function buildComplianceJsonShape(checks: ComplianceCheckDef[]): string {
  return checks
    .map((c) => `    "${c.key}": { "passed": <true|false>, "evidence": "<quote from transcript>" }`)
    .join(",\n");
}

export function buildSystemPrompt(opts: {
  preset?: string;
  strictness?: string;
  customFocus?: string;
  agentName?: string;
  knowledgeBase?: string;
  rubric?: RubricDimension[];
}): string {
  const rubric =
    opts.rubric && opts.rubric.length > 0 ? opts.rubric : RUBRIC_DIMENSIONS;
  const p = AUDIT_PRESETS[opts.preset ?? "general"] ?? AUDIT_PRESETS.general;
  const parts = [p.instructions];
  if (opts.customFocus?.trim()) {
    parts.push(`Additional reviewer focus: ${opts.customFocus.trim()}`);
  }
  const focus_block = parts.join("\n\n");
  const strictness_block =
    STRICTNESS_LEVELS[opts.strictness ?? "standard"] ??
    STRICTNESS_LEVELS.standard;

  // Get the right compliance checks for this agent type
  const checks = getComplianceChecks(opts.agentName);
  const inbound = isInboundAgent(opts.agentName);

  // Build dynamic compliance JSON shape and optional call_reason field
  const complianceJsonShape = buildComplianceJsonShape(checks);
  const callReasonField = inbound
    ? `,\n  "call_reason": "<brief category of what the GP was calling about â e.g. 'loan status query', 'app login issue', 'payout delay', 'callback request', 'product information', 'complaint'>"`
    : "";

  let prompt = SYSTEM_PROMPT_TEMPLATE
    .replace("{focus_block}", focus_block)
    .replace("{strictness_block}", strictness_block)
    .replace("{rubric}", formatRubric(rubric, p.emphasis_keys))
    .replace("{compliance_block}", formatComplianceBlock(checks))
    .replace("{compliance_json_shape}", complianceJsonShape)
    .replace("{call_reason_field}", callReasonField);


  // Inbound-specific: do not penalize closing when the customer hung up first
  if (inbound) {
    prompt +=
      `\n\nINBOUND CALL DISCONNECT POLICY:\n` +
      `The transcript may be prefixed with a "CALL METADATA:" block that includes a "Disconnect Reason:" line.\n` +
      `If the disconnect reason contains "disconnected by user" or otherwise indicates the customer/user ended the call:\n` +
      `- Do NOT penalize the agent for an incomplete or missing closing — the customer chose to hang up before the agent could close.\n` +
      `- Score the "closing" rubric dimension as null with rationale: "Customer disconnected the call — agent had no opportunity to complete closing. Score withheld per policy."\n` +
      `- Mark the "closing_assistance" compliance check as passed: true with evidence: "Not applicable — customer disconnected the call before the agent could close."\n` +
      `- For "followed_inbound_script", do not fail step (6) professional closing if the disconnect was user-initiated.\n` +
      `If no disconnect reason is mentioned, or the reason is anything other than user-initiated, evaluate closing normally.`;
  }
  if (opts.knowledgeBase?.trim()) {
    const kb = opts.knowledgeBase.trim().slice(0, 60000);
    prompt +=
      `\n\n---\nAGENT KNOWLEDGE BASE` +
      (opts.agentName ? ` (${opts.agentName})` : "") +
      `\n\nThe AI agent on this call is expected to operate strictly within ` +
      `the knowledge, scripts, policies, and guardrails below. When scoring ` +
      `product_accuracy and compliance, verify the agent's statements ` +
      `against THIS document. Flag any claim that contradicts it, any ` +
      `required disclosure it omits, and any guardrail it breaks. Do not ` +
      `penalise the agent for following this document.\n\n` +
      kb;
  }

  return prompt;
    }
