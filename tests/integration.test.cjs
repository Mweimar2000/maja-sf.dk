'use strict';

// Self-contained: importing robot.test.cjs would register its tests a second time.
// Only the .gs source is evaluated. All Google services and model replies are
// in-memory fakes; the VM has no require, process, fetch, or real credentials.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const SOURCE = fs.readFileSync(process.env.ROBOT_SOURCE || path.join(__dirname, '../sf-middelfart-robot-v8.gs'), 'utf8');
const NOW = Date.parse('2026-09-08T12:00:00Z');
const DAY = 86400000;
const FA = 'https://dagsordener.middelfart.dk';
const GOOD = {
  tldr: 'Kommunen anlægger en cykelsti.', sfAnalysis: 'Bedre cykelforhold.',
  facts: 'Kommunen anlægger en cykelsti.', amounts: 'Ingen beløb oplyst.',
  score: 4, programMatch: 'Grøn transport.'
};
const DRAFT = 'Kommunen anlægger en cykelsti.\n\nDe bedste hilsner, SF Middelfart';
const CHECK = { claims: [{
  claim: 'Kommunen anlægger en cykelsti.', verdict: 'verified',
  evidence: 'Kommunen anlægger en cykelsti.', sourceIndex: 1
}] };
const PUBLIC_ENTRIES = new Set([
  'setupOnce_createTriggers',
  'dailyIngest', 'ingestFromFirstAgendaApi', 'ingestInboxEmails',
  'dailyRepairAnalyses', 'reanalyzeAllRows', 'generateWeeklyDraft', 'testGenerateNewsletterWithoutEmail'
]);

function item(id = 'cycle', title = 'Ny cykelsti', text = GOOD.facts) {
  return { Id: id, IsOpen: true, Number: 1, Caption: title, Bilag: [], Felter: [{ Tekst: text }] };
}

function meeting(id = 'council', daysAgo = 1) {
  return { Id: id, Dato: new Date(NOW - daysAgo * DAY).toISOString(), Afsluttet: true };
}

function sourceRow(sourceItem, { score = 4, tldr = GOOD.tldr } = {}) {
  return [
    '2026-09-07 12:00', 'Referat', 'Byrådet', sourceItem.Caption,
    'FirstAgenda API', `FA:council:${sourceItem.Id}`, `${FA}/Vis/Referat/council`,
    sourceItem.Felter[0].Tekst, '', tldr, GOOD.sfAnalysis, GOOD.facts,
    GOOD.amounts, score, GOOD.programMatch, '2026-09-07T12:00:00Z', ''
  ];
}

function message(id, daysAgo = 0) {
  return {
    getId: () => id,
    getSubject: () => `Byrådets orientering ${id}`,
    getFrom: () => 'fixture@example.invalid',
    getDate: () => new Date(NOW - daysAgo * DAY),
    getPlainBody: () => `Orientering om kommunens arbejde (${id}).`,
    getAttachments: () => []
  };
}

function thread(...messages) {
  return { messages, getMessages() { return this.messages.slice(); } };
}

