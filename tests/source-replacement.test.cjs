'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const SOURCE = fs.readFileSync(process.env.ROBOT_SOURCE || path.join(__dirname, '../sf-middelfart-robot-v8.gs'), 'utf8');
const FA = 'https://dagsordener.middelfart.dk';
const HEADER = 'Erstattet af kilde-ID';
const GROUPS = ['Byrådet og politiske udvalg', 'Byrådet og politiske udvalg - Historisk', 'Budget'];
const OLD_MEETING = '3f9e8c35-98b2-43a7-918c-9a230edad517';
const OLD_POINT = '90d23fe6-0683-4341-a623-3f136bc4e547';
const NEW_MEETING = '0297a497-000a-429c-a7d5-00e803399c51';
const NEW_POINT = 'e9a4584b-8bf3-49e6-8cc6-d10bbe6e0e5f';
const COMMITTEE = '2f38f175-4dc7-4796-8cf6-406b17b50efa';
const OLD_ID = `FA:${OLD_MEETING}:${OLD_POINT}`, NEW_ID = `FA:${NEW_MEETING}:${NEW_POINT}`;
const TITLE = '1. behandling af budget 2027-2030';
const DATE = '2026-09-08T15:30:00+02:00';
const guid = n => `11111111-2222-4333-8444-${String(n).padStart(12, '0')}`;
const link = id => { const [, meeting, point] = id.split(':'); return `${FA}/vis?id=${meeting}&punktid=${point}`; };
// Actual 1059/1119 identifiers and the observed 23→21 name difference.
const NAMES = ['Hovedoversigt  - Direktionens budgetforslag til 1. behandling', 'Bevillingsoversigt - Direktionens budgetforslag til 1. behandling',
  'ØKU - Budgetdokument Politisk organisation', 'ØKU - Budgetdokument Administration', 'ØKU - Budgetdokument Erhverv og Turisme',
  'ØKU - Budgetdokument Fælles funktioner', 'ØKU - Budgetdokument Beredskabssamarbejdet', 'ØKU - Budgetdokument Jordforsyning',
  'BAU - Budgetdokument Beskæftigelsesindsats', 'SKU - Budgetdokument Undervisning', 'BKF - Budgetdokument Kultur og Fritid',
  'BKF - Budgetdokument Børn, Familie og Sundhed', 'BKF - Budgetdokument Dagtilbud', 'SSU - Budgetdokument Senior og Sundhed',
  'SSU - Budgetdokument Social og Psykiatri', 'SSU - Budgetdokument Kvalitet og Sammenhæng', 'TEU - Budgetdokument Vej, Trafik og Rekreative områder',
  'TEU - Budgetdokument Bygningsvedligehold og Byudvikling', 'KNG - Budgetdokument Natur og Miljø', 'KNG - Budgetdokument Klima og Energi', 'KNG - Budgetdokument Anden Forsyning'];
const OLD_NAMES = [...NAMES.slice(0, 2), 'Samlet Høringssvar', 'Indkomne høringssvar efter tidsfrist', ...NAMES.slice(2)];
const GOOD = { ok: true, tldr: 'Budgetforslaget foreligger til behandling.', sfAnalysis: 'Politisk vurdering.', facts: 'Budgetforslag 2027-2030.', amounts: '', score: 4, programMatch: '' };

