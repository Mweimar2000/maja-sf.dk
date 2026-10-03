'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Reuse the existing in-memory Google service fakes without registering their
// tests again. No network, Apps Script account, or real credentials are used.
const fixtureContext = vm.createContext({
  require: name => name === 'node:test' ? { test() {} } : require(name),
  __dirname, process, Buffer, structuredClone
});
vm.runInContext(
  fs.readFileSync(path.join(__dirname, 'integration.test.cjs'), 'utf8')
    + '\nglobalThis.fixtures = { harness, item, sourceRow, prompt, DRAFT, CHECK, NOW, DAY };',
  fixtureContext
);
const { harness, item, sourceRow, prompt, DRAFT, CHECK, NOW, DAY } = fixtureContext.fixtures;
const HOUR = 60 * 60 * 1000;

function setup(t, rows = [sourceRow(item())]) {
  const h = harness(t, rows);
  h.generationRetries = () => h.triggers.filter(trigger => trigger.handler === 'retryWeeklyDraft');
  h.failModel = code => {
    h.replies.length = 0;
    h.beforeModel = () => h.replies.push({ httpError: code });
  };
  h.succeedModel = () => {
    h.beforeModel = null;
    h.replies.length = 0;
    h.replies.push(DRAFT);
  };
  h.fireRetry = () => {
    assert.equal(h.generationRetries().length, 1, 'Exactly one generation retry is scheduled');
    const trigger = h.generationRetries()[0];
    h.triggers.splice(h.triggers.indexOf(trigger), 1);
    h.now += trigger.delay;
    return h.run('retryWeeklyDraft', { triggerUid: trigger.id });
  };
  return h;
}

function attemptWithoutTerminalAssertion(work) {
  // Terminal failures may throw for the Apps Script execution log. Their
  // observable effects (no extra generation or retry) are asserted separately.
  try { work(); } catch (error) {
    assert.match(error.message, /generer|genforsøg|retry|udløb|deadline|forsøg/i);
  }
}

for (const code of [503, 429]) {
  test(`weekly timer defers HTTP ${code} without creating a draft or sending an error email`, t => {
    const h = setup(t);
    h.failModel(code);

    assert.doesNotThrow(() => h.run('generateWeeklyDraft', { triggerUid: 'weekly-base' }));

    assert.ok(h.modelCalls.length > 0, 'The newsletter was attempted');
    assert.equal(h.documents.length, 0);
    assert.equal(h.mails.length, 0, 'A scheduled automatic retry is not a terminal error');
    assert.equal(h.generationRetries().length, 1);
    const delay = h.generationRetries()[0].delay;
    if (code === 503) {
      assert.ok(delay >= 55 * 60 * 1000 && delay <= 65 * 60 * 1000, 'Temporary outage retries in about one hour');
    } else {
      assert.ok(delay >= 22 * HOUR && delay <= 23.5 * HOUR, 'Quota retry leaves room for three runs within 48 hours');
    }
  });
}

test('a retry preserves the original newsletter period and source date boundaries', t => {
  const boundary = sourceRow(item('boundary', 'Sag lige inden for ugegrænsen'));
  boundary[0] = '2026-09-01 12:30';
  boundary[15] = new Date(NOW - 7 * DAY + HOUR / 2).toISOString();
  const h = setup(t, [sourceRow(item()), boundary]);
  h.failModel(429);
  assert.doesNotThrow(() => h.run('generateWeeklyDraft', { triggerUid: 'weekly-base' }));
  const originalPrompt = prompt(h.modelCalls[0]);
  assert.match(originalPrompt, /Sag lige inden for ugegrænsen/);

  const later = sourceRow(item('later', 'Ny sag efter det oprindelige ugevindue'));
  later[0] = '2026-09-08 12:30';
  later[15] = new Date(NOW + HOUR / 2).toISOString();
  h.rows.push(later);
  h.succeedModel();
  assert.doesNotThrow(() => h.fireRetry());

  const retryPrompt = prompt(h.modelCalls.at(-1));
  assert.equal(retryPrompt.match(/^Perioden: (.+)$/m)?.[1], originalPrompt.match(/^Perioden: (.+)$/m)?.[1]);
  assert.match(retryPrompt, /Sag lige inden for ugegrænsen/, 'A retry does not age out an original source');
  assert.doesNotMatch(retryPrompt, /Ny sag efter det oprindelige ugevindue/, 'A retry does not include later publications');
  assert.equal(h.documents.length, 1, 'One successful generation creates one draft');
  assert.equal(h.generationRetries().length, 0);
});

