'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const SOURCE = fs.readFileSync(process.env.ROBOT_SOURCE || path.join(__dirname, '../sf-middelfart-robot-v8.gs'), 'utf8');

// Independent reproductions of the two P2 findings in candidate 08d58f2c.
// The clock is fixed so the original meeting is past and the later stages future.
const NOW = Date.parse('2026-09-09T09:00:00Z');
class ReviewDate extends Date {
  constructor(...args) { super(...(args.length ? args : [NOW])); }
  static now() { return NOW; }
}

const budget = {
  type: 'Dagsorden', committee: 'Økonomiudvalget', score: 5,
  subject: '1. behandling af budget 2027-2030', meetingDate: '2026-09-08T13:30:00Z',
  snippet: [
    'Præsentation', 'Budgetforslaget står på Økonomiudvalgets dagsorden dateret 8. september 2026.',
    'Forvaltningen indstiller', 'At budgetforslaget fremsendes til 1. behandling i Byrådet.',
    'Behandlingsplan', 'Økonomiudvalget: 1. behandling den 8. september 2026.',
    'Byrådet: 1. behandling den 15. september 2026.',
    'Økonomiudvalget: 2. behandling den 22. september 2026.'
  ].join('\n')
};
const district = {
  type: 'Referat', committee: 'Skoleudvalget', score: 4,
  subject: 'Høring: Ændring af skoledistrikt for bydelen Trådværket',
  snippet: 'Beslutning\nTaget til efterretning.\nPræsentation\nÆndring af skoledistrikt for Trådværket.\nForvaltningen indstiller\nAt forslaget sendes i høring hos skolebestyrelserne fra 8. til 29. september 2026.'
};
const other = {
  type: 'Referat', committee: 'Skoleudvalget', score: 3,
  subject: 'Høring: Renovering af kantinerne',
  snippet: 'Beslutning\nForslaget til renovering af kantinerne er godkendt og sendt i høring.\nPræsentation\nRenovering af kantinerne.'
};
const MIXED_ACTOR = 'Budgettet står på Økonomiudvalgets daterede dagsorden, og vi står over for første behandling i Byrådet.';
const MIXED_STAGE = 'Budgettets 1. behandling står på Økonomiudvalgets daterede dagsorden, og vi står over for 2. behandling i Økonomiudvalget.';
const YEAR_BOUNDARY = [
  'Trådværket er på dagsordenen.',
  'Forslaget er nu sendt i høring frem til den 29. september 2026.',
  'En anden sag gælder renovering af kantinerne.'
].join('\n\n');

function harness(replies = []) {
  const calls = [];
  const context = vm.createContext({
    Date: ReviewDate, console: { log() {} },
    Session: { getScriptTimeZone: () => 'Europe/Copenhagen' },
    Utilities: {
      formatDate: (date, timezone, format) => format === 'yyyy-MM-dd' ? '2026-09-09' : format === 'w' ? '37' : '2026',
      sleep() {}
    },
    UrlFetchApp: { fetch(url, options) {
      if (!/^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models\//.test(url)) {
        throw new Error('Unexpected external service in local review test');
      }
      const text = replies[calls.length];
      if (text === undefined) throw new Error('Unexpected model attempt in local review test');
      calls.push({ url, payload: JSON.parse(options.payload) });
      return { getResponseCode: () => 200, getContentText: () => JSON.stringify({
        candidates: [{ finishReason: 'STOP', content: { parts: [{ text }] } }]
      }) };
    } }
  }, { codeGeneration: { strings: false, wasm: false } });
  vm.runInContext(SOURCE, context, { timeout: 1000 });
  context.loadToneGuide_ = () => 'Skriv med kildebelæg.';
  return { context, calls };
}

test('review P2: another body or later stage is not tied to the historical stage elsewhere in the sentence', () => {
  const { context } = harness();
  for (const text of [MIXED_ACTOR, MIXED_STAGE,
    'Vi står over for første behandling i Byrådet af det budget, som Økonomiudvalget tidligere har drøftet.'
  ]) {
    assert.doesNotThrow(() => context.validateDecisionStage_(text, [budget]), text);
  }
});

test('review control: the actual past first treatment is still rejected in either actor position', () => {
  const { context } = harness();
  for (const text of [
    'Vi står over for 1. behandling af budgettet i Økonomiudvalget.',
    'Økonomiudvalget står over for første behandling af budgettet.'
  ]) assert.throws(() => context.validateDecisionStage_(text, [budget]), /fremtid|mødedato|uden belæg/i, text);
});

test('review P2: a valid mixed-body newsletter returns on its first model response', () => {
  const text = MIXED_ACTOR + '\nDe bedste hilsner, SF Middelfart';
  const { context, calls } = harness([text, text, text]);
  const result = context.generateNewsletterWithGemini_('local-fixture-key', {
    dateRange: '2. sep – 9. sep 2026', topStories: [budget], mediumStories: [], adminItems: [], upcomingMeetings: []
  });
  assert.equal(result, text);
  assert.equal(calls.length, 1, 'A correct statement must not consume fallback models or lose the draft');
});

test('review P2: a year-ending full stop cannot lend the next case approval to the preceding hearing', () => {
  const { context } = harness();
  for (const stories of [[district, other], [other, district]]) {
    assert.throws(() => context.validateDecisionStage_(YEAR_BOUNDARY, stories), /uden belæg/);
  }
  const nonnumeric = YEAR_BOUNDARY.replace('den 29. september 2026.', 'slutningen af september.');
  assert.throws(() => context.validateDecisionStage_(nonnumeric, [district, other]), /uden belæg/);
});

test('review P2: the omitted pronoun claim still produces a full-text report warning across the year boundary', () => {
  const { context } = harness();
  const job = {
    newsletter: YEAR_BOUNDARY, stories: [district, other],
    sources: [{ freshText: district.snippet }, { freshText: other.snippet }],
    textResult: { claims: [{ claim: 'Kantinerne renoveres.', verdict: 'verified',
      evidence: 'Renovering af kantinerne.', sourceIndex: 2, sourceUrl: 'https://example.invalid/kantiner' }] },
    pdfTasks: [], pdfReviews: [], failures: []
  };
  const before = JSON.stringify(job);
  const result = context.factCheckResult_(job);
  assert.match(result.note || '', /kladdens fulde tekst/);
  assert.equal(result.summary.verified, 1, 'The independently supported other-case claim remains verified');
  assert.equal(result.summary.unverified, 0);
  assert.equal(JSON.stringify(job), before, 'The report warning must not modify saved job state');
});

test('review control: a real case change before the pronoun still permits its own documented hearing', () => {
  const { context } = harness();
  const text = 'Trådværket er på dagsordenen i 2026.\n\nEn anden sag gælder renovering af kantinerne.\n\nForslaget er nu sendt i høring.';
  assert.doesNotThrow(() => context.validateDecisionStage_(text, [district, other]));
});