function fixture() {
  const meeting = { Id: NEW_MEETING, Dato: DATE, ReleasedDate: '2026-09-08T12:58:11+02:00', Afsluttet: false, IsSupplementaryAgenda: false };
  const item = { Id: NEW_POINT, AgendaUid: NEW_MEETING, IsOpen: true, Number: '122', Punktnummer: '122',
    CaseNumber: '2026-000962', SagsNummer: '2026-000962', Caption: TITLE, Navn: TITLE,
    Felter: [{ Html: '<h3>Forvaltningen indstiller</h3><p>Budgetforslaget fremsendes til behandling i Byrådet.</p>' }],
    Bilag: NAMES.map((Navn, n) => ({ Id: guid(100 + n), Navn, HarPdfVersion: 'true' })) };
  const catalog = { Udvalg: {
    [GROUPS[0]]: [{ Id: COMMITTEE, Navn: 'Økonomiudvalget', Moeder: [meeting] }],
    [GROUPS[1]]: [{ Id: guid(1), Navn: 'Tidligere udvalg', Moeder: [] }],
    [GROUPS[2]]: [{ Id: guid(2), Navn: 'Budgetarkiv', Moeder: [] }]
  } };
  const agenda = { Id: NEW_MEETING, Udvalg: { Id: COMMITTEE, Navn: 'Økonomiudvalget' },
    Moede: { ...meeting, Id: '00000000-0000-0000-0000-000000000000' }, TillaegsDagsorden: false, Dagsordenpunkter: [item] };
  return { catalog, agenda, meeting, item };
}

