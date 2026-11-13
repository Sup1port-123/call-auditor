/**
 * Otis - audit new calls from a Google Sheet automatically.
 *
 * Paste this into each sheet (Karta and Convozen): Extensions > Apps Script.
 * Then follow README.md. Every run finds calls that are long enough and not sent
 * yet, posts them to Otis (which audits them and emails the batch report with
 * the Excel attached) and writes "sent" in an "Otis Status" column so a row is
 * never sent twice.
 */

// ---- Settings -------------------------------------------------------------
var OTIS_URL = 'https://YOUR-PRODUCTION-DOMAIN.vercel.app/api/ingest/sheet'; // public production domain

// Tabs to read. The same list works in both spreadsheets: a tab that is not
// in the open spreadsheet is skipped.
//   source: 'karta' or 'convozen'
//   durationUnit: unit of the call-duration column ('seconds' or 'minutes')
var SHEETS = [
  { tab: 'ai_karta_logs', source: 'karta', durationUnit: 'seconds' },
  { tab: 'ai_convozen_logs', source: 'convozen', durationUnit: 'seconds' },
];

var MIN_SECONDS = 60;       // calls shorter than this are not audited
var LOOKBACK_DAYS = 2;      // only calls from the last N days are sent
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
};
// Used when a row has no agent name: Convozen agentId -> Otis agent.
var AGENT_ID_MAP = {
  'agent_GP01_0000049042': 'Inbound Support',
  'agent_GP02_0000059413': 'Gro Score',
};

// The secret is stored in Script Properties (Project Settings), not in this file:
//   name: OTIS_KEY   value: the CRON_SECRET from Vercel

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
  var key = PropertiesService.getScriptProperties().getProperty('OTIS_KEY');
  if (!key) throw new Error('Add the script property OTIS_KEY (Project Settings > Script properties).');
  var summary = [];
  SHEETS.forEach(function (cfg) { summary.push(cfg.tab + ': ' + syncTab_(cfg, key)); });
  Logger.log(summary.join('\n'));
}

/** Run this once to make the sync run automatically (every TRIGGER_MINUTES). */
function installHourlyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'syncNow') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('syncNow').timeBased().everyMinutes(TRIGGER_MINUTES).create();
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

function syncTab_(cfg, key) {
  var sheet = SpreadsheetApp.getActive().getSheetByName(cfg.tab);
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
  var from = Math.max(2, lastRow - SCAN_ROWS + 1);
  var n = lastRow - from + 1;
  var ids = column_(sheet, from, n, idx.call_id);
  var done = column_(sheet, from, n, statusCol);
  var statuses = column_(sheet, from, n, idx.call_status);
  var durations = column_(sheet, from, n, idx.duration);
  var times = column_(sheet, from, n, idx.call_time);
  var cutoff = new Date(Date.now() - LOOKBACK_DAYS * 86400000);

  var pending = []; // row numbers, newest first
  for (var i = n - 1; i >= 0 && pending.length < MAX_ROWS_PER_RUN; i--) {
    if (String(done[i]).trim() !== '') continue;
    if (String(ids[i]).trim() === '') continue;
    if (statuses) {
      var st = String(statuses[i]).trim().toLowerCase();
      if (st && OK_STATUS.indexOf(st) < 0) continue;
    }
    if (durations) {
      var sec = seconds_(durations[i], cfg.durationUnit);
      if (sec !== null && sec < MIN_SECONDS) continue;
    }
    if (times) {
      var d = cellDate_(times[i]);
      if (d && d < cutoff) continue;
    }
    pending.push(from + i);
  }
  if (pending.length === 0) return 'nothing new';

  var rows = pending.map(function (rowNumber) {
    var r = sheet.getRange(rowNumber, 1, 1, width).getValues()[0];
    var rawAgent = idx.agent_name >= 0 ? String(r[idx.agent_name]).trim() : '';
    var agentId = idx.agent_id >= 0 ? String(r[idx.agent_id]).trim() : '';
    var agent = rawAgent ? (AGENT_MAP[rawAgent] || rawAgent) : (AGENT_ID_MAP[agentId] || '');
    var outbound = idx.direction >= 0 && String(r[idx.direction]).toLowerCase() === 'outbound';
    var mobile = '';
    if (outbound && idx.to_number >= 0) mobile = r[idx.to_number];
    else if (idx.from_number >= 0) mobile = r[idx.from_number];
    else if (idx.to_number >= 0) mobile = r[idx.to_number];
    var t = idx.call_time >= 0 ? r[idx.call_time] : '';
    var sec2 = idx.duration >= 0 ? seconds_(r[idx.duration], cfg.durationUnit) : null;
    return {
      rowNumber: rowNumber,
      payload: {
        call_id: String(r[idx.call_id]).trim(),
        agent_name: agent,
        recording_url: idx.recording_url >= 0 ? String(r[idx.recording_url]).trim() : '',
        transcript: idx.transcript >= 0 ? String(r[idx.transcript]) : '',
        summary: idx.summary >= 0 ? String(r[idx.summary]) : '',
        duration_seconds: sec2,
        call_time: t instanceof Date ? Utilities.formatDate(t, 'Asia/Kolkata', "yyyy-MM-dd'T'HH:mm:ss") : String(t),
        mobile: String(mobile),
        disconnect_reason: idx.disconnect_reason >= 0 ? String(r[idx.disconnect_reason]) : '',
      },
    };
  });

  var sent = 0, audited = 0, failed = 0;
  var label = (cfg.source === 'karta' ? 'Karta' : 'Convozen') + ' sheet ' + Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd HH:mm');
  for (var c = 0; c < rows.length; c += CHUNK) {
    var part = rows.slice(c, c + CHUNK);
    var lastChunk = c + CHUNK >= rows.length;
    var res = UrlFetchApp.fetch(OTIS_URL + '?key=' + encodeURIComponent(key) + (lastChunk ? '&drive=1' : ''), {
      method: 'post',
      contentType: 'application/json',
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
