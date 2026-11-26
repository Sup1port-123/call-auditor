/**
 * Otis - audit new calls from a Google Sheet automatically.
 *
 * One script for both sheets (Karta and Convozen): it opens each sheet by its id,
 * so it works from a standalone Apps Script project or from one opened through
 * Extensions > Apps Script in either sheet. Then follow README.md. Every run finds calls that are long enough and not sent
 * yet, posts them to Otis (which audits them and emails the batch report with
 * the Excel attached) and writes "sent" in an "Otis Status" column so a row is
 * never sent twice.
 */

// ---- Settings -------------------------------------------------------------
var OTIS_URL = 'https://call-auditor-otis4.vercel.app/api/ingest/sheet';

// Tabs to read.
//   spreadsheetId: the id in the sheet's address (docs.google.com/spreadsheets/d/<id>/edit);
//                  leave it out to use the spreadsheet this script is attached to
//   source: 'karta' or 'convozen'
//   durationUnit: unit of the call-duration column ('seconds' or 'minutes')
var SHEETS = [
  { spreadsheetId: '17fMDdhecRdmaXs5abZD3yFx2m3tQ7pneLIrWKdIbLxo', tab: 'ai_karta_logs', source: 'karta', durationUnit: 'seconds' },
  // Convozen is audited from the call RECORDING (never from the chat text). Its recording
  // links stop working about 15 minutes after the call, so this tab is synced every 5
  // minutes (syncFast) and only calls that ended in the last maxAgeMin minutes are sent.
  { spreadsheetId: '1ysTOFI3kqNTSQ2_cE6zTOhM5US4bmIUh03UpkqnDnUQ', tab: 'ai_convozen_logs', source: 'convozen', durationUnit: 'seconds', fast: true, recordingOnly: true, maxAgeMin: 12, scanRows: 800 },
];

var MIN_SECONDS = 60;       // calls shorter than this are not audited
var LIVE_ONLY = true;       // only calls made today (IST) are sent; earlier days are never audited
var MAX_ROWS_PER_RUN = 200; // calls sent per run per tab (the rest go in the next run)
var SCAN_ROWS = 30000;      // how many rows from the bottom of the tab are scanned
var CHUNK = 50;             // calls per request
var TRIGGER_MINUTES = 30;   // how often the automatic sync runs (1, 5, 10, 15 or 30)
var STATUS_HEADER = 'Otis Status';

// Sheet agent name -> the exact name of the agent in Otis (Otis > Agents). The
// Otis agent supplies the rubric and knowledge base. A name not listed here is
// used as it is; if Otis has no agent with that name the calls are audited
// without an agent (general audit).
var AGENT_MAP = {
  'Inbound Support - Tara Live': 'Inbound Support',
  'Tara_Inbound': 'Inbound Support',
  'Welcome (lead + sales)': 'Welcome Call Agent-',
  'Arjun_Groscore': 'Gro Score',
  'CCdrop_GP': 'CC Drop GP',
  'Bajaj_EMI': 'Bajaj EMI',
};

// Campaigns that are never audited (Gro Score runs on Convozen and is skipped).
function isExcluded_(agentName, agentId) {
  return /gro ?score/i.test(agentName) || /GP02/i.test(agentId);
}
// Agent id -> Otis agent, for both sheets. The id is checked first; the agent name
// (AGENT_MAP above) is the fallback for an id that is not listed. Add one line
// here for every new campaign.
var AGENT_ID_MAP = {
  '6861ZW': 'Welcome Call Agent-',              // Karta: Welcome (lead + sales)
  '6863W3': 'Inbound Support',                  // Karta: Inbound Support - Tara Live
  '6975IO': 'Bajaj EMI',                        // Karta: Bajaj_EMI
  'agent_GP01_0000049042': 'Inbound Support',   // Convozen: Tara inbound
  'agent_GP02_0000059413': 'Gro Score',         // Convozen: Gro Score (skipped)
};

// Secrets are stored in Script Properties (Project Settings), not in this file:
//   OTIS_KEY     the CRON_SECRET from Vercel
//   OTIS_BYPASS  (only if Vercel Authentication is on) the "Protection Bypass for
//                Automation" secret from Vercel > Settings > Deployment Protection