function harness(t) {
  const f = fixture();
  const h = { ...f, rows: [Array(17).fill('')], columns: 17, notes: new Map(), writes: [], fetches: [], logs: [], loaded: [], models: [], unexpected: [],
    now: Date.parse('2026-09-09T10:00:00Z'), locked: false, beforeWrite: null, afterWrite: null,
    catalogCode: 200, agendaCode: 200, messages: [], agendas: new Map(), beforeFetch: null,
    props: new Map([['SPREADSHEET_ID', 'fake-sheet'], ['GEMINI_API_KEY', 'fake-key'], ['DRAFT_FOLDER_ID', 'fake-folder'], ['INBOX_LABEL', 'fake-label']]) };
  h.agendas.set(NEW_MEETING, h.agenda);
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [h.now])); } static now() { return h.now; } }
  function range(row, column, height = 1, width = 1) {
    assert.ok(column + width - 1 <= h.columns, 'Range must fit physical columns');
    const r = {
      getValues: () => Array.from({ length: height }, (_, i) => Array.from({ length: width }, (_, j) => h.rows[row + i - 1]?.[column + j - 1] ?? '')),
      setValues(values) {
        assert.ok(h.locked, 'Writes must use robot lock');
        assert.equal(values.length, height); values.forEach(v => assert.equal(v.length, width));
        const write = { row, column, values: structuredClone(values) };
        if (h.beforeWrite) h.beforeWrite(write);
        values.forEach((v, i) => { if (!h.rows[row + i - 1]) h.rows[row + i - 1] = Array(h.columns).fill('');
          v.forEach((cell, j) => { h.rows[row + i - 1][column + j - 1] = cell; }); });
        h.writes.push(write); if (h.afterWrite) h.afterWrite(write); return r;
      },
      setValue(value) { return r.setValues([[value]]); },
      setNote(note) { assert.ok(h.locked); h.notes.set(`${row}:${column}`, note); return r; }
    }; return r;
  }
  h.sheet = { getLastRow: () => h.rows.length, getMaxColumns: () => h.columns, getRange: range,
    getDataRange: () => range(1, 1, h.rows.length, h.columns), insertColumnsAfter(after, count) { assert.ok(h.locked); assert.equal(after, h.columns); h.columns += count; } };
  const props = { getProperty: key => h.props.get(key) ?? null, setProperty: (key, value) => h.props.set(key, String(value)), deleteProperty: key => h.props.delete(key) };
  const unexpected = message => { h.unexpected.push(message); throw new Error(message); };
  const context = vm.createContext({ Date: Clock, console: { log: (...args) => h.logs.push(args.join(' ')) },
    Session: { getScriptTimeZone: () => 'Europe/Copenhagen', getEffectiveUser: () => ({ getEmail: () => 'fake@example.invalid' }) },
    PropertiesService: { getScriptProperties: () => props },
    SpreadsheetApp: { openById: () => ({ getSheetByName: () => h.sheet }) },
    LockService: { getScriptLock: () => ({ tryLock() { if (h.locked) return false; h.locked = true; return true; }, releaseLock() { h.locked = false; } }) },
    Utilities: { DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' }, sleep: () => {},
      computeDigest: (algorithm, text) => [...crypto.createHash('sha256').update(text).digest()],
      // Fixtures are in September, when Copenhagen is UTC+02.
      parseDate: text => new Clock(text.replace(' ', 'T') + (text.length === 10 ? 'T00:00' : '') + ':00+02:00'),
      formatDate: (date, tz, format) => new Date(date.getTime() + 7200000).toISOString().slice(0, format === 'yyyy-MM-dd' ? 10 : 16).replace('T', ' ') },
    GmailApp: { getUserLabelByName: () => ({ getThreads: () => h.messages.length ? [{ getMessages: () => h.messages }] : [] }) },
    MailApp: { sendEmail: () => unexpected('Unexpected mail') }, DocumentApp: { create: () => unexpected('Unexpected document') },
    UrlFetchApp: { fetch(url) {
      h.fetches.push(url); if (h.beforeFetch) h.beforeFetch(url);
      let code = 200, body = '';
      if (url.startsWith(`${FA}/Home/AnonymousAuthentication?`)) {}
      else if (url === `${FA}/api/agenda/udvalgsliste`) { body = h.catalog; code = h.catalogCode; }
      else if (url.startsWith(`${FA}/api/agenda/dagsorden/`)) { const id = url.split('/').pop(); body = h.agendas.get(id) ?? { Dagsordenpunkter: [] }; code = h.agendaCode; }
      else return unexpected(`Unexpected network/model/PDF: ${url}`);
      return { getResponseCode: () => code, getContentText: () => typeof body === 'string' ? body : JSON.stringify(body), getAllHeaders: () => ({ 'Set-Cookie': 'fake=anonymous' }) };
    } }
  }, { codeGeneration: { strings: false, wasm: false } });
  vm.runInContext(SOURCE, context, { timeout: 1000 }); h.context = context;
  h.lockedRun = (name, ...args) => context.withRobotLock_(() => context[name](...args));
  h.ingest = () => context.ingestFromFirstAgendaApi();
  h.excluded = () => [...context.sourceRowExclusions_(h.sheet.getDataRange().getValues()).all];
  h.seed = ({ oldAnalysis = false, current = true, replacement = false } = {}) => {
    const newText = context.extractContentFromAgendaItem_(h.item);
    const newRow = ['2026-09-08 15:30', 'Dagsorden', 'Økonomiudvalget', TITLE, 'FirstAgenda API', NEW_ID, link(NEW_ID), newText, NAMES.join('; '),
      GOOD.tldr, GOOD.sfAnalysis, GOOD.facts, GOOD.amounts, 4, GOOD.programMatch, '2026-09-08T10:58:11.000Z',
      context.sourceFingerprint_(['Dagsorden', 'Økonomiudvalget', TITLE, newText, h.item.Bilag, h.item.Felter])];
    const old = newRow.slice(); old[5] = OLD_ID; old[6] = link(OLD_ID); old[7] = newText.replace(NAMES.join(', '), OLD_NAMES.join(', ')); old[8] = OLD_NAMES.join('; ');
    old[15] = ''; old[16] = 'retained-original-fingerprint'; if (!oldAnalysis) for (let i = 9; i < 15; i++) old[i] = '';
    h.rows.push(old); if (current) h.rows.push(newRow);
    if (replacement) { h.columns = 18; h.rows[0][17] = HEADER; old[17] = NEW_ID; }
    return { old, newRow };
  };
  h.stubAnalyses = () => {
    context.loadAnalysisSource_ = row => { h.loaded.push(row[5]); return { subject: row[3], id: row[5] }; };
    context.analyzeWithGemini_ = (key, data) => { h.models.push(data.id); return GOOD; };
  };
  t.after(() => { assert.deepEqual(h.unexpected, []); assert.equal(h.locked, false); });
  return h;
}

