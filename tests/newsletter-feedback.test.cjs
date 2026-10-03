'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const SOURCE = fs.readFileSync(process.env.ROBOT_SOURCE || path.join(__dirname, '../sf-middelfart-robot-v8.gs'), 'utf8');

// Synthetic source/candidates: test correction routing, not model writing quality.
const story = { type: 'Dagsorden', subject: 'Ansøgning om skolepulje til mindre skoler',
  committee: 'Byrådet', meetingDate: '2026-10-05 17:00', score: 4,
  snippet: 'Præsentation\nDer foreslås en ansøgning om skolepulje til mindre skoler.\nForvaltningen indstiller\nAt forslaget drøftes.' };
const BAD = 'Byrådet har godkendt ansøgningen om skolepulje til mindre skoler. De bedste hilsner, SF Middelfart';
const GOOD = 'På dagsordenen beskrives et forslag om at søge skolepuljen til mindre skoler. De bedste hilsner, SF Middelfart';
const data = { dateRange: '26. sep – 3. okt 2026', topStories: [story], mediumStories: [], adminItems: [], upcomingMeetings: [] };

function harness(reply) {
  const calls = [];
  const context = vm.createContext({ console: { log() {} },
    Session: { getScriptTimeZone: () => 'Europe/Copenhagen' },
    Utilities: { formatDate: () => '2026', parseDate: value => new Date(value.replace(' ', 'T')), sleep() {} },
    UrlFetchApp: { fetch(url, options) {
      const payload = JSON.parse(options.payload);
      const request = { url, payload, prompt: payload.contents[0].parts[0].text };
      calls.push(request);
      const result = reply(request, calls.length);
      return { getResponseCode: () => result.code || 200,
        getContentText: () => JSON.stringify(result.code
          ? { error: { status: 'UNAVAILABLE' } }
          : { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: result.text }] } }] }) };
    } }
  }, { codeGeneration: { strings: false, wasm: false } });
  vm.runInContext(SOURCE, context, { timeout: 1000 });
  context.loadToneGuide_ = () => 'Skriv med kildebelæg.';
  return { context, calls };
}

test('a rejected draft gives the fallback model concrete correction feedback and validates its replacement', () => {
  const h = harness(request => ({ text: request.prompt.includes('KVALITETSKONTROLLENS RETTELSE') ? GOOD : BAD }));
  assert.equal(h.context.generateNewsletterWithGemini_('fixture-key', data), GOOD);
  assert.equal(h.calls.length, 2, 'Reuse the existing model fallback without extra attempts');
  assert.match(h.calls[1].prompt, /uden belæg i beslutningsteksten/);
  assert.match(h.calls[1].prompt, /Ansøgning om skolepulje til mindre skoler/);
  assert.match(h.calls[1].prompt, /recordedDecision/);
  assert.match(h.calls[1].prompt, /Præsentation/);
  assert.doesNotMatch(h.calls[0].prompt, /KVALITETSKONTROLLENS RETTELSE/);
});

test('feedback never allows a still unsupported decision to become a draft', () => {
  const h = harness(() => ({ text: BAD }));
  const failure = {};
  assert.equal(h.context.generateNewsletterWithGemini_('fixture-key', data, failure), null);
  assert.equal(h.calls.length, 3);
  assert.equal(failure.validationRejected, true);
  assert.equal(failure.retryable, false);
  for (const call of h.calls.slice(1)) assert.match(call.prompt, /KVALITETSKONTROLLENS RETTELSE/);
  assert.equal(h.calls[2].prompt.split('KVALITETSKONTROLLENS RETTELSE').length, 2, 'Feedback replaces rather than accumulates');
});

test('a valid first reply uses one model call with no correction feedback', () => {
  const h = harness(() => ({ text: GOOD }));
  assert.equal(h.context.generateNewsletterWithGemini_('fixture-key', data), GOOD);
  assert.equal(h.calls.length, 1);
  assert.doesNotMatch(h.calls[0].prompt, /KVALITETSKONTROLLENS RETTELSE/);
});

test('HTTP retries do not pretend a draft was rejected by the content validator', () => {
  const h = harness((request, count) => count < 3 ? { code: 503 } : { text: GOOD });
  assert.equal(h.context.generateNewsletterWithGemini_('fixture-key', data), GOOD);
  assert.equal(h.calls.length, 3);
  assert.deepEqual(h.calls.map(call => call.prompt), Array(3).fill(h.calls[0].prompt));
});

test('validation feedback does not leak into a later independent generation', () => {
  let succeed = false;
  const h = harness(() => ({ text: succeed ? GOOD : BAD }));
  assert.equal(h.context.generateNewsletterWithGemini_('fixture-key', data), null);
  succeed = true;
  assert.equal(h.context.generateNewsletterWithGemini_('fixture-key', data), GOOD);
  assert.doesNotMatch(h.calls.at(-1).prompt, /KVALITETSKONTROLLENS RETTELSE/);
});

test('a terminal validation error names the content check in the failure email and saves no draft', t => {
  const fixtures = vm.createContext({
    require: name => name === 'node:test' ? { test() {} } : require(name),
    __dirname, process, Buffer, structuredClone
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'integration.test.cjs'), 'utf8')
    + '\nglobalThis.fixtures = { harness, item, sourceRow };', fixtures);
  const f = fixtures.fixtures;
  const row = f.sourceRow(f.item('school', story.subject, story.snippet));
  row[1] = 'Dagsorden';
  const h = f.harness(t, [row]);
  h.replies.push(BAD, BAD, BAD);
  assert.throws(() => h.run('generateWeeklyDraft', { triggerUid: 'weekly-base' }), /generer/);
  assert.equal(h.documents.length, 0);
  assert.equal(h.triggers.filter(trigger => trigger.handler === 'retryWeeklyDraft').length, 0);
  assert.equal(h.mails.length, 1);
  assert.match(h.mails[0][2], /Kildestatuskontrollen afviste modelteksten/);
  assert.match(h.mails[0][2], /8\.2\.2-validation/);
  assert.doesNotMatch(h.mails[0][2], /Gemini-kaldet fejlede/);
});
