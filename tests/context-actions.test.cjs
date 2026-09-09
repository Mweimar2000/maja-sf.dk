'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const SOURCE = fs.readFileSync(process.env.ROBOT_SOURCE || path.join(__dirname, '../sf-middelfart-robot-v8.gs'), 'utf8');

// Public source excerpts and the actual v8.1.7 writer failure from 9 September
// 2026. Self-contained: no dependence on a live job, workspace backup or another
// test file. In particular the writer paragraph break is part of the regression.
const district = {
  type: 'Referat', committee: 'Skoleudvalget', score: 4,
  subject: 'Høring: Ændring af skoledistrikt for bydelen Trådværket',
  snippet: [
    'PUNKT 52: Høring: Ændring af skoledistrikt for bydelen Trådværket',
    'Sagsnr: 2026-009857',
    'Beslutning', 'Taget til efterretning.',
    'Præsentation', 'Sagen vedrører høring af forslag om ændring af skoledistrikt for bydelen Trådværket.',
    'Forvaltningen indstiller',
    'At Skoleudvalget godkender at sende forslag om ændring af skoledistrikt for bydelen Trådværket i høring hos de berørte skolebestyrelser på Vestre Skole og Østre Skole.',
    'Sagsbeskrivelse',
    "Byrådet vedtog 4. december 2023 en udviklingsplan for 'Fremtidens havn Trådværket', der omdanner arealet ved Trafikhavnen til et nyt grønt bykvarter.",
    'Høring',
    'Forvaltningen indstiller, at forslag om ændring af skoledistrikt for bydelen Trådværket, sendes i høring hos skolebestyrelserne ved Vestre Skole og Østre Skole i perioden 8. til 29. september 2026.',
    'Klima & bæredygtighed', 'Behandlingsplan:',
    'Skoleudvalget den 7. september 2026', 'Høringsperiode 8. - 29. september 2026',
    'Skoleudvalget den 19. oktober 2026', 'Økonomiudvalget den 27. oktober 2026', 'Byrådet den 2. november 2026'
  ].join('\n')
};
const actualParagraphs = [
  'Samtidig kigger vi ind i fremtiden for det nye byområde ved Trådværket.',
  'Forvaltningen foreslår at flytte skoledistriktet fra Østre Skole til Vestre Skole for at sikre en bedre balance på tværs af byskolerne.',
  'Forslaget er nu sendt i høring hos skolebestyrelserne frem til den 29. september 2026.'
];
const ACTUAL = actualParagraphs.join('\n\n');
const CONTEXT = actualParagraphs.slice(0, 2).join('\n\n');
const GENERIC_ACTION = 'Forslaget er nu sendt i høring';
const APPROVED = 'Beslutning\nForslaget er godkendt og sendt i høring.\nPræsentation\nHøring om ændring af skoledistrikt for bydelen Trådværket.';
const other = {
  type: 'Referat', committee: 'Skoleudvalget', score: 3,
  subject: 'Høring: Renovering af kantinerne',
  snippet: 'Beslutning\nForslaget til renovering af kantinerne er godkendt og sendt i høring.\nPræsentation\nNye kantiner.'
};
const budget = {
  type: 'Dagsorden', committee: 'Økonomiudvalget', score: 5,
  subject: '1. behandling af budget 2027-2030',
  snippet: 'Præsentation\nØkonomiudvalget og Byrådet skal 1. behandle budgettet for 2027-2030.\nForvaltningen indstiller\nAt Økonomiudvalget fremsender Direktionens forslag til budget 2027-2030 til 1. behandling i Byrådet.'
};
// All eleven subjects/committees and decision excerpts from the actual job.
// These extra contexts expose accidental matches on actor and process words;
// the full hearing evidence remains the district excerpt above.
const liveContexts = [
  budget,
  ['Beskæftigelses- og Arbejdsmarkedsudvalget', 'Nøgletal pr. 31.07.26', 'Udvalget tager orienteringen til efterretning'],
  ['Beskæftigelses- og Arbejdsmarkedsudvalget', 'Rehabiliteringsrapport 1. halvår 2026', 'Rehabiliteringsrapport drøftet'],
  ['Klima- Natur og Genbrugsudvalget', 'Endelig vedtagelse af tillæg 2 til spildevandsplanen for Middelfart Kommune 2026-2031', 'Godkendt'],
  ['Budget', 'Eksterne ønsker', 'BILAG: 1. Tilstandsvurdering haller rev. 1, 2. Forslag fra Ældrerådet - Ole Juel Jakobsen, 3.a Strib IF - Kunstgræsbane, 3.b Strib IF - Projektbeskrivelse'],
  ['Skoleudvalget', 'Dispensation vedr. klassetildeling for 2. årgang på Gelsted Skole i skoleåret 2026/2027', 'Taget til efterretning.'],
  district,
  ['Skoleudvalget', 'Orientering', 'Taget til efterretning.'],
  ['Skoleudvalget', 'Orientering om deltagelse i projekt Teenager og Anbragt', 'Taget til efterretning.'],
  ['Klima- Natur og Genbrugsudvalget', 'Orientering', 'Udvalget blev orienteret om:\nLillebæltstien\nBlødgøring af vand\nAnsøgning om udvidelse af husdyrbrug\nVandløb\nNaturbeskyttelse'],
  ['Skoleudvalget', 'Udkast til Skoleudvalgets besøgsrunde i valgperioden', 'Taget til efterretning.\nPunktet sættes på om ca. et halvt år, hvor vi ser på, om der er behov for justering i oplægget - eller for at lægge yderligere besøg ind.']
].map(value => Array.isArray(value) ? {
  type: 'Referat', committee: value[0], subject: value[1], snippet: 'Beslutning\n' + value[2] + '\nPræsentation\n' + value[1]
} : value);

