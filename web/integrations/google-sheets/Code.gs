/**
 * Otis - audit new calls from a Google Sheet automatically.
 *
 * Paste this into the sheet: Extensions > Apps Script. Then follow README.md.
 * Every run it finds rows not sent yet, posts them to Otis (which audits them
 * and emails the batch report with the Excel attached) and writes "sent" in an
 * "Otis Status" column so a row is never sent twice.
 */

// ---- Settings -------------------------------------------------------------
var OTIS_URL = 'https://YOUR-PRODUCTION-DOMAIN.vercel.app/api/ingest/sheet'; // public production domain
var SHEETS = [
  // tab = sheet tab name, source = 'karta' or 'convozen'
  // durationUnit = unit of the call-duration column: 'seconds' or 'minutes'
  { tab: 'ai_karta_logs', source: 'karta', durationUnit: 'seconds' },
  // { tab: 'convozen_logs', source: 'convozen', durationUnit: 'minutes' },
];
var LOOKBACK_DAYS = 2;     // only rows whose call date is within this many days are sent
var MAX_ROWS_PER_RUN = 300; // rows sent per run per tab (older unsent rows go in the next run)
var CHUNK = 50;            // rows per request
var STATUS_HEADER = 'Otis Status';
var ONLY_ENDED = true;     // skip rows whose call_status is not "ended" (when the column exists)

// The secret is stored in Script Properties (Project Settings), not in this file:
//   name: OTIS_KEY   value: the CRON_SECRET from Vercel

// Header names (matched ignoring case, spaces and symbols) for each field.
var ALIASES = {
  call_id: ['callid', 'callidentifier', 'uniqueid'],
  agent_name: ['agentname', 'agent', 'campaign'],
  recording_url: ['recordinglink', 'recordingurl', 'audiourl', 'callrecording'],
  transcript: ['transcripttext', 'transcript', 'chathistory'],
  summary: ['summary', 'callsummary'],
  duration: ['talktimeduration', 'callduration', 'duration', 'sessionduration'],
  call_time: ['callstarttimestamp', 'calldate', 'calltime', 'time', 'createdat'],
  call_status: ['callstatus', 'status'],
  direction: ['calldirection', 'direction'],
  to_number: ['tonumber', 'targetnumber', 'phonenumber', 'gpmobilenumber', 'mobile'],
  from_number: ['fromnumber', 'callernumber'],
  disconnect_reason: ['disconnectreason', 'disconnectedby', 'endedby'],
};

// ---- Entry points ----------------------------------------------------------

/** Run this by hand once to authorise the script and test it. */
function syncNow() {
  var key = PropertiesService.getScriptProperties().getProperty('OTIS_KEY');
  if (!key) throw new Error('Add the script property OTIS_KEY (Project Settings > Script properties).');
  var summary = [];
  SHEETS.forEach(function (cfg) { summary.push(cfg.tab + ': ' + syncTab_(cfg, key)); });
  Logger.log(summary.join('\n'));
}

/** Run this once to make the sync run every hour. */
function installHourlyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'syncNow') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('syncNow').timeBased().everyHours(1).create();
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

function toSeconds_(v, unit) {
  if (v === '' || v === null || v === undefined) return null;
  if (v instanceof Date) return null;
  var s = String(v).trim();
  if (/^\d+:\d{1,2}(:\d{1,2})?$/.test(s)) return s; // mm:ss, parsed by Otis
  var n = Number(s);
  if (isNaN(n)) return null;
  return unit === 'minutes' ? Math.round(n * 60) : Math.round(n);
}

function syncTab_(cfg, key) {
  var sheet = SpreadsheetApp.getActive().getSheetByName(cfg.tab);
  if (!sheet) return 'tab not found';
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 2) return 'no rows';

  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var statusCol = headers.map(function (h) { return String(h).trim(); }).indexOf(STATUS_HEADER);
  if (statusCol < 0) {
    statusCol = lastCol;
    sheet.getRange(1, statusCol + 1).setValue(STATUS_HEADER);
    lastCol += 1;
  }
  var idx = {};
  Object.keys(ALIASES).forEach(function (k) { idx[k] = colIndex_(headers, ALIASES[k]); });
  if (idx.call_id < 0) return 'no call id column found';

  // Read the newest rows first: a 26,000-row log only needs its tail.
  var scanFrom = Math.max(2, lastRow - 4000);
  var values = sheet.getRange(scanFrom, 1, lastRow - scanFrom + 1, lastCol).getValues();
  var cutoff = new Date(Date.now() - LOOKBACK_DAYS * 86400000);

  var pending = []; // {rowNumber, payload}
  for (var i = values.length - 1; i >= 0 && pending.length < MAX_ROWS_PER_RUN; i--) {
    var r = values[i];
    if (String(r[statusCol]).trim() !== '') continue;
    var callId = String(r[idx.call_id]).trim();
    if (!callId) continue;
    if (ONLY_ENDED && idx.call_status >= 0) {
      var st = String(r[idx.call_status]).trim().toLowerCase();
      if (st && st !== 'ended' && st !== 'completed') continue;
    }
    if (idx.call_time >= 0) {
      var d = cellDate_(r[idx.call_time]);
      if (d && d < cutoff) continue;
    }
    var outbound = idx.direction >= 0 && String(r[idx.direction]).toLowerCase() === 'outbound';
    var mobile = outbound ? r[idx.to_number >= 0 ? idx.to_number : 0] : r[idx.from_number >= 0 ? idx.from_number : (idx.to_number >= 0 ? idx.to_number : 0)];
    var callTime = idx.call_time >= 0 ? r[idx.call_time] : '';
    pending.push({
      rowNumber: scanFrom + i,
      payload: {
        call_id: callId,
        agent_name: idx.agent_name >= 0 ? String(r[idx.agent_name]).trim() : '',
        recording_url: idx.recording_url >= 0 ? String(r[idx.recording_url]).trim() : '',
        transcript: idx.transcript >= 0 ? String(r[idx.transcript]) : '',
        summary: idx.summary >= 0 ? String(r[idx.summary]) : '',
        duration_seconds: idx.duration >= 0 ? toSeconds_(r[idx.duration], cfg.durationUnit) : null,
        call_time: callTime instanceof Date ? Utilities.formatDate(callTime, 'Asia/Kolkata', "yyyy-MM-dd'T'HH:mm:ss") : String(callTime),
        mobile: mobile === undefined ? '' : String(mobile),
        disconnect_reason: idx.disconnect_reason >= 0 ? String(r[idx.disconnect_reason]) : '',
      },
    });
  }
  if (pending.length === 0) return 'nothing new';

  var sent = 0, audited = 0, failed = 0;
  var label = (cfg.source === 'karta' ? 'Karta' : 'Convozen') + ' sheet ' + Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd HH:mm');
  for (var c = 0; c < pending.length; c += CHUNK) {
    var part = pending.slice(c, c + CHUNK);
    var res = UrlFetchApp.fetch(OTIS_URL + '?key=' + encodeURIComponent(key), {
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
    var out = JSON.parse(res.getContentText());
    audited += out.audited || 0;
    var stamp = 'sent ' + Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd HH:mm');
    part.forEach(function (p) { sheet.getRange(p.rowNumber, statusCol + 1).setValue(stamp); });
    sent += part.length;
  }
  return 'sent ' + sent + ' rows, ' + audited + ' audited by Otis' + (failed ? ', ' + failed + ' failed (see Executions log)' : '');
}
