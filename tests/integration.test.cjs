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
  'dailyRepairAnalyses', 'reanalyzeAllRows', 'generateWeeklyDraft', 'testGenerateNewsletterWithoutEmail',
  'processPendingFactCheck'
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
    replies: [], documents: [], documentWrites: [], mails: [], logs: [], unexpected: [], lockEvents: [], triggers: [],
    owner: null, beforeWrite: null, afterWrite: null, beforeModel: null, beforeFetch: null,
    files: new Map(), folders: new Map(), fileWrites: [], executions: [], pdfs: new Map(),
    terminateExecution: false, beforeMail: null, beforeFileWrite: null,
    beforeTriggerCreate: null, triggerEvents: [],
    afterDocumentSet: null, afterDocumentSave: null, afterFileWrite: null, afterMail: null,
    unavailableDocuments: new Set(), deletedFiles: new Set(), nextFileId: 1,
    originalIds: new Set(), documentReads: [], afterDocumentCreate: null,
    properties: new Map(Object.entries({
      SPREADSHEET_ID: 'fixture-sheet', INBOX_SHEET_NAME: 'Inbox',
      INBOX_LABEL: 'fixture-label', GEMINI_API_KEY: 'fake-test-key',
      DRAFT_FOLDER_ID: 'fixture-folder'
    }))
  };
  // Production catches many service errors. Unexpected fake calls must still
  // fail the test even when the robot catches the exception and logs it.
  t.after(() => assert.deepEqual(h.unexpected, [], 'Unexpected service/model requests'));
  t.after(() => {
    for (const operation of [...h.documentReads, ...h.documentWrites]) {
      if (h.executions[operation.execution - 1]?.entry === 'processPendingFactCheck') {
        assert.ok(!h.originalIds.has(operation.id), 'Workers must neither read nor write the original draft');
      }
    }
  });
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
      getAllHeaders: () => headers, getHeaders: () => headers,
      getBlob: () => blob(typeof body === 'string' ? body : JSON.stringify(body), headers['Content-Type'])
    };
  }
  function documentApi(doc) {
    return {
      getId: () => doc.id, getUrl: () => `https://docs.example.invalid/${doc.id}`,
      getBody: () => ({ getText: () => doc.text, setText(text) {
        doc.text = text.replace(/\r\n?/g, '\n'); // Google Docs returns LF-normalized body text.
        doc.nonTextContent = []; // Replacing the body discards formatting and inline images.
        doc.modifiedAt = Math.max(h.now, doc.modifiedAt + 1);
        h.documentWrites.push({ id: doc.id, text: doc.text, execution: h.executions.length });
        if (h.afterDocumentSet) h.afterDocumentSet(doc);
      } }),
      saveAndClose() {
        doc.saves.push(doc.text);
        doc.modifiedAt = Math.max(h.now, doc.modifiedAt + 1);
        if (h.afterDocumentSave) h.afterDocumentSave(doc);
      }
    };
  }
  function blob(text, type = 'text/plain', name = '') {
    const bytes = Buffer.from(text);
    return { getDataAsString: () => bytes.toString(), getBytes: () => Array.from(bytes),
      getContentType: () => type, getName: () => name, getSize: () => bytes.length };
  }
  function fileApi(file) {
    const api = {
      getId: () => file.id, getName: () => file.name,
      getBlob: () => blob(file.bytes ?? file.content, file.type, file.name),
      setContent(content) {
        if (h.beforeFileWrite) h.beforeFileWrite(file, String(content));
        file.content = String(content);
        if (file.name.endsWith('.json')) {
          const job = JSON.parse(file.content);
          if (job.docId) h.originalIds.add(job.docId);
        }
        h.fileWrites.push({ id: file.id, content: file.content, execution: h.executions.length });
        if (h.afterFileWrite) h.afterFileWrite(file);
        return api;
      },
      setTrashed(value) { file.trashed = value; return api; },
      moveTo(folder) { file.folder = folder.getId(); return api; }
    };
    return api;
  }
  function folderApi(folder) {
    return {
      getId: () => folder.id, getName: () => folder.name,
      createFolder(name) {
        const child = { id: `folder-${h.folders.size + 1}`, name, parent: folder.id };
        h.folders.set(child.id, child); return folderApi(child);
      },
      createFile(name, content, type) {
        let bytes;
        if (typeof name !== 'string') {
          bytes = name.getBytes(); type = name.getContentType(); content = name.getDataAsString(); name = name.getName();
        }
        const file = { id: `file-${h.nextFileId++}`, name, content: '', type, folder: folder.id, bytes };
        h.files.set(file.id, file); return fileApi(file).setContent(content);
      }
    };
  }
  h.folders.set('fixture-folder', { id: 'fixture-folder', name: 'Drafts' });
  h.pendingJob = () => {
    const id = h.properties.get('PENDING_FACTCHECK_JOB_ID');
    if (!id) return null;
    assert.ok(h.files.has(id), 'Pending property points to a real Drive JSON file');
    return JSON.parse(h.files.get(id).content);
  };
  h.latestJob = () => JSON.parse([...h.files.values()].filter(file => file.name.endsWith('.json')).at(-1).content);
  h.report = () => {
    const job = h.latestJob();
    const report = h.documents.find(doc => doc.id === job.reportDocId);
    assert.ok(report, 'The job identifies a separate fact-check report document');
    assert.notEqual(report.id, job.docId, 'The report must never replace the original draft');
    return report;
  };
  h.workerTriggers = () => h.triggers.filter(trigger => trigger.handler === 'processPendingFactCheck');
  h.drain = (limit = 40) => {
    let runs = 0;
    while (h.pendingJob() && runs++ < limit) h.worker();
    assert.equal(h.pendingJob(), null, `Job must reach completion within ${limit} worker executions`);
    return runs;
  };
  h.worker = () => {
    assert.equal(h.workerTriggers().length, 1, 'Exactly one continuation must be scheduled');
    const trigger = h.workerTriggers()[0];
    assert.ok(trigger.delay > 0, 'Continuation uses timeBased().after(delayMs)');
    h.triggers.splice(h.triggers.indexOf(trigger), 1); // Apps Script consumes the fired one-shot trigger.
    h.now += trigger.delay;
    return h.run('processPendingFactCheck');
  };
  h.run = entry => {
    assert.ok(PUBLIC_ENTRIES.has(entry), 'Tests invoke public entry points only');
    h.executions.push({ entry });
    // Each invocation models a new Apps Script execution: its time budget and
    // in-process caches reset; Sheets, Gmail, locks and properties persist.
    const context = vm.createContext({
      __now: () => h.now,
      __terminate: () => h.terminateExecution,
      console: { log: (...args) => h.logs.push(args.join(' ')) },
      Session: {
        getScriptTimeZone: () => 'UTC',
        getEffectiveUser: () => ({ getEmail: () => 'reviewer@example.invalid' })
      },
      Utilities: {
        newBlob: blob,
        base64Encode: bytes => Buffer.from(bytes).toString('base64'),
        base64Decode: text => Array.from(Buffer.from(text, 'base64')),
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
        deleteTrigger: trigger => {
          assert.ok(h.triggers.includes(trigger), 'Only existing triggers can be deleted');
          h.triggers.splice(h.triggers.indexOf(trigger), 1);
          h.triggerEvents.push({ action: 'delete', handler: trigger.handler, remaining: h.workerTriggers().length });
        },
        newTrigger(handler) {
          const trigger = { handler, getHandlerFunction() { return this.handler; } };
          const builder = {
            timeBased() { return this; },
            after(delay) { trigger.delay = delay; return this; },
            everyDays(days) { trigger.days = days; return this; },
            atHour(hour) { trigger.hour = hour; return this; },
            onWeekDay(day) { trigger.day = day; return this; },
            create() {
              if (h.beforeTriggerCreate) h.beforeTriggerCreate(trigger);
              h.triggers.push(trigger);
              h.triggerEvents.push({ action: 'create', handler, delay: trigger.delay });
              return trigger;
            }
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
        sendEmail: (...args) => {
          if (h.beforeMail) h.beforeMail(args);
          h.mails.push(structuredClone(args));
          if (h.afterMail) h.afterMail(args);
        }
      },
      CacheService: { getScriptCache: () => ({ get: () => 'Teststilguide: Skriv kort og kildebaseret.' }) },
      DocumentApp: {
        create(title) {
          const doc = { id: `draft-${h.documents.length + 1}`, title, text: '', nonTextContent: [], saves: [], modifiedAt: h.now };
          h.documents.push(doc);
          if (h.afterDocumentCreate) h.afterDocumentCreate(doc);
          return documentApi(doc);
        },
        openById(id) {
          h.documentReads.push({ id, execution: h.executions.length });
          if (h.unavailableDocuments.has(id)) throw new Error('Document access denied');
          const doc = h.documents.find(d => d.id === id);
          if (!doc) return unexpected(`Unknown document: ${id}`);
          return documentApi(doc);
        }
      },
      DriveApp: {
        createFolder(name) {
          const folder = { id: `folder-${h.folders.size + 1}`, name, parent: null };
          h.folders.set(folder.id, folder); return folderApi(folder);
        },
        getFolderById: id => {
          if (!h.folders.has(id)) return unexpected(`Unknown folder: ${id}`);
          return folderApi(h.folders.get(id));
        },
        getFileById: id => {
          if (h.deletedFiles.has(id)) throw new Error('Drive file not found');
          if (h.files.has(id)) return fileApi(h.files.get(id));
          const doc = h.documents.find(d => d.id === id);
          if (!doc) return unexpected(`Unknown Drive file: ${id}`);
          h.documentReads.push({ id, execution: h.executions.length });
          return {
            moveTo(folder) { doc.folder = folder.getId(); },
            getLastUpdated: () => new Date(doc.modifiedAt)
          };
        }
      },
      MimeType: { PLAIN_TEXT: 'text/plain', JSON: 'application/json' },
      UrlFetchApp: { fetch(url, options = {}) {
        h.fetches.push(url);
        if (h.beforeFetch) h.beforeFetch(url, options);
        if (h.pdfs.has(url)) {
          const pdf = h.pdfs.get(url);
          return http(pdf.body ?? '%PDF-1.4 fixture', pdf.code ?? 200, { 'Content-Type': 'application/pdf' });
        }
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
            savedDocuments: h.documents.map(doc => doc.saves.slice()), locked: h.owner !== null,
            job: h.pendingJob(), triggers: h.triggers.map(x => ({ handler: x.handler, delay: x.delay })),
            execution: h.executions.length
          });
          if (h.beforeModel) h.beforeModel(h.modelCalls.at(-1));
          if (!h.replies.length) return unexpected('Model request without a scripted reply');
          const reply = h.replies.shift();
          if (reply.httpError) return http({ error: { status: 'PERMISSION_DENIED' } }, reply.httpError);
          if (reply.rawResponse) return http(reply.rawResponse);
          return http({ candidates: [{ finishReason: 'STOP', content: {
            parts: [{ text: typeof reply === 'string' ? reply : JSON.stringify(reply) }]
          } }] });
        }
        return unexpected(`Unconfigured URL: ${url}`);
      } }
    }, { codeGeneration: { strings: false, wasm: false } });
    vm.runInContext(`{
      const stopIfTerminated = () => { if (__terminate()) { while (true) {} } };
      for (const name of ['create', 'openById']) {
        const open = DocumentApp[name];
        DocumentApp[name] = (...args) => {
          const doc = open(...args), getBody = doc.getBody, save = doc.saveAndClose;
          stopIfTerminated();
          doc.getBody = () => {
            const body = getBody(), setText = body.setText;
            body.setText = (...args) => { const result = setText(...args); stopIfTerminated(); return result; };
            return body;
          };
          doc.saveAndClose = () => { const result = save(); stopIfTerminated(); return result; };
          return doc;
        };
      }
      const getFile = DriveApp.getFileById;
      DriveApp.getFileById = (...args) => {
        const file = getFile(...args), setContent = file.setContent;
        if (setContent) file.setContent = (...args) => { const result = setContent(...args); stopIfTerminated(); return result; };
        return file;
      };
      const sendMail = GmailApp.sendEmail;
      GmailApp.sendEmail = (...args) => { const result = sendMail(...args); stopIfTerminated(); return result; };
      const fetch = UrlFetchApp.fetch;
      UrlFetchApp.fetch = (...args) => {
        const result = fetch(...args);
        // A VM watchdog termination cannot be caught by the robot. This models
        // Apps Script killing a slow call without running catch/finally blocks.
        stopIfTerminated();
        return result;
      };
      const RealDate = Date;
      globalThis.Date = class extends RealDate {
        constructor(...args) { super(...(args.length ? args : [__now()])); }
        static now() { return __now(); }
      };
    }`, context, { timeout: 1000 });
    vm.runInContext(SOURCE, context, { timeout: 1000 });
    try {
      return vm.runInContext(`${entry}()`, context, { timeout: 500 });
    } catch (error) {
      if (error.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') {
        h.owner = null; // Apps Script releases execution-owned locks on termination.
        h.terminateExecution = false;
      }
      throw error;
    }
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
    h.run('generateWeeklyDraft'); h.drain();

    assert.equal(h.rows[1][13], 4);
    assert.equal(h.modelCalls.length, 3, 'Analysis, newsletter and fact check all run');
    assert.match(prompt(h.modelCalls[1]), /Ny cykelsti/);
    assert.equal(h.documents.length, 2);
    for (const doc of h.documents) assert.match(doc.text, /DÆKNING: 1 sager i perioden.*1 analyseret.*0 mangler analyse/);
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
  h.run('generateWeeklyDraft'); h.drain();
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
for (const entry of [...PUBLIC_ENTRIES].filter(entry => !['setupOnce_createTriggers', 'processPendingFactCheck'].includes(entry))) {
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
    h.run('generateWeeklyDraft'); h.drain();
    assert.equal(h.modelCalls.length, 2, 'Both newsletter generation and actual fact-check validation execute');
    for (const call of h.modelCalls) {
      assert.match(prompt(call), /Ny cykelsti/);
      assert.doesNotMatch(prompt(call), /POISONED_CASE_MUST_NOT_REACH_MODEL|Analyse fejlede/);
    }
    assert.equal(h.documents.length, 2);
    const doc = h.documents[0];
    assert.equal(doc.folder, 'fixture-folder');
    assert.equal(doc.text, doc.saves[0], 'The original remains the initial draft');
    assert.equal(h.report().saves.length, 1, 'The separate report is published once');
    assert.equal(h.modelCalls[0].savedDocuments.length, 0);
    assert.equal(h.modelCalls[1].savedDocuments[0][0], doc.saves[0], 'Initial draft is saved before starting fact check');
    for (const saved of [...doc.saves, ...h.report().saves]) {
      assert.match(saved, /DÆKNING: 2 sager i perioden.*1 analyseret.*1 mangler analyse/);
      assert.match(saved, /⚠️ Ufuldstændigt grundlag/);
      assert.ok(saved.includes(DRAFT));
    }
    assert.match(doc.saves[0], /IKKE verificeret/);
    assert.match(h.report().text, /Verificeret: 1/);
    assert.equal(h.mails.length, 1);
    assert.equal(h.mails[0][0], 'reviewer@example.invalid');
    assert.match(h.mails[0][1], /⚠️|UFULDT GRUNDLAG/);
    assert.match(h.mails[0][2], /1 sager mangler analyse|Mangler analyse: 1/);
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
  h.run('testGenerateNewsletterWithoutEmail'); h.drain();
  assert.equal(h.documents.length, 2);
  assert.equal(h.documents[0].text, h.documents[0].saves[0]);
  assert.match(h.report().text, /Verificeret: 1/);
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
  h.run('testGenerateNewsletterWithoutEmail'); h.drain();
  assert.equal(h.documents.length, 2);
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
    h.run('testGenerateNewsletterWithoutEmail'); h.drain();
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
  h.run('testGenerateNewsletterWithoutEmail'); h.drain();
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
  h.run('testGenerateNewsletterWithoutEmail'); h.drain();
  assert.equal(h.documents.length, 2, 'Carry recently received mail into one draft and its report across the weekly boundary');
  h.now = Date.parse('2026-09-26T13:00:00Z');
  h.run('testGenerateNewsletterWithoutEmail'); h.drain();
  assert.equal(h.documents.length, 2, 'Do not publish the carried source again in another week');
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
  h.run('testGenerateNewsletterWithoutEmail'); h.drain();
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
  h.run('testGenerateNewsletterWithoutEmail'); h.drain();
  assert.ok(h.logs.some(x=>/Fandt 1 sager fra denne uge/.test(x)));
  assert.equal(h.documents.length,2); assert.equal(h.mails.length,0);
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
  h.run('testGenerateNewsletterWithoutEmail'); h.drain();
  assert.ok(h.logs.some(x=>/Fandt 2 sager fra denne uge/.test(x)));
  assert.equal(h.documents.length,2); assert.equal(h.mails.length,0);
});

