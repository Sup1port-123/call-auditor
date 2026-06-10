# Otis — AI Call Auditor · Handover Document

_Last updated: June 2026._

This document explains what the tool does, how it's built, how every piece
works, what it depends on, and how to operate and extend it. It's meant to get
a new owner/engineer fully productive without having to reverse-engineer the
codebase.

---

## 1. What this tool is

**Otis** is an AI-powered QA system for call-center recordings. You give it a
call recording (a URL), and it:

1. **Transcribes** the call (with speaker labels, tuned for Hindi/English/Hinglish).
2. **Scores** the call against a rubric using an LLM — per-dimension scores with
   timestamped rationale, an overall score, summary, strengths, gaps, and
   recommendations.
3. **Stores** the result and surfaces it on a dashboard.
4. **Reports** — lets you filter/download results as Excel, mark each audit as
   reviewed, and email a daily report automatically.

It is used to audit AI sales/support agents (e.g. GroMo's "inbound agent") and
human agents alike. Each **agent** has its own knowledge base and its own
editable scoring **rubric**.

The product is branded **"Otis"**; the repo is **call-auditor**.

---

## 2. Tech stack

| Layer | Technology |
|---|---|
| Web app + API | **Next.js 16** (App Router, React 19, TypeScript) |
| Styling | Tailwind CSS v4 |
| Database | **Supabase** (hosted PostgreSQL). No row-level security — the app is internal/no-login and uses server-side keys. |
| Transcription | **AssemblyAI** (universal-3-pro / universal-2, speaker labels) |
| LLM scoring | **OpenAI** (primary, `gpt-4o`) → **Gemini** → **Anthropic** as fallbacks |
| Spreadsheets | **SheetJS (`xlsx`)** — for Excel export and email attachment |
| PDF extraction | **`unpdf`** — to ingest a knowledge base from a PDF |
| Email | **Gmail SMTP via `nodemailer`** (primary) or **Resend** (fallback) |
| Hosting | **Vercel** (project `call-auditor`, domain `call-auditor-eight.vercel.app`) |
| Scheduling | External cron (**cron-job.org**) hitting a secured endpoint — Vercel Hobby only allows once-a-day crons, so an external scheduler gives flexible timing |

There is also a legacy **Streamlit** app (`app.py` at the repo root) for manual
auditing/calibration. **The live product is the Next.js app under `web/`.** The
root `app.py`, `auditor.py`, `rubric.py`, `calibration.py` are not used by the
deployed product.

---

## 3. Repository layout

```
call-auditor/
├── app.py, auditor.py, rubric.py, calibration.py   # legacy Streamlit (not deployed)
├── HANDOVER.md                                      # this file
├── web/                                             # the deployed Next.js app
│   ├── app/
│   │   ├── (app)/                  # authenticated app shell (sidebar layout)
│   │   │   ├── layout.tsx          # sidebar nav
│   │   │   ├── dashboard/          # home: stat cards, filters, expandable table, Excel download
│   │   │   ├── audits/             # list + [id] detail (full evaluation)
│   │   │   ├── agents/             # list, new, [id] (edit KB + rubric)
│   │   │   ├── batches/            # list + [id] (spreadsheet upload progress, retry)
│   │   │   ├── new-audit/          # single-URL form + batch (spreadsheet) form
│   │   │   └── settings/           # daily email report config
│   │   └── api/                    # all backend routes (see §8)
│   ├── lib/
│   │   ├── auditor.ts              # AssemblyAI submit + LLM scoring (OpenAI/Gemini/Anthropic)
│   │   ├── finalize.ts             # drives an audit transcribing → scoring → completed/failed
│   │   ├── rubric.ts               # dimensions, presets, prompt builder, per-agent rubric parsing
│   │   ├── audit-filters.ts        # dashboard filter parse/apply + helpers
│   │   ├── audit-export.ts         # shared Excel workbook builder
│   │   ├── report.ts               # daily report: IST helpers, email send, generate+send
│   │   ├── agent-kb.ts             # knowledge-base + rubric form parsing
│   │   ├── supabase/               # server / admin / client Supabase factories
│   │   └── types/                  # Agent, Audit, Batch type definitions
│   ├── *.sql                       # database migrations (run in Supabase) — see §11
│   └── package.json
└── .env.example                    # all environment variables
```

---

## 4. Architecture & end-to-end data flow

```
            ┌──────────────── you ────────────────┐
            │ paste a URL          upload a sheet  │
            ▼                                      ▼
   POST /api/audits                        POST /api/batches
   (status=transcribing)                   (N rows, status=queued)
            │                                      │
            │                          batch-view polls:
            │                          POST /api/batches/[id]/process
            │                          (queued → submit; transcribing → finalize)
            ▼                                      ▼
   submitTranscription() ─────────────────────────┘
   → AssemblyAI (async)
            │
            │ when transcript is ready:
            │   • AssemblyAI webhook → POST /api/audits/webhook
            │   • OR poller → GET /api/audits/[id]/status   (self-heal)
            ▼
   finalizeAudit()  (lib/finalize.ts)
     1. claim row (transcribing → scoring)
     2. fetch transcript from AssemblyAI (+ audio_duration)
     3. load the agent's knowledge base + rubric
     4. scoreTranscript() → OpenAI (→ Gemini → Anthropic)
     5. store scores, summary, etc.  status → completed / failed
            │
            ▼
   Dashboard / Audits pages read from Supabase
   Excel download + daily email report use the same export builder
```

**Status machine for an audit:**
`queued → transcribing → scoring → completed` (or `failed` from any step).
Failed audits can be re-run via the batch **Retry failed** button (resets them
to `transcribing` so they re-score without re-transcribing).

**Why webhook AND poller:** the AssemblyAI webhook can be missed (deploy
protection, transient errors). The poller is a self-heal path — any audit stuck
in `transcribing` gets finalized on the next status check.

---

## 5. Data model (Supabase / Postgres)

No row-level security anywhere — the app has no user login and accesses data via
server-side keys (anon for reads, service-role for writes).

### `audits`
The central table. One row per recording audited.

| Column | Meaning |
|---|---|
| `id` | `aud-...` primary key |
| `timestamp` | when the audit was **created** (upload time), ISO string |
| `audited_at` | when scoring **finished** (newer audits); falls back to `timestamp` |
| `source` | `next-app` (single) / `batch` |
| `target` | the recording **URL** (also serves as the call identifier) |
| `agent_id` | FK → `agents` (nullable) — selects the rubric + knowledge base |
| `batch_id` | FK → `batches` (nullable) |
| `preset`, `strictness`, `custom_focus` | scoring controls |
| `status` | `queued / transcribing / scoring / completed / failed` |
| `transcript_id` | AssemblyAI transcript id |
| `transcript` | formatted transcript text with `[MM:SS]` + speaker labels |
| `duration_seconds` | recording length (from AssemblyAI `audio_duration`); `-1` = unknown |
| `overall_score` | LLM overall score |
| `summary`, `strengths`, `what_was_lacking` | LLM text outputs |
| `scores_json` | per-dimension `{score, rationale, name, min, max}` (snapshotted rubric) |
| `recommendations_json` | array of recommendation strings |
| `llm_provider`, `llm_fallback_reason` | which model scored it |
| `review_status` | manual review: `reviewed / not_reviewed / flagged` (default `not_reviewed`) |
| `error_message` | failure detail |

### `agents`
| Column | Meaning |
|---|---|
| `id`, `name`, `target`, `description`, `created_at` | basics |
| `knowledge_base` | text injected into the scoring prompt (≤60k chars used) — grounds product-accuracy/compliance scoring |
| `rubric_json` | per-agent rubric: array of `{key, name, criteria, min, max}`. `NULL` = use the built-in default 10 dimensions (1–5). |

### `batches`
A spreadsheet upload. `id, label, agent_id, preset, strictness, custom_focus,
url_column, total, created_at`. Its audits link back via `audits.batch_id`.

### `report_settings`
Singleton (`id='default'`) for the daily email: `emails` (comma-separated),
`send_time` ("HH:MM" IST), `timezone`, `enabled`, `last_sent_date`, `updated_at`.

---

## 6. The scoring rubric (per-agent, editable)

- **Default rubric**: 10 dimensions (Opening, Language, Discovery, Product
  Accuracy, Objection Handling, Compliance, Tone, Flow, Closing, Goal), each
  scored **1–5**. Defined in `lib/rubric.ts`.
- **Per-agent override**: each agent can edit its dimensions — name, grading
  **criteria** (the text the LLM grades against), and a **min/max** range per
  dimension — and add/remove dimensions. Edited in the agent page after the
  knowledge base. Stored in `agents.rubric_json`.
- At scoring time (`scoreTranscript`), the prompt and the LLM's JSON schema are
  built from that agent's rubric. Scores are **clamped** to each dimension's
  range, and the rubric metadata (name/min/max) is **snapshotted** into
  `scores_json` so old audits still render correctly even if the rubric later
  changes.
- The **overall score** is still produced by the LLM (the user chose this).
- The audit detail page and dashboard scale each dimension's bar to its own
  `max`.

---

## 7. Features (what each screen does)

- **Dashboard** (`/dashboard`): three stat cards; a **filter bar** (Date, Call
  ID, Duration, Audit score, Review status); a table of recent/filtered audits
  with **expandable rows** (summary, per-dimension scores+rationale, strengths,
  gaps, recommendations, transcript, review control); a **Download Excel**
  button that exports the current filtered set.
- **Audits** (`/audits`, `/audits/[id]`): searchable list with a Review control
  per row; detail page with the full evaluation and a review control.
- **Agents** (`/agents`, `/agents/new`, `/agents/[id]`): create/edit an agent's
  name, target, **knowledge base** (paste text or upload PDF), and **scoring
  rubric**.
- **Batches** (`/batches`, `/batches/[id]`): upload a spreadsheet of recording
  URLs → it creates N audits and drives them to completion with a live progress
  bar; **Retry failed** re-runs only the failures; **Export CSV**.
- **New audit** (`/new-audit`): single URL form or batch spreadsheet upload;
  pick the agent, preset, strictness, custom focus.
- **Settings** (`/settings`): configure the **daily email report** — recipients,
  send time (IST), on/off, and **Send test now**.

---

## 8. API routes reference

| Route | Purpose |
|---|---|
| `POST /api/audits` | Create a single audit and submit to AssemblyAI |
| `PATCH /api/audits/[id]` | Set `review_status` |
| `GET /api/audits/[id]/status` | Poll status; self-heals stuck audits via `finalizeAudit` |
| `GET /api/audits/export` | Excel of audits (respects dashboard filters) |
| `POST /api/audits/webhook` | AssemblyAI callback → `finalizeAudit` |
| `POST /api/agents`, `PATCH /api/agents/[id]` | Create / edit agent (name, target, KB, rubric) |
| `POST /api/batches` | Create a batch + N queued audits from a sheet |
| `POST /api/batches/[id]/process` | Driver: submit queued, then finalize transcribing (chunked) |
| `GET /api/batches/[id]/status` | Batch progress counts |
| `POST /api/batches/[id]/retry` | Reset failed rows so they re-run |
| `GET /api/batches/[id]/export` | CSV of a batch |
| `GET/POST /api/report-settings` | Read settings / save settings / "send test" |
| `GET /api/cron/daily-report?key=…` | Secured; sends the day's report once at/after the set time |
| `POST /api/admin/backfill-duration` | One-off: backfill `duration_seconds` for old audits |

---

## 9. Environment variables (set in Vercel → Settings → Environment Variables)

| Var | Used for |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase reads |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase writes (server only) |
| `ASSEMBLYAI_API_KEY` | transcription |
| `OPENAI_API_KEY` | LLM scoring (primary). `OPENAI_MODEL` optional (default `gpt-4o`) |
| `GOOGLE_API_KEY` | Gemini fallback. `GEMINI_MODEL` optional |
| `ANTHROPIC_API_KEY` | Anthropic fallback (optional). `ANTHROPIC_MODEL` optional |
| `LLM_PROVIDER` | which provider is tried first (default `openai`) |
| **Email** | one of the two transports below |
| `SMTP_USER`, `SMTP_PASS` | Gmail address + **app password** (preferred email path) |
| `RESEND_API_KEY` | Resend (needs a verified sender domain) — fallback if SMTP not set |
| `REPORT_FROM_EMAIL` | the "from" address (for Gmail SMTP, set to the `SMTP_USER` address) |
| `CRON_SECRET` | random string; the external scheduler must pass it as `?key=` |

Email transport precedence: **if `SMTP_USER`+`SMTP_PASS` are set, Gmail SMTP is
used; otherwise Resend.**

---

## 10. External services & accounts

- **Supabase** — database. Project dashboard holds the SQL editor + table data.
- **Vercel** — hosting/CI. Pushes to `main` auto-deploy to production. Plan is
  **Hobby** (cron limited to once/day → we use an external scheduler).
- **AssemblyAI** — transcription. Paid per audio minute.
- **OpenAI** — scoring. Paid per token. (Gemini/Anthropic are optional fallbacks
  and need their own funded keys to be useful.)
- **Gmail** (or Google Workspace) — sending the report via an **app password**
  (requires 2-Step Verification; some Workspace admins disable app passwords).
- **cron-job.org** (free) — pings `/api/cron/daily-report` every ~15 min so the
  report fires daily at the configured time.
- **GitHub** — `a07nemo/call-auditor`, branch `main`.

---

## 11. Database migrations (run order in Supabase → SQL Editor)

All are idempotent. Run each once. They live in `web/*.sql`:

1. `supabase-migration.sql` — base `audits` status/transcript columns
2. `supabase-agents-migration.sql` — `agents` table + `audits.agent_id`
3. `supabase-batches-migration.sql` — `batches` table + `audits.batch_id`
4. `supabase-seed-inbound-agent.sql` — seeds the default inbound agent (optional)
5. `supabase-duration-migration.sql` — `audits.duration_seconds`
6. `supabase-audited-at-migration.sql` — `audits.audited_at`
7. `supabase-rubric-migration.sql` — `agents.rubric_json`
8. `supabase-review-status-migration.sql` — `audits.review_status`
9. `supabase-report-settings-migration.sql` — `report_settings` table

> When prompted by Supabase about "Row Level Security," choose **Run without
> RLS** — the whole app intentionally runs without RLS.

After deploying code that adds a column, **run its migration before relying on
it** (otherwise writes to the missing column fail).

---

## 12. Deployment

- Hosted on **Vercel**, project `call-auditor`, connected to GitHub `main`.
- **Every push to `main` auto-deploys to production.** Production is only updated
  when a build is **Ready (green)**; a failed build leaves the previous version
  live.
- Env-var changes require a **Redeploy** to take effect (Deployments → ⋯ →
  Redeploy).
- There is no local dev runtime on the current owner's machine (Node isn't
  installed there); the build/typecheck happens on Vercel. To develop locally:
  `cd web && npm install && npm run dev`.

