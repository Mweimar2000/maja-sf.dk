'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const SOURCE = fs.readFileSync(process.env.ROBOT_SOURCE || path.join(__dirname, '../sf-middelfart-robot-v8.gs'), 'utf8');
const FIXTURE = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/legacy-source-text-public.json'), 'utf8'));
const FA = 'https://dagsordener.middelfart.dk';
const clone = value => JSON.parse(JSON.stringify(value));
const withoutH = row => clone(row).filter((_, i) => i !== 7);
const enrichmentLogs = h => h.logs.filter(line => /\d+ eksisterende kildetekster udvidet/.test(line));
const SYNTHETIC_ANALYSIS = ['Synthetic summary sentinel', 'Synthetic political analysis sentinel',
  'Synthetic fact sentinel', 'Synthetic amount sentinel', 4, 'Synthetic programme match sentinel'];

// Independent, strict in-memory ingestion harness; existing test harnesses are unchanged.
// HTTP responses are saved public data. No actual network, model, mail or Drive access.
function harness(t, { pairs = FIXTURE.pairs, includeOld = true } = {}) {
  const h = { now: Date.parse('2026-09-09T11:00:00Z'), locked: false, columns: 18, rows: [], writes: [], notes: new Map(),
    props: new Map([['SPREADSHEET_ID', 'local-fixture'], ['GEMINI_API_KEY', 'unused'], ['DRAFT_FOLDER_ID', 'unused']]),
    fetches: [], logs: [], unexpected: [], beforeWrite: null, afterWrite: null, pairs: clone(pairs), catalog: clone(FIXTURE.catalog) };
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [h.now])); } static now() { return h.now; } }
  const revive = row => row.map(value => value && value.$date ? new Clock(value.$date) : value);
  h.rows.push([...FIXTURE.header, 'Erstattet af kilde-ID']);
  for (const pair of h.pairs) {
    if (includeOld) { pair.oldIndex = h.rows.length; h.rows.push([...revive(pair.oldRow), '']); }
    pair.targetIndex = h.rows.length; h.rows.push([...revive(pair.targetRow), '']);
    pair.item = pair.agenda.Dagsordenpunkter[0];
  }
  const agendas = new Map(h.pairs.map(pair => [pair.agenda.Id, pair.agenda]));
  for (const group of Object.values(h.catalog.Udvalg)) for (const committee of group) {
    committee.Moeder = committee.Moeder.filter(meeting => agendas.has(meeting.Id));
  }
  const unexpected = message => { h.unexpected.push(message); throw Error(message); };
  function range(row, column, height = 1, width = 1) {
    assert.ok(column >= 1 && column + width - 1 <= h.columns);
    const result = {
      getValues: () => Array.from({ length: height }, (_, i) => Array.from({ length: width }, (_, j) => h.rows[row + i - 1]?.[column + j - 1] ?? '')),
      setValues(values) {
        assert.ok(h.locked, 'Every write must use the existing robot lock'); assert.equal(values.length, height);
        values.forEach(value => assert.equal(value.length, width));
        const write = { row, column, height, width, values: clone(values) };
        if (h.beforeWrite) h.beforeWrite(write);
        values.forEach((value, i) => { h.rows[row + i - 1] ||= Array(h.columns).fill(''); value.forEach((cell, j) => { h.rows[row + i - 1][column + j - 1] = cell; }); });
        h.writes.push(write); if (h.afterWrite) h.afterWrite(write); return result;
      },
      setValue(value) { return result.setValues([[value]]); },
      setNote(value) { assert.ok(h.locked); h.notes.set(`${row}:${column}`, value); return result; }
    }; return result;
  }
  h.sheet = { getRange: range, getLastRow: () => h.rows.length, getMaxColumns: () => h.columns,
    getDataRange: () => range(1, 1, h.rows.length, h.columns), insertColumnsAfter: () => unexpected('Unexpected schema expansion') };
  const props = { getProperty: key => h.props.get(key) ?? null, setProperty: (key, value) => h.props.set(key, String(value)), deleteProperty: key => h.props.delete(key) };
  h.context = vm.createContext({ Date: Clock, console: { log: (...values) => h.logs.push(values.join(' ')) },
    Session: { getScriptTimeZone: () => 'Europe/Copenhagen' }, PropertiesService: { getScriptProperties: () => props },
    SpreadsheetApp: { openById: () => ({ getSheetByName: () => h.sheet }) },
    LockService: { getScriptLock: () => ({ tryLock() { if (h.locked) return false; h.locked = true; return true; }, releaseLock() { h.locked = false; } }) },
    Utilities: { DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' }, sleep: () => {},
      computeDigest: (algorithm, text) => [...crypto.createHash('sha256').update(text).digest()],
      // All fixture meeting dates are August/September 2026, UTC+02 in Copenhagen.
      parseDate: text => new Clock(text.replace(' ', 'T') + (text.length === 10 ? 'T00:00' : '') + ':00+02:00'),
      formatDate: (date, tz, format) => new Date(date.getTime() + 7200000).toISOString().slice(0, format === 'yyyy-MM-dd' ? 10 : 16).replace('T', ' ') },
    MailApp: { sendEmail: () => unexpected('Unexpected mail') }, DocumentApp: { create: () => unexpected('Unexpected document') },
    UrlFetchApp: { fetch(url) {
      h.fetches.push(url); let body;
      if (url.startsWith(`${FA}/Home/AnonymousAuthentication?`)) body = '';
      else if (url === `${FA}/api/agenda/udvalgsliste`) body = h.catalog;
      else if (url.startsWith(`${FA}/api/agenda/dagsorden/`) && agendas.has(url.split('/').pop())) body = agendas.get(url.split('/').pop());
      else return unexpected(`Unexpected source/model/PDF request: ${url}`);
      return { getResponseCode: () => 200, getContentText: () => typeof body === 'string' ? body : JSON.stringify(body), getAllHeaders: () => ({ 'Set-Cookie': 'local=fixture' }) };
    } }
  }, { codeGeneration: { strings: false, wasm: false } });
  vm.runInContext(SOURCE, h.context, { timeout: 1000 });
  h.ingest = () => h.context.ingestFromFirstAgendaApi();
  h.text = pair => h.context.extractContentFromAgendaItem_(pair.item);
  h.fingerprint = pair => {
    const row = h.rows[pair.targetIndex];
    return h.context.sourceFingerprint_([row[1], row[2], row[3], h.text(pair), pair.item.Bilag, pair.item.Felter]);
  };
  h.pending = () => {
    const excluded = h.context.sourceRowExclusions_(h.sheet.getDataRange().getValues()).all;
    return h.rows.slice(1).filter((row, i) => !excluded.has(i) && h.context.analysisScore_(row) === null).map(row => row[5]);
  };
  h.dataWrites = () => h.writes.filter(write => write.row > 1);
  t.after(() => { assert.equal(h.locked, false); assert.deepEqual(h.unexpected, []); });
  return h;
}

