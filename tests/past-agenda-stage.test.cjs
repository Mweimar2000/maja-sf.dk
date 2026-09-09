'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const SOURCE = fs.readFileSync(process.env.ROBOT_SOURCE || path.join(__dirname, '../sf-middelfart-robot-v8.gs'), 'utf8');

// Actual v8.1.7 writer sentence. Far past/future ISO fixtures make the narrow
// temporal contract independent of the date the test suite is run.
const ACTUAL = 'Vi står over for 1. behandlingen af budgettet for 2027-2030 i Økonomiudvalget, og for os i SF handler det altid om mennesker før kolde regneark.';
const budget = {
  type: 'Dagsorden', committee: 'Økonomiudvalget', score: 5,
  meetingDate: '2000-09-08T13:30:00.000Z',
  subject: '1. behandling af budget 2027-2030',
  snippet: 'Præsentation\nØkonomiudvalget og Byrådet skal 1. behandle budgettet for 2027-2030.\nForvaltningen indstiller\nAt Økonomiudvalget fremsender Direktionens forslag til budget 2027-2030 til 1. behandling i Byrådet.'
};

function context() {
  const value = vm.createContext({ console: { log() {} },
    Session: { getScriptTimeZone: () => 'Europe/Copenhagen' }
  }, { codeGeneration: { strings: false, wasm: false } });
  vm.runInContext(SOURCE, value, { timeout: 1000 });
  return value;
}

function job(story, text) {
  return { phase: 'finalize', newsletter: text, stories: [structuredClone(story)],
    sources: [{ freshText: story.snippet }], pdfReviews: [], pdfTasks: [], failures: [],
    textResult: { claims: [{ claim: text, verdict: 'verified', sourceIndex: 1,
      sourceUrl: 'https://dagsordener.middelfart.dk/vis?id=budget-fixture',
      evidence: 'Økonomiudvalget og Byrådet skal 1. behandle budgettet for 2027-2030.' }] }
  };
}

test('past ISO agenda rejects the actual upcoming first-treatment claim in writer and resumed report', () => {
  const h = context();
  for (const text of [ACTUAL, ACTUAL.replace('1. behandlingen', 'første behandling')]) {
    assert.throws(() => h.validateDecisionStage_(text, [budget]), /uden belæg|fremtid/i);
  }
  const saved = job(budget, ACTUAL), before = JSON.stringify(saved);
  const result = h.factCheckResult_(saved);
  assert.equal(result.claims[0].verdict, 'unverified', 'The explicitly bound claim retains its story ISO meeting date');
  assert.equal(result.claims[0].sourceIndex, null); assert.equal(result.claims[0].sourceUrl, '');
  assert.equal(result.summary.verified, 0); assert.equal(result.summary.unverified, 1);
  assert.match(result.note || '', /Udokumenteret status i kladdens fulde tekst/);
  assert.equal(JSON.stringify(saved), before);
});

test('the same first-treatment wording is allowed for a future ISO agenda and its report', () => {
  const h = context(), future = { ...budget, meetingDate: '2100-09-08T13:30:00.000Z' };
  assert.doesNotThrow(() => h.validateDecisionStage_(ACTUAL, [future]));
  const saved = job(future, ACTUAL), before = JSON.stringify(saved), result = h.factCheckResult_(saved);
  assert.equal(result.claims[0].verdict, 'verified');
  assert.equal(result.claims[0].sourceIndex, 1);
  assert.doesNotMatch(result.note || '', /Udokumenteret status i kladdens fulde tekst/);
  assert.equal(JSON.stringify(saved), before);
});

test('past first-treatment agenda does not prohibit a different stage or another decision-making body', () => {
  const h = context();
  for (const text of [
    ACTUAL.replace('1. behandlingen', '2. behandlingen'),
    ACTUAL.replace('1. behandlingen', 'anden behandling'),
    ACTUAL.replace('Økonomiudvalget', 'Byrådet')
  ]) assert.doesNotThrow(() => h.validateDecisionStage_(text, [budget]), text);
});

test('conditional or explicitly uncertain upcoming treatment is not asserted as a calendar fact', () => {
  const h = context();
  for (const text of [
    'Hvis mødet endnu ikke er afholdt, står vi over for 1. behandlingen af budgettet i Økonomiudvalget.',
    'Det er uklart, om vi står over for 1. behandlingen af budgettet i Økonomiudvalget.',
    'Måske står vi over for første behandling af budgettet i Økonomiudvalget.'
  ]) assert.doesNotThrow(() => h.validateDecisionStage_(text, [budget]), text);
});

test('a correctly dated description of a past agenda remains allowed without asserting the meeting outcome', () => {
  const h = context();
  const text = 'Økonomiudvalgets dagsorden dateret 8. september 2000 indeholder 1. behandling af budgettet for 2027-2030. Det fremgår ikke af dagsordenen, om behandlingen er gennemført.';
  assert.doesNotThrow(() => h.validateDecisionStage_(text, [budget]));
  const saved = job(budget, text), before = JSON.stringify(saved), result = h.factCheckResult_(saved);
  assert.equal(result.claims[0].verdict, 'verified');
  assert.doesNotMatch(result.note || '', /Udokumenteret status i kladdens fulde tekst/);
  assert.equal(JSON.stringify(saved), before);
});
