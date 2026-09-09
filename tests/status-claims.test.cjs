'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const SOURCE = fs.readFileSync(process.env.ROBOT_SOURCE || path.join(__dirname, '../sf-middelfart-robot-v8.gs'), 'utf8');
// Excerpts from the public FirstAgenda records used in the live writer comparison.
const budget = { type:'Dagsorden', subject:'1. behandling af budget 2027-2030', committee:'Økonomiudvalget', score:5,
  snippet:'Præsentation\nØkonomiudvalget og Byrådet skal 1. behandle budgettet for 2027-2030.\nForvaltningen indstiller\nAt Økonomiudvalget fremsender Direktionens forslag til budget 2027-2030 til 1. behandling i Byrådet.\nSagsbeskrivelse\nDer er i budgetforslaget et skattefinansieret anlægsbudget på netto 80,555 mio. kr. i 2027.' };
const district = { type:'Referat', subject:'Høring: Ændring af skoledistrikt for bydelen Trådværket', committee:'Skoleudvalget', score:4,
  snippet:'Beslutning\nTaget til efterretning.\nPræsentation\nSagen vedrører høring af forslag om ændring af skoledistrikt for bydelen Trådværket.\nForvaltningen indstiller\nAt Skoleudvalget godkender at sende forslag om ændring af skoledistrikt for bydelen Trådværket i høring hos de berørte skolebestyrelser.\nSagsbeskrivelse\nForslagets virkning er fra 2027.' };
const BAD_BUDGET = 'Økonomiudvalget har netop haft den første behandling af direktionens forslag til budgettet for 2027-2030.';
const BAD_HEARING = 'Skoleudvalget har sendt et forslag i høring om at flytte skoledistriktet for den kommende bydel Trådværket.';
function harness(replies=[]) {
  const calls=[];
  const context=vm.createContext({console:{log:()=>{}}, Session:{getScriptTimeZone:()=> 'Europe/Copenhagen'},
    Utilities:{formatDate:()=> '2026',sleep:()=>{}}, UrlFetchApp:{fetch:(url)=>{
      calls.push(url); const text=replies[Math.min(calls.length-1,replies.length-1)];
      if(text===undefined) throw Error('Unexpected network call');
      return {getResponseCode:()=>200,getContentText:()=>JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{text}]}}]})};
    }}}, {codeGeneration:{strings:false,wasm:false}});
  vm.runInContext(SOURCE,context,{timeout:1000});
  context.loadToneGuide_=()=> 'Skriv med kildebelæg.';
  return {context,calls};
}
test('rejects completed budget treatment and forwarding based on a proposal-only agenda',()=>{
  const h=harness();
  for(const text of [BAD_BUDGET,'Økonomiudvalget nu har sendt budgetforslaget videre til 1. behandling i Byrådet.'])
    assert.throws(()=>h.context.validateDecisionStage_(text,[budget]),/uden belæg/);
});
test('rejects active and passive hearing completion when the decision only takes note',()=>{
  const h=harness();
  for(const text of [BAD_HEARING,'Forslag om ændring af skoledistrikt for Trådværket er sendt i høring frem til 29. september.'])
    assert.throws(()=>h.context.validateDecisionStage_(text,[district]),/uden belæg/);
});
test('allows proposal wording, taking note, and explicit uncertainty',()=>{
  const h=harness();
  assert.doesNotThrow(()=>h.context.validateDecisionStage_('Budgetforslaget står på Økonomiudvalgets dagsorden til 1. behandling.',[budget]));
  for(const text of ['Skoleudvalget har taget høringen om Trådværket til efterretning.',
    'Forvaltningen foreslår at sende ændringen af skoledistriktet for Trådværket i høring.',
    'Det er uklart, om ændringen af skoledistriktet for Trådværket er sendt i høring.',
    'Ændringen af skoledistriktet for Trådværket er ikke sendt i høring.'])
    assert.doesNotThrow(()=>h.context.validateDecisionStage_(text,[district]));
});
test('does not bind another case from the same committee to the hearing restriction',()=>{
  const h=harness();
  assert.doesNotThrow(()=>h.context.validateDecisionStage_('Skoleudvalget har godkendt nye kantiner.',[district]));
});
test('accepts explicit completed actions from a decision record or a complete original sentence',()=>{
  const h=harness();
  const decided={...district,snippet:district.snippet.replace('Taget til efterretning.','Forslaget er godkendt og sendt i høring.')};
  assert.doesNotThrow(()=>h.context.validateDecisionStage_(BAD_HEARING,[decided]));
  const historical='Økonomiudvalget har godkendt budgetrammen for 2025.';
  assert.doesNotThrow(()=>h.context.validateDecisionStage_(historical,[{...budget,snippet:budget.snippet+'\n'+historical}]));
});
test('a rejected completed-action draft falls back before returning generated text',()=>{
  const good='Budgetforslaget står på Økonomiudvalgets dagsorden. Forvaltningen foreslår en høring om Trådværkets skoledistrikt.';
  const h=harness([BAD_BUDGET,good]);
  assert.equal(h.context.generateNewsletterWithGemini_('fixture-key',{dateRange:'uge37',topStories:[budget,district],mediumStories:[],adminItems:[],upcomingMeetings:[]}),good);
  assert.equal(h.calls.length,2);
  assert.match(h.calls[1],/gemini-3.6-flash/);
});
test('all unsupported-action writer replies produce no usable draft',()=>{
  const h=harness([BAD_HEARING]);
  assert.equal(h.context.generateNewsletterWithGemini_('fixture-key',{dateRange:'uge37',topStories:[district],mediumStories:[],adminItems:[],upcomingMeetings:[]}),null);
  assert.equal(h.calls.length,3);
});
test('resumed old jobs downgrade unsupported status without rewriting saved claims or granting PDF verification',()=>{
  const h=harness();
  const job={stories:[district],textResult:{claims:[{claim:'Forslag om ændring af skoledistrikt for Trådværket er sendt i høring.',verdict:'verified',evidence:'Forvaltningen indstiller',sourceIndex:1,sourceUrl:'https://dagsordener.middelfart.dk/vis?id=fixture'}]},
    pdfReviews:[{reviews:[{claimId:0,verdict:'supported',evidence:'Forvaltningen indstiller'}]}],pdfTasks:[{}],failures:[]};
  const before=JSON.stringify(job);
  const result=h.context.factCheckResult_(job);
  assert.equal(result.claims[0].verdict,'unverified');
  assert.equal(result.claims[0].sourceIndex,null);
  assert.equal(result.claims[0].sourceUrl,'');
  assert.equal(result.summary.verified,0);
  assert.equal(result.summary.unverified,1);
  assert.equal(JSON.stringify(job),before);
});

