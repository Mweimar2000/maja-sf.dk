'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const SOURCE = fs.readFileSync(process.env.ROBOT_SOURCE || path.join(__dirname, '../sf-middelfart-robot-v8.gs'), 'utf8');

const MiB = 1024 * 1024;
const PDF_LIMIT = 30 * MiB;
const WIRE_LIMIT = 45 * MiB;
// Exact sizes observed in five public MOTAS PDFs on 9 September 2026.
// Bodies below are synthetic signature/size fixtures, not copies of those PDFs.
// No test depends on private files, network access or another test module.
const MOTAS_SIZES = [26625, 301428, 16393175, 90947, 78848];
const GOOD = { tldr: 'Et budgetforslag.', sfAnalysis: 'Relevant for kommunen.',
  facts: 'Budgettet er et forslag.', amounts: 'Ikke angivet', score: 4, programMatch: 'Miljø' };

function base64AtSize(size) {
  const padding = (3 - size % 3) % 3;
  return 'A'.repeat(Math.ceil(size / 3) * 4 - padding) + '='.repeat(padding);
}

function pdfResponse(size, mime = 'application/pdf', signature = '%PDF-') {
  // Never spread/Array.from a large byte buffer: Apps Script array semantics
  // relevant here are length, indexing and slice, which Uint8Array provides.
  const bytes = new Uint8Array(size);
  for (let i = 0; i < Math.min(size, signature.length); i++) bytes[i] = signature.charCodeAt(i);
  return {
    getResponseCode: () => 200,
    getHeaders: () => ({ 'Content-Type': mime }),
    getBlob: () => ({ getContentType: () => mime, getBytes: () => bytes })
  };
}

function harness(t) {
  const h = { clock: Date.parse('2026-09-09T10:00:00Z'), requests: [], sourceRequests: [],
    logs: [], encodes: [], sleeps: [], documents: new Map(), unexpected: [], inspectRequest: null };
  class ReviewDate extends Date {
    constructor(...args) { super(...(args.length ? args : [h.clock])); }
    static now() { return h.clock; }
  }
  const context = vm.createContext({
    Date: ReviewDate,
    console: { log: (...args) => h.logs.push(args.join(' ')) },
    Session: { getScriptTimeZone: () => 'Europe/Copenhagen' },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null }) },
    Utilities: {
      sleep(ms) { h.sleeps.push(ms); h.clock += ms; },
      base64Encode(bytes) { h.encodes.push(bytes.length); return base64AtSize(bytes.length); },
      newBlob(data) { return { getBytes: () => typeof data === 'string' ? Buffer.from(data, 'utf8') : data }; },
      Charset: { UTF_8: 'UTF-8' }
    },
    UrlFetchApp: { fetch(url, options) {
      if (h.documents.has(url)) {
        h.sourceRequests.push(url);
        return h.documents.get(url)();
      }
      if (/^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models\/[^/]+:generateContent$/.test(url)) {
        h.requests.push({ url, bytes: Buffer.byteLength(options.payload, 'utf8'), length: options.payload.length });
        if (h.inspectRequest) h.inspectRequest(options.payload);
        return { getResponseCode: () => 200, getContentText: () => JSON.stringify({
          candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(GOOD) }] } }]
        }) };
      }
      h.unexpected.push(url);
      throw new Error('Unexpected local fake request');
    } }
  }, { codeGeneration: { strings: false, wasm: false } });
  vm.runInContext(SOURCE, context, { timeout: 1000 });
  h.context = context;
  h.send = (payload, opts) => context.geminiFetch_('local-fixture-key', payload, opts);
  t.after(() => assert.deepEqual(h.unexpected, [], 'All requests must be explicitly simulated'));
  return h;
}