test('source citations survive both initial save and failed fact check without notification', t => {
  const source=item(); const h=harness(t,[sourceRow(source)]); h.agendas.set('council',[source]);
  h.replies.push(DRAFT, ...Array.from({ length: 9 }, () => ({})));
  h.run('testGenerateNewsletterWithoutEmail'); h.drain();
  assert.equal(h.documents.length,2);
  for (const saved of h.documents.flatMap(doc => doc.saves)) {
    assert.match(saved,/KILDER TIL KONTROL/);
    assert.ok(saved.includes(`${FA}/vis?id=council&punktid=cycle`));
    assert.match(saved,/2026-09-07 12:00/);
  }
  assert.match(h.report().text,/FAKTA-TJEK KUNNE IKKE KØRES/);
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
  h.run('testGenerateNewsletterWithoutEmail'); h.drain();
  assert.equal(h.documents.length,2);assert.equal(h.modelCalls.length,3);
  assert.match(h.fetches.filter(url=>url.startsWith('https://generativelanguage.googleapis.com'))[1],/gemini-3.6-flash/);
  for (const saved of h.documents.flatMap(doc => doc.saves)) { assert.ok(saved.includes(good));assert.ok(!saved.includes(bad)); }
  assert.equal(h.mails.length,0);assert.equal(h.rows[1][9],bad,'Stored history is preserved');
});