// Header names (matched ignoring case, spaces and symbols) for each field.
var ALIASES = {
  call_id: ['callid', 'callidentifier', 'uniqueid'],
  agent_name: ['agentname', 'agent', 'campaign'],
  agent_id: ['agentid'],
  recording_url: ['recordinglink', 'recordingurl', 'audiourl', 'callrecording', 'bulkrequestid'],
  transcript: ['transcripttext', 'transcript', 'chathistory'],
  summary: ['summary', 'callsummary'],
  duration: ['talktimeduration', 'callduration', 'duration', 'sessionduration'],
  call_time: ['callstarttimestamp', 'createdat', 'calldate', 'calltime', 'time'],
  call_status: ['callstatus', 'status'],
  direction: ['calldirection', 'direction'],
  to_number: ['tonumber', 'targetnumber', 'phonenumber', 'gpmobilenumber', 'mobile'],
  from_number: ['fromnumber', 'callernumber'],
  disconnect_reason: ['disconnectreason', 'disconnectedby', 'endedby'],
};
var OK_STATUS = ['ended', 'completed', 'connected', 'success', 'answered'];

// ---- Entry points ----------------------------------------------------------

/** Run this by hand once to authorise the script and test it. */
function syncNow() {
  try {
    var key = PropertiesService.getScriptProperties().getProperty('OTIS_KEY');
    if (!key) throw new Error('Add the script property OTIS_KEY (Project Settings > Script properties).');
    var summary = [];
    SHEETS.forEach(function (cfg) { if (!cfg.fast) summary.push(cfg.tab + ': ' + syncTab_(cfg, key)); });
    Logger.log(summary.join('\n'));
    if (/failed/.test(summary.join(' '))) alert_('Otis sheet sync: some calls failed', summary.join('\n'));
  } catch (e) {
    alert_('Otis sheet sync crashed', String(e && e.stack ? e.stack : e));
    throw e;
  }
}

// Emails a problem to the script owner (or to the script property ALERT_EMAIL).
// At most one email every 2 hours, so a long outage does not flood the inbox.
function alert_(subject, body) {
  try {
    var p = PropertiesService.getScriptProperties();
    var last = Number(p.getProperty('LAST_ALERT_MS') || 0);
    if (Date.now() - last < 2 * 3600 * 1000) return;
    p.setProperty('LAST_ALERT_MS', String(Date.now()));
    var to = p.getProperty('ALERT_EMAIL') || Session.getEffectiveUser().getEmail();
    MailApp.sendEmail(to, subject, body + '\n\nTime: ' + Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd HH:mm') + ' IST');
  } catch (e2) {
    Logger.log('Could not send alert: ' + e2);
  }
}

/** Every 5 minutes: syncs the tabs whose recordings expire quickly (Convozen). */
function syncFast() {
  try {
    var key = PropertiesService.getScriptProperties().getProperty('OTIS_KEY');
    if (!key) throw new Error('Add the script property OTIS_KEY (Project Settings > Script properties).');
    var summary = [];
    SHEETS.forEach(function (cfg) { if (cfg.fast) summary.push(cfg.tab + ': ' + syncTab_(cfg, key)); });
    Logger.log(summary.join('\n'));
    if (/failed/.test(summary.join(' '))) alert_('Otis fast sync: some calls failed', summary.join('\n'));
  } catch (e) {
    alert_('Otis fast sync crashed', String(e && e.stack ? e.stack : e));
    throw e;
  }
}

/** Run this once to make the sync run automatically (every TRIGGER_MINUTES). */
function installHourlyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'syncNow') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('syncNow').timeBased().everyMinutes(TRIGGER_MINUTES).create();
}

/**
 * Keeps scoring moving: asks Otis to work through batches that are not finished.
 * Run every few minutes by installTriggers(), so no outside scheduler is needed.
 */