for (const data of FIXTURE.pairs) test(`saved public source ${data.label}: enrich H, then retire using durable full text`, t => {
  const h = harness(t, { pairs: [data] }), pair = h.pairs[0], target = h.rows[pair.targetIndex], before = clone(h.rows);
  const fullText = h.text(pair), sourceDate = h.context.sourceNewsDate_(target).toISOString();
  assert.equal(pair.httpEvidence.http, 200); assert.match(pair.httpEvidence.sha256, /^[0-9a-f]{64}$/);
  assert.equal(fullText.length, data.expectedFreshTextLength); assert.equal(target[7].length, 8000);
  assert.equal(fullText.slice(0, 8000), target[7]); assert.equal(h.fingerprint(pair), data.targetRow[16]);
  h.ingest();
  assert.equal(target[7], fullText, 'Legacy text must expand without pretending the unchanged source is new');
  assert.deepEqual(withoutH(target), withoutH(before[pair.targetIndex]), 'Only H may change on the current row');
  assert.deepEqual(clone(h.rows[pair.oldIndex].slice(0, 17)), before[pair.oldIndex].slice(0, 17));
  assert.equal(h.rows[pair.oldIndex][17], target[5]); assert.equal(h.context.sourceNewsDate_(target).toISOString(), sourceDate);
  assert.deepEqual(h.dataWrites().map(w => [w.row, w.column, w.width]), [[pair.targetIndex + 1, 8, 1], [pair.oldIndex + 1, 18, 1]]);
  assert.match(enrichmentLogs(h).join('\n'), /1 eksisterende kildetekster udvidet/);
  assert.ok(h.logs.some(line => /0 nye\/ændrede kildepunkter/.test(line)));
});