function harness(t, rows = []) {
  const h = {
    now: NOW, rows: [Array(17).fill(''), ...structuredClone(rows)], maxColumns: 17,
    meetings: [], agendas: new Map(), threads: [], labelExists: true,
    writes: [], propertyWrites: [], pages: [], fetches: [], modelCalls: [],
    replies: [], documents: [], mails: [], logs: [], unexpected: [], lockEvents: [], triggers: [],
    owner: null, beforeWrite: null, afterWrite: null,
    properties: new Map(Object.entries({
      SPREADSHEET_ID: 'fixture-sheet', INBOX_SHEET_NAME: 'Inbox',
      INBOX_LABEL: 'fixture-label', GEMINI_API_KEY: 'fake-test-key',
      DRAFT_FOLDER_ID: 'fixture-folder'
    }))
  };
  // Production catches many service errors. Unexpected fake calls must still
  // fail the test even when the robot catches the exception and logs it.
  t.after(() => assert.deepEqual(h.unexpected, [], 'Unexpected service/model requests'));
  function unexpected(description) {
    h.unexpected.push(description);
    throw new Error(description);
  }
  function range(row, column, height = 1, width = 1) {
    assert.ok(row >= 1 && column >= 1 && height >= 1 && width >= 1);
    const result = {
      getValues: () => Array.from({ length: height }, (_, i) =>
        Array.from({ length: width }, (_, j) => h.rows[row - 1 + i]?.[column - 1 + j] ?? '')),
      setValues(values) {
        assert.equal(values.length, height, 'Sheet write height');
        for (const cells of values) assert.equal(cells.length, width, 'Sheet write width');
        const write = { row, column, values: structuredClone(values), locked: h.owner !== null };
        if (h.beforeWrite) h.beforeWrite(write);
        for (let i = 0; i < height; i++) {
          while (h.rows.length < row + i) h.rows.push(Array(h.maxColumns).fill(''));
          for (let j = 0; j < width; j++) h.rows[row - 1 + i][column - 1 + j] = write.values[i][j];
        }
        h.writes.push(write);
        if (h.afterWrite) h.afterWrite(write);
        return result;
      },
      setValue(value) { return result.setValues([[value]]); }
    };
    return result;
  }
  const sheet = {
    getLastRow: () => h.rows.length,
    getMaxColumns: () => h.maxColumns,
    insertColumnsAfter(after, count) {
      assert.equal(after, h.maxColumns);
      h.maxColumns += count;
    },
    getDataRange: () => range(1, 1, h.rows.length, h.maxColumns),
    getRange: range
  };
  function http(body, code = 200, headers = {}) {
    return {
      getResponseCode: () => code,
      getContentText: () => typeof body === 'string' ? body : JSON.stringify(body),
      getAllHeaders: () => headers
    };
  }
  function documentApi(doc) {
    return {
      getId: () => doc.id, getUrl: () => `https://docs.example.invalid/${doc.id}`,
      getBody: () => ({ setText(text) { doc.text = text; } }),
      saveAndClose() { doc.saves.push(doc.text); }
    };
  }
  h.run = entry => {
    assert.ok(PUBLIC_ENTRIES.has(entry), 'Tests invoke public entry points only');
    // Each invocation models a new Apps Script execution: its time budget and
    // in-process caches reset; Sheets, Gmail, locks and properties persist.
    const context = vm.createContext({
      __now: () => h.now,
      console: { log: (...args) => h.logs.push(args.join(' ')) },
      Session: {
        getScriptTimeZone: () => 'UTC',
        getEffectiveUser: () => ({ getEmail: () => 'reviewer@example.invalid' })
      },
      Utilities: {
        sleep: ms => { h.now += ms; },
        DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
        computeDigest: (algorithm, text, encoding) => Array.from(crypto.createHash(algorithm).update(text, encoding).digest()),
        // Fixtures deliberately use UTC; timezone correctness is not under test.
        parseDate: text => new Date(text.replace(' ', 'T') + (text.length === 10 ? 'T00:00:00Z' : 'Z')),
        formatDate(date, timezone, format) {
          assert.equal(timezone, 'UTC');
          const iso = date.toISOString();
          if (format === 'yyyy-MM-dd HH:mm') return iso.slice(0, 16).replace('T', ' ');
          if (format === 'yyyy') return iso.slice(0, 4);
          if (format === 'w') return '37';
          return unexpected(`Unsupported date format: ${format}`);
        }
      },
      PropertiesService: { getScriptProperties: () => ({
        getProperty: key => h.properties.get(key) ?? null,
        setProperty(key, value) {
          h.properties.set(key, String(value)); h.propertyWrites.push({ key, value: String(value) });
        },
        deleteProperty(key) { h.properties.delete(key); h.propertyWrites.push({ key, deleted: true }); }
      }) },
      LockService: { getScriptLock: () => {
        const token = Symbol(entry);
        return {
          tryLock() {
            const acquired = h.owner === null;
            h.lockEvents.push({ entry, action: 'try', acquired });
            if (acquired) h.owner = token;
            return acquired;
          },
          releaseLock() {
            assert.equal(h.owner, token, 'Must never release another execution’s lock');
            h.owner = null; h.lockEvents.push({ entry, action: 'release' });
          }
        };
      } },
      ScriptApp: {
        WeekDay: { SATURDAY: 'SATURDAY' },
        getProjectTriggers: () => h.triggers.slice(),
        deleteTrigger: trigger => { h.triggers.splice(h.triggers.indexOf(trigger), 1); },
        newTrigger(handler) {
          const trigger = { handler, getHandlerFunction() { return this.handler; } };
          const builder = {
            timeBased() { return this; },
            everyDays(days) { trigger.days = days; return this; },
            atHour(hour) { trigger.hour = hour; return this; },
            onWeekDay(day) { trigger.day = day; return this; },
            create() { h.triggers.push(trigger); return trigger; }
          };
          return builder;
        }
      },
      SpreadsheetApp: { openById(id) {
        assert.equal(id, 'fixture-sheet');
        return { getSheetByName: name => name === 'Inbox' ? sheet : null };
      } },
      GmailApp: {
        getUserLabelByName(name) {
          assert.equal(name, 'fixture-label');
          return !h.labelExists ? null : { getThreads(offset, limit) {
            h.pages.push({ offset, limit });
            return h.threads.slice(offset, offset + limit);
          } };
        },
        getMessageById: id => h.threads.flatMap(x => x.messages).find(m => m.getId() === id) ?? null,
        // Capture only. There is deliberately no transport behind this fake.
        sendEmail: (...args) => h.mails.push(structuredClone(args))
      },
      CacheService: { getScriptCache: () => ({ get: () => 'Teststilguide: Skriv kort og kildebaseret.' }) },
      DocumentApp: {
        create(title) {
          const doc = { id: `draft-${h.documents.length + 1}`, title, text: '', saves: [] };
          h.documents.push(doc); return documentApi(doc);
        },
        openById(id) {
          const doc = h.documents.find(d => d.id === id);
          if (!doc) return unexpected(`Unknown document: ${id}`);
          return documentApi(doc);
        }
      },
      DriveApp: {
        getFolderById: id => ({ id }),
        getFileById: id => ({ moveTo(folder) {
          assert.equal(folder.id, 'fixture-folder');
          h.documents.find(d => d.id === id).folder = folder.id;
        } })
      },
      UrlFetchApp: { fetch(url, options = {}) {
        h.fetches.push(url);
        if (url.startsWith(`${FA}/Home/AnonymousAuthentication?`)) {
          return http('', 302, { 'Set-Cookie': ['fixture=anonymous; Path=/'] });
        }
        if (url === `${FA}/api/agenda/udvalgsliste`) {
          return http({ Udvalg: { Kommunale: [{ Id: 'committee', Navn: 'Byrådet', Moeder: h.meetings }] } });
        }
        if (url.startsWith(`${FA}/api/agenda/dagsorden/`)) {
          const id = url.slice(`${FA}/api/agenda/dagsorden/`.length);
          if (!h.agendas.has(id)) return unexpected(`Unconfigured agenda: ${id}`);
          return http({ Dagsordenpunkter: h.agendas.get(id) });
        }
        if (/^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models\/[^/]+:generateContent$/.test(url)) {
          h.modelCalls.push({
            payload: JSON.parse(options.payload), rows: structuredClone(h.rows),
            savedDocuments: h.documents.map(doc => doc.saves.slice()), locked: h.owner !== null
          });
          if (!h.replies.length) return unexpected('Model request without a scripted reply');
          const reply = h.replies.shift();
          if (reply.httpError) return http({ error: { status: 'PERMISSION_DENIED' } }, reply.httpError);
          return http({ candidates: [{ finishReason: 'STOP', content: {
            parts: [{ text: typeof reply === 'string' ? reply : JSON.stringify(reply) }]
          } }] });
        }
        return unexpected(`Unconfigured URL: ${url}`);
      } }
    }, { codeGeneration: { strings: false, wasm: false } });
    vm.runInContext(`{
      const RealDate = Date;
      globalThis.Date = class extends RealDate {
        constructor(...args) { super(...(args.length ? args : [__now()])); }
        static now() { return __now(); }
      };
    }`, context, { timeout: 1000 });
    vm.runInContext(SOURCE, context, { timeout: 1000 });
    return vm.runInContext(`${entry}()`, context, { timeout: 2000 });
  };
  return h;
}

