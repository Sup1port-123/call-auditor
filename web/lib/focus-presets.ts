// web/lib/focus-presets.ts
// Client-safe preset list (no server imports) — used by the upload form and by focus.ts.

export type FocusPreset = {
  key: string;
  label: string;
  question: string;
  categories: string[];
};

export const FOCUS_PRESETS: FocusPreset[] = [
  {
    key: "transfer_reason",
    label: "Reason for call transfer",
    question: "Why was the call transferred to another agent/team?",
    categories: [
      "Agent knowledge gap",
      "Customer asked for human/senior",
      "Issue outside agent scope (policy/process)",
      "Technical / system issue",
      "Complaint or escalation required",
      "Language barrier",
      "Agent could not understand query",
      "Other",
    ],
  },
  {
    key: "escalation_reason",
    label: "Reason for escalation",
    question: "Why did this call need (or get) an escalation?",
    categories: [
      "Payout / commission issue",
      "Lead / application status issue",
      "App or login issue",
      "Repeated unresolved query",
      "Agent denied or delayed escalation",
      "Customer angry / complaint",
      "Other",
    ],
  },
  {
    key: "dissatisfaction_reason",
    label: "Why customer was unhappy",
    question: "Was the customer dissatisfied, and if so, why?",
    categories: [
      "Issue not resolved",
      "Long wait / repeated calls",
      "Agent tone or behaviour",
      "Wrong or unclear information",
      "Product / policy limitation",
      "Payout delay",
      "Other",
    ],
  },
  {
    key: "resolution",
    label: "Was the issue resolved",
    question: "Was the customer's issue fully resolved on this call? If not, what blocked resolution?",
    categories: [
      "Resolved on call",
      "Partially resolved",
      "Not resolved — needs follow-up",
      "Not resolved — agent lacked information",
      "Not resolved — system/process blocker",
      "Other",
    ],
  },
  {
    key: "drop_reason",
    label: "Why customer dropped / disconnected",
    question: "Why did the customer disconnect or drop off the call?",
    categories: [
      "Busy / call back later",
      "Not interested",
      "Long hold or silence",
      "Agent could not answer",
      "Network / technical issue",
      "Frustration with agent",
      "Other",
    ],
  },
  {
    key: "objection_reason",
    label: "Customer objections (sales)",
    question: "What objection did the customer raise, and was it handled?",
    categories: [
      "Already have the product",
      "High fees / interest",
      "Trust / safety concern",
      "Not eligible / documents",
      "Need time to think",
      "No objection raised",
      "Other",
    ],
  },
];