test('a consumed retry UID cannot repeat generation or replace its successor', t => {
  const h = setup(t);
  h.failModel(503);
  assert.doesNotThrow(() => h.run('generateWeeklyDraft', { triggerUid: 'weekly-base' }));
  const oldUid = h.generationRetries()[0].id;
  assert.doesNotThrow(() => h.fireRetry());
  const newUid = h.generationRetries()[0].id;
  assert.notEqual(newUid, oldUid);
  const calls = h.modelCalls.length;

  h.run('retryWeeklyDraft', { triggerUid: oldUid });
  h.run('retryWeeklyDraft');
  assert.equal(h.modelCalls.length, calls, 'Duplicate and manual retry events perform no work');
  assert.equal(h.generationRetries().length, 1);
  assert.equal(h.generationRetries()[0].id, newUid);
});

for (const code of [503, 429]) {
  test(`HTTP ${code} is limited to three generation executions including the initial timer`, t => {
    const h = setup(t);
    h.failModel(code);
    assert.doesNotThrow(() => h.run('generateWeeklyDraft', { triggerUid: 'weekly-base' }));
    assert.doesNotThrow(() => h.fireRetry());
    assert.equal(h.mails.length, 0, 'The second run can still defer without an error email');
    const finalUid = h.generationRetries()[0].id;
    attemptWithoutTerminalAssertion(() => h.fireRetry());

    assert.equal(new Set(h.modelCalls.map(call => call.execution)).size, 3);
    assert.ok(h.now - NOW < 48 * HOUR, 'All three scheduled generation runs fit inside the deadline');
    assert.equal(h.generationRetries().length, 0, 'The last failure cannot start a fourth run');
    assert.equal(h.documents.length, 0);
    assert.ok(h.mails.length <= 1, 'At most the terminal failure sends an error email');
    const calls = h.modelCalls.length;
    h.run('retryWeeklyDraft', { triggerUid: finalUid });
    assert.equal(h.modelCalls.length, calls, 'Terminal retry UID is invalidated');
  });
}

test('a retry delivered after 48 hours expires before contacting the model', t => {
  const h = setup(t);
  h.failModel(503);
  assert.doesNotThrow(() => h.run('generateWeeklyDraft', { triggerUid: 'weekly-base' }));
  const trigger = h.generationRetries()[0];
  h.triggers.splice(h.triggers.indexOf(trigger), 1);
  h.now = NOW + 48 * HOUR + 1;
  const calls = h.modelCalls.length;

  attemptWithoutTerminalAssertion(() => h.run('retryWeeklyDraft', { triggerUid: trigger.id }));
  assert.equal(h.modelCalls.length, calls);
  assert.equal(h.generationRetries().length, 0);
  assert.equal(h.documents.length, 0);
});

test('a new weekly timer starts a fresh retry budget after the old window expired', t => {
  const h = setup(t);
  h.failModel(503);
  assert.doesNotThrow(() => h.run('generateWeeklyDraft', { triggerUid: 'weekly-base' }));
  const oldUid = h.generationRetries()[0].id;
  h.now = NOW + 7 * DAY;
  h.rows[1][0] = '2026-09-14 12:00';
  h.rows[1][15] = new Date(h.now - DAY).toISOString();
  const calls = h.modelCalls.length;

  assert.doesNotThrow(() => h.run('generateWeeklyDraft', { triggerUid: 'weekly-base' }));
  assert.ok(h.modelCalls.length > calls, 'The next week gets a fresh first attempt');
  assert.equal(h.generationRetries().length, 1);
  assert.notEqual(h.generationRetries()[0].id, oldUid);
  assert.equal(h.mails.length, 0);
  const newCalls = h.modelCalls.length;
  h.run('retryWeeklyDraft', { triggerUid: oldUid });
  assert.equal(h.modelCalls.length, newCalls, 'The prior week cannot overwrite the new state');
  assert.doesNotThrow(() => h.fireRetry(), 'The new week also has a second attempt');
  assert.equal(h.generationRetries().length, 1, 'The new week retains its third attempt');
});

test('manual no-email generation does not schedule a retry when all model calls fail', t => {
  const h = setup(t);
  h.failModel(503);
  assert.throws(() => h.run('testGenerateNewsletterWithoutEmail'), /generer/i);
  assert.equal(h.documents.length, 0);
  assert.equal(h.mails.length, 0);
  assert.equal(h.generationRetries().length, 0);
});

