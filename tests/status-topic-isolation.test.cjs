'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const SOURCE = fs.readFileSync(process.env.ROBOT_SOURCE || path.join(__dirname, '../sf-middelfart-robot-v8.gs'), 'utf8');

// Synthetic cases reproduce a title naming the decision-making body. No saved
// newsletter, private spreadsheet data or rejected model text is needed.
const school = {
  type: 'Dagsorden', committee: 'Byrådet',
  subject: 'Forslag til Byrådet om ansøgning til pulje for mindre skoler',
  snippet: 'Præsentation\nEt forslag om mindre skoler.\nForvaltningen indstiller\nAt Byrådet søger midler fra puljen.'
};
const harbour = {
  type: 'Referat', committee: 'Byrådet', subject: 'Strategi for kulturhavnen',
  snippet: 'Beslutning\nStrategien for kulturhavnen er godkendt.\nPræsentation\nNy havnestrategi.'
};

function validator() {
  const context = vm.createContext({ console: { log() {} } });
  vm.runInContext(SOURCE, context, { timeout: 1000 });
  return (text, stories) => context.validateDecisionStage_(text, stories);
}

test('an actor named in a pending title cannot reject another case with a documented decision', () => {
  const validate = validator();
  for (const stories of [[school, harbour], [harbour, school]]) {
    assert.doesNotThrow(() => validate('Byrådet har godkendt strategien for kulturhavnen.', stories));
  }
});

test('school proposal completion still fails when the sentence identifies that case', () => {
  const validate = validator();
  assert.throws(() => validate('Byrådet har besluttet at søge puljen til mindre skoler.', [school, harbour]), /uden belæg/);
  assert.doesNotThrow(() => validate('Forslaget er, at Byrådet søger midler til mindre skoler.', [school, harbour]));
});

test('actor and process words alone do not identify a pending case', () => {
  const pending = { ...school, subject: 'Forslag til Byrådet om endelig vedtagelse' };
  assert.doesNotThrow(() => validator()('Byrådet har godkendt strategien for kulturhavnen.', [pending, harbour]));
});

test('committee finality checks use the case topic rather than the committee in its title', () => {
  const pending = {
    type: 'Referat', committee: 'Klimaudvalget', subject: 'Klimaudvalget: Damprojekt',
    snippet: 'Beslutning\nGodkendt.\nPræsentation\nDamprojekt.\nBehandlingsplan:\nKlimaudvalget og derefter Byrådet.'
  };
  const approved = { ...harbour, committee: 'Klimaudvalget' };
  const validate = validator();
  assert.doesNotThrow(() => validate('Klimaudvalget har endeligt godkendt strategien for kulturhavnen.', [pending, approved]));
  assert.throws(() => validate('Klimaudvalget har endeligt godkendt damprojektet.', [pending, approved]), /endelig vedtagelse/);
});

test('a different source category named Budget does not disable the budget status guard', () => {
  const budget = {
    type: 'Dagsorden', committee: 'Økonomiudvalget', subject: '1. behandling af budget 2027-2030',
    snippet: 'Præsentation\nØkonomiudvalget skal behandle budgetforslaget.'
  };
  assert.throws(() => validator()('Økonomiudvalget har behandlet budgetforslaget.',
    [budget, { ...harbour, committee: 'Budget' }]), /uden belæg/);
});