---

## 13. Operational runbook (common tasks)

- **Audit one call:** New audit → paste URL → pick agent → submit. Watch it on
  its detail page (it self-heals if the webhook is missed).
- **Audit many calls:** New audit → Upload spreadsheet (a column of recording
  URLs) → pick agent → it processes in the background. Keep the tab open.
- **A batch has failures:** open the batch → **Retry failed**. Most common cause
  historically was an LLM key with no credit/quota — check the failed audit's
  error message.
- **Change the rubric for an agent:** Agents → open agent → Edit → adjust
  dimensions/criteria/min-max → Save. Affects **future** audits only.
- **Mark audits reviewed/flagged:** use the Review control on the audits list,
  the dashboard expanded row, or the audit detail page.
- **Download data:** Dashboard → apply filters → Download Excel (full insight
  incl. transcript). Per-batch: Export CSV.
- **Daily email:** Settings → set recipients + IST time + On → Save → Send test
  now. Then ensure the cron-job.org job is pinging
  `/api/cron/daily-report?key=CRON_SECRET` every ~15 min.
- **Swap an LLM/email key:** Vercel env vars → edit → **Redeploy**.

---

## 14. Known limitations & roadmap

- **Manual ingestion.** Recordings are entered by hand (URL or sheet). The next
  step is an **auto-ingestion connector** that pulls recordings from the source
  call platform (e.g. Karta), auto-maps each call to the right agent, dedupes by
  external call id, and runs the pipeline + report with no human step. Needs the
  source platform's API/webhook + an "external agent id" mapping. Est. ~1 week
  (clean source API) to ~2 weeks (messy API / high volume needing Vercel Pro + a
  queue).