function harness(t, replies = []) {
  const h = { calls: [], unexpected: [], logs: [] };
  const context = vm.createContext({
    console: { log: (...args) => h.logs.push(args.join(' ')) },
    Session: { getScriptTimeZone: () => 'Europe/Copenhagen' },
    Utilities: { formatDate: (date, timezone, format) => format === 'w' ? '37' : '2026', sleep() {} },
    UrlFetchApp: { fetch(url, options) {
      const model = url.match(/^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models\/([^/]+):generateContent$/)?.[1];
      if (!model || h.calls.length >= replies.length) {
        h.unexpected.push(url); throw new Error('Unscripted model/service request');
      }
      const text = replies[h.calls.length];
      h.calls.push({ model, payload: JSON.parse(options.payload),
        previousSuccess: vm.runInContext('LAST_SUCCESSFUL_GEMINI_MODEL', context) });
      return { getResponseCode: () => 200, getContentText: () => JSON.stringify({
        candidates: [{ finishReason: 'STOP', content: { parts: [{ text }] } }]
      }) };
    } }
  }, { codeGeneration: { strings: false, wasm: false } });
  vm.runInContext(SOURCE, context, { timeout: 1000 });
  // Only the externally loaded style guide is stubbed. Writer, model fallback,
  // action validation and factCheckResult_ are the actual production functions.
  context.loadToneGuide_ = () => 'Skriv klart med kildebelæg.';
  h.context = context;
  h.models = Array.from(vm.runInContext('[CFG.MODEL_NAME].concat(CFG.MODEL_FALLBACKS || [])', context));
  t.after(() => assert.deepEqual(h.unexpected, [], 'Every service request must be a scripted local fake'));
  return h;
}

function writerData() {
  return { dateRange: 'Uge 37, 2026', topStories: [structuredClone(district)],
    mediumStories: [], adminItems: [], upcomingMeetings: [] };
}