test('actual 1059 replacement retires only R, preserves 23 versus 21 attachments and existing analysis', t => {
  const h = harness(t); h.seed(); const before = structuredClone(h.rows.slice(1));
  h.ingest();
  assert.equal(h.rows[1][17], NEW_ID); assert.deepEqual(h.rows[1].slice(0, 17), before[0]); assert.deepEqual(h.rows[2].slice(0, 17), before[1]);
  assert.equal(h.rows.length, 3); assert.deepEqual(h.excluded(), [0]);
  const note = h.notes.get('2:18');
  for (const text of ['23 → 21', 'Samlet Høringssvar', 'Indkomne høringssvar efter tidsfrist', link(OLD_ID), link(NEW_ID)]) assert.ok(note.includes(text), text);
  assert.ok(h.writes.every(w => w.row === 1 || w.column === 18));
  assert.ok(h.logs.some(line => /0 nye\/ændrede/.test(line)));
  assert.ok(h.logs.some(line => /1 kilder erstattet/.test(line)));
  assert.ok(!h.fetches.some(url => url.includes(OLD_MEETING)), 'Old HTTP 500 is not needed as evidence');
});

test('new target is stored before R; a repeat retains values and retirement history', t => {
  const h = harness(t); h.seed({ current: false }); h.ingest();
  assert.equal(h.rows[1][17], NEW_ID); assert.equal(h.rows[2][5], NEW_ID); assert.equal(h.rows[2][9], '');
  assert.ok(h.writes.findIndex(w => w.row === 3 && w.column === 1) < h.writes.findIndex(w => w.row === 2 && w.column === 18));
  const saved = structuredClone(h.rows), note = h.notes.get('2:18'); h.writes.length = 0; h.ingest();
  assert.deepEqual(h.rows, saved); assert.equal(h.notes.get('2:18'), note); assert.ok(h.writes.every(w => w.row === 1));
});

const badCatalogs = {
  'missing required group': c => { delete c.Udvalg[GROUPS[1]]; },
  'empty required group': c => { c.Udvalg[GROUPS[1]] = []; },
  'missing meetings array': c => { delete c.Udvalg[GROUPS[1]][0].Moeder; },
  'non-array meetings': c => { c.Udvalg[GROUPS[1]][0].Moeder = {}; },
  'invalid meeting date': c => { c.Udvalg[GROUPS[0]][0].Moeder[0].Dato = 'not-a-date'; },
  'missing meeting type': c => { delete c.Udvalg[GROUPS[0]][0].Moeder[0].Afsluttet; },
  'duplicate committee ID': c => { c.Udvalg[GROUPS[1]][0].Id = COMMITTEE; },
  'pagination or partial flag': c => { c.nextPage = 'next'; },
  'duplicate meeting ID': c => { c.Udvalg[GROUPS[1]][0].Moeder = [structuredClone(c.Udvalg[GROUPS[0]][0].Moeder[0])]; }
};
for (const [name, change] of Object.entries(badCatalogs)) test(`no retirement from catalog: ${name}`, t => {
  const h = harness(t); h.seed(); const before = h.rows[1].slice(); change(h.catalog);
  try { h.ingest(); } catch (error) { assert.match(error.message, /iterable|date|Dato|Invalid|time/i); }
  assert.equal(h.rows[1][17] || '', ''); assert.deepEqual(h.rows[1].slice(0, 17), before);
});

for (const [name, change] of Object.entries({
  'different committee': r => { r[2] = 'Byrådet'; },
  'different meeting date': r => { r[0] = '2026-09-07 15:30'; },
  'different time on same date': r => { r[0] = '2026-09-08 17:00'; },
  'different title': r => { r[3] += ' (anden sag)'; },
  'different case': r => { r[7] = r[7].replace('2026-000962', '2026-000963'); },
  'different point': r => { r[7] = r[7].replace('PUNKT 122:', 'PUNKT 123:'); },
  'missing case': r => { r[7] = r[7].replace(/Sagsnr:[^\n]+/, 'Sagsnr:'); },
  'different source type': r => { r[1] = 'Referat'; },
  'mail instead of API': r => { r[4] = 'other@example.invalid'; }
})) test(`strict replacement identity: ${name}`, t => {
  const h = harness(t); h.seed(); change(h.rows[1]); h.ingest(); assert.equal(h.rows[1][17] || '', '');
});