function bundle(h, sizes) {
  const guid = i => `10000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`;
  const item = { Id: 'point', IsOpen: true, Caption: 'MOTAS budget',
    Felter: [{ DocumentId: guid(0), Tekst: 'Indstilling om budget og takster.' }],
    Bilag: sizes.slice(1).map((_, i) => ({ Id: guid(i + 1), HarPdfVersion: true, Navn: `Bilag ${i + 1}` })) };
  const urls = sizes.map((_, i) => i === 0
    ? `https://dagsordener.middelfart.dk/Pdf/HentEksternPdf?documentId=${guid(i)}`
    : `https://dagsordener.middelfart.dk/vis/pdf/bilag/${guid(i)}/?redirectDirectlyToPdf=true`);
  urls.forEach((url, i) => h.documents.set(url, () => pdfResponse(sizes[i])));
  const row = ['2026-09-08', 'Dagsorden', 'Økonomiudvalget', item.Caption,
    'FirstAgenda API', 'FA:meeting:point', '', 'Tidligere kildetekst'];
  const cache = { cookies: 'local-fixture-cookie', meeting: [item] };
  return { row, cache, item, urls };
}

function payload(text = '') {
  return { contents: [{ parts: [{ text }] }], generationConfig: {
    responseMimeType: 'application/json', responseSchema: { type: 'OBJECT', description: 'Testskema' }
  } };
}

function assertWireRejected(h, input, opts) {
  assert.throws(() => h.send(input, opts), error => {
    assert.equal(error.noFallback, true, 'A local size error must not consume fallback models');
    assert.match(error.message, /stør|budget|payload|JSON|byte|input/i);
    return true;
  });
  assert.equal(h.requests.length, 0, 'Oversize input must be rejected before UrlFetchApp.fetch');
  assert.deepEqual(h.sleeps, [], 'Local size rejection must not back off or retry');
  assert.doesNotMatch(h.logs.join('\n'), /prøver reservemodel/);
}

test('a PDF at the actual 16,393,175-byte MOTAS size is accepted intact', t => {
  const h = harness(t);
  const result = h.context.pdfResponse_(pdfResponse(MOTAS_SIZES[2]));
  assert.equal(result.success, true);
  assert.equal(result.pdfBase64.length, Math.ceil(MOTAS_SIZES[2] / 3) * 4);
  assert.deepEqual(h.encodes, [MOTAS_SIZES[2]]);
});

test('a single PDF at the 30 MiB raw boundary is accepted', t => {
  const h = harness(t);
  assert.equal(h.context.pdfResponse_(pdfResponse(PDF_LIMIT)).pdfBase64.length, 40 * MiB);
  assert.deepEqual(h.encodes, [PDF_LIMIT]);
});

test('one byte above the raw PDF cap is rejected before base64 allocation', t => {
  const h = harness(t);
  assert.throws(() => h.context.pdfResponse_(pdfResponse(PDF_LIMIT + 1)), /stor|stør|budget|grænse|byte/i);
  assert.deepEqual(h.encodes, []);
  assert.equal(h.requests.length, 0);
});

for (const [name, mime, signature, size] of [
  ['non-PDF MIME', 'text/html', '%PDF-', 100],
  ['ZIP bytes advertised as PDF', 'application/pdf', 'PK\x03\x04', 100],
  ['truncated PDF signature', 'application/pdf', '%PDF-', 4]
]) {
  test(`raising the cap does not accept ${name}`, t => {
    const h = harness(t);
    assert.throws(() => h.context.pdfResponse_(pdfResponse(size, mime, signature)), /PDF|MIME|signatur|filtype/i);
    assert.deepEqual(h.encodes, []);
  });
}

test('valid PDF MIME parameters remain accepted', t => {
  const h = harness(t);
  assert.equal(h.context.pdfResponse_(pdfResponse(100, 'Application/PDF; charset=binary')).success, true);
});