test('both real sources enrich in one ingestion, preserve analyses and remove only the two retired pending IDs', t => {
  const h = harness(t), before = clone(h.rows), pendingBefore = h.pending(); h.ingest();
  const retiredIds = h.pairs.map(pair => h.rows[pair.oldIndex][5]);
  assert.deepEqual(h.pending(), pendingBefore.filter(id => !retiredIds.includes(id)));
  for (const pair of h.pairs) assert.deepEqual(clone(h.rows[pair.targetIndex].slice(9)), before[pair.targetIndex].slice(9));
  assert.match(enrichmentLogs(h).join('\n'), /2 eksisterende kildetekster udvidet/);
  assert.ok(h.logs.some(line => /0 nye\/ændrede kildepunkter/.test(line)));
  assert.equal(h.rows.length, before.length);
});

test('repeat ingestion is idempotent: no repeated H write, retirement or enrichment count', t => {
  const h = harness(t); h.ingest(); const saved = clone(h.rows), notes = [...h.notes];
  h.writes.length = 0; h.logs.length = 0; h.ingest();
  assert.deepEqual(clone(h.rows), saved); assert.deepEqual([...h.notes], notes);
  assert.deepEqual(h.dataWrites(), []); assert.deepEqual(enrichmentLogs(h), []);
});

test('known legacy enrichment caps H at 45000 and preserves the full-source Q', t => {
  const h = harness(t, { pairs: [FIXTURE.pairs[0]] }), pair = h.pairs[0], target = h.rows[pair.targetIndex];
  pair.item.Felter.push({ Tekst: 'Yderligere kildeindhold. '.repeat(3000) }); target[16] = h.fingerprint(pair);
  const before = clone(target), fullText = h.text(pair); assert.ok(fullText.length > 45000);
  assert.ok(fullText.startsWith(target[7])); h.ingest();
  assert.equal(target[7], fullText.slice(0, 45000)); assert.equal(target[7].length, 45000);
  assert.deepEqual(withoutH(target), withoutH(before)); assert.equal(h.rows[pair.oldIndex][17], target[5]);
});

test('pure enrichment preserves a pending analysis and its historical source date', t => {
  const h = harness(t, { pairs: [FIXTURE.pairs[0]], includeOld: false }), pair = h.pairs[0], target = h.rows[pair.targetIndex];
  target.splice(9, 6, '', '', '', '', '', ''); target[15] = '2026-08-31T09:00:00.000Z';
  const before = clone(target), pending = h.pending(); h.ingest();
  assert.equal(target[7], h.text(pair)); assert.deepEqual(withoutH(target), withoutH(before)); assert.deepEqual(h.pending(), pending);
  assert.equal(h.context.analysisScore_(target), null); assert.equal(h.context.sourceNewsDate_(target).toISOString(), before[15]);
  assert.deepEqual(h.dataWrites().map(w => [w.column, w.width]), [[8, 1]]);
});

