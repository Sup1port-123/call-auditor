# Audit calls automatically from a Google Sheet

New rows in a Karta or Convozen sheet are sent to Otis every hour. Otis audits
them (from the transcript when the sheet has one, otherwise from the recording),
groups them into one batch per agent, and emails the batch report with the Excel
attached when a batch finishes.

## Set up (once per sheet, about 5 minutes)

1. In Vercel, find the `CRON_SECRET` value (it already exists for the daily
   report). Use the **public production domain** of the project; a domain that
   shows a Vercel login page when opened in a private window is blocked and the
   sync will fail.
2. Open the Google Sheet: **Extensions > Apps Script**. Replace the contents of
   `Code.gs` with `Code.gs` from this folder.
3. At the top of the script set `OTIS_URL` to
   `https://<production-domain>/api/ingest/sheet` and check the `SHEETS` list
   (tab name, `karta` or `convozen`, duration unit).
4. **Project Settings > Script properties > Add**: name `OTIS_KEY`, value the
   `CRON_SECRET`.
5. Select `syncNow` and press **Run**; accept the Google permissions. A
   column `Otis Status` appears and the newest rows are marked `sent ...`.
6. Select `installHourlyTrigger` and press **Run** once. The sync now runs
   every hour.

## Notes

- Only rows from the last `LOOKBACK_DAYS` (default 2) days are sent, so turning
  this on does not audit the whole history. Raise it to back-fill.
- Rows already marked in `Otis Status`, calls under 60 seconds, calls whose
  status is not `ended`, and call ids Otis already has are skipped.
- Agent names in the sheet are matched to Otis agents by name (ignoring case);
  an unknown name is audited with no agent.
- Batches also keep moving through `/api/cron/process-batches` (cron-job.org,
  every 5 minutes) if a run is cut short.