function processNow() {
  try {
    var p = PropertiesService.getScriptProperties();
    var bypass = p.getProperty('OTIS_BYPASS');
    var res = UrlFetchApp.fetch(
      OTIS_URL.replace('/api/ingest/sheet', '/api/cron/process-batches') + '?key=' + encodeURIComponent(p.getProperty('OTIS_KEY')),
      { headers: bypass ? { 'x-vercel-protection-bypass': bypass } : {}, muteHttpExceptions: true });
    Logger.log(res.getResponseCode() + ' ' + res.getContentText().slice(0, 200));
    if (res.getResponseCode() !== 200) {
      alert_('Otis scoring is not running', 'Otis answered ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 300));
    }
  } catch (e) {
    alert_('Otis scoring crashed', String(e && e.stack ? e.stack : e));
    throw e;
  }
}

/** Emails one combined audit report for the last 3 hours (installTriggers runs it every 3 hours). */
function reportNow() {
  try {
    var p = PropertiesService.getScriptProperties();
    var bypass = p.getProperty('OTIS_BYPASS');
    var res = UrlFetchApp.fetch(
      OTIS_URL.replace('/api/ingest/sheet', '/api/cron/interval-report') + '?key=' + encodeURIComponent(p.getProperty('OTIS_KEY')),
      { headers: bypass ? { 'x-vercel-protection-bypass': bypass } : {}, muteHttpExceptions: true });
    Logger.log(res.getResponseCode() + ' ' + res.getContentText().slice(0, 600));
    if (res.getResponseCode() !== 200) alert_('Otis 3-hour report failed', 'Otis answered ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 300));
  } catch (e) {
    alert_('Otis 3-hour report crashed', String(e && e.stack ? e.stack : e));
    throw e;
  }
}

/**
 * Sends one small test email to ADDRESS and logs what the mail server answered.
 * Change ADDRESS below, then Run. Use it to find out why a mailbox gets no reports.
 */
function testEmail() {
  var ADDRESS = 'alwarquality_t@gromo.in';
  var p = PropertiesService.getScriptProperties();
  var bypass = p.getProperty('OTIS_BYPASS');
  var res = UrlFetchApp.fetch(
    OTIS_URL.replace('/api/ingest/sheet', '/api/cron/interval-report') + '?test=1&to=' + encodeURIComponent(ADDRESS) + '&key=' + encodeURIComponent(p.getProperty('OTIS_KEY')),
    { headers: bypass ? { 'x-vercel-protection-bypass': bypass } : {}, muteHttpExceptions: true });
  Logger.log(res.getResponseCode() + ' ' + res.getContentText().slice(0, 800));
}

/** Emails the once-a-day report (previous day) to Vijay, Sameer and Anjali. Runs at about 09:00 IST. */
function dailyReportNow() {
  try {
    var p = PropertiesService.getScriptProperties();
    var bypass = p.getProperty('OTIS_BYPASS');
    var res = UrlFetchApp.fetch(
      OTIS_URL.replace('/api/ingest/sheet', '/api/cron/daily-report') + '?key=' + encodeURIComponent(p.getProperty('OTIS_KEY')),
      { headers: bypass ? { 'x-vercel-protection-bypass': bypass } : {}, muteHttpExceptions: true });
    Logger.log(res.getResponseCode() + ' ' + res.getContentText().slice(0, 600));
    if (res.getResponseCode() !== 200) alert_('Otis daily report failed', 'Otis answered ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 300));
  } catch (e) {
    alert_('Otis daily report crashed', String(e && e.stack ? e.stack : e));
    throw e;
  }
}

/** Emails an alert if an audited call shows the agent sharing wrong or risky information. Every 15 minutes. */
function alertsNow() {
  try {
    var p = PropertiesService.getScriptProperties();
    var bypass = p.getProperty('OTIS_BYPASS');
    var res = UrlFetchApp.fetch(
      OTIS_URL.replace('/api/ingest/sheet', '/api/cron/alerts') + '?key=' + encodeURIComponent(p.getProperty('OTIS_KEY')),
      { headers: bypass ? { 'x-vercel-protection-bypass': bypass } : {}, muteHttpExceptions: true });
    Logger.log(res.getResponseCode() + ' ' + res.getContentText().slice(0, 200));
    if (res.getResponseCode() !== 200) alert_('Otis alert check failed', 'Otis answered ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 300));
  } catch (e) {
    alert_('Otis alert check crashed', String(e && e.stack ? e.stack : e));
    throw e;
  }
}

/**
 * One-off: audits EVERY inbound call of the Welcome campaign (agent id 6861ZW) in the
 * Karta sheet, however old, and lists them in a new tab "welcome_inbound_ids".
 * Calls Otis already has are skipped, so it is safe to run again. Run it once, wait
 * for the scoring to finish, then ask for the report.
 */
function backfillWelcomeInbound() {
  var p = PropertiesService.getScriptProperties();
  var key = p.getProperty('OTIS_KEY');
  var bypass = p.getProperty('OTIS_BYPASS');
  var cfg = SHEETS[0]; // Karta
  var book = SpreadsheetApp.openById(cfg.spreadsheetId);
  var sheet = book.getSheetByName(cfg.tab);
  var width = sheet.getLastColumn();
  var headers = sheet.getRange(1, 1, 1, width).getValues()[0];
  var idx = {};
  Object.keys(ALIASES).forEach(function (k) { idx[k] = colIndex_(headers, ALIASES[k]); });
  var n = sheet.getLastRow() - 1;
  var ids = column_(sheet, 2, n, idx.call_id);
  var agentIds = column_(sheet, 2, n, idx.agent_id);
  var dirs = column_(sheet, 2, n, idx.direction);
  var durs = column_(sheet, 2, n, idx.duration);
  var times = column_(sheet, 2, n, idx.call_time);
  var found = [];
  for (var i = 0; i < n; i++) {
    if (String(agentIds[i]).trim() === '6861ZW' && String(dirs[i]).trim().toLowerCase() === 'inbound' && String(ids[i]).trim() !== '') {
      found.push(i + 2);
    }
  }
  // List of every inbound Welcome call, for the report.
  var tab = book.getSheetByName('welcome_inbound_ids') || book.insertSheet('welcome_inbound_ids');
  tab.clear();
  var list = [['call_id', 'call_time', 'duration_sec', 'sheet_row']].concat(found.map(function (row) {
    var t = times[row - 2];
    return [String(ids[row - 2]).trim(), t instanceof Date ? Utilities.formatDate(t, 'Asia/Kolkata', 'yyyy-MM-dd HH:mm:ss') : String(t), seconds_(durs[row - 2], cfg.durationUnit), row];
  }));
  tab.getRange(1, 1, list.length, 4).setValues(list);

  // Send the ones long enough to be audited. Otis skips calls it already has.
  var send = found.filter(function (row) { var s = seconds_(durs[row - 2], cfg.durationUnit); return s === null || s >= MIN_SECONDS; });
  var label = 'Karta Welcome inbound backfill ' + Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd HH:mm');
  var audited = 0, failed = 0;
  for (var c = 0; c < send.length; c += CHUNK) {
    var part = send.slice(c, c + CHUNK);
    var payload = part.map(function (row) { return rowToPayload_(sheet.getRange(row, 1, 1, width).getValues()[0], idx, cfg); });
    var last = c + CHUNK >= send.length;
    var res = UrlFetchApp.fetch(OTIS_URL + '?key=' + encodeURIComponent(key) + '&backfill=1' + (last ? '&drive=1' : ''), {
      method: 'post', contentType: 'application/json',
      headers: bypass ? { 'x-vercel-protection-bypass': bypass } : {},
      payload: JSON.stringify({ source: 'karta', label: label, rows: payload }), muteHttpExceptions: true,
    });
    if (res.getResponseCode() !== 200) { failed += part.length; Logger.log('Otis answered ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 300)); continue; }
    audited += JSON.parse(res.getContentText()).audited || 0;
  }
  Logger.log('Welcome inbound calls found: ' + found.length + '; long enough to audit: ' + send.length + '; newly sent for audit: ' + audited + (failed ? '; failed: ' + failed : ''));
}

/** Run this once: sync every TRIGGER_MINUTES, scoring every 5 minutes, report every 3 hours. */
function installTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('syncNow').timeBased().everyMinutes(TRIGGER_MINUTES).create();
  ScriptApp.newTrigger('processNow').timeBased().everyMinutes(5).create();
  ScriptApp.newTrigger('syncFast').timeBased().everyMinutes(5).create();
  ScriptApp.newTrigger('reportNow').timeBased().everyHours(3).create();
  ScriptApp.newTrigger('alertsNow').timeBased().everyMinutes(15).create();
  ScriptApp.newTrigger('dailyReportNow').timeBased().atHour(9).nearMinute(0).inTimezone('Asia/Kolkata').everyDays(1).create();
}

// ---- Implementation --------------------------------------------------------

function norm_(s) { return String(s).toLowerCase().replace(/[^a-z0-9]/g, ''); }

function colIndex_(headers, names) {
  var normed = headers.map(norm_);
  for (var i = 0; i < names.length; i++) {
    var at = normed.indexOf(names[i]);
    if (at >= 0) return at;
  }
  return -1;
}

// Calendar day (IST, yyyy-MM-dd) of a sheet date cell, or '' when it is not a date.
function dayStr_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, 'Asia/Kolkata', 'yyyy-MM-dd');
  var m = /^(\d{4}-\d{2}-\d{2})/.exec(String(v).trim());
  return m ? m[1] : '';
}

// A sheet date/time (India time, e.g. "2026-11-13 00:02:34") as milliseconds, or null.
function istMs_(v) {
  if (v instanceof Date) return v.getTime();
  var d = new Date(String(v).trim().replace(' ', 'T') + '+05:30');
  return isNaN(d.getTime()) ? null : d.getTime();
}

function cellDate_(v) {
  if (v instanceof Date) return v;
  var d = new Date(String(v).replace(' ', 'T'));
  return isNaN(d.getTime()) ? null : d;
}

// Seconds as a number, or null when the cell is empty or not a duration.
function seconds_(v, unit) {
  if (v === '' || v === null || v === undefined || v instanceof Date) return null;
  var s = String(v).trim();
  var m = s.match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/);
  if (m) return m[3] !== undefined ? (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) : (+m[1]) * 60 + (+m[2]);
  var n = Number(s);
  if (isNaN(n)) return null;
  return Math.round(unit === 'minutes' ? n * 60 : n);
}

function column_(sheet, from, n, idx) {
  if (idx < 0) return null;
  return sheet.getRange(from, idx + 1, n, 1).getValues().map(function (r) { return r[0]; });
}

// One sheet row -> the call as Otis expects it.
function rowToPayload_(r, idx, cfg) {
  var rawAgent = idx.agent_name >= 0 ? String(r[idx.agent_name]).trim() : '';
  var agentId = idx.agent_id >= 0 ? String(r[idx.agent_id]).trim() : '';
  var agent = AGENT_ID_MAP[agentId] || (rawAgent ? (AGENT_MAP[rawAgent] || rawAgent) : '');
  var outbound = idx.direction >= 0 && String(r[idx.direction]).toLowerCase() === 'outbound';
  var mobile = '';
  if (outbound && idx.to_number >= 0) mobile = r[idx.to_number];
  else if (idx.from_number >= 0) mobile = r[idx.from_number];
  else if (idx.to_number >= 0) mobile = r[idx.to_number];
  var t = idx.call_time >= 0 ? r[idx.call_time] : '';
  var sec = idx.duration >= 0 ? seconds_(r[idx.duration], cfg.durationUnit) : null;
  return {
    call_id: String(r[idx.call_id]).trim(),
    agent_name: agent,
    recording_url: idx.recording_url >= 0 ? String(r[idx.recording_url]).trim() : '',
    transcript: (cfg.recordingOnly || idx.transcript < 0) ? '' : String(r[idx.transcript]),
    summary: (cfg.recordingOnly || idx.summary < 0) ? '' : String(r[idx.summary]),
    duration_seconds: sec,
    call_time: t instanceof Date ? Utilities.formatDate(t, 'Asia/Kolkata', "yyyy-MM-dd'T'HH:mm:ss") : String(t),
    mobile: String(mobile),
    disconnect_reason: idx.disconnect_reason >= 0 ? String(r[idx.disconnect_reason]) : '',
  };
}

function syncTab_(cfg, key) {
  var book = cfg.spreadsheetId ? SpreadsheetApp.openById(cfg.spreadsheetId) : SpreadsheetApp.getActive();
  var sheet = book.getSheetByName(cfg.tab);
  if (!sheet) return 'tab not found (skipped)';
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return 'no rows';

  var width = sheet.getLastColumn();
  var headers = sheet.getRange(1, 1, 1, width).getValues()[0];
  var lastHeader = -1;
  headers.forEach(function (h, i) { if (String(h).trim() !== '') lastHeader = i; });
  var statusCol = headers.map(function (h) { return String(h).trim(); }).indexOf(STATUS_HEADER);
  if (statusCol < 0) {
    statusCol = lastHeader + 1;
    if (statusCol + 1 > sheet.getMaxColumns()) sheet.insertColumnAfter(sheet.getMaxColumns());
    sheet.getRange(1, statusCol + 1).setValue(STATUS_HEADER);
    headers[statusCol] = STATUS_HEADER;
  }
  var idx = {};
  Object.keys(ALIASES).forEach(function (k) { idx[k] = colIndex_(headers, ALIASES[k]); });
  if (idx.call_id < 0) return 'no call id column found';

  // Read only the small columns for the whole window; the large transcript
  // and recording cells are read later, for the calls that qualify.
  var from = Math.max(2, lastRow - (cfg.scanRows || SCAN_ROWS) + 1);
  var n = lastRow - from + 1;
  var ids = column_(sheet, from, n, idx.call_id);
  var done = column_(sheet, from, n, statusCol);
  var statuses = column_(sheet, from, n, idx.call_status);
  var durations = column_(sheet, from, n, idx.duration);
  var times = column_(sheet, from, n, idx.call_time);
  var agentNames = column_(sheet, from, n, idx.agent_name);
  var agentIds = column_(sheet, from, n, idx.agent_id);
  var recs = cfg.recordingOnly ? column_(sheet, from, n, idx.recording_url) : null;
  var nowMs = Date.now();
  var today = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd');

  var pending = []; // row numbers, newest first
  for (var i = n - 1; i >= 0 && pending.length < MAX_ROWS_PER_RUN; i--) {
    if (String(done[i]).trim() !== '') continue;
    if (String(ids[i]).trim() === '') continue;
    if (statuses) {
      var st = String(statuses[i]).trim().toLowerCase();
      if (st && OK_STATUS.indexOf(st) < 0) continue;
    }
    if (isExcluded_(agentNames ? String(agentNames[i]) : '', agentIds ? String(agentIds[i]) : '')) continue;
    if (durations) {
      var sec = seconds_(durations[i], cfg.durationUnit);
      if (sec !== null && sec < MIN_SECONDS) continue;
    }
    if (times && LIVE_ONLY) {
      var cd = dayStr_(times[i]);
      if (cd && cd < today) continue;
    }
    if (cfg.recordingOnly) {
      // Audited from the recording only: needs a link, and the link must still work.
      if (!recs || !/^https?:\/\//i.test(String(recs[i]).trim())) continue;
      if (cfg.maxAgeMin) {
        var rowMs = times ? istMs_(times[i]) : null;
        if (rowMs === null || nowMs - rowMs > cfg.maxAgeMin * 60000) continue;
      }
    }
    pending.push(from + i);
  }
  if (pending.length === 0) return 'nothing new';

  var rows = pending.map(function (rowNumber) {
    var r = sheet.getRange(rowNumber, 1, 1, width).getValues()[0];
    return { rowNumber: rowNumber, payload: rowToPayload_(r, idx, cfg) };
  });

  var sent = 0, audited = 0, failed = 0;
  var label = (cfg.source === 'karta' ? 'Karta' : 'Convozen') + ' sheet ' + Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd HH:mm');
  for (var c = 0; c < rows.length; c += CHUNK) {
    var part = rows.slice(c, c + CHUNK);
    var lastChunk = c + CHUNK >= rows.length;
    var bypass = PropertiesService.getScriptProperties().getProperty('OTIS_BYPASS');
    var res = UrlFetchApp.fetch(OTIS_URL + '?key=' + encodeURIComponent(key) + (lastChunk ? '&drive=1' : ''), {
      method: 'post',
      contentType: 'application/json',
      headers: bypass ? { 'x-vercel-protection-bypass': bypass } : {},
      payload: JSON.stringify({ source: cfg.source, label: label, rows: part.map(function (p) { return p.payload; }) }),
      muteHttpExceptions: true,
    });
    if (res.getResponseCode() !== 200) {
      failed += part.length;
      Logger.log('Otis answered ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 300));
      continue;
    }
    audited += JSON.parse(res.getContentText()).audited || 0;
    var stamp = 'sent ' + Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd HH:mm');
    var a1 = part.map(function (p) { return sheet.getRange(p.rowNumber, statusCol + 1).getA1Notation(); });
    sheet.getRangeList(a1).setValue(stamp);
    sent += part.length;
  }
  return 'sent ' + sent + ' calls, ' + audited + ' audited by Otis' + (failed ? ', ' + failed + ' failed (see Executions log)' : '');
}