test('PDF fetch logs distinguish MIME, signature and exact size failures', t => {
  for (const [size, mime, signature, reason] of [
    [100, 'text/html', '%PDF-', /MIME|filtype/i],
    [100, 'application/pdf', 'PK\x03\x04', /signatur|%PDF-/i],
    [PDF_LIMIT + 1, 'application/pdf', '%PDF-', /31457281.*30 MiB/i]
  ]) {
    const h = harness(t), url = 'https://sf.dk/rejected-fixture.pdf';
    h.documents.set(url, () => pdfResponse(size, mime, signature));
    const result = h.context.fetchPdfFromUrl_(url);
    assert.equal(result.success, false);
    // The existing fetch contract returns success:false; the specific new
    // diagnostic is logged. Persistence of that reason is a separate concern.
    assert.match(h.logs.join('\n'), reason);
    assert.equal(h.sourceRequests.length, 1);
    assert.deepEqual(h.encodes, []);
  }
});

test('all five MOTAS-sized PDFs survive source preparation and enter one analysis request', t => {
  const h = harness(t), input = bundle(h, MOTAS_SIZES);
  assert.equal(MOTAS_SIZES.reduce((sum, size) => sum + size, 0), 16891023);
  const data = h.context.loadAnalysisSource_(input.row, input.cache);
  assert.equal(data.pdfBase64List.length, 5, 'The largest document must not be skipped');
  assert.deepEqual(h.sourceRequests, input.urls);
  h.inspectRequest = wire => {
    const sent = JSON.parse(wire);
    assert.match(sent.contents[0].parts[0].text, /Indstilling om budget og takster/);
    const parts = sent.contents[0].parts.filter(part => part.inline_data);
    assert.equal(parts.length, 5);
    assert.deepEqual(parts.map(part => part.inline_data.data.length), MOTAS_SIZES.map(size => Math.ceil(size / 3) * 4));
    assert.ok(parts.every(part => part.inline_data.mime_type === 'application/pdf'));
    assert.ok(sent.systemInstruction.parts[0].text.length > 0);
    assert.ok(sent.generationConfig.responseSchema);
  };
  assert.equal(h.context.analyzeWithGemini_('local-fixture-key', data).ok, true);
  assert.equal(h.requests.length, 1);
  assert.ok(h.requests[0].bytes < WIRE_LIMIT);
});

test('the older ground-truth collector also retains the complete five-PDF bundle', t => {
  const h = harness(t), input = bundle(h, MOTAS_SIZES);
  h.context.fetchMeetingAgenda_ = () => [input.item];
  const source = h.context.collectGroundTruth_([{ type: input.row[1], committee: input.row[2],
    subject: input.row[3], source: input.row[4], sourceId: input.row[5], snippet: input.row[7]
  }], 'local-fixture-cookie')[0];
  assert.deepEqual(h.sourceRequests, input.urls);
  assert.equal(source.pdfBase64List.length, 5);
  assert.equal(source.incomplete, true, 'PDF interpretations still require manual verification');
});

test('an aggregate over 30 MiB cannot become an analysis of only the smaller subset', t => {
  const h = harness(t), input = bundle(h, [16 * MiB, 15 * MiB]);
  assert.throws(() => h.context.loadAnalysisSource_(input.row, input.cache), /samlet|budget|stør/i);
  assert.deepEqual(h.sourceRequests, input.urls, 'Both individually permitted PDFs reached the aggregate check');
  assert.equal(h.requests.length, 0);
});

test('mail attachment cap stays at its existing 20 MiB', t => {
  const h = harness(t);
  const attachment = { getName: () => 'mail.pdf', getSize: () => 20 * MiB + 1,
    getBytes() { throw new Error('An oversized mail attachment must not be loaded'); } };
  const result = h.context.processAttachments_({ getAttachments: () => [attachment] });
  assert.equal(result.incomplete, true);
  assert.equal(result.pdfBase64List.length, 0);
  assert.match(result.summary, /for stor/i);
  assert.deepEqual(h.encodes, []);
});

test('ZIP expansion retains its separate 15 MiB cap', t => {
  const h = harness(t);
  h.context.Utilities.unzip = () => [{ getName: () => 'inside.pdf', getBytes: () => new Uint8Array(15 * MiB + 1) }];
  const result = h.context.processZipAttachment_({});
  assert.equal(result.incomplete, true);
  assert.equal(result.pdfBase64List.length, 0);
  assert.deepEqual(h.encodes, []);
  assert.match(h.logs.join('\n'), /ZIP.*budget/);
});