function factJob(stories, sources, sourceIndex) {
  return { phase: 'finalize', stories: structuredClone(stories), sources: structuredClone(sources),
    textResult: { summary: { verified: 1, unverified: 0, contradicted: 0 }, claims: [{
      claim: GENERIC_ACTION, verdict: 'verified', evidence: 'Forvaltningen indstiller en høring.',
      sourceIndex, sourceUrl: 'https://dagsordener.middelfart.dk/vis?id=fixture-' + sourceIndex
    }] },
    pdfReviews: [{ reviews: [{ claimId: 0, verdict: 'supported', evidence: 'Høringsperiode 8. - 29. september 2026' }] }],
    pdfTasks: [{}], failures: [] };
}

test('actual v8.1.7 Trådværket paragraphs cannot turn taking note into a completed hearing', t => {
  const h = harness(t);
  assert.throws(() => h.context.validateDecisionStage_(ACTUAL, [district]), /uden belæg/);
  const continuation = '\n\nVi skal lytte til forældrene og skolerne, før der træffes endelige beslutninger i Byrådet til november!';
  assert.equal(liveContexts.length, 11);
  assert.throws(() => h.context.validateDecisionStage_(ACTUAL + continuation, liveContexts), /uden belæg/,
    'The actual continuation and all eleven topics must not let generic endelige beslutninger hide the hearing');
});

test('ordinary prose and paragraph separators preserve the nearby action referent', t => {
  const h = harness(t);
  for (const separator of [' ', '\n', '\r\n\r\n', ' \n\n\n']) {
    assert.throws(() => h.context.validateDecisionStage_(actualParagraphs.join(separator), [district]),
      /uden belæg/, 'Sentence or paragraph layout must not hide the completed action');
  }
  const actorMention = 'Trådværkets skoledistrikt er til debat. Skoleudvalget har taget sagen til efterretning. Forslaget er nu sendt i høring.';
  assert.throws(() => h.context.validateDecisionStage_(actorMention, liveContexts), /uden belæg/,
    'Mentioning the committee must not switch to the unrelated Skoleudvalgets besøgsrunde story');
});

test('planned, negated and conditional hearings remain allowed with the same nearby context', t => {
  const h = harness(t);
  for (const ending of [
    'Forvaltningen foreslår at sende forslaget i høring frem til den 29. september 2026.',
    'Forslaget skal sendes i høring hos skolebestyrelserne.',
    'Forslaget er ikke sendt i høring.',
    'Det er ikke dokumenteret, at forslaget er sendt i høring.',
    'Hvis forslaget er sendt i høring, følger vi skolebestyrelsernes svar.',
    'Vi følger op, hvis forslaget er sendt i høring.'
  ]) assert.doesNotThrow(() => h.context.validateDecisionStage_(CONTEXT + '\n\n' + ending, [district]), ending);
});

test('a new editorial heading resets the inherited story before an unnamed action', t => {
  const h = harness(t);
  for (const heading of ['**Fællesskab og byliv**', '### Fællesskab og byliv']) {
    assert.doesNotThrow(() => h.context.validateDecisionStage_(CONTEXT + '\n\n' + heading + '\n\n' + GENERIC_ACTION + '.', [district]));
  }
});

test('a known different case with an approved decision replaces the prior story context', t => {
  const h = harness(t);
  const text = CONTEXT + '\n\nEn anden sag gælder renovering af kantinerne.\n\n' + GENERIC_ACTION + '.';
  assert.doesNotThrow(() => h.context.validateDecisionStage_(text, [district, other]));
  assert.doesNotThrow(() => h.context.validateDecisionStage_(text, [other, district]), 'Story ordering must not select the restriction');
});

test('an ambiguous or absent referent is not arbitrarily bound to a restricted story', t => {
  const h = harness(t);
  const text = 'Der ligger forslag om Trådværket og renovering af kantinerne.\n\n' + GENERIC_ACTION + '.';
  assert.doesNotThrow(() => h.context.validateDecisionStage_(text, [district, other]));
  assert.doesNotThrow(() => h.context.validateDecisionStage_(GENERIC_ACTION + '.', [district]));
});