test('conditional and explicitly undocumented active actions do not claim completion',()=>{
  const h=harness();
  assert.doesNotThrow(()=>h.context.validateDecisionStage_('Hvis Økonomiudvalget har behandlet budgetforslaget, følger sagen den videre proces.',[budget]));
  assert.doesNotThrow(()=>h.context.validateDecisionStage_('Det er ikke dokumenteret, at Skoleudvalget har sendt forslaget om Trådværket i høring.',[district]));
  assert.doesNotThrow(()=>h.context.validateDecisionStage_('Vi følger op, hvis forslaget om Trådværket er sendt i høring.',[district]));
});
test('a historical decision by another actor is not mistaken for the proposed hearing',()=>{
  const h=harness();
  const story={...district,snippet:district.snippet+'\nByrådet vedtog 4. december 2023 en udviklingsplan for Fremtidens havn Trådværket.'};
  assert.doesNotThrow(()=>h.context.validateDecisionStage_('Udviklingsplanen for Trådværket blev vedtaget af Byrådet i 2023.',[story]));
});
test('final status review uses the claim source instead of a different agenda on the same budget',()=>{
  const h=harness();
  const decided={...budget,type:'Referat',committee:'Byrådet',snippet:'Beslutning\nBudgettet er godkendt.\nPræsentation\nBudget 2027-2030.'};
  const job={stories:[budget,decided],sources:[{freshText:budget.snippet},{freshText:decided.snippet}],
    textResult:{claims:[{claim:'Byrådet har godkendt budgettet for 2027-2030.',verdict:'verified',evidence:'Budgettet er godkendt.',sourceIndex:2,sourceUrl:'https://dagsordener.middelfart.dk/vis?id=fixture'}]},pdfReviews:[],pdfTasks:[],failures:[]};
  assert.equal(h.context.factCheckResult_(job).claims[0].verdict,'verified');
});
test('final status review respects a fresh decision made after the draft source snapshot',()=>{
  const h=harness();
  const fresh='Beslutning\nForslaget om Trådværkets skoledistrikt er godkendt og sendt i høring.\nPræsentation\nHøring.';
  const job={stories:[district],sources:[{freshText:fresh}],
    textResult:{claims:[{claim:BAD_HEARING,verdict:'verified',evidence:'Forslaget om Trådværkets skoledistrikt er godkendt og sendt i høring.',sourceIndex:1,sourceUrl:'https://dagsordener.middelfart.dk/vis?id=fixture'}]},pdfReviews:[],pdfTasks:[],failures:[]};
  assert.equal(h.context.factCheckResult_(job).claims[0].verdict,'verified');
});
