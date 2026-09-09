'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(process.env.ROBOT_SOURCE || path.join(__dirname, '../sf-middelfart-robot-v8.gs'), 'utf8');
const pairs = [
  ['dailyIngest', 'retryDailyIngest', ['api', 'gmail']],
  ['dailyRepairAnalyses', 'retryDailyRepairAnalyses', ['repair']],
  ['generateWeeklyDraft', 'retryWeeklyDraft', ['weekly']]
];
const key = handler => 'BASE_RETRY_' + handler;

// Whole candidate source, fresh execution globals, shared in-memory Google state.
// No network, credentials, require/process in the VM, or actual email transport.
function harness(t) {
  const h = { robotOwner: null, schedulerOwner: null, nextId: 1,
    props: new Map(), triggers: [], trace: [], work: [], logs: [], mails: [],
    failCreate: false, failSet: false, failClear: false, failList: false,
    failDelete: new Set(), beforeWork: null, apiError: false, gmailError: false, workError: false };
  t.after(() => assert.equal(h.schedulerOwner, null));
  h.add = (handler, id = 'trigger-' + h.nextId++) => {
    const trigger = { handler, id, getUniqueId: () => id, getHandlerFunction: () => handler };
    h.triggers.push(trigger); return trigger;
  };
  const protectedHandlers = ['dailyIngest', 'dailyRepairAnalyses', 'generateWeeklyDraft', 'processPendingFactCheck', 'otherProjectTask'];
  h.protected = protectedHandlers.map(handler => h.add(handler));
  t.after(() => h.protected.forEach(trigger => assert.ok(h.triggers.includes(trigger), trigger.handler + ' must survive')));
  h.pending = handler => h.triggers.filter(trigger => trigger.handler === handler);
  h.arm = handler => { const trigger = h.add(handler); h.props.set(key(handler), trigger.id); return trigger; };
  h.consume = trigger => { h.triggers.splice(h.triggers.indexOf(trigger), 1); return { triggerUid: trigger.id }; };
  h.run = (entry, event) => {
    const token = Symbol(entry);
    function schedulerOwned() { assert.equal(h.schedulerOwner, token, 'Trigger/state changes need the scheduler lock'); }
    const context = vm.createContext({
      console: { log: (...args) => h.logs.push(args.join(' ')) },
      LockService: {
        getUserLock: () => ({
          waitLock(ms) {
            assert.equal(ms, 10000);
            if (h.schedulerOwner !== null) throw new Error('scheduler timeout');
            h.schedulerOwner = token; h.trace.push('scheduler acquired');
          },
          releaseLock() { schedulerOwned(); h.schedulerOwner = null; h.trace.push('scheduler released'); }
        }),
        getScriptLock: () => ({
          tryLock(ms) {
            assert.equal(ms, 1000); schedulerOwned(); h.trace.push('robot try');
            if (h.robotOwner !== null) return false;
            h.robotOwner = token; return true;
          },
          releaseLock() { assert.equal(h.robotOwner, token); h.robotOwner = null; h.trace.push('robot released'); }
        })
      },
      PropertiesService: { getUserProperties: () => ({
        getProperty: name => { schedulerOwned(); return h.props.get(name) ?? null; },
        setProperty(name, value) {
          schedulerOwned(); if (h.failSet) throw new Error('property write failed');
          h.props.set(name, value); h.trace.push('set ' + value);
        },
        deleteProperty(name) {
          schedulerOwned(); if (h.failClear) throw new Error('property clear failed');
          h.props.delete(name); h.trace.push('clear ' + name);
        }
      }) },
      ScriptApp: {
        getProjectTriggers: () => { schedulerOwned(); if (h.failList) throw new Error('list failed'); return h.triggers.slice(); },
        newTrigger(handler) {
          schedulerOwned(); assert.ok(pairs.some(pair => pair[1] === handler));
          return {
            timeBased() { return this; },
            after(ms) { assert.equal(ms, 420000); return this; },
            create() {
              schedulerOwned(); if (h.failCreate) throw new Error('create failed');
              const trigger = h.add(handler); h.trace.push('create ' + trigger.id); return trigger;
            }
          };
        },
        deleteTrigger(trigger) {
          schedulerOwned(); assert.ok(pairs.some(pair => pair[1] === trigger.handler));
          h.trace.push('delete ' + trigger.id);
          if (h.failDelete.has(trigger.id)) throw new Error('delete failed');
          assert.ok(h.triggers.includes(trigger)); h.triggers.splice(h.triggers.indexOf(trigger), 1);
        }
      }
    }, { codeGeneration: { strings: false, wasm: false } });
    vm.runInContext(source, context, { timeout: 1000 });
    function work(kind, options) {
      assert.equal(h.robotOwner, token, 'All work must own the robot lock');
      assert.equal(h.schedulerOwner, null, 'Scheduler lock must not span long work');
      h.work.push(kind);
      if (h.beforeWork) h.beforeWork(kind);
      if (h.workError || (kind === 'api' && h.apiError) || (kind === 'gmail' && h.gmailError)) throw new Error(kind + ' failed');
      if (kind === 'weekly' && !(options && options.sendNotification === false)) h.mails.push('simulated notification');
      return kind === 'weekly' ? 'fixture://draft' : undefined;
    }
    context.ingestFirstAgendaLocked_ = () => work('api');
    context.ingestInboxEmailsLocked_ = () => work('gmail');
    context.dailyRepairAnalysesLocked_ = () => work('repair');
    context.generateWeeklyDraftLocked_ = options => work('weekly', options);
    // Test the allowlist through the production helper rather than an imitation.
    if (entry === 'invalid') return context.withBaseTriggerLock_(event, 'processPendingFactCheck', () => work('bad'));
    return context[entry](event);
  };
  return h;
}

