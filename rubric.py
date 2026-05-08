"""Scoring rubric for AI-human call audits. Edit RUBRIC_DIMENSIONS to tune."""

RUBRIC_DIMENSIONS = [
    {
        "key": "opening",
        "name": "Opening & Identification",
        "criteria": "Did the AI greet the customer, identify itself and the company, and state the purpose of the call clearly within the first 20 seconds?",
    },
    {
        "key": "language_match",
        "name": "Language Adaptation",
        "criteria": "Did the AI match the customer's language preference (English/Hindi/Hinglish), switch fluidly when the customer switched, and avoid robotic translation artefacts?",
    },
    {
        "key": "discovery",
        "name": "Needs Discovery",
        "criteria": "Did the AI ask qualifying questions to understand the customer's situation/need before pitching, rather than launching into a script?",
    },
    {
        "key": "product_accuracy",
        "name": "Product Knowledge & Accuracy",
        "criteria": "Were product details, eligibility, fees, and benefits described correctly and without misleading or fabricated claims?",
    },
    {
        "key": "objection_handling",
        "name": "Objection Handling",
        "criteria": "When the customer raised concerns or pushed back, did the AI engage with the specific objection, or did it deflect/repeat the script?",
    },
    {
        "key": "compliance",
        "name": "Compliance & Disclosures",
        "criteria": "Did the AI mention required disclosures (interest rates, terms, recording disclosure, identity verification) where applicable, and avoid prohibited promises (guaranteed approval, fixed returns, etc.)?",
    },
    {
        "key": "tone_empathy",
        "name": "Tone & Empathy",
        "criteria": "Was the AI polite, patient, and empathetic? Did it acknowledge customer emotion (frustration, hesitation) rather than ignoring it?",
    },
    {
        "key": "flow",
        "name": "Conversation Flow",
        "criteria": "Was the conversation coherent? Minimal awkward silences, no talking over the customer, smooth turn-taking, graceful interruption handling.",
    },
    {
        "key": "closing",
        "name": "Closing & Next Steps",
        "criteria": "Did the AI summarize what was discussed, confirm next steps (link sent, callback scheduled, application initiated), and end the call professionally?",
    },
    {
        "key": "goal",
        "name": "Goal Achievement",
        "criteria": "Did the AI accomplish the call's apparent objective: qualified the lead, completed the sale, scheduled a callback, or properly disqualified an unfit prospect?",
    },
]


AUDIT_PRESETS = {
    "general": {
        "name": "General quality",
        "description": "Balanced evaluation across all 10 dimensions.",
        "emphasis_keys": [],
        "instructions": "Evaluate the call holistically. No single dimension is privileged.",
    },
    "sales": {
        "name": "Sales effectiveness",
        "description": "How well did the AI sell? Focus on discovery, objections, closing, conversion.",
        "emphasis_keys": ["opening", "discovery", "objection_handling", "closing", "goal"],
        "instructions": "This is a SALES audit. Pay particular attention to how the AI moved the customer toward conversion: hook, qualifying questions, handling pushback, and closing the loop. Weight sales-execution dimensions heavily in the overall_score.",
    },
    "support": {
        "name": "Customer support",
        "description": "Was the AI helpful and empathetic? Focus on tone, language, accuracy.",
        "emphasis_keys": ["language_match", "tone_empathy", "flow", "product_accuracy"],
        "instructions": "This is a SUPPORT audit. Pay particular attention to how the AI handled the customer's emotional state, language preference, and information needs. Weight empathy, language adaptation, and product accuracy heavily in the overall_score.",
    },
    "compliance": {
        "name": "Compliance audit",
        "description": "Did the AI stay within regulatory bounds? Focus on disclosures, accuracy.",
        "emphasis_keys": ["compliance", "product_accuracy", "opening", "closing"],
        "instructions": "This is a COMPLIANCE audit. Be strict on missing disclosures, misleading claims, and prohibited language (guaranteed approval, fixed returns, etc.). Weight compliance and product accuracy heavily in the overall_score; minor flow issues are secondary.",
    },
    "onboarding": {
        "name": "Lead qualification",
        "description": "Did the AI properly qualify the lead? Focus on discovery, accuracy, next steps.",
        "emphasis_keys": ["discovery", "product_accuracy", "goal", "closing"],
        "instructions": "This is a LEAD QUALIFICATION audit. Focus on whether the AI gathered enough info to qualify (or correctly disqualify) the customer and moved them to the right next step. Weight discovery, goal achievement, and closing heavily in the overall_score.",
    },
}