test('successful manual no-email generation cancels the outstanding generation retry', t => {
  const h = setup(t);
  h.failModel(503);
  assert.doesNotThrow(() => h.run('generateWeeklyDraft', { triggerUid: 'weekly-base' }));
  const oldUid = h.generationRetries()[0].id;
  h.succeedModel();
  h.run('testGenerateNewsletterWithoutEmail');

  assert.equal(h.documents.length, 1);
  assert.equal(h.mails.length, 0);
  assert.equal(h.generationRetries().length, 0);
  const calls = h.modelCalls.length;
  h.run('retryWeeklyDraft', { triggerUid: oldUid });
  assert.equal(h.modelCalls.length, calls);
  assert.equal(h.documents.length, 1);
});

test('permanent HTTP 403 fails normally and does not schedule generation retry', t => {
  const h = setup(t);
  h.failModel(403);
  assert.throws(() => h.run('generateWeeklyDraft', { triggerUid: 'weekly-base' }), /generer/i);
  assert.equal(h.modelCalls.length, 1, 'Invalid credentials must not be retried on fallback models');
  assert.equal(h.documents.length, 0);
  assert.equal(h.mails.length, 1);
  assert.equal(h.generationRetries().length, 0);
});

test('an error after document creation never schedules a new newsletter generation', t => {
  const h = setup(t);
  h.succeedModel();
  h.afterDocumentCreate = () => { throw new Error('Document service unavailable HTTP 503'); };
  assert.throws(() => h.run('generateWeeklyDraft', { triggerUid: 'weekly-base' }), /Document service unavailable/);
  assert.equal(h.documents.length, 1, 'A document already exists when the service fails');
  assert.equal(h.generationRetries().length, 0, 'Generation retry could duplicate an already created draft');
});

test('the delayed newsletter uses the current date and excludes meetings that already passed', t => {
  const h = setup(t);
  h.failModel(429);
  h.run('generateWeeklyDraft', { triggerUid: 'weekly-base' });
  // The calendar endpoint changes between executions. This meeting is inside
  // the original upcoming window, but it is in the past at the delayed run.
  h.meetings.push({ Id: 'passed-meeting', Navn: 'Møde afholdt under kvotepausen',
    Dato: new Date(NOW + 2 * HOUR).toISOString(), Afsluttet: false });
  h.succeedModel();
  h.fireRetry();

  const retryPrompt = prompt(h.modelCalls.at(-1));
  assert.match(retryPrompt, /Dags dato i projektets tidszone: 2026-09-09/);
  assert.doesNotMatch(retryPrompt, /Møde afholdt under kvotepausen/);
  assert.match(retryPrompt, /Ingen kommende møder i de tilgængelige kalenderdata/);
  assert.equal(h.documents.length, 1);
});

test('an initial robot lock conflict can reach generation retry without any prior generation state', t => {
  const h = setup(t);
  h.failModel(503);
  h.owner = Symbol('another robot execution');
  h.run('generateWeeklyDraft', { triggerUid: 'weekly-base' });
  assert.equal(h.modelCalls.length, 0);
  assert.equal(h.generationRetries().length, 1);
  assert.equal(h.generationRetries()[0].delay, 7 * 60 * 1000);
  h.owner = null;

  assert.doesNotThrow(() => h.fireRetry());
  assert.ok(h.modelCalls.length > 0, 'The lock retry gets the first real generation attempt');
  assert.equal(h.generationRetries().length, 1);
  assert.equal(h.generationRetries()[0].delay, HOUR, 'Model failure switches to the generation retry interval');
  assert.equal(h.mails.length, 0);
  assert.doesNotThrow(() => h.fireRetry());
  attemptWithoutTerminalAssertion(() => h.fireRetry());
  assert.equal(new Set(h.modelCalls.map(call => call.execution)).size, 3, 'The blocked timer does not use up a generation attempt');
  assert.equal(h.generationRetries().length, 0);
});