for (const [base, retry, expectedWork] of pairs) {
  test(base + ': a busy timer retries once, re-arms a consumed event, then works once', t => {
    const h = harness(t); const owner = Symbol('factworker'); h.robotOwner = owner;
    h.run(base, { triggerUid: 'base-event' });
    assert.deepEqual(h.work, []); assert.equal(h.robotOwner, owner);
    assert.equal(h.pending(retry).length, 1);
    const first = h.pending(retry)[0]; const event = h.consume(first);
    h.run(retry, event);
    const second = h.pending(retry)[0]; assert.notEqual(second.id, first.id);
    assert.equal(h.pending(retry).length, 1);
    h.run(retry, event); // overlapping delivery of an invalidated, consumed event
    assert.equal(h.pending(retry)[0], second);
    h.robotOwner = null;
    h.run(retry, h.consume(second));
    assert.deepEqual(h.work, expectedWork); assert.equal(h.props.has(key(retry)), false);
    h.run(retry, { triggerUid: second.id }); // duplicate delivery after success
    assert.deepEqual(h.work, expectedWork); assert.equal(h.robotOwner, null);
    assert.equal(h.pending(retry).length, 0);
  });

  test(base + ': manual busy calls never schedule, and manual retry handlers do nothing', t => {
    const h = harness(t); h.robotOwner = Symbol('worker');
    for (const event of [undefined, null, {}, { sendNotification: false }, { triggerUid: '' }]) h.run(base, event);
    assert.deepEqual(h.work, []); assert.deepEqual(h.mails, []);
    assert.equal(h.props.size, 0); assert.equal(h.triggers.length, h.protected.length);
    assert.ok(!h.logs.some(line => line.includes('Daglig indsamling afsluttet')));
    h.robotOwner = null; h.run(retry); h.run(retry, {});
    assert.deepEqual(h.work, []); assert.deepEqual(h.mails, []);
  });

  test(base + ': repeated busy base calls replace only their own retry, create before delete', t => {
    const h = harness(t); h.robotOwner = Symbol('worker');
    const others = pairs.filter(pair => pair[1] !== retry).map(pair => h.arm(pair[1]));
    h.run(base, { triggerUid: 'base-event' }); const old = h.pending(retry)[0];
    h.trace.length = 0; h.run(base, { triggerUid: 'base-event' });
    const next = h.pending(retry)[0]; assert.notEqual(next.id, old.id);
    assert.equal(h.pending(retry).length, 1);
    assert.ok(h.trace.indexOf('create ' + next.id) < h.trace.indexOf('set ' + next.id));
    assert.ok(h.trace.indexOf('set ' + next.id) < h.trace.indexOf('delete ' + old.id));
    others.forEach(trigger => { assert.ok(h.triggers.includes(trigger)); assert.equal(h.props.get(key(trigger.handler)), trigger.id); });
  });

  test(base + ': successful manual lock clears only its retry and invalidates already dispatched events', t => {
    const h = harness(t); const old = h.arm(retry);
    const other = h.arm(pairs.find(pair => pair[1] !== retry)[1]);
    h.failDelete.add(old.id); // old trigger can still deliver despite deletion failure
    h.run(base, { sendNotification: false });
    assert.deepEqual(h.work, expectedWork); assert.equal(h.props.has(key(retry)), false);
    assert.ok(h.triggers.includes(other)); assert.equal(h.props.get(key(other.handler)), other.id);
    h.run(retry, { triggerUid: old.id });
    assert.deepEqual(h.work, expectedWork); assert.deepEqual(h.mails, []);
  });

  test(base + ': failed replacement creation preserves the old pending retry and both locks', t => {
    const h = harness(t); const old = h.arm(retry); const owner = Symbol('worker'); h.robotOwner = owner;
    h.failCreate = true;
    assert.throws(() => h.run(base, { triggerUid: 'base-event' }), /create failed/);
    assert.equal(h.props.get(key(retry)), old.id); assert.deepEqual(h.pending(retry), [old]);
    assert.equal(h.robotOwner, owner); assert.equal(h.schedulerOwner, null);
    assert.ok(!h.trace.some(line => line.startsWith('delete ')));
  });
}