STRICTNESS_LEVELS = {
    "lenient": "Be generous. Give benefit of the doubt for minor issues. Reserve scores of 1-2 for serious failures only; most adequate calls should land at 3-4.",
    "standard": "Use the full 1-5 range. Don't cluster everything around 3-4. Score 1-2 for clear failures, 4-5 for genuinely good or excellent execution.",
    "strict": "Be tough. Reserve 4-5 only for genuinely excellent execution. Default to 2-3 for adequate-but-unremarkable performance. Score 1-2 readily for any clear failure.",
}


SYSTEM_PROMPT = """You are an expert QA auditor for AI-driven outbound calls in the Indian fintech sector (loans, credit cards, insurance, investment products). The calls are between an AI sales/support agent and a human customer, often code-switching between Hindi, English, and Hinglish.

You will be given a timestamped transcript. Speaker labels (Speaker A, Speaker B, etc.) may or may not be present:
- If labels ARE present, they were produced by automatic diarization and are usually reliable but can occasionally be wrong. Determine which speaker is the AI based on the opening turns (the AI typically greets and identifies the company), then evaluate that speaker's behavior. If diarization looks broken, note it in the rationales.
- If labels are NOT present, infer who is speaking from context — the AI is the caller.

AUDIT FOCUS:
{focus_block}

SCORING:
- Score each dimension 1 (poor) to 5 (excellent).
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

Be specific, fair, and direct. Indian fintech compliance standards apply. Do not be lenient on misleading product claims or guaranteed-approval language."""


def _format_rubric(emphasis_keys: list) -> str:
    lines = []
    for d in RUBRIC_DIMENSIONS:
        marker = "  [PRIMARY FOCUS]" if d["key"] in emphasis_keys else ""
        lines.append(f"- {d['key']} ({d['name']}){marker}: {d['criteria']}")
    return "\n".join(lines)


def system_prompt(
    preset: str = "general",
    strictness: str = "standard",
    custom_focus: str = "",
) -> str:
    p = AUDIT_PRESETS.get(preset, AUDIT_PRESETS["general"])
    focus_parts = [p["instructions"]]
    if custom_focus and custom_focus.strip():
        focus_parts.append(f"Additional reviewer focus: {custom_focus.strip()}")
    focus_block = "\n\n".join(focus_parts)

    strictness_block = STRICTNESS_LEVELS.get(strictness, STRICTNESS_LEVELS["standard"])

    return SYSTEM_PROMPT.format(
        focus_block=focus_block,
        strictness_block=strictness_block,
        rubric=_format_rubric(p["emphasis_keys"]),
    )


def output_schema() -> dict:
    score_block = {
        "type": "object",
        "properties": {
            "score": {
                "anyOf": [{"type": "integer"}, {"type": "null"}],
                "description": "1-5, or null if not applicable",
            },
            "rationale": {"type": "string"},
        },
        "required": ["score", "rationale"],
        "additionalProperties": False,
    }
    return {
        "type": "object",
        "properties": {
            "scores": {
                "type": "object",
                "properties": {d["key"]: score_block for d in RUBRIC_DIMENSIONS},
                "required": [d["key"] for d in RUBRIC_DIMENSIONS],
                "additionalProperties": False,
            },
            "overall_score": {"type": "integer"},
            "summary": {"type": "string"},
            "strengths": {"type": "string"},
            "what_was_lacking": {"type": "string"},
            "improvement_recommendations": {
                "type": "array",
                "items": {"type": "string"},
            },
        },
        "required": [
            "scores",
            "overall_score",
            "summary",
            "strengths",
            "what_was_lacking",
            "improvement_recommendations",
        ],
        "additionalProperties": False,
    }