function prompt(call) {
  return call.payload.contents.flatMap(content => content.parts).map(part => part.text || '').join('\n');
}

function ids(h) { return h.rows.slice(1).map(row => row[5]); }

function assertExactlyOnce(h, expected) {
  assert.equal(ids(h).length, new Set(ids(h)).size, 'No duplicate source IDs');
  assert.deepEqual(ids(h).slice().sort(), expected.slice().sort(), 'No lost messages');
}

for (const daysAgo of [25, 120]) {
  test(`late publication of a ${daysAgo}-day-old meeting reaches this week's draft`, t => {
    const h = harness(t);
    const late = meeting('late', daysAgo);
    late.ReleasedDate = new Date(NOW - 3600000).toISOString();
    h.meetings = [meeting('old-unpublished', 150), late];
    h.agendas.set('late', [item(), { ...item('closed'), IsOpen: false }]);
    h.replies.push(GOOD, DRAFT, CHECK);

    h.run('ingestFromFirstAgendaApi');
    assert.deepEqual(ids(h), ['FA:late:cycle'], 'Only the newly available open item is retained');
    assert.equal(h.rows[1][0], late.Dato.slice(0, 16).replace('T', ' '), 'Preserve the actual meeting date');
    assert.equal(h.rows[1][15], late.ReleasedDate, 'Use publication time independently of meeting/import time');
    h.run('dailyRepairAnalyses');
    h.run('generateWeeklyDraft');

    assert.equal(h.rows[1][13], 4);
    assert.equal(h.modelCalls.length, 3, 'Analysis, newsletter and fact check all run');
    assert.match(prompt(h.modelCalls[1]), /Ny cykelsti/);
    assert.equal(h.documents.length, 1);
    assert.match(h.documents[0].saves.at(-1), /DÆKNING: 1 sager i perioden.*1 analyseret.*0 mangler analyse/);
    assert.equal(h.mails.length, 1, 'Notification is captured by the Gmail fake');
  });
}