test('same-type referat replacement also works without changing stage', t => {
  const h = harness(t); h.meeting.Afsluttet = true; h.agenda.Moede.Afsluttet = true; h.seed(); h.rows[1][1] = 'Referat';
  h.ingest(); assert.equal(h.rows[1][17], NEW_ID); assert.equal(h.rows[1][1], 'Referat'); assert.equal(h.rows[2][1], 'Referat');
});

test('old meeting still listed is not retired even when its endpoint returns no point', t => {
  const h = harness(t); h.seed(); h.catalog.Udvalg[GROUPS[0]][0].Moeder.push({ ...h.meeting, Id: OLD_MEETING });
  h.ingest(); assert.equal(h.rows[1][17] || '', '');
});

test('another current meeting at the same time prevents choosing an arbitrary replacement', t => {
  const h = harness(t); h.seed(); h.catalog.Udvalg[GROUPS[0]][0].Moeder.push({ ...h.meeting, Id: guid(10) });
  h.ingest(); assert.equal(h.rows[1][17] || '', '');
});

test('ambiguous matching open points or duplicate stored target IDs cannot retire old data', t => {
  for (const duplicate of ['point', 'stored']) {
    const h = harness(t); h.seed();
    if (duplicate === 'point') h.agenda.Dagsordenpunkter.push({ ...structuredClone(h.item), Id: guid(20) });
    else h.rows.push(h.rows[2].slice());
    h.ingest(); assert.equal(h.rows[1][17] || '', '', duplicate);
  }
});

for (const [name, change] of Object.entries({
  'catalog HTTP 500': h => { h.catalogCode = 500; },
  'agenda HTTP 500': h => { h.agendaCode = 500; },
  'invalid agenda JSON': h => { h.agendas.set(NEW_MEETING, '{'); },
  'missing points array': h => { delete h.agenda.Dagsordenpunkter; },
  'closed point': h => { h.item.IsOpen = false; },
  'wrong item agenda UID': h => { h.item.AgendaUid = OLD_MEETING; },
  'wrong response committee': h => { h.agenda.Udvalg.Id = guid(30); },
  'wrong response time': h => { h.agenda.Moede.Dato = '2026-09-08T17:00:00+02:00'; },
  'partial points response': h => { h.agenda.nextPage = 'more'; },
  'supplementary agenda': h => { h.agenda.TillaegsDagsorden = true; },
  'inconsistent case aliases': h => { h.item.SagsNummer = '2026-000999'; }
})) test(`fresh positive source required: ${name}`, t => {
  const h = harness(t); h.seed(); change(h);
  if (h.catalogCode !== 200) assert.throws(h.ingest, /HTTP 500/); else h.ingest();
  assert.equal(h.rows[1][17] || '', '');
});

test('partial open-point fields or attachment entries cannot attest a complete fresh point', t => {
  for (const change of [
    h => { delete h.item.Felter; },
    h => { h.item.Felter = [{}]; },
    h => { h.item.Bilag[0] = {}; },
    h => { h.item.Bilag[0].Id = 'not-a-guid'; },
    h => { const duplicate = structuredClone(h.item); duplicate.Id = guid(60); delete duplicate.Bilag; h.agenda.Dagsordenpunkter.push(duplicate); }
  ]) {
    const h = harness(t); h.seed(); change(h); h.ingest(); assert.equal(h.rows[1][17] || '', '');
  }
});

test('ambiguous committee names do not identify the original committee', t => {
  const h = harness(t); h.seed(); h.catalog.Udvalg[GROUPS[1]][0].Navn = 'Økonomiudvalget';
  h.ingest(); assert.equal(h.rows[1][17] || '', '');
});