test('pure enrichment preserves all six nonempty synthetic analysis fields and stays out of the repair queue', t => {
  const h = harness(t, { pairs: [FIXTURE.pairs[0]], includeOld: false }), pair = h.pairs[0], target = h.rows[pair.targetIndex];
  target.splice(9, 6, ...SYNTHETIC_ANALYSIS);
  const before = clone(target), sourceDate = h.context.sourceNewsDate_(target).toISOString();
  assert.equal(h.context.analysisScore_(target), 4); assert.deepEqual(h.pending(), []); h.ingest();
  assert.equal(target[7], h.text(pair)); assert.deepEqual(withoutH(target), withoutH(before));
  assert.deepEqual(target.slice(9, 15), SYNTHETIC_ANALYSIS); assert.deepEqual(h.pending(), []);
  assert.equal(h.context.sourceNewsDate_(target).toISOString(), sourceDate);
  assert.deepEqual(h.dataWrites().map(w => [w.column, w.width]), [[8, 1]]);
});

test('unrelated R history, source IDs/URLs, user columns and worker properties survive enrichment', t => {
  const h = harness(t, { pairs: [FIXTURE.pairs[0]], includeOld: false }), pair = h.pairs[0];
  h.columns = 20; h.rows.forEach(row => row.push('User note', 'Keep formatting metadata'));
  const unrelated = h.rows[pair.targetIndex].slice(); unrelated[4] = 'Email'; unrelated[5] = 'unrelated-mail'; unrelated[17] = 'retained R history'; h.rows.push(unrelated);
  h.props.set('PENDING_FACTCHECK_JOB_ID', 'existing-job'); h.props.set('BASE_RETRY_DAILY_INGEST', 'existing-timer');
  const before = clone(h.rows); h.ingest();
  assert.deepEqual(withoutH(h.rows[pair.targetIndex]), withoutH(before[pair.targetIndex]));
  assert.deepEqual(clone(unrelated), before.at(-1)); assert.equal(h.props.get('PENDING_FACTCHECK_JOB_ID'), 'existing-job');
  assert.equal(h.props.get('BASE_RETRY_DAILY_INGEST'), 'existing-timer');
});

test('blank Q follows existing fingerprint baseline logic without enriching H or resetting analysis', t => {
  const h = harness(t, { pairs: [FIXTURE.pairs[0]] }), pair = h.pairs[0], target = h.rows[pair.targetIndex];
  target[16] = ''; const before = clone(target); h.ingest();
  assert.deepEqual(clone(target.slice(0, 16)), before.slice(0, 16)); assert.equal(target[16], h.fingerprint(pair));
  assert.deepEqual(h.dataWrites().map(w => [w.row, w.column, w.width]), [[pair.targetIndex + 1, 17, 1]]);
  assert.equal(h.rows[pair.oldIndex][17], ''); assert.deepEqual(enrichmentLogs(h), []);
});

test('changed full-source fingerprint still invalidates analysis even when the old 8000 characters match', t => {
  const h = harness(t, { pairs: [FIXTURE.pairs[0]] }), pair = h.pairs[0], target = h.rows[pair.targetIndex];
  target.splice(9, 6, ...SYNTHETIC_ANALYSIS); assert.equal(h.context.analysisScore_(target), 4);
  const oldQ = target[16], oldP = target[15]; pair.item.Felter.push({ Tekst: 'Ny beslutning efter den tidligere afkortning.' });
  assert.ok(h.text(pair).startsWith(target[7])); assert.notEqual(h.fingerprint(pair), oldQ); h.ingest();
  const saved = h.rows[pair.targetIndex];
  assert.equal(saved[7], h.text(pair)); assert.equal(saved[16], h.fingerprint(pair));
  assert.deepEqual(saved.slice(9, 15), ['', '', '', '', '', '']);
  assert.notEqual(saved[15], oldP); assert.equal(saved[15], new Date(h.now).toISOString());
  assert.ok(h.dataWrites().some(w => w.column === 1 && w.width === 17));
  assert.ok(h.logs.some(line => /1 nye\/ændrede kildepunkter/.test(line))); assert.deepEqual(enrichmentLogs(h), []);
});