test('first import of an old meeting without a recent publication does not become this week’s news', t => {
  const h = harness(t);
  const historical = meeting('history', 25);
  h.meetings = [historical];
  h.agendas.set('history', [item()]);
  h.replies.push(GOOD);
  h.run('ingestFromFirstAgendaApi');
  assertExactlyOnce(h, ['FA:history:cycle']);
  assert.equal(h.rows[1][15], historical.Dato, 'An import is not a new publication');
  h.run('dailyRepairAnalyses');
  assert.equal(h.rows[1][13], 4, 'Even a relevant historical case stays outside the weekly window');
  h.run('generateWeeklyDraft');
  assert.equal(h.modelCalls.length, 1, 'Only analysis runs; no newsletter is requested');
  assert.equal(h.documents.length, 0);
  assert.equal(h.mails.length, 0);
});

test('same-type corrected referat invalidates stale analysis before the next model call', t => {
  const h = harness(t);
  h.meetings = [meeting()];
  h.agendas.set('council', [item()]);
  h.replies.push(GOOD);
  h.run('ingestFromFirstAgendaApi');
  h.run('dailyRepairAnalyses');
  const oldAnalysis = h.rows[1].slice(9, 15);
  assert.equal(oldAnalysis[4], 4, 'Start with a successfully analysed referat');

  h.now += DAY;
  const corrected = item('cycle', 'Rettet beslutning om cykelstien', 'Cykelstien er udsat til næste år.');
  h.agendas.set('council', [corrected]);
  const writeStart = h.writes.length;
  h.run('ingestFromFirstAgendaApi');
  assertExactlyOnce(h, ['FA:council:cycle']);
  assert.equal(h.rows[1][1], 'Referat');
  assert.equal(h.rows[1][3], corrected.Caption);
  assert.match(h.rows[1][7], /Cykelstien er udsat til næste år/);
  assert.deepEqual(h.rows[1].slice(9, 15), Array(6).fill(''), 'Stale summary, facts and score must all be pending');
  assert.equal(h.rows[1][15], new Date(h.now).toISOString());
  assert.ok(h.writes.slice(writeStart).some(write => write.row === 2), 'The existing source row was refreshed');

  h.replies.push({ ...GOOD, tldr: corrected.Felter[0].Tekst, facts: corrected.Felter[0].Tekst, score: 3 });
  h.run('dailyRepairAnalyses');
  assert.equal(h.modelCalls.length, 2);
  assert.deepEqual(h.modelCalls[1].rows[1].slice(9, 15), Array(6).fill(''), 'Invalidation is durable before the model is called');
  assert.match(prompt(h.modelCalls[1]), /Cykelstien er udsat til næste år/);
  assert.doesNotMatch(prompt(h.modelCalls[1]), /Kommunen anlægger en cykelsti/);
  assert.equal(h.rows[1][9], corrected.Felter[0].Tekst);
  assert.equal(h.rows[1][13], 3);
});

test('unchanged FirstAgenda replay preserves analysis and publication time without another model call', t => {
  const h = harness(t);
  h.meetings = [meeting()];
  h.agendas.set('council', [item()]);
  h.replies.push(GOOD);
  h.run('ingestFromFirstAgendaApi');
  h.run('dailyRepairAnalyses');
  const retained = structuredClone(h.rows[1]);
  h.now += DAY;
  h.run('ingestFromFirstAgendaApi');
  h.run('dailyRepairAnalyses');
  assert.deepEqual(h.rows[1], retained, 'Replay neither republishes nor invalidates the source');
  assertExactlyOnce(h, ['FA:council:cycle']);
  assert.equal(h.modelCalls.length, 1);
});

test('Gmail paginates beyond 30 threads and repeated sweeps retain every message exactly once', t => {
  const h = harness(t);
  const messages = Array.from({ length: 65 }, (_, i) => message(`mail-${i}`));
  h.threads = messages.map(m => thread(m));
  for (let run = 0; run < 8 && ids(h).length < messages.length; run++) h.run('ingestInboxEmails');
  assertExactlyOnce(h, messages.map(m => m.getId()));
  assert.ok(h.pages.some(page => page.offset > 0), 'Later thread pages must be visited');
  for (let run = 0; run < 8; run++) h.run('ingestInboxEmails');
  assertExactlyOnce(h, messages.map(m => m.getId()));
  assert.equal(h.modelCalls.length, 0, 'Ingestion saves sources independently of analysis');
  assert.equal(h.mails.length, 0);
});

