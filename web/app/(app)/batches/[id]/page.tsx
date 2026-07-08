import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Batch } from "@/lib/types/batch";
import BatchView from "./batch-view";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export type BatchAuditRow = {
  id: string;
  target: string;
  call_id: string | null;
  mobile_number: string | null;
  status: string | null;
  overall_score: number | null;
  error_message: string | null;
};

export default async function BatchDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: batch } = await supabase
    .from("batches")
    .select("*")
    .eq("id", id)
    .maybeSingle<Batch>();

  if (!batch) {
    notFound();
  }

  const { data: audits } = await supabase
    .from("audits")
    .select("id, target, call_id, mobile_number, status, overall_score, error_message")
    .eq("batch_id", id)
    .order("timestamp", { ascending: true });

  let agentName: string | null = null;
  if (batch.agent_id) {
    const { data: agent } = await supabase
      .from("agents")
      .select("name")
      .eq("id", batch.agent_id)
      .maybeSingle();
    agentName = agent?.name ?? null;
  }

  return (
    <BatchView
      batch={batch}
      agentName={agentName}
      audits={(audits ?? []) as BatchAuditRow[]}
    />
  );
}