test('fresh receipt cannot retire an unstored target or a target whose Q/content write is not durable', t => {
  for (const damage of ['Q', 'content', 'missing']) {
    const h = harness(t); h.seed({ current: false });
    h.afterWrite = w => { if (w.row === 3 && w.column === 1) {
      if (damage === 'Q') h.rows[2][16] = 'different-version';
      if (damage === 'content') h.rows[2][7] = 'Partial write';
      if (damage === 'missing') h.rows.pop();
    } };
    h.ingest(); assert.equal(h.rows[1][17] || '', '', damage);
  }
});

test('interruption at target write and between saved target and R is recoverable', t => {
  for (const boundary of ['target', 'R']) {
    const h = harness(t); h.seed({ current: false });
    h.beforeWrite = w => { if ((boundary === 'target' && w.row === 3 && w.column === 1) || (boundary === 'R' && w.row === 2 && w.column === 18)) throw Error('terminated'); };
    assert.throws(h.ingest, /terminated/); assert.equal(h.rows[1][17] || '', '');
    h.beforeWrite = null; h.ingest(); assert.equal(h.rows[1][17], NEW_ID); assert.equal(h.rows.length, 3);
  }
});

test('full catalog alone and a stored cache are insufficient when the target was not fetched this run', t => {
  const h = harness(t); h.seed(); h.context.timeFor_ = () => false; h.ingest();
  assert.equal(h.rows[1][17] || '', ''); assert.ok(!h.fetches.some(url => url.includes('/dagsorden/')));
});

test('a completed positive target survives an interrupted later scan without treating the scan as the catalog', t => {
  const h = harness(t); h.seed();
  h.catalog.Udvalg[GROUPS[0]][0].Moeder.push({ ...h.meeting, Id: guid(40), Dato: '2026-09-07T15:30:00+02:00', ReleasedDate: '2026-09-07T15:30:00+02:00' });
  h.beforeFetch = url => { if (url.endsWith('/' + NEW_MEETING)) h.context.timeFor_ = () => false; };
  h.ingest(); assert.equal(h.rows[1][17], NEW_ID); assert.ok(!h.fetches.some(url => url.endsWith('/' + guid(40))));
});

test('R header ownership prevents interpreting or overwriting foreign values', t => {
  for (const header of ['Personal notes', '']) {
    const h = harness(t); h.seed({ replacement: true }); h.rows[0][17] = header;
    const before = structuredClone(h.rows); assert.deepEqual(h.excluded(), []);
    assert.throws(h.ingest, /Kolonne.*[Rr]|layout/); assert.deepEqual(h.rows, before); assert.equal(h.writes.length, 0);
  }
});

test('15/17-column legacy sheets migrate; extra user columns and source metadata survive', t => {
  for (const columns of [15, 17, 20]) {
    const h = harness(t); h.seed(); h.columns = columns; h.rows = h.rows.map(r => r.slice(0, columns));
    if (columns === 20) { h.rows[0][19] = 'Personal'; h.rows[1][19] = 'keep'; }
    const before = h.rows[1].slice(0, columns === 15 ? 15 : 17); h.ingest();
    assert.ok(h.columns >= 18); assert.equal(h.rows[0][17], HEADER); assert.equal(h.rows[1][17], NEW_ID);
    assert.deepEqual(h.rows[1].slice(0, before.length), before);
    if (columns === 20) assert.equal(h.rows[1][19], 'keep');
  }
});

test('chains retire history, while cycles, missing or ambiguous targets and wrong keys fail open', t => {
  const h = harness(t); h.seed({ replacement: true });
  const c = h.rows[2].slice(); c[5] = `FA:${guid(50)}:${guid(51)}`; c[6] = link(c[5]); h.rows[2][17] = c[5]; h.rows.push(c);
  assert.deepEqual(h.excluded(), [0, 1]);
  c[17] = OLD_ID; assert.deepEqual(h.excluded(), []); c[17] = '';
  h.rows.pop(); assert.deepEqual(h.excluded(), []); h.rows.push(c);
  h.rows.push(c.slice()); assert.deepEqual(h.excluded(), []); h.rows.pop();
  c[7] = c[7].replace('PUNKT 122:', 'PUNKT 999:'); assert.deepEqual(h.excluded(), []);
});