test('Gmail finds an old late-labelled message and a new reply in an already-seen thread', t => {
  const h = harness(t);
  const messages = Array.from({ length: 35 }, (_, i) => message(`seen-${i}`));
  h.threads = messages.map(m => thread(m));
  for (let run = 0; run < 4; run++) h.run('ingestInboxEmails');
  assertExactlyOnce(h, messages.map(m => m.getId()));
  // Legacy watermark must not suppress messages newly discovered by label/ID.
  h.properties.set('LAST_PROCESSED_MS', String(NOW));
  h.threads[0].messages.push(message('new-reply'));
  h.threads.push(thread(message('late-label', 200)));
  h.threads.unshift(thread(message('new-thread')));
  for (let run = 0; run < 8; run++) h.run('ingestInboxEmails');
  assertExactlyOnce(h, [...messages.map(m => m.getId()), 'new-reply', 'late-label', 'new-thread']);
  assert.ok(Date.parse(h.rows.find(row => row[5] === 'late-label')[0]) < NOW - 100 * DAY);
  assert.equal(h.mails.length, 0);
});

test('Gmail resumes a time-budget interruption without losing or duplicating messages', t => {
  const h = harness(t);
  const messages = Array.from({ length: 37 }, (_, i) => message(`interrupted-${i}`));
  h.threads = messages.map(m => thread(m));
  h.afterWrite = write => {
    if (write.row > 1 && ids(h).length === 7) { h.now += 280000; h.afterWrite = null; }
  };
  h.run('ingestInboxEmails');
  assert.equal(ids(h).length, 7, 'Fixture actually exhausts the first execution’s budget');
  assert.equal(h.owner, null);
  for (let run = 0; run < 8; run++) h.run('ingestInboxEmails');
  assertExactlyOnce(h, messages.map(m => m.getId()));
});

test('concurrent FirstAgenda and Gmail ingestion cannot overwrite each other’s append', t => {
  const h = harness(t);
  h.meetings = [meeting()];
  h.agendas.set('council', [item()]);
  h.threads = [thread(message('concurrent-mail'))];
  let interleaved = false;
  h.beforeWrite = write => {
    if (write.row === 2 && !interleaved) {
      interleaved = true;
      const before = structuredClone(h.rows);
      h.run('ingestInboxEmails');
      assert.deepEqual(h.rows, before, 'Contending ingestion must not write');
    }
  };
  h.run('ingestFromFirstAgendaApi');
  assert.ok(interleaved, 'Contention occurs after choosing the append row and before saving it');
  assert.equal(h.owner, null);
  assert.ok(h.lockEvents.some(event => event.entry === 'ingestInboxEmails' && event.acquired === false));
  h.run('ingestInboxEmails');
  assertExactlyOnce(h, ['FA:council:cycle', 'concurrent-mail']);
  assert.ok(h.writes.every(write => write.locked), 'All sheet mutations occur while owning the shared lock');
});

// Trigger setup does not touch the Sheets/analysis state guarded by this lock.
for (const entry of [...PUBLIC_ENTRIES].filter(entry => entry !== 'setupOnce_createTriggers')) {
  test(`${entry} leaves shared state untouched while another execution owns the lock`, t => {
    const h = harness(t, [sourceRow(item())]);
    h.threads = [thread(message('must-wait'))];
    const externalOwner = Symbol('another execution');
    h.owner = externalOwner;
    const before = structuredClone(h.rows);
    h.run(entry);
    assert.deepEqual(h.rows, before);
    assert.equal(h.owner, externalOwner, 'A skipped execution must not release somebody else’s lock');
    assert.equal(h.writes.length + h.propertyWrites.length + h.fetches.length + h.mails.length + h.documents.length, 0);
    assert.ok(h.lockEvents.some(event => event.action === 'try' && !event.acquired));
  });
}

test('a mid-ingestion Sheets exception releases the lock and the next execution recovers', t => {
  const h = harness(t);
  h.threads = [thread(message('before-error')), thread(message('after-error'))];
  h.beforeWrite = write => {
    if (write.row === 3) { h.beforeWrite = null; throw new Error('Synthetic Sheets write failure'); }
  };
  assert.throws(() => h.run('ingestInboxEmails'), /Synthetic Sheets write failure/);
  assertExactlyOnce(h, ['before-error']);
  assert.equal(h.owner, null, 'Lock must be released even when a persistence call throws');
  h.run('ingestInboxEmails');
  assertExactlyOnce(h, ['before-error', 'after-error']);
  assert.equal(h.owner, null);
});