test('context lookback expires across a long stretch of unrelated ordinary prose', t => {
  const h = harness(t);
  const gaps = [
    'Vi lytter. Vi læser. Vi mødes. Vi drøfter.',
    'Vi arbejder for ' + 'et varmere fællesskab og bedre muligheder for alle, '.repeat(20) + 'sammen.'
  ];
  for (const gap of gaps) assert.doesNotThrow(() => h.context.validateDecisionStage_(
    CONTEXT + '\n\n' + gap + '\n\n' + GENERIC_ACTION + '.', [district]),
  'Both many short sentences and a single long passage expire the old referent');
});

test('sourceBound explicitly validates an unnamed action without enabling global story guessing', t => {
  const h = harness(t);
  assert.doesNotThrow(() => h.context.validateDocumentedActions_(GENERIC_ACTION, [district]));
  assert.throws(() => h.context.validateDocumentedActions_(GENERIC_ACTION, [district], { sourceBound: true }), /uden belæg/);
  assert.doesNotThrow(() => h.context.validateDocumentedActions_(GENERIC_ACTION,
    [{ ...district, snippet: APPROVED }], { sourceBound: true }));
});

test('the actual bad paragraph response triggers model fallback before any usable writer output', t => {
  const good = CONTEXT + '\n\nForvaltningen foreslår at sende forslaget i høring; beslutningen er alene taget til efterretning.';
  const h = harness(t, [ACTUAL, good]), data = writerData(), before = JSON.stringify(data);
  assert.equal(h.context.generateNewsletterWithGemini_('fixture-key', data), good);
  assert.deepEqual(h.calls.map(call => call.model), h.models.slice(0, 2));
  assert.ok(!h.calls[1].previousSuccess, 'Rejected text must not mark its model successful');
  assert.equal(vm.runInContext('LAST_SUCCESSFUL_GEMINI_MODEL', h.context), h.models[1]);
  assert.equal(JSON.stringify(data), before, 'Writer validation must not mutate source stories');
});

test('all models repeating the contextual overclaim return no usable newsletter', t => {
  const h = harness(t, [ACTUAL, ACTUAL, ACTUAL]);
  assert.equal(h.context.generateNewsletterWithGemini_('fixture-key', writerData()), null);
  assert.deepEqual(h.calls.map(call => call.model), h.models);
  assert.ok(!vm.runInContext('LAST_SUCCESSFUL_GEMINI_MODEL', h.context));
});

test('fact-check claim sourceIndex 1 uses its own fresh taking-note decision and cannot borrow approval or PDF support', t => {
  const h = harness(t);
  const job = factJob([{ ...district, snippet: APPROVED }, other],
    [{ freshText: district.snippet }, { freshText: other.snippet }], 1);
  const before = JSON.stringify(job), result = h.context.factCheckResult_(job);
  assert.equal(result.claims[0].verdict, 'unverified');
  assert.equal(result.claims[0].sourceIndex, null); assert.equal(result.claims[0].sourceUrl, '');
  assert.match(result.claims[0].evidence, /beslutningstekst|status/i);
  assert.equal(result.summary.verified, 0); assert.equal(result.summary.unverified, 1);
  assert.equal(JSON.stringify(job), before, 'Saved job, source snapshot and model/PDF results stay intact');
  assert.notEqual(result.claims[0], job.textResult.claims[0]);
  assert.equal(h.context.factCheckResult_(job).claims[0].verdict, 'unverified', 'Repeated finalization applies the same guard');
});