test('self-reference and same-meeting point substitution are not replacements', t => {
  const h = harness(t); h.seed({ replacement: true }); h.rows[1][17] = OLD_ID; assert.deepEqual(h.excluded(), []);
  h.rows[2][5] = `FA:${OLD_MEETING}:${NEW_POINT}`; h.rows[1][17] = h.rows[2][5]; assert.deepEqual(h.excluded(), []);
});

test('GUID letter case cannot make the same meeting appear absent or different', t => {
  const h = harness(t); h.seed({ current: false });
  h.rows[1][5] = `FA:${NEW_MEETING}:${OLD_POINT}`; h.rows[1][6] = link(h.rows[1][5]);
  const upper = NEW_MEETING.toUpperCase(); h.meeting.Id = upper; h.item.AgendaUid = upper; h.agenda.Id = upper;
  h.agendas.delete(NEW_MEETING); h.agendas.set(upper, h.agenda);
  h.ingest(); assert.equal(h.rows[1][17] || '', '');
});

test('case variants of one stored target ID remain ambiguous', t => {
  const h = harness(t); h.seed({ replacement: true });
  const duplicate = h.rows[2].slice(); duplicate[5] = NEW_ID.toUpperCase(); h.rows.push(duplicate);
  assert.deepEqual(h.excluded(), []);
});

test('returned old meeting restores R even if point retrieval fails; catalog failure does not restore', t => {
  const h = harness(t); h.seed({ replacement: true }); h.catalogCode = 500;
  assert.throws(h.ingest, /HTTP 500/); assert.equal(h.rows[1][17], NEW_ID);
  h.catalogCode = 200; h.agendaCode = 500; h.catalog.Udvalg[GROUPS[0]][0].Moeder.push({ ...h.meeting, Id: OLD_MEETING });
  const before = h.rows[1].slice(0, 17); h.ingest(); assert.equal(h.rows[1][17], ''); assert.deepEqual(h.rows[1].slice(0, 17), before);
});

test('pending and diagnostics count retirement separately from successful analysis', t => {
  const h = harness(t); h.seed({ replacement: true }); h.stubAnalyses();
  assert.equal(h.lockedRun('analyzePendingRows_', h.sheet, 0), 0); assert.deepEqual(h.loaded, []); assert.deepEqual(h.models, []);
  h.context.debugDiagnoseSheet(); const logs = h.logs.join('\n');
  assert.match(logs, /0 repareret/); assert.match(logs, /Erstattet af ny kilde-ID: 1/); assert.match(logs, /Rigtigt analyseret:\s+1/);
  assert.ok(logs.includes(link(OLD_ID))); assert.ok(logs.includes(link(NEW_ID)));
});

test('manual reanalysis skips retired rows before formalia and source fetch', t => {
  const h = harness(t); h.seed({ replacement: true }); h.stubAnalyses();
  const before = h.rows[1].slice(); h.context.reanalyzeAllRows();
  assert.deepEqual(h.loaded, [NEW_ID]); assert.deepEqual(h.rows[1], before); assert.equal(h.props.has('REANALYZE_PROGRESS'), false);
});

test('range analysis sees an R target outside its range and reads complete source metadata', t => {
  const h = harness(t); h.seed({ replacement: true }); h.stubAnalyses();
  h.lockedRun('analyzeNewRows_', h.sheet, 2, 1); assert.deepEqual(h.loaded, []);
  h.lockedRun('analyzeNewRows_', h.sheet, 3, 1); assert.deepEqual(h.loaded, [NEW_ID]);
});

test('weekly selection excludes retired scored rows before writer input', t => {
  const h = harness(t); h.seed({ replacement: true, oldAnalysis: true }); let selected;
  h.context.generateNewsletterWithGemini_ = (key, data) => { selected = data; throw Error('writer boundary'); };
  assert.throws(() => h.lockedRun('generateWeeklyDraftLocked_', { sendNotification: false }), /writer boundary/);
  assert.deepEqual(Array.from(selected.topStories, s => s.sourceId), [NEW_ID]); assert.equal(h.rows[1][17], NEW_ID);
});