for (const poisonedScore of [1, 5]) {
  test(`draft retains coverage warning before and after fact check with poisoned score ${poisonedScore}`, t => {
    const valid = item();
    const poisoned = item('poisoned', 'POISONED_CASE_MUST_NOT_REACH_MODEL', 'Uafklaret sag.');
    const h = harness(t, [sourceRow(valid), sourceRow(poisoned, {
      score: poisonedScore, tldr: 'Analyse fejlede: tidligere modelsvigt'
    })]);
    h.meetings = [meeting()];
    h.agendas.set('council', [valid, poisoned]);
    h.replies.push(DRAFT, CHECK);
    h.run('generateWeeklyDraft');
    assert.equal(h.modelCalls.length, 2, 'Both newsletter generation and actual fact-check validation execute');
    for (const call of h.modelCalls) {
      assert.match(prompt(call), /Ny cykelsti/);
      assert.doesNotMatch(prompt(call), /POISONED_CASE_MUST_NOT_REACH_MODEL|Analyse fejlede/);
    }
    assert.equal(h.documents.length, 1);
    const doc = h.documents[0];
    assert.equal(doc.folder, 'fixture-folder');
    assert.equal(doc.saves.length, 2, 'Initial saved draft and final updated draft both exist');
    assert.equal(h.modelCalls[0].savedDocuments.length, 0);
    assert.deepEqual(h.modelCalls[1].savedDocuments, [[doc.saves[0]]], 'Initial draft is saved before starting fact check');
    for (const saved of doc.saves) {
      assert.match(saved, /DÆKNING: 2 sager i perioden.*1 analyseret.*1 mangler analyse/);
      assert.match(saved, /⚠️ Ufuldstændigt grundlag/);
      assert.ok(saved.includes(DRAFT));
    }
    assert.match(doc.saves[0], /IKKE verificeret/);
    assert.match(doc.saves[1], /Verificeret: 1/);
    assert.equal(h.mails.length, 1);
    assert.equal(h.mails[0][0], 'reviewer@example.invalid');
    assert.match(h.mails[0][1], /UFULDT GRUNDLAG/);
    assert.match(h.mails[0][2], /Mangler analyse: 1/);
    assert.deepEqual(h.rows[2].slice(9, 15), sourceRow(poisoned, {
      score: poisonedScore, tldr: 'Analyse fejlede: tidligere modelsvigt'
    }).slice(9, 15), 'Draft generation must not silently rewrite the poisoned row');
  });
}

test('manual draft verification creates the document without sending any email', t => {
  const valid = item();
  const h = harness(t, [sourceRow(valid)]);
  h.meetings = [meeting()];
  h.agendas.set('council', [valid]);
  h.replies.push(DRAFT, CHECK);
  h.run('testGenerateNewsletterWithoutEmail');
  assert.equal(h.documents.length, 1);
  assert.equal(h.documents[0].saves.length, 2);
  assert.equal(h.mails.length, 0);
});


test('scheduled ingestion and repair finish before Saturday newsletter even with trigger jitter', t => {
  const h = harness(t);
  const unrelated = { handler: 'otherProjectTask', getHandlerFunction() { return this.handler; } };
  h.triggers.push(unrelated);
  h.run('setupOnce_createTriggers');
  assert.ok(h.triggers.includes(unrelated), 'Unrelated triggers must survive installation');
  const byName = Object.fromEntries(h.triggers.map(trigger => [trigger.handler, trigger]));
  const ingest = byName.dailyIngest, repair = byName.dailyRepairAnalyses, draft = byName.generateWeeklyDraft;
  // Apps Script may choose any minute within atHour's one-hour window.
  // Leave an additional six minutes for the preceding execution to finish.
  assert.ok(ingest.hour + 1 + 6 / 60 < repair.hour, 'Ingestion must finish before repair starts');
  assert.ok(repair.hour + 1 + 6 / 60 < draft.hour, 'Repair must finish before the newsletter starts');
  assert.equal(draft.day, 'SATURDAY');
  assert.equal(draft.hour, 13, 'Preserve the existing weekly delivery hour');
  const saturday = Date.parse('2026-09-12T00:00:00Z');
  h.now = saturday + (ingest.hour + 1) * 3600000 - 1;
  h.meetings = [{ Id: 'council', Dato: new Date(h.now).toISOString(), Afsluttet: true }];
  h.agendas.set('council', [item()]);
  h.run('dailyIngest');
  assert.equal(h.rows[1][13], '', 'The ingestion phase alone has no analysis');
  h.now = saturday + repair.hour * 3600000;
  h.replies.push(GOOD);
  h.run('dailyRepairAnalyses');
  assert.equal(h.rows[1][13], 4);
  h.now = saturday + draft.hour * 3600000;
  h.replies.push(DRAFT, CHECK);
  h.run('testGenerateNewsletterWithoutEmail');
  assert.equal(h.documents.length, 1);
  assert.match(h.documents[0].text, /Kommunen anlægger en cykelsti/);
  assert.equal(h.mails.length, 0);
});

