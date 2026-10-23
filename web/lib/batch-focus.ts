// web/lib/batch-focus.ts
// Builds (and caches) the batch-level Special Audit Focus Report.
// Cache lives in batches.focus_report_json and is rebuilt automatically when
// more audits complete (e.g. multi-chunk Convozen uploads), or on force=true.

import { createAdminClient } from "@/lib/supabase/admin";
import {
  buildFocusReport,
  getFocusPreset,
  hasFocus,
  parseFocusFromCompliance,
  type FocusAuditRow,
  type FocusReport,
} from "@/lib/focus";

export async function getOrBuildBatchFocusReport(
  batchId: string,
  opts: { force?: boolean } = {},
): Promise<FocusReport | null> {
  const db = createAdminClient();

  const { data: batch } = await db
    .from("batches")
    .select("id, custom_focus, agent_id")
    .eq("id", batchId)
    .maybeSingle();

  if (!batch || !hasFocus(batch.custom_focus)) return null;

  const { data: audits } = await db
    .from("audits")
    .select("id, call_id, mobile_number, overall_score, compliance_json, agent_id")
    .eq("batch_id", batchId)
    .eq("status", "completed");

  const list = audits ?? [];

  // Agent names
  const agentIds = [
    ...new Set(list.map((a) => a.agent_id ?? batch.agent_id).filter(Boolean)),
  ] as string[];
  const names = new Map<string, string>();
  if (agentIds.length) {
    const { data: agents } = await db.from("agents").select("id, name").in("id", agentIds);
    (agents ?? []).forEach((a) => names.set(a.id, a.name));
  }

  const rows: FocusAuditRow[] = [];
  for (const a of list) {
    const focus = parseFocusFromCompliance(a.compliance_json);
    if (!focus) continue;
    const aid = a.agent_id ?? batch.agent_id;
    rows.push({
      auditId: a.id,
      callId: a.call_id,
      mobile: a.mobile_number,
      agentName: aid ? names.get(aid) ?? null : null,
      overallScore: a.overall_score,
      focus,
    });
  }
  if (rows.length === 0) return null;

  // Serve cache if it already covers every completed focus audit.
  // The cache column is optional — if it does not exist yet, we simply rebuild.
  let cachedRaw: string | null = null;
  if (!opts.force) {
    const { data: cacheRow, error: cacheErr } = await db
      .from("batches")
      .select("focus_report_json")
      .eq("id", batchId)
      .maybeSingle();
    if (!cacheErr) cachedRaw = (cacheRow as { focus_report_json?: string | null } | null)?.focus_report_json ?? null;
  }
  if (cachedRaw) {
    try {
      const cached = JSON.parse(cachedRaw) as FocusReport;
      if (cached?.totalCalls === rows.length && cached.reasons) return cached;
    } catch {
      /* rebuild */
    }
  }

  const preset = getFocusPreset(batch.custom_focus);
  const question = preset ? preset.question : String(batch.custom_focus).trim();
  const report = await buildFocusReport(question, rows);

  // Best-effort cache write (ignored if the focus_report_json column is missing)
  const { error: saveErr } = await db
    .from("batches")
    .update({ focus_report_json: JSON.stringify(report) })
    .eq("id", batchId);
  if (saveErr) console.warn("[otis] focus report cache not saved:", saveErr.message);

  return report;
}