test('mail append leaves existing R/history and source-specific metadata intact', t => {
  const h = harness(t); h.seed({ replacement: true }); const before = structuredClone(h.rows.slice(1));
  h.messages.push({ getId: () => 'new-mail', getSubject: () => 'Lokal orientering', getFrom: () => 'fixture@example.invalid',
    getDate: () => new Date(DATE), getPlainBody: () => 'En lokal orientering.', getAttachments: () => [] });
  h.context.ingestInboxEmails(); assert.deepEqual(h.rows.slice(1, 3), before); assert.equal(h.rows[3][5], 'new-mail'); assert.equal(h.rows[3][17] || '', '');
});

test('replacing minutes keeps their predecessor agenda out of the writer and analysis queue', t => {
  const h = harness(t); h.meeting.Afsluttet = true; h.agenda.Moede.Afsluttet = true;
  h.seed({ current: false, oldAnalysis: true }); h.rows[1][1] = 'Referat';
  const agenda = h.rows[1].slice(); agenda[1] = 'Dagsorden';
  agenda[5] = `FA:${guid(61)}:${guid(62)}`; agenda[6] = link(agenda[5]); h.rows.push(agenda);
  const before = structuredClone(h.rows.slice(1));
  assert.deepEqual(h.excluded(), [1]); h.ingest();
  assert.equal(h.rows[1][17], NEW_ID);
  assert.deepEqual(h.rows[1].slice(0,17), before[0]); assert.deepEqual(h.rows[2].slice(0,17), before[1]);
  assert.deepEqual(h.excluded().sort((a,b) => a-b), [0,1]);
  // Supply a valid recorded analysis for the current source at the writer boundary.
  h.rows[3].splice(9,6,...before[0].slice(9,15));
  let selected;
  h.context.generateNewsletterWithGemini_ = (key,data) => { selected=data; throw Error('composition writer boundary'); };
  assert.throws(() => h.lockedRun('generateWeeklyDraftLocked_', {sendNotification:false}), /composition writer boundary/);
  assert.deepEqual(Array.from(selected.topStories, story => story.sourceId), [NEW_ID]);
  h.stubAnalyses(); h.lockedRun('analyzeNewRows_',h.sheet,2,2); assert.deepEqual(h.loaded,[]);
});

test('invalid retirement leaves competing minutes visible and agenda identity ambiguous', t => {
  const h=harness(t); h.seed({replacement:true}); h.rows[1][1]='Referat'; h.rows[2][1]='Referat';
  h.rows[1][17]=`FA:${guid(71)}:${guid(72)}`;
  const agenda=h.rows[2].slice(); agenda[1]='Dagsorden'; agenda[5]=`FA:${guid(73)}:${guid(74)}`; agenda[17]='';
  h.rows.push(agenda); assert.deepEqual(h.excluded(),[]);
});

test('mixed agenda and minutes replacement chains preserve original row indexes', t => {
  const h=harness(t); h.seed({replacement:true});
  const oldMinutes=h.rows[2].slice(); oldMinutes[1]='Referat'; oldMinutes[5]=`FA:${guid(81)}:${guid(82)}`;
  const currentMinutes=oldMinutes.slice(); currentMinutes[5]=`FA:${guid(83)}:${guid(84)}`;
  oldMinutes[17]=currentMinutes[5]; currentMinutes[17]=''; h.rows.push(oldMinutes,currentMinutes);
  const unrelated=h.rows[2].slice(); unrelated[4]='Email'; unrelated[5]='unrelated-mail';
  h.rows.splice(1,0,unrelated);
  const result=h.context.sourceRowExclusions_(h.sheet.getDataRange().getValues());
  assert.deepEqual([...result.replacements].sort((a,b)=>a-b),[1,3]);
  assert.deepEqual([...result.minutes],[2]);
  assert.deepEqual([...result.all].sort((a,b)=>a-b),[1,2,3]);
});