for (const position of [0, 7999]) test(`non-prefix/user text at position ${position} is preserved despite matching Q and length 8000`, t => {
  const h = harness(t, { pairs: [FIXTURE.pairs[0]], includeOld: false }), pair = h.pairs[0], target = h.rows[pair.targetIndex];
  target[7] = target[7].slice(0, position) + 'Ω' + target[7].slice(position + 1);
  const before = clone(h.rows); h.ingest();
  assert.deepEqual(clone(h.rows), before); assert.deepEqual(h.dataWrites(), []); assert.deepEqual(enrichmentLogs(h), []);
});

for (const length of [0, 7999, 8001]) test(`matching-Q prefix of length ${length} is not the known legacy truncation`, t => {
  const h = harness(t, { pairs: [FIXTURE.pairs[0]], includeOld: false }), pair = h.pairs[0];
  h.rows[pair.targetIndex][7] = h.text(pair).slice(0, length); const before = clone(h.rows); h.ingest();
  assert.deepEqual(clone(h.rows), before); assert.deepEqual(h.dataWrites(), []); assert.deepEqual(enrichmentLogs(h), []);
});

test('a complete source of exactly 8000 characters is not counted as enrichment', t => {
  const h = harness(t, { pairs: [FIXTURE.pairs[0]], includeOld: false }), pair = h.pairs[0], target = h.rows[pair.targetIndex];
  pair.item.Bilag = []; pair.item.Felter = [{ Tekst: 'x' }];
  pair.item.Felter[0].Tekst = 'x'.repeat(8000 - (h.text(pair).length - 1));
  target[7] = h.text(pair); target[8] = ''; target[16] = h.fingerprint(pair); assert.equal(target[7].length, 8000);
  const before = clone(h.rows); h.ingest();
  assert.deepEqual(clone(h.rows), before); assert.deepEqual(h.dataWrites(), []); assert.deepEqual(enrichmentLogs(h), []);
});

test('H write failure preserves original data and blocks retirement; later ingestion retries safely', t => {
  const h = harness(t, { pairs: [FIXTURE.pairs[0]] }), pair = h.pairs[0], before = clone(h.rows);
  h.beforeWrite = w => { if (w.column === 8) throw Error('H write failed'); };
  assert.throws(h.ingest, /H write failed/); assert.deepEqual(clone(h.rows), before); assert.equal(h.notes.size, 0);
  h.beforeWrite = null; h.ingest();
  assert.equal(h.rows[pair.targetIndex][7], h.text(pair)); assert.equal(h.rows[pair.oldIndex][17], h.rows[pair.targetIndex][5]);
  assert.deepEqual(withoutH(h.rows[pair.targetIndex]), withoutH(before[pair.targetIndex]));
});

test('retirement requires H to be durable, not merely changed in the ingestion cache', t => {
  const h = harness(t, { pairs: [FIXTURE.pairs[0]] }), pair = h.pairs[0], oldH = h.rows[pair.targetIndex][7];
  h.afterWrite = w => { if (w.column === 8) h.rows[pair.targetIndex][7] = oldH; };
  h.ingest(); assert.equal(h.rows[pair.oldIndex][17], ''); assert.equal(h.notes.size, 0);
  h.afterWrite = null; h.ingest(); assert.equal(h.rows[pair.oldIndex][17], h.rows[pair.targetIndex][5]);
});

test('interruption after durable H write resumes retirement without another H write or analysis reset', t => {
  const h = harness(t, { pairs: [FIXTURE.pairs[0]] }), pair = h.pairs[0], before = clone(h.rows[pair.targetIndex]);
  h.afterWrite = w => { if (w.column === 8) throw Error('execution terminated'); };
  assert.throws(h.ingest, /execution terminated/); assert.equal(h.rows[pair.oldIndex][17], '');
  assert.equal(h.rows[pair.targetIndex][7], h.text(pair)); assert.deepEqual(withoutH(h.rows[pair.targetIndex]), withoutH(before));
  h.afterWrite = null; h.writes.length = 0; h.logs.length = 0; h.ingest();
  assert.equal(h.rows[pair.oldIndex][17], h.rows[pair.targetIndex][5]);
  assert.deepEqual(h.dataWrites().map(w => w.column), [18]); assert.deepEqual(enrichmentLogs(h), []);
});