test('a lock conflict during generation retry preserves the retry window and attempt budget', t => {
  const boundary = sourceRow(item('boundary', 'Oprindelig sag ved ugegrænsen'));
  boundary[0] = '2026-09-01 12:30';
  boundary[15] = new Date(NOW - 7 * DAY + HOUR / 2).toISOString();
  const h = setup(t, [sourceRow(item()), boundary]);
  h.failModel(503);
  h.run('generateWeeklyDraft', { triggerUid: 'weekly-base' });
  const originalPeriod = prompt(h.modelCalls[0]).match(/^Perioden: (.+)$/m)?.[1];
  const initialCalls = h.modelCalls.length;
  const blockedUid = h.generationRetries()[0].id;
  h.owner = Symbol('another robot execution');
  h.fireRetry();
  assert.equal(h.modelCalls.length, initialCalls);
  assert.equal(h.generationRetries().length, 1);
  assert.equal(h.generationRetries()[0].delay, 7 * 60 * 1000);
  assert.notEqual(h.generationRetries()[0].id, blockedUid);
  h.owner = null;

  h.run('retryWeeklyDraft', { triggerUid: blockedUid });
  assert.equal(h.modelCalls.length, initialCalls, 'The blocked event cannot repeat work after its replacement');
  assert.doesNotThrow(() => h.fireRetry());
  const retryPrompt = prompt(h.modelCalls.at(-1));
  assert.equal(retryPrompt.match(/^Perioden: (.+)$/m)?.[1], originalPeriod);
  assert.match(retryPrompt, /Oprindelig sag ved ugegrænsen/);
  assert.equal(h.mails.length, 0);
  attemptWithoutTerminalAssertion(() => h.fireRetry());
  assert.equal(new Set(h.modelCalls.map(call => call.execution)).size, 3);
  assert.equal(h.generationRetries().length, 0);
});

for (const failure of ['create', 'uid']) {
  test(`generation retry scheduling failure (${failure}) leaves no orphan timer and permits recovery`, t => {
    const h = setup(t);
    h.failModel(503);
    let rejectedUid;
    h.beforeTriggerCreate = trigger => {
      if (trigger.handler !== 'retryWeeklyDraft') return;
      rejectedUid = trigger.id;
      if (failure === 'create') throw new Error('Fixture scheduler creation failed');
      trigger.getUniqueId = () => { throw new Error('Fixture scheduler UID unavailable'); };
    };

    assert.throws(() => h.run('generateWeeklyDraft', { triggerUid: 'weekly-base' }), /Fixture scheduler/);
    assert.equal(h.documents.length, 0);
    assert.equal(h.generationRetries().length, 0, 'A timer without a registered UID must not remain scheduled');
    assert.equal(h.owner, null, 'Failure releases the robot lock');
    assert.equal(h.schedulerOwner, null, 'Failure releases the scheduler lock');
    const calls = h.modelCalls.length;
    h.run('retryWeeklyDraft', { triggerUid: rejectedUid });
    assert.equal(h.modelCalls.length, calls, 'A failed registration must not authorize an event');

    h.beforeTriggerCreate = null;
    h.succeedModel();
    h.run('generateWeeklyDraft', { triggerUid: 'weekly-base' });
    assert.equal(h.documents.length, 1, 'The next invocation can recover after a scheduler failure');
    assert.equal(h.generationRetries().length, 0);
  });
}

test('a duplicate weekly base event cannot reopen the budget after three failed generation runs', t => {
  const h = setup(t);
  h.failModel(503);
  h.run('generateWeeklyDraft', { triggerUid: 'weekly-base' });
  h.fireRetry();
  attemptWithoutTerminalAssertion(() => h.fireRetry());
  const calls = h.modelCalls.length;
  const mails = h.mails.length;

  h.now += HOUR;
  assert.doesNotThrow(() => h.run('generateWeeklyDraft', { triggerUid: 'weekly-base' }));
  assert.equal(h.modelCalls.length, calls, 'A delayed duplicate cannot grant another three generation attempts');
  assert.equal(h.mails.length, mails, 'The terminal notification must not be repeated');
  assert.equal(h.generationRetries().length, 0);
  assert.equal(h.documents.length, 0);
});

test('a duplicate weekly base event cannot regenerate a draft after its fact check completed', t => {
  const h = setup(t);
  h.agendas.set('council', [item()]);
  h.succeedModel();
  h.replies.push(CHECK);
  h.run('generateWeeklyDraft', { triggerUid: 'weekly-base' });
  h.drain();
  assert.equal(h.pendingJob(), null, 'No pending fact check remains to prevent duplicate generation');
  assert.equal(h.documents.length, 2, 'Original draft and separate fact-check report exist');
  const calls = h.modelCalls.length;
  const mails = h.mails.length;
  h.failModel(503);

  h.now += HOUR;
  assert.doesNotThrow(() => h.run('generateWeeklyDraft', { triggerUid: 'weekly-base' }));
  assert.equal(h.modelCalls.length, calls, 'The successful base event stays consumed after fact-check completion');
  assert.equal(h.documents.length, 2);
  assert.equal(h.mails.length, mails);
  assert.equal(h.generationRetries().length, 0);
});