// Resumable fact check: every worker below evaluates the unmodified production
// script in a fresh VM. Only service state (Drive/Docs/Properties/triggers)
// survives. In particular no helper is replaced with a synchronous shortcut.
function queuedFixture(t, pdfCount = 0, entry = 'testGenerateNewsletterWithoutEmail') {
  const source = item();
  const urls = [];
  for (let i = 0; i < pdfCount; i++) {
    const id = `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`;
    if (i === 0) {
      source.Felter[0].DocumentId = id;
      urls.push(`${FA}/Pdf/HentEksternPdf?documentId=${id}`);
    } else {
      source.Bilag.push({ Id: id, HarPdfVersion: 'true', Navn: `Bilag ${i + 1}` });
      urls.push(`${FA}/vis/pdf/bilag/${id}/?redirectDirectlyToPdf=true`);
    }
  }
  const h = harness(t, [sourceRow(source)]);
  h.agendas.set('council', [source]);
  h.pdfUrls = urls;
  for (const [i, url] of urls.entries()) h.pdfs.set(url, { body: `%PDF-1.4\nfixture attachment ${i + 1}` });
  h.replies.push(DRAFT);
  h.run(entry);
  return h;
}

function untilPhase(h, phase) {
  for (let i = 0; i < 30 && h.pendingJob()?.phase !== phase; i++) {
    assert.ok(h.pendingJob(), `Job must not finish before ${phase}`);
    h.worker();
  }
  assert.equal(h.pendingJob()?.phase, phase);
}

function pdfCalls(h) {
  return h.modelCalls.filter(call => call.payload.contents.some(content => content.parts.some(part => part.inline_data)));
}

function assertCheckpoint(call, phase) {
  assert.equal(call.job?.phase, phase, 'Phase is already durable when the model request starts');
  assert.equal(call.triggers.filter(trigger => trigger.handler === 'processPendingFactCheck').length, 1,
    'A continuation already exists before the potentially fatal model request');
  assert.equal(call.triggers.find(trigger => trigger.handler === 'processPendingFactCheck').delay, 7 * 60 * 1000);
  assert.ok(call.locked, 'Worker owns the same script lock as generation');
  assert.ok(call.savedDocuments[0]?.length, 'Initial document predates the model request');
}

test('generation returns a durable prepare job before fetching sources or fact checking', t => {
  const h = queuedFixture(t, 2);
  const job = h.pendingJob();
  assert.ok(job, 'The public generator must persist a queue, not complete the check synchronously');
  for (const field of ['version', 'docId', 'docUrl', 'newsletter', 'savedDraftText',
    'stories', 'upcomingMeetings', 'options', 'phase', 'sourceCursor', 'sources', 'pdfTasks', 'pdfCursor',
    'textResult', 'pdfReviews', 'attempts', 'failures', 'notificationAttempted']) {
    assert.ok(Object.hasOwn(job, field), `Durable job contains ${field}`);
  }
  assert.equal(job.phase, 'prepare');
  assert.equal(job.docId, h.documents[0].id);
  assert.equal(job.newsletter, DRAFT);
  assert.ok(h.documents[0].text.includes(job.savedDraftText));
  assert.equal(h.modelCalls.length, 1, 'Only the writing model runs in generation');
  assert.ok(!h.fetches.some(url => url.includes('/api/agenda/dagsorden/') || h.pdfUrls.includes(url)));
  assert.match(h.documents[0].text, /IKKE verificeret|afventer|kø|genoptag|FAKTA-TJEK I GANG/i);
  assert.doesNotMatch(h.documents[0].text, /✅/);
  assert.equal(h.documents.length, 1);
  assert.equal(h.mails.length, 0);
  assert.equal(h.workerTriggers().length, 1);
  const file = h.files.get(h.properties.get('PENDING_FACTCHECK_JOB_ID'));
  assert.equal(file.folder, h.properties.get('FACTCHECK_DATA_FOLDER_ID'));
  assert.equal(h.folders.get(file.folder).parent, null, 'Internal job folder is private at Drive root, never inside the shared draft folder');
  for (const write of h.fileWrites) assert.doesNotMatch(write.content, /fake-test-key|fixture=anonymous|GEMINI_API_KEY/,
    'Neither credentials nor session cookies may be persisted in the job');
});

test('prepare, text, each PDF and finalize are separate executions ending in one private report', t => {
  const h = queuedFixture(t, 3);
  const initialId = h.pendingJob().docId;
  const initialFileId = h.properties.get('PENDING_FACTCHECK_JOB_ID');
  h.replies.push(CHECK, { reviews: [] }, { reviews: [] }, { reviews: [] });
  untilPhase(h, 'text');
  assert.equal(h.modelCalls.length, 1, 'Prepare performs no model calls');
  assert.equal(h.pendingJob().sourceCursor, 1);
  assert.equal(h.pendingJob().pdfTasks.length, 3, 'Body PDF and every attachment have tasks');
  h.worker();
  assert.equal(h.pendingJob().phase, 'pdf');
  assert.equal(h.modelCalls.length, 2, 'Text checking gets its own execution');
  assertCheckpoint(h.modelCalls[1], 'text');
  assert.equal(pdfCalls(h).length, 0, 'Text checking cannot silently bundle PDFs');
  for (let i = 0; i < 3; i++) {
    h.worker();
    assert.equal(pdfCalls(h).length, i + 1, 'Exactly one PDF model call per worker execution');
    assert.equal(h.pendingJob().pdfCursor, i + 1, 'Each successful attachment is checkpointed');
    assert.equal(h.pendingJob().docId, initialId);
    assert.equal(h.properties.get('PENDING_FACTCHECK_JOB_ID'), initialFileId);
    assert.equal(h.mails.length, 0, 'No premature completion notification');
    assert.doesNotMatch(h.documents[0].text, /✅/);
  }
  untilPhase(h, 'finalize');
  assert.ok(h.pendingJob(), 'Finalization has not happened inside the final PDF call');
  assert.equal(h.documents.length, 1);
  h.worker();
  assert.equal(h.pendingJob(), null);
  assert.equal(h.workerTriggers().length, 0);
  assert.equal(h.documents.length, 2);
  const job = h.latestJob(), report = h.report();
  assert.equal(h.documents[0].text, h.documents[0].saves[0], 'Original is never updated by workers');
  assert.equal(report.folder, h.properties.get('FACTCHECK_DATA_FOLDER_ID'));
  assert.equal(h.folders.get(report.folder).parent, null, 'Report is in the private root folder');
  assert.ok(report.text.includes(job.docUrl), 'Report links to the original draft');
  assert.ok(report.text.includes(job.savedDraftText), 'Report contains the exact generated snapshot it checked');
  assert.match(report.text, /senere.*(?:ændr|rediger|rettelser)|(?:ændr|rediger).*ikke.*kontroll/i);
  assert.equal(job.reportExpectedText, report.text);
  assert.ok(job.reportDocUrl);
  assert.ok(h.logs.some(log => log.includes(job.docUrl)));
  assert.ok(h.logs.some(log => log.includes(job.reportDocUrl)));
  assert.equal(h.mails.length, 0, 'No-email option survives the entire queue');
  assert.deepEqual(h.fetches.filter(url => h.pdfUrls.includes(url)).sort(), h.pdfUrls.slice().sort());
  const calls = pdfCalls(h);
  assert.equal(new Set(calls.map(call => call.execution)).size, 3);
  assert.equal(new Set(calls.map(call => call.payload.contents.flatMap(c => c.parts).find(p => p.inline_data).inline_data.data)).size, 3);
  for (const call of calls) {
    assertCheckpoint(call, 'pdf');
    assert.equal(call.payload.contents.flatMap(c => c.parts).filter(p => p.inline_data).length, 1);
    const schema = call.payload.generationConfig.responseSchema;
    assert.ok(schema.required.includes('reviews'));
    const review = schema.properties.reviews.items;
    assert.equal(review.properties.claimId.type, 'INTEGER');
    assert.deepEqual(review.properties.verdict.enum.slice().sort(), ['contradicted', 'supported']);
    assert.equal(review.properties.evidence.type, 'STRING');
    for (const key of ['claimId', 'verdict', 'evidence']) assert.ok(review.required.includes(key));
  }
  assert.match(report.text, /PDF/i);
  assert.doesNotMatch(report.text, /✅/, 'Even complete PDF model reviews never make an automatic green result');
});

