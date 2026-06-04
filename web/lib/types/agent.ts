export type Agent = {
  id: string;
  name: string;
  target: string | null;
  description: string | null;
  knowledge_base: string | null;
  rubric_json: string | null;
  created_at: string;
};

export type AgentSummary = {
  id: string;
  name: string;
  target: string | null;
  created_at: string;
};

export function newAgentId(): string {
  const d = new Date();
  const stamp = d.toISOString().slice(0, 10).replace(/-/g, "");
  return `agt-${stamp}-${Math.random().toString(16).slice(2, 8)}`;
}