for (const legacyImportTimestamp of [false, true]) {
  test(`historical mail stays outside weekly news after ingestion and analysis (legacy timestamp: ${legacyImportTimestamp})`, t => {
    const h = harness(t);
    const old = message('historical-email', 200);
    old.getPlainBody = () => GOOD.facts;
    h.threads = [thread(old)];
    h.run('ingestInboxEmails');
    if (legacyImportTimestamp) h.rows[1][15] = new Date(NOW).toISOString();
    h.replies.push(GOOD, DRAFT, CHECK);
    h.run('dailyRepairAnalyses');
    assert.equal(h.rows[1][13], 4, 'Historical sources remain available for analysis');
    h.run('testGenerateNewsletterWithoutEmail');
    assert.equal(h.documents.length, 0, 'Importing or analysing an old message must not make it current news');
    assert.equal(h.modelCalls.length, 1, 'No newsletter or fact-check call for historical-only material');
    assert.equal(h.mails.length, 0);
  });
}


test('mail arriving after Saturday collection appears next week exactly once with its original date', t => {
  const h = harness(t);
  h.now = Date.parse('2026-09-12T09:00:00Z');
  h.run('ingestInboxEmails');
  h.now = Date.parse('2026-09-12T13:00:00Z');
  h.run('testGenerateNewsletterWithoutEmail');
  assert.equal(h.documents.length, 0);
  const late = message('saturday-afternoon');
  late.getDate = () => new Date('2026-09-12T12:30:00Z');
  late.getPlainBody = () => GOOD.facts;
  h.threads = [thread(late)];
  h.now = Date.parse('2026-09-13T09:00:00Z');
  h.run('ingestInboxEmails');
  h.replies.push(GOOD);
  h.now = Date.parse('2026-09-13T11:00:00Z');
  h.run('dailyRepairAnalyses');
  assert.equal(h.rows[1][13], 4);
  assert.equal(h.rows[1][0], '2026-09-12 12:30', 'Preserve the actual email date');
  h.now = Date.parse('2026-09-19T13:00:00Z');
  h.replies.push(DRAFT, CHECK);
  h.run('testGenerateNewsletterWithoutEmail');
  assert.equal(h.documents.length, 1, 'Carry recently received but not yet collected mail across the weekly boundary');
  h.now = Date.parse('2026-09-26T13:00:00Z');
  h.run('testGenerateNewsletterWithoutEmail');
  assert.equal(h.documents.length, 1, 'Do not publish the carried source again in another week');
  assert.equal(h.mails.length, 0);
});

test('current-period source repair precedes newly republished archive meetings and keeps original dates', t => {
  const current = item('current-period','Aktuel kommunal sag');
  const archive = item('archive','Genoffentliggjort arkivsag');
  const currentRow = sourceRow(current,{score:'',tldr:''});
  const archiveRow = sourceRow(archive,{score:'',tldr:''});
  archiveRow[0] = '2025-08-15 12:00';
  archiveRow[15] = new Date(NOW).toISOString();
  const h = harness(t,[currentRow,archiveRow]);
  h.agendas.set('council',[current,archive]);
  h.replies.push(GOOD,GOOD);
  h.run('dailyRepairAnalyses');
  assert.match(prompt(h.modelCalls[0]),/Aktuel kommunal sag/);
  assert.match(prompt(h.modelCalls[1]),/Genoffentliggjort arkivsag/);
  assert.match(prompt(h.modelCalls[1]),/2025-08-15 12:00/,'Original date accompanies the model input');
  assert.equal(h.rows[1][13],4);
  assert.equal(h.rows[2][13],4,'Late publications remain repairable after current cases');
});

test('FirstAgenda ingestion generates links matching the public point URL route', t => {
  const h = harness(t);
  h.meetings = [meeting()]; h.agendas.set('council',[item()]);
  h.run('dailyIngest');
  assert.equal(h.rows[1][6], `${FA}/vis?id=council&punktid=cycle`);
});

test('newsletter repairs old point links without changing source dates, analysis or email links', t => {
  const old = sourceRow(item());
  const mail = sourceRow(item('email')); mail[4]='fixture@example.invalid'; mail[5]='message-id'; mail[6]='https://sf.dk/source';
  // Out-of-period fixtures isolate the link migration from model generation.
  old[0]=old[15]=mail[0]=mail[15]='2025-01-01 12:00';
  const h = harness(t,[old,mail,old]);
  h.run('testGenerateNewsletterWithoutEmail');
  const expected = old.slice(); expected[6]=`${FA}/vis?id=council&punktid=cycle`;
  assert.deepEqual(h.rows[1],expected);
  assert.deepEqual(h.rows[2],mail);
  assert.deepEqual(h.rows[3],expected);
  assert.ok(h.writes.every(w=>w.column===7 && w.locked));
  assert.equal(h.modelCalls.length,0); assert.equal(h.mails.length,0);
});