test('ingestion uses one lock across both internal sources and preserves catch-and-continue', t => {
  const h = harness(t); h.apiError = true; h.gmailError = true;
  h.run('dailyIngest', { triggerUid: 'base-event' });
  assert.deepEqual(h.work, ['api', 'gmail']);
  assert.equal(h.trace.filter(line => line === 'robot try').length, 1);
  assert.ok(h.logs.some(line => line.includes('FirstAgenda fejl')));
  assert.ok(h.logs.some(line => line.includes('Email-fejl')));
  assert.ok(h.logs.some(line => line.includes('Daglig indsamling afsluttet')));
  assert.equal(h.robotOwner, null);
});

test('scheduler lock is released during work: another base can retain its own missed run', t => {
  const h = harness(t);
  h.beforeWork = kind => {
    if (kind === 'repair') h.run('dailyIngest', { triggerUid: 'ingest-event' });
  };
  h.run('dailyRepairAnalyses', { triggerUid: 'repair-event' });
  assert.deepEqual(h.work, ['repair']); assert.equal(h.pending('retryDailyIngest').length, 1);
  h.beforeWork = null;
  h.run('retryDailyIngest', h.consume(h.pending('retryDailyIngest')[0]));
  assert.deepEqual(h.work, ['repair', 'api', 'gmail']);
});

test('an already dispatched retry cannot re-arm during its successful base execution', t => {
  const h = harness(t); const old = h.arm('retryWeeklyDraft'); const event = h.consume(old);
  h.beforeWork = () => h.run('retryWeeklyDraft', event);
  h.run('generateWeeklyDraft', { triggerUid: 'base-event' });
  assert.deepEqual(h.work, ['weekly']); assert.equal(h.mails.length, 1);
  assert.equal(h.pending('retryWeeklyDraft').length, 0);
});

