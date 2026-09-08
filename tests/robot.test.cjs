const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(process.env.ROBOT_SOURCE || path.join(__dirname, '../sf-middelfart-robot-v8.gs'), 'utf8');
const good = {tldr:'Kommunen afsætter 10 mio. kr.', sfAnalysis:'Velfærd', facts:'10 mio. kr.', amounts:'10 mio. kr.', score:4, programMatch:'Velfærd'};
const gt = [{subject:'Budget',committee:'Byråd',sourceType:'firstagenda',sourceUrl:'https://dagsordener.middelfart.dk/Vis/Referat/1',freshText:'Kommunen afsætter 10 mio. kr.'}];
function response(text, finishReason='STOP', code=200, parts) {
 return {code,body:{candidates:[{finishReason,content:{parts:parts || [{text}]}}]}};
}
function harness(replies=[]) {
 const calls=[],logs=[],writes=[];
 const context=vm.createContext({console:{log:(...x)=>logs.push(x.join(' '))}, Session:{getScriptTimeZone:()=> 'Europe/Copenhagen'}, Utilities:{sleep:()=>{},parseDate:t=>new Date(t.replace(' ','T'))},
 UrlFetchApp:{fetch:(url,opts)=>{calls.push({url,opts}); const r=replies[Math.min(calls.length-1,replies.length-1)]; if(!r)throw Error('Unexpected network call');return {getResponseCode:()=>r.code,getContentText:()=>JSON.stringify(r.body)};}}}, {codeGeneration:{strings:false,wasm:false}});
 vm.runInContext(source,context,{timeout:1000});
 return {context,calls,logs,writes,run:(code)=>vm.runInContext(code,context,{timeout:1000})};
}
for (const value of [{},[],null,{...good,score:'4'},{...good,score:2.5},{...good,score:0},{...good,tldr:''},{...good,facts:[]}]) {
 test('reject invalid analysis '+JSON.stringify(value),()=>{
  const h=harness([response(JSON.stringify(value))]);
  assert.equal(h.context.analyzeWithGemini_('test-key',{subject:'Budget',content:'10 mio. kr.'}).ok,false);
 });
}
test('valid analysis accepted',()=>{const h=harness([response(JSON.stringify(good))]);assert.equal(h.context.analyzeWithGemini_('test-key',{subject:'Budget',content:'10 mio. kr.'}).score,4);});
test('malformed JSON falls back',()=>{const h=harness([response('{'),response(JSON.stringify(good))]);assert.equal(h.context.analyzeWithGemini_('test-key',{subject:'Budget',content:'tekst'}).ok,true);assert.match(h.calls[1].url,/gemini-3.6-flash/);});
test('MAX_TOKENS falls back even with valid partial JSON',()=>{const h=harness([response(JSON.stringify(good),'MAX_TOKENS'),response(JSON.stringify({...good,score:5}))]);assert.equal(h.context.analyzeWithGemini_('test-key',{subject:'Budget',content:'tekst'}).score,5);});
test('all non-thought text parts joined',()=>{const h=harness([response('', 'STOP',200,[{text:'hidden reasoning',thought:true},{text:JSON.stringify(good).slice(0,20)},{text:JSON.stringify(good).slice(20)}])]);assert.equal(h.context.analyzeWithGemini_('test-key',{subject:'Budget',content:'tekst'}).ok,true);});
for(const value of [{},{claims:[]},{claims:[{claim:'Beløb',verdict:'maybe',evidence:'tekst',sourceIndex:1}]}]) {
 test('invalid fact check never green '+JSON.stringify(value),()=>{const h=harness([response(JSON.stringify(value))]);const result=h.context.factCheckNewsletter_('test-key','Budgettet er på 10 mio. kr.',gt);assert.ok(result.error || result.note);assert.doesNotMatch(h.context.formatFactCheckReport_(result),/✅/);});
}
test('counts are derived from verdicts, not model summary',()=>{const h=harness([response(JSON.stringify({summary:{verified:1,unverified:0,contradicted:0},claims:[{claim:'Budgettet er på 20 mio.',verdict:'contradicted',evidence:'Kommunen afsætter 10 mio. kr.',sourceIndex:1}]}))]);const r=h.context.factCheckNewsletter_('test-key','Budgettet er på 20 mio.',gt);assert.equal(r.summary.contradicted,1);assert.equal(r.summary.verified,0);});
test('invented citation cannot verify',()=>{const h=harness([response(JSON.stringify({claims:[{claim:'Budget',verdict:'verified',evidence:'Kommunen afsætter 20 mio.',sourceIndex:1}]}))]);const r=h.context.factCheckNewsletter_('test-key','Budget',gt);assert.ok(r.error || r.summary.unverified>0);});
test('cached sources cannot make complete green check',()=>{const h=harness([response(JSON.stringify({claims:[{claim:'Budget',verdict:'verified',evidence:gt[0].freshText,sourceIndex:1}]}))]);const r=h.context.factCheckNewsletter_('test-key','Budget',[{...gt[0],sourceType:'firstagenda-cached'}]);assert.ok(r.error || r.note || r.summary.unverified>0);});
test('model output is escaped when stored as spreadsheet text',()=>{const h=harness();const sheet={getRange:()=>({setValues:v=>h.writes.push(v)})};h.context.writeAnalysisRow_(sheet,2,{...good,ok:true,tldr:'=IMPORTXML("https://example.invalid","//a")'});assert.ok(!h.writes[0][0][0].startsWith('='));});
test('HTTP 403 stops without switching models',()=>{const h=harness([{code:403,body:{error:{status:'PERMISSION_DENIED',message:'denied'}}}]);assert.equal(h.context.analyzeWithGemini_('test-key',{subject:'Budget',content:'tekst'}).ok,false);assert.equal(h.calls.length,1);});
module.exports={harness,response,good,gt};
function fakeSheet(rows) {
 const data=rows.map(r=>r.slice()); const ranges=[];
 return {data,ranges,getLastRow:()=>data.length,getMaxColumns:()=>17,getDataRange:()=>({getValues:()=>data.map(r=>r.slice())}),
 getRange:(row,col,nr=1,nc=1)=>({getValues:()=>Array.from({length:nr},(_,i)=>Array.from({length:nc},(_,j)=>data[row-1+i]?.[col-1+j]??'')),setValue:v=>{while(data.length<row)data.push([]);data[row-1][col-1]=v;},setValues:v=>{ranges.push({row,col,v});v.forEach((r,i)=>{while(data.length<row+i)data.push([]);r.forEach((x,j)=>data[row-1+i][col-1+j]=x);});}})};
}
function row(date, subject, score='', tldr='') {const r=Array(17).fill('');Object.assign(r,{0:date,1:'Referat',2:'Byråd',3:subject,4:'FirstAgenda API',5:'FA:meeting:'+subject,7:'Kildetekst',9:tldr,13:score});return r;}
test('invalid/poisoned scores are pending, genuine formalia stays 1',()=>{const h=harness();for(const r of [row('2026-09-01','x',1,'Analyse fejlede'),row('2026-09-01','x',-1,'tekst'),row('2026-09-01','x',3,''),row('2026-09-01','x',2.5,'tekst')])assert.equal(h.context.analysisScore_(r),null);assert.equal(h.context.analysisScore_(row('2026-09-01','x',1,'Formalia/procedurepunkt')),1);});
test('repair selects recent rows before historical backlog',()=>{const h=harness();const sheet=fakeSheet([Array(17).fill(''),row('2025-01-01','old'),row('2026-09-07','new')]);let subjects=[];h.context.PropertiesService={getScriptProperties:()=>({getProperty:()=> 'test-key',setProperty:()=>{},deleteProperty:()=>{}})};h.context.loadAnalysisSource_=r=>({subject:r[3],content:'tekst'});h.context.analyzeWithGemini_=(key,d)=>{subjects.push(d.subject);return {...good,ok:true};};h.context.analyzePendingRows_(sheet,0);assert.deepEqual(subjects,['new','old']);});
test('source collection never uses AI summary when original source missing',()=>{const h=harness();const sources=h.context.collectGroundTruth_([{subject:'x',source:'email',sourceId:'msg',tldr:'AI says 20 mio.',snippet:''}],null);assert.ok(sources.length);assert.equal(sources[0].freshText,'');assert.ok(sources[0].incomplete);});
test('legitimate topics containing formalia keywords are analysed',()=>{const h=harness();assert.equal(h.context.isAdministrativeSubject_('Ændret kompetencefordeling for socialområdet'),false);assert.equal(h.context.isAdministrativeSubject_('Godkendelse af dagsorden'),true);});
test('PDF analysis sends every supplied attachment plus body text',()=>{const h=harness([response(JSON.stringify(good))]);const result=h.context.analyzeWithGemini_('test-key',{subject:'Budget',content:'Supplement i email',pdfBase64List:[{data:'AAA'},{data:'BBB'}]});assert.ok(result.ok);const payload=JSON.parse(h.calls[0].opts.payload);assert.equal(payload.contents[0].parts.filter(p=>p.inline_data).length,2);assert.match(payload.contents[0].parts[0].text,/Supplement i email/);});
test('failed repair preserves existing row and pending count',()=>{const h=harness();const sheet=fakeSheet([[],row('2026-09-07','new',1,'Analyse fejlede')]);h.context.PropertiesService={getScriptProperties:()=>({getProperty:()=> 'test-key',setProperty:()=>{},deleteProperty:()=>{}})};h.context.loadAnalysisSource_=r=>({subject:r[3],content:'tekst'});h.context.analyzeWithGemini_=()=>({ok:false});assert.equal(h.context.analyzePendingRows_(sheet,0),1);assert.equal(sheet.ranges.length,0);});
test('source URL policy blocks actions, credentials, IPs and unapproved hosts',()=>{const h=harness();h.context.PropertiesService={getScriptProperties:()=>({getProperty:()=>''})};for(const url of ['https://sf.dk/unsubscribe?format=.pdf','https://sf.dk/%75nsubscribe','https://sf.dk@evil.example/doc.pdf','http://sf.dk/a.pdf','https://127.0.0.1/doc','https://evil.example/a.pdf','https://sf.dk:443/a.pdf','https://sf.dk\\@evil.example/a'])assert.equal(h.context.sourceUrlAllowed_(url),false,url);assert.equal(h.context.sourceUrlAllowed_('https://sf.dk/a.pdf'),true);});
test('redirect to blocked action is never requested',()=>{const h=harness();let urls=[];h.context.PropertiesService={getScriptProperties:()=>({getProperty:()=>''})};h.context.UrlFetchApp.fetch=(url,opts)=>{urls.push(url);assert.equal(opts.followRedirects,false);return {getResponseCode:()=>302,getHeaders:()=>({Location:'/unsubscribe?file=.pdf'})};};assert.throws(()=>h.context.fetchSourceUrl_('https://sf.dk/document.pdf'));assert.deepEqual(urls,['https://sf.dk/document.pdf']);});
test('direct PDF downloads also enforce URL policy',()=>{const h=harness();h.context.PropertiesService={getScriptProperties:()=>({getProperty:()=>''})};assert.equal(h.context.fetchPdfFromUrl_('https://sf.dk/unsubscribe?file=.pdf').success,false);assert.equal(h.calls.length,0);});
test('ISO timestamp and legacy sheet date both parse',()=>{const h=harness();assert.equal(h.context.parseDate_('2026-09-08T13:00:00.000Z').toISOString(),'2026-09-08T13:00:00.000Z');assert.ok(h.context.parseDate_('2026-09-08 12:00'));assert.equal(h.context.parseDate_('garbage'),null);});
test('truncated corpus cannot result in green status',()=>{const h=harness();const r=h.context.factCheckNewsletter_('key','news',[{...gt[0],freshText:'x'.repeat(240001)}]);assert.ok(r.error);assert.equal(h.calls.length,0);});
test('deadline prevents all network attempts',()=>{const h=harness([response(JSON.stringify(good))]);h.context.timeFor_=()=>false;assert.equal(h.context.analyzeWithGemini_('key',{subject:'x',content:'text'}).ok,false);assert.equal(h.calls.length,0);});
test('HTTP 503 retries then switches model',()=>{const h=harness([{code:503,body:{error:{status:'UNAVAILABLE'}}},{code:503,body:{error:{status:'UNAVAILABLE'}}},{code:503,body:{error:{status:'UNAVAILABLE'}}},response(JSON.stringify(good))]);assert.ok(h.context.analyzeWithGemini_('key',{subject:'x',content:'text'}).ok);assert.equal(h.calls.length,4);assert.match(h.calls[3].url,/gemini-3.6-flash/);});
test('malformed ZIP leaves source explicitly incomplete',()=>{const h=harness();h.context.Utilities.unzip=()=>{throw Error('bad zip')};assert.equal(h.context.processZipAttachment_({}).incomplete,true);});
test('FirstAgenda PDF references include body document and string-true attachments',()=>{
 const h=harness();const refs=h.context.firstAgendaPdfReferences_({Felter:[{DocumentId:'06af11f4-c1da-41cb-9c8f-b8cc8554eb54',Html:'<div></div>',Link:'https://dagsordener.middelfart.dk/Vis/Pdf/bilag/06af11f4-c1da-41cb-9c8f-b8cc8554eb54'}],Bilag:[{Id:'df46c4fc-9fc9-4c21-accd-4d4b6c22a54d',HarPdfVersion:'true',Navn:'Budget'}]});
 assert.equal(refs.length,2);assert.match(refs[0].url,/Pdf\/HentEksternPdf\?documentId=06af/);assert.match(refs[1].url,/vis\/pdf\/bilag\/df46.*redirectDirectlyToPdf=true/);
});
test('FirstAgenda loader sends both PDFs when HTML has no content',()=>{
 const h=harness([response(JSON.stringify(good))]);const pdfUrls=[];h.context.fetchPdfFromUrl_=url=>{pdfUrls.push(url);return {success:true,pdfBase64:'AAAA'};};
 const cache={cookies:'fixture',meeting:[{Id:'point',IsOpen:true,Caption:'Budget',Felter:[{DocumentId:'06af11f4-c1da-41cb-9c8f-b8cc8554eb54',Html:'<div></div>'}],Bilag:[{Id:'df46c4fc-9fc9-4c21-accd-4d4b6c22a54d',HarPdfVersion:'true',Navn:'Budget'}]}]};
 const r=row('2026-09-08','point');const data=h.context.loadAnalysisSource_(r,cache);assert.equal(data.pdfBase64List.length,2);assert.equal(pdfUrls.length,2);assert.ok(h.context.analyzeWithGemini_('key',data).ok);assert.equal(JSON.parse(h.calls[0].opts.payload).contents[0].parts.filter(p=>p.inline_data).length,2);
});
test('signed PDF redirect never receives FirstAgenda cookies',()=>{
 const h=harness();const calls=[];h.context.PropertiesService={getScriptProperties:()=>({getProperty:()=>''})};
 h.context.UrlFetchApp.fetch=(url,opts)=>{calls.push({url,opts});return calls.length===1?{getResponseCode:()=>302,getHeaders:()=>({Location:'https://staticresources.firstagenda.com/api/v1/signed/1?k=fixture'})}:{getResponseCode:()=>200,getBlob:()=>({getContentType:()=> 'application/pdf',getBytes:()=>[37,80,68,70,45,49]})};};
 h.context.Utilities.base64Encode=()=> 'JVBERi0x';assert.equal(h.context.fetchPdfFromUrl_('https://dagsordener.middelfart.dk/document.pdf','fixture-cookie').success,true);assert.equal(calls[0].opts.headers.Cookie,'fixture-cookie');assert.equal(calls[1].opts.headers.Cookie,undefined);assert.equal(calls[1].opts.followRedirects,false);
});
test('PDF signature mismatch is rejected',()=>{const h=harness();assert.throws(()=>h.context.pdfResponse_({getBlob:()=>({getContentType:()=> 'application/pdf',getBytes:()=>[60,104,116,109,108]})}));});
test('unsupported FirstAgenda attachment cannot be silently dropped',()=>{const h=harness();assert.throws(()=>h.context.firstAgendaPdfReferences_({Bilag:[{Id:'df46c4fc-9fc9-4c21-accd-4d4b6c22a54d',HarPdfVersion:'false'}]}));});
test('incomplete fact check still exposes contradictions',()=>{const h=harness();const report=h.context.formatFactCheckReport_({note:'Kilde mangler',summary:{verified:0,unverified:0,contradicted:1},claims:[{claim:'20 mio.',verdict:'contradicted',evidence:'10 mio.',sourceUrl:'https://sf.dk/source'}]});assert.match(report,/MODSAGTE PÅSTANDE/);assert.match(report,/10 mio/);assert.doesNotMatch(report,/✅/);});
test('failed newest source is deferred so subsequent repair reaches next source',()=>{
 const h=harness();const props=new Map([['GEMINI_API_KEY','fixture']]);h.context.PropertiesService={getScriptProperties:()=>({getProperty:k=>props.get(k),setProperty:(k,v)=>props.set(k,v),deleteProperty:k=>props.delete(k)})};
 const sheet=fakeSheet([[],row('2026-09-07','older'),row('2026-09-08','newer')]);let seen=[];
 h.context.loadAnalysisSource_=r=>({subject:r[3],content:'text'});h.context.analyzeWithGemini_=(key,data)=>{seen.push(data.subject);return {ok:false};};h.context.analyzePendingRows_(sheet,0);
 props.delete('ANALYSIS_RETRY_FA:meeting:older');seen=[];h.context.analyzeWithGemini_=(key,data)=>{seen.push(data.subject);return {...good,ok:true};};assert.equal(h.context.analyzePendingRows_(sheet,0),1);assert.deepEqual(seen,['older']);
});
test('unsupported email document is reported incomplete',()=>{const h=harness();const result=h.context.processAttachments_({getAttachments:()=>[{getName:()=> 'budget.docx',getSize:()=>1000}]});assert.equal(result.incomplete,true);});
test('incomplete source cannot generate a relevance score',()=>{const h=harness([response(JSON.stringify(good))]);assert.equal(h.context.analyzeWithGemini_('key',{subject:'x',content:'text',sourceIncomplete:true}).ok,false);assert.equal(h.calls.length,0);});