test('published minutes supersede an old agenda ID for repair and newsletter without altering history', t => {
  const source = item(); source.Felter[0].Tekst='PUNKT 51: Ny cykelsti\nSagsnr: 2026-123456\n'+GOOD.facts;
  const minutes = sourceRow(source,{score:'',tldr:''});
  const agenda = minutes.slice(); agenda[1]='Dagsorden'; agenda[5]='FA:obsolete-meeting:old-point';
  const h = harness(t,[agenda,minutes]); h.agendas.set('council',[source]); h.replies.push(GOOD,DRAFT,CHECK);
  h.run('dailyRepairAnalyses');
  assert.ok(h.logs.some(x=>/1 repareret · 0 afventer/.test(x)));
  assert.deepEqual(h.rows[1],agenda,'Historical agenda remains unchanged');
  assert.equal(h.rows[2][13],4);
  h.run('testGenerateNewsletterWithoutEmail');
  assert.ok(h.logs.some(x=>/Fandt 1 sager fra denne uge/.test(x)));
  assert.equal(h.documents.length,1); assert.equal(h.mails.length,0);
  assert.ok(h.fetches.every(url=>!url.includes('obsolete-meeting')),'Never retry retired source IDs');
});

test('superseding an agenda never excludes an updated referat sharing its source ID under different metadata', t => {
  const oldSource=item('cycle','Original title','PUNKT 51: Original title\nSagsnr: 2026-123456\n'+GOOD.facts);
  const oldAgenda=sourceRow(oldSource,{score:'',tldr:''}); oldAgenda[1]='Dagsorden';
  const updatedSource=item('cycle','Updated title','PUNKT 52: Updated title\nSagsnr: 2026-999999\n'+GOOD.facts);
  const updatedMinutes=sourceRow(updatedSource,{score:'',tldr:''});
  const matchingMinutes=sourceRow(oldSource,{score:'',tldr:''}); matchingMinutes[5]='FA:another-meeting:cycle';
  const h=harness(t,[oldAgenda,updatedMinutes,matchingMinutes]);
  h.agendas.set('council',[updatedSource]); h.agendas.set('another-meeting',[oldSource]);
  h.replies.push(GOOD,GOOD,DRAFT,CHECK); h.run('dailyRepairAnalyses');
  assert.equal(h.rows[1][13],''); assert.equal(h.rows[2][13],4); assert.equal(h.rows[3][13],4);
  assert.ok(h.logs.some(x=>/2 repareret · 0 afventer/.test(x)));
  h.run('testGenerateNewsletterWithoutEmail');
  assert.ok(h.logs.some(x=>/Fandt 2 sager fra denne uge/.test(x)));
  assert.equal(h.documents.length,1); assert.equal(h.mails.length,0);
});

test('source citations survive both initial save and failed fact check without notification', t => {
  const source=item(); const h=harness(t,[sourceRow(source)]); h.agendas.set('council',[source]);
  h.replies.push(DRAFT,{}, {}, {});
  h.run('testGenerateNewsletterWithoutEmail');
  assert.equal(h.documents.length,1);
  for (const saved of h.documents[0].saves) {
    assert.match(saved,/KILDER TIL KONTROL/);
    assert.ok(saved.includes(`${FA}/vis?id=council&punktid=cycle`));
    assert.match(saved,/2026-09-07 12:00/);
  }
  assert.match(h.documents[0].text,/FAKTA-TJEK KUNNE IKKE KØRES/);
  assert.equal(h.mails.length,0);
});

test('a finality overclaim from the writing model triggers fallback before any draft is saved', t => {
  const text='Godkendt. Behandlingsplan: Klimaudvalget den 2. september. Byrådet den 28. september.';
  const source=item('cycle','Spildevandsplan',text), r=sourceRow(source); r[2]='Klimaudvalget';
  const bad='Klimaudvalget har endeligt vedtaget spildevandsplanen. De bedste hilsner, SF Middelfart';
  const good='Klimaudvalget har godkendt indstillingen. Sagen går videre til Byrådet. De bedste hilsner, SF Middelfart';
  r[9]=bad;
  const h=harness(t,[r]);h.agendas.set('council',[source]);
  h.replies.push(bad,good,{claims:[{claim:'Sagen går videre til Byrådet.',verdict:'verified',evidence:'Byrådet den 28. september.',sourceIndex:1}]});
  h.run('testGenerateNewsletterWithoutEmail');
  assert.equal(h.documents.length,1);assert.equal(h.modelCalls.length,3);
  assert.match(h.fetches.filter(url=>url.startsWith('https://generativelanguage.googleapis.com'))[1],/gemini-3.6-flash/);
  for (const saved of h.documents[0].saves) { assert.ok(saved.includes(good));assert.ok(!saved.includes(bad)); }
  assert.equal(h.mails.length,0);assert.equal(h.rows[1][9],bad,'Stored history is preserved');
});