test('a source-bound claim with its own fresh approved decision remains verified without changing the saved job', t => {
  const h = harness(t);
  const job = factJob([district, district],
    [{ freshText: district.snippet }, { freshText: APPROVED }], 2);
  const before = JSON.stringify(job), result = h.context.factCheckResult_(job);
  assert.equal(result.claims[0].verdict, 'verified');
  assert.equal(result.claims[0].sourceIndex, 2);
  assert.equal(result.claims[0].sourceUrl, job.textResult.claims[0].sourceUrl);
  assert.equal(result.summary.verified, 1); assert.equal(result.summary.unverified, 0);
  assert.equal(JSON.stringify(job), before);
  result.claims[0].verdict = 'unverified';
  assert.equal(h.context.factCheckResult_(job).claims[0].verdict, 'verified', 'Returned results do not alias saved state');
  assert.equal(JSON.stringify(job), before);
});

test('full-text status warning catches omitted budget forwarding even with empty or entirely verified claims', t => {
  const h = harness(t);
  for (const includeClaim of [false, true]) {
    const job = factJob([budget], [{ freshText: budget.snippet }], 1);
    job.newsletter = 'Sagen handler om budgettet. Økonomiudvalget nu har sendt budgetforslaget videre til 1. behandling i Byrådet.';
    job.pdfReviews = []; job.pdfTasks = [];
    job.textResult.claims = includeClaim ? [{ claim: 'Budgetforslaget omfatter perioden 2027-2030.',
      verdict: 'verified', evidence: 'Direktionens forslag til budget 2027-2030', sourceIndex: 1,
      sourceUrl: 'https://dagsordener.middelfart.dk/vis?id=budget-fixture' }] : [];
    const before = JSON.stringify(job), result = h.context.factCheckResult_(job);
    assert.match(result.note || '', /Udokumenteret status i kladdens fulde tekst/);
    assert.equal(result.summary.verified, includeClaim ? 1 : 0);
    assert.equal(result.summary.unverified, 0, 'Do not invent a model claim or change an unrelated verified claim');
    assert.equal(JSON.stringify(result.claims), JSON.stringify(job.textResult.claims));
    assert.equal(JSON.stringify(job), before);
    assert.equal(h.context.factCheckResult_(job).note, result.note, 'Repeated finalization does not accumulate warnings in saved state');
    const fresh = structuredClone(job);
    fresh.sources[0].freshText = 'Beslutning\nØkonomiudvalget har fremsendt Direktionens forslag til budget 2027-2030 til 1. behandling i Byrådet.\nPræsentation\nBudget 2027-2030.';
    const freshBefore = JSON.stringify(fresh), updated = h.context.factCheckResult_(fresh);
    assert.doesNotMatch(updated.note || '', /Udokumenteret status i kladdens fulde tekst/);
    assert.equal(updated.summary.verified, includeClaim ? 1 : 0);
    assert.equal(JSON.stringify(fresh), freshBefore);
  }
});

test('full-text legacy hearing warning uses each story own fresh decision when the model omitted the pronoun claim', t => {
  const h = harness(t);
  const job = factJob([district, other], [{ freshText: district.snippet }, { freshText: other.snippet }], 2);
  job.newsletter = ACTUAL;
  job.textResult.claims[0].claim = 'Forslaget til renovering af kantinerne er sendt i høring.';
  job.textResult.claims[0].evidence = 'Forslaget til renovering af kantinerne er godkendt og sendt i høring.';
  const before = JSON.stringify(job), result = h.context.factCheckResult_(job);
  assert.match(result.note || '', /Udokumenteret status i kladdens fulde tekst/);
  assert.equal(result.summary.verified, 1); assert.equal(result.summary.unverified, 0);
  assert.equal(JSON.stringify(result.claims), JSON.stringify(job.textResult.claims));
  assert.equal(JSON.stringify(job), before);
  const fresh = structuredClone(job);
  fresh.sources[0].freshText = APPROVED;
  const freshBefore = JSON.stringify(fresh), updated = h.context.factCheckResult_(fresh);
  assert.doesNotMatch(updated.note || '', /Udokumenteret status i kladdens fulde tekst/);
  assert.equal(updated.summary.verified, 1);
  assert.equal(JSON.stringify(fresh), freshBefore);
});