test('a second generation while a job is active reuses its document and preserves no-email', t => {
  const h = queuedFixture(t);
  const jobId = h.properties.get('PENDING_FACTCHECK_JOB_ID');
  h.run('generateWeeklyDraft');
  h.run('testGenerateNewsletterWithoutEmail');
  assert.equal(h.documents.length, 1);
  assert.equal(h.modelCalls.length, 1);
  assert.equal(h.properties.get('PENDING_FACTCHECK_JOB_ID'), jobId);
  assert.equal(h.workerTriggers().length, 1);
  h.replies.push(CHECK);
  h.drain();
  assert.equal(h.mails.length, 0, 'A scheduled generation cannot upgrade the queued no-email choice');
});

for (const phase of ['text', 'pdf']) {
  test(`hard termination during ${phase} resumes from the durable checkpoint in a fresh execution`, t => {
    const h = queuedFixture(t, phase === 'pdf' ? 2 : 0);
    h.replies.push(CHECK, { reviews: [] }, { reviews: [] });
    untilPhase(h, phase);
    const before = h.pendingJob();
    h.beforeModel = call => { if (call.job?.phase === phase) h.terminateExecution = true; };
    assert.throws(() => h.worker(), error => error.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT');
    const interrupted = h.pendingJob();
    assert.equal(interrupted.docId, before.docId);
    assert.equal(interrupted.phase, phase);
    assert.equal(interrupted.pdfCursor, before.pdfCursor, 'An interrupted PDF must not count as reviewed');
    assert.equal(h.workerTriggers().length, 1, 'Recovery cannot rely on a finally block after hard termination');
    assertCheckpoint(h.modelCalls.at(-1), phase);
    assert.notDeepEqual(interrupted.attempts, before.attempts, 'Attempt is durable before the fatal request');
    h.beforeModel = null;
    h.replies.unshift(phase === 'text' ? CHECK : { reviews: [] });
    h.drain();
    assert.equal(h.documents.length, 2);
    assert.equal(h.mails.length, 0);
    if (phase === 'pdf') {
      assert.equal(pdfCalls(h).length, 3, 'Interrupted PDF is retried and the remaining attachment is retained');
      assert.doesNotMatch(h.report().text, /✅/);
    }
  });
}

test('hard timeouts cannot repeat a PDF batch more than three times and later PDFs still run', t => {
  const h = queuedFixture(t, 2);
  h.replies.push(CHECK, ...Array.from({ length: 5 }, () => ({ reviews: [] })));
  untilPhase(h, 'pdf');
  h.beforeModel = call => { if (call.job?.phase === 'pdf' && call.job.pdfCursor === 0) h.terminateExecution = true; };
  for (let i = 0; i < 3; i++) assert.throws(() => h.worker(), error => error.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT');
  h.beforeModel = null;
  h.drain();
  assert.equal(pdfCalls(h).filter(call => call.job.pdfCursor === 0).length, 3);
  assert.equal(pdfCalls(h).filter(call => call.job.pdfCursor === 1).length, 1, 'A bad PDF cannot starve the next attachment');
  assert.match(h.report().text, /ufuld|fejl|mangler|ikke.*kontroll/i);
  assert.doesNotMatch(h.report().text, /✅/);
  assert.equal(h.mails.length, 0);
});

test('completed PDFs are not repeated when the following PDF is interrupted', t => {
  const h = queuedFixture(t, 3);
  h.replies.push(CHECK, ...Array.from({ length: 4 }, () => ({ reviews: [] })));
  untilPhase(h, 'pdf');
  h.worker();
  assert.equal(h.pendingJob().pdfCursor, 1);
  h.beforeModel = () => { h.terminateExecution = true; };
  assert.throws(() => h.worker(), error => error.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT');
  assert.equal(h.pendingJob().pdfCursor, 1);
  h.beforeModel = null;
  h.drain();
  assert.deepEqual(pdfCalls(h).map(call => call.job.pdfCursor), [0, 1, 1, 2]);
  assert.equal(h.documents.length, 2);
});

test('missing PDF is terminal after bounded attempts, visibly incomplete and cannot suppress later PDFs', t => {
  const h = queuedFixture(t, 2);
  h.pdfs.set(h.pdfUrls[0], { code: 404, body: 'Missing document' });
  h.replies.push(CHECK, { reviews: [] });
  h.drain();
  const failedFetches = h.fetches.filter(url => url === h.pdfUrls[0]);
  assert.ok(failedFetches.length > 0 && failedFetches.length <= 3);
  assert.equal(pdfCalls(h).length, 1, 'The available attachment is still checked');
  assert.match(h.report().text, /ufuld|fejl|mangler|ikke.*kontroll/i);
  assert.doesNotMatch(h.report().text, /✅/);
  assert.equal(h.mails.length, 0);
});

for (const editPhase of ['prepare', 'text', 'pdf', 'finalize']) {
  test(`user edits made before ${editPhase} are preserved across all remaining workers`, t => {
    const h = queuedFixture(t, 1);
    h.replies.push(CHECK, { reviews: [] });
    untilPhase(h, editPhase);
    const edited = h.documents[0].text + '\n\nMajas egen rettelse: behold denne tekst ordret.';
    h.documents[0].text = edited;
    h.drain();
    assert.equal(h.documents[0].text, edited, 'Workers must never touch the edited original');
    assert.equal(h.documents.length, 2);
    assert.equal(h.mails.length, 0);
    assert.equal(h.latestJob().phase, 'completed', 'Original edits cannot halt computation');
    assert.match(h.report().text, /Verificeret: 1/);
    assert.ok(!h.report().text.includes('Majas egen rettelse'), 'User edits are not claimed to be checked');
  });
}

test('all workers preserve unrelated properties and original scheduled triggers', t => {
  const h = queuedFixture(t, 2);
  const preserved = new Map(h.properties);
  preserved.delete('PENDING_FACTCHECK_JOB_ID');
  preserved.set('LAST_PROCESSED_MS', 'keep-watermark');
  preserved.set('ANALYSIS_RETRY_FA:council:cycle', 'keep-retry');
  preserved.set('SOME_OTHER_PROJECT_SETTING', 'keep-setting');
  for (const [key, value] of preserved) h.properties.set(key, value);
  const original = ['dailyIngest', 'dailyRepairAnalyses', 'generateWeeklyDraft', 'otherProjectTask']
    .map(handler => ({ handler, getHandlerFunction() { return this.handler; } }));
  h.triggers.push(...original);
  const sourceRows = structuredClone(h.rows);
  const sheetWrites = h.writes.length;
  h.replies.push(CHECK, { reviews: [] }, { reviews: [] });
  for (let run = 0; h.pendingJob() && run < 20; run++) {
    h.worker();
    for (const trigger of original) assert.ok(h.triggers.includes(trigger));
    for (const [key, value] of preserved) assert.equal(h.properties.get(key), value, key);
    assert.deepEqual(h.rows, sourceRows, 'Fact-check workers cannot change original Sheet data');
    assert.equal(h.writes.length, sheetWrites);
  }
  assert.equal(h.pendingJob(), null);
  assert.deepEqual(h.triggers, original);
  h.run('processPendingFactCheck');
  assert.deepEqual(h.triggers, original, 'A stale worker with no pending job is harmless');
});

test('notification is checkpointed before delivery and never retried after an ambiguous mail failure', t => {
  const h = queuedFixture(t, 0, 'generateWeeklyDraft');
  h.replies.push(CHECK);
  untilPhase(h, 'finalize');
  let deliveries = 0;
  let deliveryCheckpoint;
  h.beforeMail = () => {
    deliveries++;
    deliveryCheckpoint = h.pendingJob();
    throw new Error('Mail service disconnected after accepting the message');
  };
  // The worker may report the delivery error to its caller or capture it.
  try { h.worker(); } catch (error) { assert.match(error.message, /Mail service disconnected/); }
  assert.equal(deliveries, 1);
  assert.equal(deliveryCheckpoint.notificationAttempted, true, 'Checkpoint before sending, not after');
  if (h.pendingJob()) h.drain();
  h.run('processPendingFactCheck');
  assert.equal(deliveries, 1);
  assert.equal(h.documents.length, 2);
});

const VALID_PDF_REVIEW = { claimId: 0, verdict: 'supported', evidence: 'Bilagets modelvurderede belæg.' };
for (const [label, reply] of [
  ['missing reviews', {}],
  ['non-array reviews', { reviews: {} }],
  ['negative local ID', { reviews: [{ ...VALID_PDF_REVIEW, claimId: -1 }] }],
  ['unknown local ID', { reviews: [{ ...VALID_PDF_REVIEW, claimId: 1 }] }],
  ['fractional local ID', { reviews: [{ ...VALID_PDF_REVIEW, claimId: 0.5 }] }],
  ['string local ID', { reviews: [{ ...VALID_PDF_REVIEW, claimId: '0' }] }],
  ['duplicated local ID', { reviews: [VALID_PDF_REVIEW, { ...VALID_PDF_REVIEW, verdict: 'contradicted' }] }],
  ['automatic verified verdict', { reviews: [{ ...VALID_PDF_REVIEW, verdict: 'verified' }] }],
  ['blank evidence', { reviews: [{ ...VALID_PDF_REVIEW, evidence: '  ' }] }],
  ['non-string evidence', { reviews: [{ ...VALID_PDF_REVIEW, evidence: 42 }] }],
  ['null review', { reviews: [null] }],
  ['truncated JSON', '{"reviews":['],
  ['MAX_TOKENS even with valid JSON', { rawResponse: { candidates: [{ finishReason: 'MAX_TOKENS',
    content: { parts: [{ text: JSON.stringify({ reviews: [VALID_PDF_REVIEW] }) }] } }] } }]
]) {
  test(`PDF ${label} is rejected with bounded retries and never counts as checked`, t => {
    const h = queuedFixture(t, 1);
    h.replies.push(CHECK, ...Array.from({ length: 12 }, () => structuredClone(reply)));
    untilPhase(h, 'finalize');
    const job = h.pendingJob();
    assert.equal(job.pdfCursor, 1, 'Failed attachment has terminal status rather than blocking the queue');
    assert.ok(job.failures.length > 0, 'Invalid reviews remain visible as failure, not successful coverage');
    assert.ok(pdfCalls(h).length > 0 && pdfCalls(h).length <= 3,
      `No more than three PDF attempts across workers; observed ${pdfCalls(h).length} calls in ${new Set(pdfCalls(h).map(call => call.execution)).size} executions`);
    h.worker();
    assert.equal(h.pendingJob(), null);
    assert.doesNotMatch(h.report().text, /✅/);
    assert.match(h.report().text, /ufuld|fejl|mangler|ikke.*kontroll/i);
    assert.equal(h.mails.length, 0);
  });
}

for (const verdict of ['supported', 'contradicted']) {
  test(`PDF ${verdict} remains a visible manual model assessment, never a locally verified citation`, t => {
    const h = queuedFixture(t, 1);
    const unverified = { claims: [{ claim: GOOD.facts, verdict: 'unverified',
      evidence: 'Ikke fundet i originalteksten.', sourceIndex: null }] };
    h.replies.push(unverified, { reviews: [{ ...VALID_PDF_REVIEW, verdict }] });
    untilPhase(h, 'finalize');
    const job = h.pendingJob();
    assert.equal(job.failures.length, 0);
    assert.equal(job.textResult.summary.verified, 0);
    assert.equal(job.textResult.claims[0].verdict, 'unverified', 'A PDF review must not rewrite text verification');
    h.worker();
    assert.match(h.report().text, /model|manuel/i);
    assert.ok(h.report().text.includes(VALID_PDF_REVIEW.evidence), 'Reviewer can inspect the actual assessment');
    assert.ok(h.report().text.includes(h.pdfUrls[0]), 'Reviewer can open the particular PDF');
    assert.match(h.report().text, /Verificeret: 0/);
    assert.doesNotMatch(h.report().text, /✅/);
    if (verdict === 'contradicted') assert.match(h.report().text, /modsig|modsagt/i);
    assert.equal(h.mails.length, 0);
  });
}

test('empty PDF reviews are valid for an irrelevant attachment and do not trigger retries', t => {
  const h = queuedFixture(t, 1);
  h.replies.push(CHECK, { reviews: [] });
  untilPhase(h, 'finalize');
  assert.equal(h.pendingJob().failures.length, 0);
  assert.equal(h.pendingJob().pdfCursor, 1);
  assert.equal(pdfCalls(h).length, 1);
  h.worker();
  assert.doesNotMatch(h.report().text, /✅/);
});

test('prepare checkpoints each source and resumes the next source after its time budget is exhausted', t => {
  const first = item('first', 'Første sag');
  const second = item('second', 'Anden sag', 'En anden original kommunal beslutning.');
  const rows = [sourceRow(first), sourceRow(second)];
  rows[1][5] = 'FA:second-meeting:second';
  const h = harness(t, rows);
  h.agendas.set('council', [first]);
  h.agendas.set('second-meeting', [second]);
  h.replies.push(DRAFT, CHECK);
  h.run('testGenerateNewsletterWithoutEmail');
  const slowUrl = `${FA}/api/agenda/dagsorden/council`;
  const otherUrl = `${FA}/api/agenda/dagsorden/second-meeting`;
  let fetchCheckpoint;
  h.beforeFetch = url => {
    if (url === slowUrl) {
      fetchCheckpoint = { job: h.pendingJob(), triggers: h.workerTriggers().length };
      h.now += 280000;
      h.beforeFetch = null;
    }
  };
  h.worker();
  assert.equal(fetchCheckpoint.job.phase, 'prepare');
  assert.equal(fetchCheckpoint.triggers, 1, 'The source request also has a pre-existing recovery trigger');
  assert.equal(h.pendingJob().sourceCursor, 1, 'First completed source is durable before the next worker');
  assert.ok(!h.fetches.includes(otherUrl), 'Slow preparation really stops before the next source');
  assert.equal(h.modelCalls.length, 1);
  untilPhase(h, 'text');
  assert.equal(h.pendingJob().sourceCursor, 2);
  assert.equal(h.fetches.filter(url => url === slowUrl).length, 1, 'Already saved source is not fetched again');
  h.drain();
  assert.match(prompt(h.modelCalls[1]), /En anden original kommunal beslutning/);
  assert.match(prompt(h.modelCalls[1]), /Kommunen anlægger en cykelsti/);
  assert.equal(h.mails.length, 0);
});

test('a contending worker rearms its watchdog before the lock without modifying job or document', t => {
  const h = queuedFixture(t);
  const otherOwner = Symbol('another execution');
  h.owner = otherOwner;
  const before = h.pendingJob();
  const writes = h.fileWrites.length;
  const fetches = h.fetches.length;
  const doc = structuredClone(h.documents[0]);
  h.worker();
  assert.equal(h.owner, otherOwner);
  assert.deepEqual(h.pendingJob(), before);
  assert.equal(h.fileWrites.length, writes);
  assert.equal(h.fetches.length, fetches);
  assert.deepEqual(h.documents[0], doc);
  assert.equal(h.workerTriggers().length, 1);
  assert.equal(h.workerTriggers()[0].delay, 7 * 60 * 1000);
  assert.ok(h.lockEvents.some(event => event.entry === 'processPendingFactCheck' && event.acquired === false));
  h.owner = null;
  h.replies.push(CHECK);
  h.drain();
});

test('a failed replacement trigger never removes the existing continuation', t => {
  const h = queuedFixture(t);
  const continuation = h.workerTriggers()[0];
  const before = h.pendingJob();
  h.beforeTriggerCreate = () => { throw new Error('Trigger service unavailable'); };
  assert.throws(() => h.run('processPendingFactCheck'), /Trigger service unavailable/);
  assert.ok(h.triggers.includes(continuation));
  assert.deepEqual(h.pendingJob(), before);
  h.beforeTriggerCreate = null;
  h.replies.push(CHECK);
  h.drain();
  // Every deletion during replacement must leave its newly created successor.
  // Only final cleanup (the final deletion) may leave no continuation.
  const deletions = h.triggerEvents.filter(event => event.action === 'delete');
  assert.ok(deletions.slice(0, -1).every(event => event.remaining >= 1));
  assert.equal(deletions.at(-1).remaining, 0);
});

test('permanent PDF access failure ends the batch after one model call and continues after sixty seconds', t => {
  const h = queuedFixture(t, 1);
  h.replies.push(CHECK, { httpError: 403 });
  untilPhase(h, 'pdf');
  assert.equal(h.workerTriggers()[0].delay, 60000);
  h.worker();
  assert.equal(h.pendingJob().pdfCursor, 0);
  assert.equal(h.workerTriggers()[0].delay, 60000);
  assert.match(h.pendingJob().lastError.message, /HTTP 403/, 'Caught error remains visible in the durable job');
  assertCheckpoint(pdfCalls(h)[0], 'pdf');
  h.worker();
  assert.equal(h.pendingJob().pdfCursor, 1);
  assert.equal(h.pendingJob().phase, 'finalize');
  assert.equal(h.pendingJob().pdfReviews.length, 0, 'A permanent access failure cannot count as a completed review');
  assert.ok(h.pendingJob().failures.some(failure => failure.key === 'pdf:0'));
  assert.equal(pdfCalls(h).length, 1, 'HTTP 403 must not retry on this or a fallback model');
  assert.equal(h.workerTriggers()[0].delay, 60000);
  h.drain();
  assert.equal(pdfCalls(h).length, 1);
  assert.match(h.report().text, /DELE DER IKKE KUNNE KONTROLLERES/);
  assert.doesNotMatch(h.report().text, /✅/);
  assert.equal(h.mails.length, 0);
});


for (const point of ['setText', 'saveAndClose']) {
  test('interrupted report ' + point + ' resumes publication read-only and completes the pipeline', t => {
    const h = queuedFixture(t);
    h.replies.push(CHECK);
    untilPhase(h, 'finalize');
    const original = structuredClone(h.documents[0]);
    const hook = point === 'setText' ? 'afterDocumentSet' : 'afterDocumentSave';
    h[hook] = doc => { if (doc.id !== original.id) h.terminateExecution = true; };
    assert.throws(() => h.worker(), error => error.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT');
    h[hook] = null;
    const job = h.pendingJob(), report = h.report();
    assert.equal(job.phase, 'completed');
    assert.equal(job.reportPublication, 'writing');
    assert.equal(job.reportExpectedText, report.text, 'ID and expected text are durable before the first report write');
    assert.equal(job.attempts.publish, 1);
    const savedReport = structuredClone(report);
    const writes = h.documentWrites.length;
    h.drain();
    assert.equal(h.latestJob().reportPublication, 'published');
    assert.equal(h.latestJob().phase, 'completed');
    assert.equal(h.documentWrites.length, writes, 'Resume must never rewrite an existing report');
    assert.deepEqual(report, savedReport);
    assert.deepEqual(h.documents[0], original);
    assert.equal(h.documents.length, 2);
    assert.match(report.text, /Verificeret: 1/);
    assert.equal(h.mails.length, 0);
  });
}

test('different report text after interrupted publication is preserved and a fresh report is published', t => {
  const h = queuedFixture(t);
  h.replies.push(CHECK);
  untilPhase(h, 'finalize');
  const original = structuredClone(h.documents[0]);
  h.afterDocumentSet = doc => { if (doc.id !== original.id) h.terminateExecution = true; };
  assert.throws(() => h.worker(), error => error.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT');
  h.afterDocumentSet = null;
  const editedReport = h.report();
  editedReport.text += '\nMajas rettelse i den afbrudte rapport.';
  editedReport.modifiedAt += 1000;
  editedReport.nonTextContent = [{type:'image',id:'user-image'}];
  const preserved = structuredClone(editedReport);
  const writes = h.documentWrites.filter(write => write.id === editedReport.id).length;
  h.drain();
  assert.deepEqual(editedReport, preserved);
  assert.equal(h.documentWrites.filter(write => write.id === editedReport.id).length, writes);
  assert.notEqual(h.report().id, editedReport.id);
  assert.equal(h.documents.length, 3);
  assert.equal(h.latestJob().attempts.publish, 2);
  assert.ok(h.latestJob().preservedReports.some(report => report.id === editedReport.id));
  assert.match(h.report().text, /Verificeret: 1/);
  assert.ok(!h.report().text.includes('Majas rettelse'));
  assert.deepEqual(h.documents[0], original);
  assert.equal(h.mails.length, 0);
});

for (const point of ['setText', 'saveAndClose']) {
  test('format/image-only edits after interrupted report ' + point + ' survive read-only completion', t => {
    const h = queuedFixture(t);
    h.replies.push(CHECK);
    untilPhase(h, 'finalize');
    const original = structuredClone(h.documents[0]);
    const hook = point === 'setText' ? 'afterDocumentSet' : 'afterDocumentSave';
    h[hook] = doc => { if (doc.id !== original.id) h.terminateExecution = true; };
    assert.throws(() => h.worker(), error => error.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT');
    h[hook] = null;
    const report = h.report();
    assert.equal(report.text, h.pendingJob().reportExpectedText);
    report.nonTextContent = [{type:'format',bold:true},{type:'image',id:'user-image'}];
    report.modifiedAt += 1000;
    const preserved = structuredClone(report);
    const writes = h.documentWrites.length;
    h.drain();
    assert.deepEqual(report, preserved, 'Identical plaintext is permission to accept publication, never to rewrite it');
    assert.equal(h.documentWrites.length, writes);
    assert.deepEqual(h.documents[0], original);
    assert.equal(h.latestJob().reportPublication, 'published');
    assert.equal(h.latestJob().attempts.publish, 1);
    assert.equal(h.documents.length, 2);
    assert.equal(h.mails.length, 0);
  });
}

test('termination after final document checkpoint resumes notification and cleanup exactly once', t => {
  const h = queuedFixture(t, 0, 'generateWeeklyDraft');
  h.replies.push(CHECK);
  untilPhase(h, 'finalize');
  h.afterFileWrite = file => {
    const job = JSON.parse(file.content);
    if (job.phase === 'completed' && job.reportPublication === 'published' && !job.notificationAttempted) h.terminateExecution = true;
  };
  assert.throws(() => h.worker(), error => error.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT');
  assert.equal(h.pendingJob().phase, 'completed');
  assert.equal(h.pendingJob().notificationAttempted, false);
  assert.equal(h.mails.length, 0);
  h.afterFileWrite = null;
  const completedId = h.properties.get('PENDING_FACTCHECK_JOB_ID');
  h.run('generateWeeklyDraft');
  assert.equal(h.properties.get('PENDING_FACTCHECK_JOB_ID'), completedId);
  assert.equal(h.documents.length, 2, 'Completed job with pending cleanup still blocks a duplicate draft');
  assert.equal(h.modelCalls.length, 2, 'No extra newsletter model call during finalization recovery');
  h.drain();
  assert.equal(h.mails.length, 1);
  h.run('processPendingFactCheck');
  assert.equal(h.mails.length, 1);
  assert.equal(h.documents.length, 2);
});

test('termination after successful notification does not send again during cleanup recovery', t => {
  const h = queuedFixture(t, 0, 'generateWeeklyDraft');
  h.replies.push(CHECK);
  untilPhase(h, 'finalize');
  h.afterMail = () => { h.terminateExecution = true; };
  assert.throws(() => h.worker(), error => error.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT');
  assert.equal(h.pendingJob().notificationAttempted, true);
  assert.equal(h.mails.length, 1);
  h.afterMail = null;
  const report = h.report();
  report.text += '\nUser edit after confirmed publication.';
  report.nonTextContent = [{type:'image',id:'published-report-image'}];
  report.modifiedAt += 1000;
  const preserved = structuredClone(report);
  const writes = h.documentWrites.length;
  h.unavailableDocuments.add(report.id);
  h.drain();
  assert.deepEqual(report, preserved, 'Published report retry neither reads nor rewrites the document');
  assert.equal(h.documentWrites.length, writes);
  assert.equal(h.documents.length, 2);
  assert.equal(h.mails.length, 1);
  assert.equal(h.workerTriggers().length, 0);
});

test('Gmail PDFs are cached privately and all survive fresh worker executions without rereading mail', t => {
  const source = sourceRow(item());
  source[4] = 'fixture@example.invalid'; source[5] = 'pdf-mail'; source[6] = '';
  const h = harness(t, [source]);
  const msg = message('pdf-mail');
  msg.getPlainBody = () => GOOD.facts;
  const pdfs = [Buffer.concat([Buffer.from('%PDF-1.4\nprivate attachment 1'), Buffer.from([0, 128, 255])]),
    Buffer.from('%PDF-1.4\nprivate attachment 2')];
  msg.getAttachments = () => pdfs.map((text, i) => ({
    getName: () => `Mailbilag ${i + 1}.pdf`, getSize: () => Buffer.byteLength(text),
    getBytes: () => Array.from(Buffer.from(text))
  }));
  h.threads = [thread(msg)];
  h.replies.push(DRAFT, CHECK, { reviews: [] }, { reviews: [] });
  h.run('testGenerateNewsletterWithoutEmail');
  untilPhase(h, 'text');
  const job = h.pendingJob();
  assert.equal(job.pdfTasks.length, 2);
  for (const task of job.pdfTasks) {
    assert.equal(task.type, 'file');
    const file = h.files.get(task.fileId);
    assert.equal(file.folder, h.properties.get('FACTCHECK_DATA_FOLDER_ID'));
    assert.equal(h.folders.get(file.folder).parent, null);
  }
  for (const pdf of pdfs) assert.ok(!JSON.stringify(job).includes(Buffer.from(pdf).toString('base64')),
    'JSON checkpoints contain file references, not embedded PDF payloads');
  h.threads = []; // Remaining executions must use the durable, private cache.
  h.drain();
  assert.deepEqual(pdfCalls(h).map(call => call.payload.contents.flatMap(c => c.parts).find(p => p.inline_data).inline_data.data),
    pdfs.map(pdf => Buffer.from(pdf).toString('base64')));
  assert.equal(h.mails.length, 0);
  assert.doesNotMatch(h.report().text, /✅/);
});

test('valid local PDF claim IDs include the last claim and retain the fixed ordering', t => {
  const h = queuedFixture(t, 1);
  const secondClaim = 'Kommunen har endnu ikke oplyst en pris.';
  h.replies.push({ claims: [...CHECK.claims, { claim: secondClaim, verdict: 'unverified',
    evidence: 'Ikke fundet i kildedata.', sourceIndex: null }] },
  { reviews: [{ claimId: 1, verdict: 'contradicted', evidence: 'Prisoverslag: 10 mio. kr.' }, VALID_PDF_REVIEW] });
  untilPhase(h, 'finalize');
  assert.equal(h.pendingJob().failures.length, 0);
  assert.deepEqual(h.pendingJob().pdfReviews[0].reviews.map(review => review.claimId), [1, 0]);
  assert.match(prompt(pdfCalls(h)[0]), /"claimId":0/);
  assert.match(prompt(pdfCalls(h)[0]), /"claimId":1/);
  h.worker();
  assert.ok(h.report().text.includes(secondClaim));
  assert.match(h.report().text, /Prisoverslag: 10 mio/);
  assert.doesNotMatch(h.report().text, /✅/);
});

test('an unsupported attachment remains visible without dropping supported PDFs on the same source', t => {
  const h = queuedFixture(t, 2);
  h.agendas.get('council')[0].Bilag.unshift({ Id: 'unsupported', HarPdfVersion: false, Navn: 'Utilgængeligt originalbilag' });
  h.replies.push(CHECK, { reviews: [] }, { reviews: [] });
  untilPhase(h, 'finalize');
  const job = h.pendingJob();
  assert.equal(job.pdfTasks.length, 3);
  assert.equal(job.pdfCursor, 3);
  assert.equal(job.pdfReviews.length, 2);
  assert.equal(job.failures.length, 1);
  h.worker();
  assert.equal(pdfCalls(h).length, 2);
  assert.match(h.report().text, /Utilgængeligt originalbilag/);
  assert.doesNotMatch(h.report().text, /✅/);
});

test('failed text validation is bounded across workers and leaves every dependent PDF explicitly unresolved', t => {
  const h = queuedFixture(t, 2);
  h.replies.push(...Array.from({ length: 20 }, () => ({})));
  untilPhase(h, 'finalize');
  const job = h.pendingJob();
  const textCalls = h.modelCalls.filter(call => call.job?.phase === 'text');
  for (const [index] of job.pdfTasks.entries()) {
    assert.ok(job.failures.some(failure => failure.key === `pdf:${index}`)
      || job.pdfReviews.some(review => review.taskIndex === index),
    `PDF ${index} must have a visible terminal result when the fixed claim list cannot be produced`);
  }
  assert.equal(job.pdfCursor, job.pdfTasks.length);
  assert.ok(textCalls.length > 0 && textCalls.length <= 3,
    `No more than three text model attempts; observed ${textCalls.length}`);
  h.worker();
  assert.match(h.report().text, /FAKTA-TJEK KUNNE IKKE KØRES/);
  assert.doesNotMatch(h.report().text, /✅/);
  assert.equal(h.mails.length, 0);
});

test('CRLF newsletter text survives Docs LF normalization without being treated as a user edit', t => {
  const h = harness(t, [sourceRow(item())]);
  h.agendas.set('council', [item()]);
  h.replies.push(DRAFT.replace(/\n/g, '\r\n'), CHECK);
  h.run('testGenerateNewsletterWithoutEmail');
  assert.doesNotMatch(h.documents[0].text, /\r/);
  h.drain();
  assert.match(h.report().text, /Verificeret: 1/);
  assert.equal(JSON.parse([...h.files.values()].find(file => file.name.endsWith('.json')).content).phase, 'completed');
  assert.equal(h.documents.length, 2);
  assert.equal(h.mails.length, 0);
});

for (const problem of ['deleted job file']) {
  test(`${problem} stops after three infrastructure failures and does not block next week's draft`, t => {
    const h = queuedFixture(t, 0, 'generateWeeklyDraft');
    const originalJob = h.pendingJob();
    const originalDoc = structuredClone(h.documents[0]);
    const sourceRows = structuredClone(h.rows);
    const writes = h.writes.length;
    const fetches = h.fetches.length;
    const preserved = new Map(h.properties);
    preserved.delete('PENDING_FACTCHECK_JOB_ID');
    preserved.set('ANALYSIS_RETRY_FA:council:cycle', 'unrelated-retry');
    for (const [key, value] of preserved) h.properties.set(key, value);
    const otherTriggers = ['dailyIngest', 'dailyRepairAnalyses', 'generateWeeklyDraft', 'otherProjectTask']
      .map(handler => ({ handler, getHandlerFunction() { return this.handler; } }));
    h.triggers.push(...otherTriggers);
    // An old job's failures must never consume the current job's retry budget.
    h.properties.set('FACTCHECK_INFRA_FAILURES', JSON.stringify({ jobFileId: 'old-job', count: 2 }));
    h.files.delete(originalJob.jobFileId);
    h.deletedFiles.add(originalJob.jobFileId);

    for (let count = 1; count <= 3; count++) {
      h.worker();
      const failure = JSON.parse(h.properties.get('FACTCHECK_INFRA_FAILURES'));
      assert.equal(failure.jobFileId, originalJob.jobFileId);
      assert.equal(failure.count, count);
      assert.match(failure.message, /Drive file not found/);
      assert.ok(failure.updatedAt);
      assert.equal(h.owner, null, 'Infrastructure failures still release the script lock');
      assert.deepEqual(h.documents[0], originalDoc, 'Failure handling must not overwrite the original draft');
      assert.deepEqual(h.rows, sourceRows);
      assert.equal(h.writes.length, writes);
      assert.equal(h.fetches.length, fetches, 'No source or model requests when job/document access fails');
      assert.equal(h.mails.length, 0, 'Do not notify using missing or untrusted job options');
      for (const [key, value] of preserved) assert.equal(h.properties.get(key), value, key);
      for (const trigger of otherTriggers) assert.ok(h.triggers.includes(trigger));
      if (count < 3) {
        assert.equal(h.properties.get('PENDING_FACTCHECK_JOB_ID'), originalJob.jobFileId);
        assert.equal(h.workerTriggers().length, 1);
        assert.equal(h.workerTriggers()[0].delay, 7 * 60 * 1000);
        assert.equal(h.properties.has('LAST_FACTCHECK_FAILURE'), false, 'Transient failures do not terminate the job early');
      }
    }

    assert.equal(h.properties.has('PENDING_FACTCHECK_JOB_ID'), false);
    assert.deepEqual(h.triggers, otherTriggers);
    const diagnostic = JSON.parse(h.properties.get('LAST_FACTCHECK_FAILURE'));
    assert.equal(diagnostic.jobFileId, originalJob.jobFileId);
    assert.equal(diagnostic.count, 3);
    assert.equal(h.files.has(originalJob.jobFileId), false, 'Do not recreate the deleted job file');
    h.run('processPendingFactCheck');
    assert.deepEqual(h.triggers, otherTriggers, 'A late worker after terminal cleanup is harmless');
    assert.equal(h.mails.length, 0);

    // The old job file stays deleted; new weekly sources must still be usable.
    h.now = NOW + 7 * DAY;
    const nextSource = item('next-week', 'Ny sag i næste uge');
    const nextRow = sourceRow(nextSource);
    nextRow[0] = '2026-09-14 12:00'; nextRow[15] = '2026-09-14T12:00:00Z';
    h.rows.push(nextRow);
    h.agendas.set('council', [nextSource]);
    h.replies.push(DRAFT, CHECK);
    h.run('testGenerateNewsletterWithoutEmail');
    const nextJob = h.pendingJob();
    assert.equal(h.documents.length, 2, 'Next week can create one new draft after the old queue is stopped');
    assert.notEqual(nextJob.docId, originalJob.docId);
    assert.notEqual(nextJob.jobFileId, originalJob.jobFileId);
    assert.equal(h.properties.has('FACTCHECK_INFRA_FAILURES'), false, 'A newly queued job resets the active failure counter');
    assert.deepEqual(JSON.parse(h.properties.get('LAST_FACTCHECK_FAILURE')), diagnostic,
      'Keep the previous failure diagnostic available for inspection');
    h.drain();
    assert.match(h.report().text, /Verificeret: 1/);
    assert.equal(h.documents.length, 3);
    assert.deepEqual(h.documents[0], originalDoc);
    assert.equal(h.mails.length, 0);
    assert.deepEqual(h.triggers, otherTriggers);
  });
}

test('a successful worker resets infrastructure failures so intermittent access errors do not accumulate', t => {
  const h = queuedFixture(t);
  const jobId = h.pendingJob().jobFileId;
  h.beforeFileWrite = file => { if (file.id === jobId) throw new Error('Drive write access denied'); };
  h.worker(); h.worker();
  assert.equal(JSON.parse(h.properties.get('FACTCHECK_INFRA_FAILURES')).count, 2);
  h.beforeFileWrite = null;
  h.worker();
  assert.equal(h.pendingJob().phase, 'text');
  assert.equal(h.properties.has('FACTCHECK_INFRA_FAILURES'), false);
  h.beforeFileWrite = file => { if (file.id === jobId) throw new Error('Drive write access denied'); };
  h.worker();
  const failure = JSON.parse(h.properties.get('FACTCHECK_INFRA_FAILURES'));
  assert.equal(failure.jobFileId, jobId);
  assert.equal(failure.count, 1, 'Successful work starts a fresh consecutive-failure budget');
  assert.equal(h.properties.has('LAST_FACTCHECK_FAILURE'), false);
  assert.equal(h.properties.get('PENDING_FACTCHECK_JOB_ID'), jobId);
  h.beforeFileWrite = null;
  h.replies.push(CHECK);
  h.drain();
  assert.equal(h.documents.length, 2);
  assert.match(h.report().text, /Verificeret: 1/);
  assert.equal(h.mails.length, 0);
  assert.equal(h.properties.has('FACTCHECK_INFRA_FAILURES'), false);
});


for (const when of ['before the worker', 'during the text model call']) {
  test('a timestamp-only original edit ' + when + ' is preserved without interrupting report generation', t => {
    const h = queuedFixture(t);
    h.replies.push(CHECK);
    untilPhase(h, 'text');
    const original = h.documents[0];
    const edit = () => { original.modifiedAt += 1000; original.nonTextContent = [{type:'image',id:'user-image'}]; };
    if (when === 'before the worker') edit();
    else h.beforeModel = edit;
    h.worker();
    h.beforeModel = null;
    const preserved = structuredClone(original);
    h.drain();
    assert.deepEqual(original, preserved);
    assert.equal(h.latestJob().phase, 'completed');
    assert.equal(h.latestJob().reportPublication, 'published');
    assert.equal(h.documents.length, 2);
    assert.match(h.report().text, /Verificeret: 1/);
    assert.equal(h.mails.length, 0);
  });
}

for (const problem of ['access revoked', 'deleted']) {
  test('original document ' + problem + ' does not halt fact checking or publication', t => {
    const h = queuedFixture(t);
    const original = structuredClone(h.documents[0]);
    h.unavailableDocuments.add(original.id);
    if (problem === 'deleted') h.deletedFiles.add(original.id);
    h.replies.push(CHECK);
    h.drain();
    assert.deepEqual(h.documents[0], original);
    assert.equal(h.latestJob().phase, 'completed');
    assert.match(h.report().text, /Verificeret: 1/);
    assert.equal(h.properties.has('FACTCHECK_INFRA_FAILURES'), false);
    assert.equal(h.mails.length, 0);
  });
}

test('inaccessible reports exhaust three publication attempts while preserving results and all existing documents', t => {
  const h = queuedFixture(t);
  h.replies.push(CHECK);
  untilPhase(h, 'finalize');
  const original = structuredClone(h.documents[0]);
  h.afterDocumentCreate = doc => { h.unavailableDocuments.add(doc.id); };
  h.afterDocumentSet = doc => { if (doc.id !== original.id) throw new Error('Report save access denied'); };
  for (let attempt = 1; attempt <= 3; attempt++) {
    h.worker();
    assert.equal(h.pendingJob().attempts.publish, attempt);
    assert.equal(h.workerTriggers()[0].delay, 15 * 60 * 1000);
  }
  const reports = structuredClone(h.documents.slice(1));
  h.worker();
  assert.equal(h.pendingJob(), null);
  assert.equal(h.latestJob().phase, 'failed');
  assert.equal(h.latestJob().attempts.publish, 3);
  assert.equal(h.latestJob().textResult.summary.verified, 1, 'Computed results survive publication failure');
  assert.ok(h.latestJob().failures.some(failure => failure.key === 'publish'));
  assert.equal(h.latestJob().preservedReports.length, 3);
  assert.equal(h.documents.length, 4);
  assert.deepEqual(h.documents.slice(1), reports);
  assert.deepEqual(h.documents[0], original);
  assert.ok(h.properties.has('LAST_FACTCHECK_FAILURE'));
  assert.equal(h.workerTriggers().length, 0);
  assert.equal(h.mails.length, 0);
});

test('a crash after report creation but before its ID checkpoint leaves the orphan untouched and resumes within the publication budget', t => {
  const h = queuedFixture(t);
  h.replies.push(CHECK);
  untilPhase(h, 'finalize');
  const original = structuredClone(h.documents[0]);
  h.afterDocumentCreate = () => { h.terminateExecution = true; };
  assert.throws(() => h.worker(), error => error.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT');
  h.afterDocumentCreate = null;
  assert.equal(h.pendingJob().reportDocId, null, 'Crash happens before the new report ID is durable');
  assert.equal(h.pendingJob().attempts.publish, 1, 'Creation attempt is durable even when the new ID is lost');
  assert.equal(h.workerTriggers().length, 1);
  const orphan = h.documents[1];
  const preserved = structuredClone(orphan);
  h.drain();
  assert.deepEqual(orphan, preserved);
  assert.equal(orphan.text, '');
  assert.ok(!h.documentWrites.some(write => write.id === orphan.id), 'Never guess which uncheckpointed document to reuse');
  assert.equal(h.latestJob().attempts.publish, 2);
  assert.equal(h.latestJob().reportPublication, 'published');
  assert.equal(h.documents.length, 3);
  assert.notEqual(h.report().id, orphan.id);
  assert.deepEqual(h.documents[0], original);
  assert.match(h.report().text, /Verificeret: 1/);
  assert.equal(h.mails.length, 0);
});