for (const pdf of [false, true]) {
 test(`analysis requests an API-enforced schema for ${pdf ? 'PDF' : 'text'} input`, () => {
  const h = harness([response(JSON.stringify(good))]);
  const data = {subject:'Budget',content:'10 mio. kr.'};
  if (pdf) data.pdfBase64List = [{data:'JVBERi0x'}];
  assert.equal(h.context.analyzeWithGemini_('test-key',data).ok,true);
  const config = JSON.parse(h.calls[0].opts.payload).generationConfig;
  assert.ok(config.responseSchema, 'JSON MIME type alone does not enforce the field contract');
  assert.equal(config.responseSchema.type,'OBJECT');
  for (const key of ['tldr','sfAnalysis','facts','amounts','programMatch']) {
   assert.ok(config.responseSchema.required.includes(key));
   assert.equal(config.responseSchema.properties[key].type,'STRING');
  }
  assert.equal(config.responseSchema.properties.score.type,'INTEGER');
 });
}

test('source version matching requires the same date, committee, title, point and case number',()=>{
 const h=harness(); const agenda=row('2026-09-07','Same title'); agenda[1]='Dagsorden'; agenda[7]='PUNKT 51: Same title\nSagsnr: 2026-123456\nOriginal';
 const minutes=agenda.slice(); minutes[1]='Referat'; minutes[5]='FA:new-meeting:new-point';
 assert.deepEqual(Array.from(h.context.supersededAgendaIndexes_([agenda,minutes])),[0]);
 for(const [column,value] of [[0,'2026-09-06'],[2,'Other committee'],[3,'Other title'],[7,'PUNKT 52: Same title\nSagsnr: 2026-123456'],[7,'PUNKT 51: Same title\nSagsnr: 2026-999999'],[7,'Missing identifiers'],[2,''],[3,' '],[7,'PUNKT 51: Same title\nSagsnr:\nBeslutning'],[7,'PUNKT 51: Same title\nSagsnr: \t\r\nBeslutning']]) {
  const unrelated=minutes.slice(); unrelated[column]=value;
  assert.equal(h.context.supersededAgendaIndexes_([agenda,unrelated]).size,0);
 }
});
test('ambiguous matches stay active and a shared source ID only supersedes the agenda row',()=>{
 const h=harness(); const agenda=row('2026-09-07','Same title'); agenda[1]='Dagsorden'; agenda[7]='PUNKT 51: Same title\nSagsnr: 2026-123456';
 const minutes=agenda.slice(); minutes[1]='Referat';
 assert.deepEqual(Array.from(h.context.supersededAgendaIndexes_([agenda,minutes])),[0]);
 minutes[5]='FA:new-meeting:new-point'; const alternative=minutes.slice(); alternative[5]='FA:other-meeting:other-point';
 assert.equal(h.context.supersededAgendaIndexes_([agenda,minutes,alternative]).size,0);
});