- **Hobby cron.** Vercel Hobby only fires cron once/day; we rely on an external
  scheduler. Vercel Pro would allow native, finer scheduling.
- **Volume/cost.** Transcription + LLM cost scales with call volume; large-scale
  auto-ingestion should add sampling/filtering and rate-limit handling.
- **Overall score scale.** The dashboard/score pills label scores `/10` while
  the LLM's overall is on a 1–5-ish scale — a cosmetic inconsistency, not fixed
  deliberately to avoid disturbing historical data.
- **No auth.** The app is open to anyone with the URL (no RLS, no login). Fine
  for internal use; add auth before exposing publicly.

---

## 15. Glossary

- **Audit** — one scored recording.
- **Agent** — the AI/human whose calls are graded; owns a knowledge base + rubric.
- **Batch** — a spreadsheet upload of many recordings.
- **Rubric / dimension** — the scoring criteria; each dimension has a min/max range.
- **Knowledge base** — agent-specific facts/scripts injected into the scoring
  prompt to ground accuracy/compliance.
- **finalize** — the function that turns a transcribed call into a scored audit.
- **review_status** — manual reviewer state (reviewed / not_reviewed / flagged).

---

_For anything unclear, the source of truth is the code under `web/` — start at
`lib/finalize.ts` and `lib/auditor.ts` for the pipeline, and `app/(app)/` for the
screens._