test('complete serialized JSON at 45 MiB is allowed including the injected system instruction', t => {
  const calibration = harness(t);
  calibration.send(payload());
  const overhead = calibration.requests[0].bytes;
  const h = harness(t);
  h.send(payload('A'.repeat(WIRE_LIMIT - overhead)));
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].bytes, WIRE_LIMIT);
});

test('the injected system instruction counts toward the shared wire limit', t => {
  const input = payload();
  const emptyBytes = Buffer.byteLength(JSON.stringify(input), 'utf8');
  input.contents[0].parts[0].text = 'A'.repeat(WIRE_LIMIT - emptyBytes - 1);
  assert.equal(Buffer.byteLength(JSON.stringify(input), 'utf8'), WIRE_LIMIT - 1);
  assertWireRejected(harness(t), input);
});

for (const field of ['prompt', 'schema', 'metadata']) {
  test(`UTF-8 emoji in ${field} counts even when JSON character length is below 45 MiB`, t => {
    const input = payload('Kontrollér originalkilden.');
    input.contents[0].parts.push({ inline_data: { mime_type: 'application/pdf', data: base64AtSize(PDF_LIMIT) } });
    const value = '🧪'.repeat(Math.floor(5 * MiB / 4) + 1);
    if (field === 'prompt') input.contents[0].parts[0].text += value;
    else if (field === 'schema') input.generationConfig.responseSchema.description = value;
    else input.cachedContent = value; // Opaque request metadata, not a media part.
    const serialized = JSON.stringify(input);
    assert.ok(serialized.length < WIRE_LIMIT);
    assert.ok(Buffer.byteLength(serialized, 'utf8') > WIRE_LIMIT);
    assertWireRejected(harness(t), input);
  });
}

test('an explicitly selected queued model cannot bypass the shared wire limit', t => {
  const h = harness(t);
  const model = vm.runInContext('CFG.MODEL_FALLBACKS[1]', h.context);
  assertWireRejected(h, payload('A'.repeat(WIRE_LIMIT)), { model, maxAttempts: 1 });
});

for (const [name, sizes, camelCase] of [
  ['one oversized file', [PDF_LIMIT + 1], false],
  ['a bundle spread across contents', [16 * MiB, 15 * MiB], true]
]) {
  test(`the shared raw PDF cap rejects ${name} before JSON serialization or model fallback`, t => {
    const h = harness(t), input = payload();
    let serializations = 0;
    input.contents = sizes.map(size => ({ parts: [camelCase
      ? { inlineData: { mimeType: 'application/pdf', data: base64AtSize(size) } }
      : { inline_data: { mime_type: 'application/pdf', data: base64AtSize(size) } }
    ] }));
    input.toJSON = function () {
      serializations++;
      return { contents: this.contents, generationConfig: this.generationConfig };
    };
    assertWireRejected(h, input, { reuseSuccessfulModel: true });
    assert.equal(serializations, 0, 'Raw budget rejection should avoid copying a large request into JSON');
  });
}

test('base64 padding cannot falsely reject a bundle exactly at the decoded byte cap', t => {
  const h = harness(t), input = payload('To PDFer med samlet 30 MiB dekodet.');
  // Both parts carry padding; encoded length * 0.75 overcounts by three bytes.
  input.contents[0].parts.push(...[PDF_LIMIT - 512, 512].map(size => ({
    inline_data: { mime_type: 'application/pdf', data: base64AtSize(size) }
  })));
  h.send(input);
  assert.equal(h.requests.length, 1);
  assert.ok(h.requests[0].bytes < WIRE_LIMIT);
});

test('time consumed while serializing cannot cause a late request', t => {
  const h = harness(t), input = payload();
  input.generationConfig.responseSchema = { toJSON() { h.clock += 240000; return { type: 'OBJECT' }; } };
  assert.throws(() => h.send(input));
  assert.equal(h.requests.length, 0);
  assert.deepEqual(h.sleeps, []);
});