test('failed UID registration retains the old retry and cleans up the new inactive trigger', t => {
  const h = harness(t); const old = h.arm('retryDailyIngest'); h.robotOwner = Symbol('worker'); h.failSet = true;
  assert.throws(() => h.run('dailyIngest', { triggerUid: 'base-event' }), /property write failed/);
  assert.deepEqual(h.pending('retryDailyIngest'), [old]); assert.equal(h.props.get(key(old.handler)), old.id);
});

test('failed deletion after replacement leaves only one authorized retry', t => {
  const h = harness(t); const old = h.arm('retryWeeklyDraft'); h.failDelete.add(old.id); h.robotOwner = Symbol('worker');
  h.run('generateWeeklyDraft', { triggerUid: 'base-event' });
  const next = h.pending('retryWeeklyDraft').find(trigger => trigger !== old);
  h.robotOwner = null; h.run('retryWeeklyDraft', { triggerUid: old.id }); assert.deepEqual(h.work, []);
  h.run('retryWeeklyDraft', h.consume(next)); assert.deepEqual(h.work, ['weekly']); assert.equal(h.mails.length, 1);
});

test('failure during successful-lock cleanup releases both locks and preserves unclaimed retry', t => {
  const h = harness(t); const old = h.arm('retryDailyRepairAnalyses'); h.failClear = true;
  assert.throws(() => h.run('dailyRepairAnalyses', { triggerUid: 'base-event' }), /property clear failed/);
  assert.equal(h.robotOwner, null); assert.equal(h.schedulerOwner, null);
  assert.equal(h.props.get(key(old.handler)), old.id); assert.deepEqual(h.work, []);
});

test('trigger listing failure before cleanup retains pending state and releases robot lock', t => {
  const h = harness(t); const old = h.arm('retryWeeklyDraft'); h.failList = true;
  assert.throws(() => h.run('generateWeeklyDraft', { triggerUid: 'base-event' }), /list failed/);
  assert.equal(h.robotOwner, null); assert.equal(h.props.get(key(old.handler)), old.id);
});

test('work exceptions do not automatically retry a potentially sent weekly notification', t => {
  const h = harness(t); h.arm('retryWeeklyDraft'); h.workError = true;
  assert.throws(() => h.run('generateWeeklyDraft', { triggerUid: 'base-event' }), /weekly failed/);
  assert.equal(h.robotOwner, null); assert.equal(h.pending('retryWeeklyDraft').length, 0);
  assert.equal(h.props.has(key('retryWeeklyDraft')), false);
});

test('allowlist rejects factworker and unknown handlers before any lock or trigger mutation', t => {
  const h = harness(t);
  assert.throws(() => h.run('invalid', { triggerUid: 'base-event' }), /Ukendt base-retryhandler/);
  assert.deepEqual(h.trace, []); assert.equal(h.props.size, 0);
});

test('scheduler lock timeout is surfaced, without work, trigger mutation, or releasing another owner', t => {
  const h = harness(t); const owner = Symbol('other scheduler'); h.schedulerOwner = owner;
  assert.throws(() => h.run('dailyIngest', { triggerUid: 'base-event' }), /scheduler timeout/);
  assert.equal(h.schedulerOwner, owner); assert.equal(h.robotOwner, null); assert.equal(h.props.size, 0);
  assert.deepEqual(h.work, []); h.schedulerOwner = null;
});

test('consumed retry creation failure is explicit; it cannot promise a nonexistent future trigger', t => {
  const h = harness(t); const event = h.consume(h.arm('retryDailyIngest'));
  h.robotOwner = Symbol('worker'); h.failCreate = true;
  assert.throws(() => h.run('retryDailyIngest', event), /create failed/);
  assert.equal(h.pending('retryDailyIngest').length, 0); assert.deepEqual(h.work, []);
  assert.equal(h.props.get(key('retryDailyIngest')), event.triggerUid);
});
