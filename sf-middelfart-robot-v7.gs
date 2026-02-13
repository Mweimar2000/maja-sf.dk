/***********************************************************************
* SF MIDDELFART NYHEDSBREV — v7.2 (FAKTABASERET + AFMELDINGS-BESKYTTELSE)
*
* ÆNDRINGER FRA v7.1:
*   - Opdateret domænereferencer til dagsordener.middelfart.dk
*   - Opdateret Gemini model til stabil version
*   - Forbedret fejlhåndtering ved API-kald
*
* ÆNDRINGER FRA v7.0:
*   - Tilføjet BLOCKED_URL_PATTERNS i CFG (afmeldings-links blokeres)
*   - extractUrls_() filtrerer nu farlige links fra
*   - Fjernet duplikeret mustGet_() funktion
*
* HOVEDÆNDRINGER FRA v6.0:
*   1. Håndterer ZIP-vedhæftninger fra e-mails
*   2. Udpakker og læser PDF'er direkte
*   3. Forbedret web-scraping af dagsordener.middelfart.dk
*   4. Fakta-fokuserede prompts (ingen hallucination)
*   5. Detaljeret logging til fejlfinding
*
* SETUP:
*   1. Opret et nyt Google Apps Script projekt
*   2. Kopier denne kode ind
*   3. Kør setupOnce_createTriggers() én gang
*   4. Udfyld Script Properties (se CFG konstanter)
***********************************************************************/

/* ═══════════════════════════════════════════════════════════════════════
   KONFIGURATION
   ═══════════════════════════════════════════════════════════════════════ */
const CFG = {
  // Script Properties keys
  P_SHEET_ID:        "SPREADSHEET_ID",
  P_SHEET_NAME:      "INBOX_SHEET_NAME",
  P_LABEL:           "INBOX_LABEL",
  P_API_KEY:         "GEMINI_API_KEY",
  P_DRAFT_FOLDER_ID: "DRAFT_FOLDER_ID",
  P_TEMPLATE_DOC_ID: "TEMPLATE_DOC_ID",

  // Model konfiguration
  MODEL_NAME: "gemini-2.0-flash",

  // Behandlingsgrænser
  MAX_THREADS_PER_RUN:    30,
  MAX_URLS_PER_MESSAGE:   5,
  MAX_ATTACHMENT_SIZE_MB:  20,
  PDF_PAGES_TO_READ:      50,

  // URLs der ALDRIG må hentes (afmeldings-links mv.)
  BLOCKED_URL_PATTERNS: [
    "afmeld", "unsubscribe", "optout", "opt-out",
    "frameld", "afbestil", "subscription/remove",
    "mail-afmelding", "nyhedsbrev/afmeld",
    "email-preferences", "manage-preferences",
    "remove-subscriber", "list-unsubscribe"
  ],

  // SF Middelfarts mærkesager (til scoring)
  SF_KEYWORDS: {
    velfaerd: ["velfærd", "normeringer", "minimumsnormeringer", "omsorg",
               "pleje", "ældre", "plejehjem", "hjemmepleje", "sosu"],
    boern:    ["børn", "unge", "trivsel", "skole", "dagtilbud", "børnehave",
               "ppr", "inklusion", "folkeskole", "sfo", "normeringer"],
    klima:    ["klima", "grøn", "miljø", "natur", "biodiversitet", "co2",
               "cykelsti", "kollektiv", "bæredygtig", "energi", "grøn trepart"],
    lighed:   ["lighed", "ulighed", "fællesskab", "fritidspas", "foreningsliv",
               "social", "psykiatri", "handicap"],
  },

  // Administrative emneord der skal ignoreres
  ADMIN_KEYWORDS: [
    "mødeplan", "mødedatoer", "fastsættelse af møde", "tidsplan",
    "godkendelse af dagsorden", "godkendelse af referat",
    "beslutningsprotokol", "orientering om", "meddelelser",
    "siden sidst", "nyt fra formanden", "valg af", "udpegning af",
    "konstituering", "sammensætning", "underskriftsark", "fraværende",
    "bemærkninger til dagsorden", "kompetencefordeling",
    "forretningsorden", "lukkede punkter"
  ]
};

/* ═══════════════════════════════════════════════════════════════════════
   SETUP & TRIGGERS
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Kør denne funktion ÉN gang for at oprette triggers
 */
function setupOnce_createTriggers() {
  // Slet gamle triggers
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));

  // Daglig indsamling kl. 12:00
  ScriptApp.newTrigger("ingestInboxEmails")
    .timeBased()
    .everyDays(1)
    .atHour(12)
    .create();

  // Ugentligt nyhedsbrev søndag kl. 13:00
  ScriptApp.newTrigger("generateWeeklyDraft")
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.SUNDAY)
    .atHour(13)
    .create();

  console.log("✅ v7.2 Presse-Robot er klar!");
  console.log("📧 Daglig indsamling: Hver dag kl. 12:00");
  console.log("📰 Ugentligt nyhedsbrev: Søndag kl. 13:00");
}

/**
 * Test-funktion til at køre manuelt
 */
function testManualRun() {
  console.log("🧪 Starter manuel test...");
  ingestInboxEmails();
  generateWeeklyDraft();
}

/* ═══════════════════════════════════════════════════════════════════════
   DAGLIG INDSAMLING (INGEST)
   ═══════════════════════════════════════════════════════════════════════ */

function ingestInboxEmails() {
  console.log("📥 Starter daglig indsamling...");

  const props   = PropertiesService.getScriptProperties();
  const sheetId = mustGet_(props, CFG.P_SHEET_ID);
  const ss      = SpreadsheetApp.openById(sheetId);

  // Hent ark-navn fra properties, eller brug "Inbox" som default
  const sheetName = props.getProperty(CFG.P_SHEET_NAME) || "Inbox";
  console.log(`🔍 Leder efter ark: "${sheetName}"`);

  const sheet = ss.getSheetByName(sheetName);

  // Fejlhåndtering hvis arket ikke findes
  if (!sheet) {
    const availableSheets = ss.getSheets().map(s => s.getName()).join(", ");
    throw new Error(`❌ Ark '${sheetName}' findes ikke! Tilgængelige ark: ${availableSheets}`);
  }

  const labelName = mustGet_(props, CFG.P_LABEL);
  const label     = GmailApp.getUserLabelByName(labelName);

  if (!label) {
    throw new Error(`❌ Gmail label '${labelName}' findes ikke!`);
  }

  const lastMs   = Number(props.getProperty("LAST_PROCESSED_MS") || 0);
  let   newestMs = lastMs;
  const threads  = label.getThreads(0, CFG.MAX_THREADS_PER_RUN);
  const tz       = Session.getScriptTimeZone();
  const newRows  = [];

  console.log(`📨 Fandt ${threads.length} tråde i ${labelName}`);

  for (const thread of threads) {
    const msgs = thread.getMessages();

    for (const msg of msgs) {
      if (msg.getDate().getTime() <= lastMs) continue;

      const msgData = processMessage_(msg, tz);
      newRows.push(msgData);

      if (msg.getDate().getTime() > newestMs) {
        newestMs = msg.getDate().getTime();
      }
    }
  }

  if (newRows.length > 0) {
    console.log(`✅ Behandler ${newRows.length} nye beskeder`);

    const startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, newRows.length, newRows[0].length).setValues(newRows);

    // Analyser de nye rækker
    analyzeNewRows_(sheet, startRow, newRows.length);

    props.setProperty("LAST_PROCESSED_MS", String(newestMs));
  } else {
    console.log("ℹ️ Ingen nye beskeder at behandle");
  }
}

/**
 * Behandler en enkelt e-mail og returnerer en række til sheet
 */
function processMessage_(msg, tz) {
  const subject    = msg.getSubject();
  const from       = msg.getFrom();
  const plainBody  = safeGetPlainBody_(msg);
  const receivedAt = Utilities.formatDate(msg.getDate(), tz, "yyyy-MM-dd HH:mm");

  // Udtræk URLs fra e-mail body (filtrerer automatisk afmeldings-links fra)
  const urls = extractUrls_(plainBody).slice(0, CFG.MAX_URLS_PER_MESSAGE);

  // Håndter vedhæftninger
  const attachmentData = processAttachments_(msg);

  // Gæt på udvalg og kildetype
  const committee  = guessCommittee_(subject);
  const sourceType = guessSourceType_(from, subject, urls);

  console.log(`  📧 ${subject} (${committee})`);
  if (attachmentData.hasAttachments) {
    console.log(`  📎 ${attachmentData.attachmentCount} vedhæftninger fundet`);
  }

  return [
    receivedAt,                        // A: Modtaget
    sourceType,                        // B: Type (Dagsorden/Referat)
    committee,                         // C: Udvalg
    subject,                           // D: Emne
    from,                              // E: Fra
    msg.getId(),                       // F: Message ID
    urls.join(", "),                   // G: URLs
    (plainBody || "").slice(0, 2000),  // H: Snippet
    attachmentData.summary,            // I: Vedhæftninger info
    "",                                // J: TLDR (udfyldes af AI)
    "",                                // K: SF Analyse
    "",                                // L: Konkrete fakta
    "",                                // M: Beløb/tal
    "",                                // N: Score
    ""                                 // O: Match med SF program
  ];
}

/* ═══════════════════════════════════════════════════════════════════════
   VEDHÆFTNINGS-HÅNDTERING
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Behandler alle vedhæftninger fra en e-mail
 * Returnerer et objekt med info om vedhæftninger
 */
function processAttachments_(msg) {
  const result = {
    hasAttachments: false,
    attachmentCount: 0,
    summary: "",
    extractedContent: "",
    pdfBase64List: []
  };

  try {
    const attachments = msg.getAttachments();
    if (!attachments || attachments.length === 0) {
      return result;
    }

    result.hasAttachments  = true;
    result.attachmentCount = attachments.length;

    const summaryParts = [];

    for (const att of attachments) {
      const name   = att.getName();
      const sizeMB = att.getSize() / (1024 * 1024);

      console.log(`     📄 Vedhæftning: ${name} (${sizeMB.toFixed(1)} MB)`);

      // Check størrelse
      if (sizeMB > CFG.MAX_ATTACHMENT_SIZE_MB) {
        summaryParts.push(`${name} (for stor: ${sizeMB.toFixed(1)} MB)`);
        continue;
      }

      const nameLower = name.toLowerCase();

      if (nameLower.endsWith('.zip')) {
        // Udpak ZIP-fil
        const zipResult = processZipAttachment_(att);
        summaryParts.push(`ZIP: ${name} → ${zipResult.fileCount} filer`);
        result.extractedContent += zipResult.content;
        result.pdfBase64List.push(...zipResult.pdfBase64List);

      } else if (nameLower.endsWith('.pdf')) {
        // Gem PDF til senere analyse
        const base64 = Utilities.base64Encode(att.getBytes());
        result.pdfBase64List.push({ name: name, data: base64 });
        summaryParts.push(`PDF: ${name}`);

      } else if (nameLower.match(/\.(txt|md|html|htm)$/)) {
        // Læs tekstfil direkte
        const text = att.getDataAsString();
        result.extractedContent += `\n\n--- ${name} ---\n${text}`;
        summaryParts.push(`TXT: ${name}`);
      }
    }

    result.summary = summaryParts.join("; ");
  } catch (e) {
    console.log(`  ⚠️ Fejl ved vedhæftninger: ${e.message}`);
    result.summary = `Fejl: ${e.message}`;
  }

  return result;
}

/**
 * Udpakker en ZIP-fil og returnerer indholdet
 */
function processZipAttachment_(zipBlob) {
  const result = { fileCount: 0, content: "", pdfBase64List: [] };

  try {
    const unzipped = Utilities.unzip(zipBlob);
    result.fileCount = unzipped.length;

    for (const file of unzipped) {
      const name      = file.getName();
      const nameLower = name.toLowerCase();

      // Spring system-filer over
      if (name.startsWith('__MACOSX') || name.startsWith('.')) {
        continue;
      }

      console.log(`       📂 Udpakket: ${name}`);

      if (nameLower.endsWith('.pdf')) {
        const base64 = Utilities.base64Encode(file.getBytes());
        result.pdfBase64List.push({ name: name, data: base64 });

      } else if (nameLower.match(/\.(txt|md|html|htm|xml)$/)) {
        try {
          const text = file.getDataAsString();
          result.content += `\n\n--- ${name} ---\n${text.slice(0, 50000)}`;
        } catch (e) {
          // Kan ikke læse som tekst
        }
      }
    }
  } catch (e) {
    console.log(`  ⚠️ Kunne ikke udpakke ZIP: ${e.message}`);
  }

  return result;
}

/* ═══════════════════════════════════════════════════════════════════════
   INDHOLDSINDSAMLING FRA WEB
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Henter indhold fra en URL - forbedret version
 */
function fetchContentFromUrl_(url) {
  if (!url) return { success: false, content: "", isPdf: false };

  // ── AFMELDINGS-BESKYTTELSE ──
  // Tjek om URL'en matcher et blokeret mønster (afmeld, unsubscribe osv.)
  const urlLower = url.toLowerCase();
  if (CFG.BLOCKED_URL_PATTERNS.some(pattern => urlLower.includes(pattern))) {
    console.log(`  🚫 BLOKERET (afmeldings-link): ${url}`);
    return { success: false, content: "", isPdf: false };
  }

  console.log(`  🌐 Henter: ${url}`);

  try {
    const response = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      followRedirects: true,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SF-Middelfart-Bot/7.2)',
        'Accept': 'text/html,application/pdf,*/*'
      }
    });

    const contentType  = response.getHeaders()['Content-Type'] || '';
    const responseCode = response.getResponseCode();

    if (responseCode !== 200) {
      console.log(`   ⚠️ HTTP ${responseCode}`);
      return { success: false, content: "", isPdf: false };
    }

    // Hvis det er en PDF direkte
    if (contentType.includes('application/pdf')) {
      const base64 = Utilities.base64Encode(response.getBlob().getBytes());
      return { success: true, content: "", isPdf: true, pdfBase64: base64 };
    }

    // HTML side
    const html = response.getContentText();

    // Søg efter PDF-links på dagsordener.middelfart.dk
    const pdfUrl = findPdfLinkInHtml_(html, url);
    if (pdfUrl) {
      console.log(`   📄 Fandt PDF-link: ${pdfUrl}`);
      const pdfResult = fetchPdfFromUrl_(pdfUrl);
      if (pdfResult.success) {
        return pdfResult;
      }
    }

    // Udtræk tekst fra HTML
    const textContent = extractTextFromHtml_(html);
    return { success: true, content: textContent, isPdf: false };
  } catch (e) {
    console.log(`  ❌ Fejl ved hentning: ${e.message}`);
    return { success: false, content: "", isPdf: false };
  }
}

/**
 * Finder PDF-links i HTML fra dagsordener.middelfart.dk
 */
function findPdfLinkInHtml_(html, baseUrl) {
  // Prøv forskellige mønstre for at finde PDF-links
  const patterns = [
    /href="([^"]*\.pdf[^"]*)"/gi,
    /href="([^"]*download[^"]*pdf[^"]*)"/gi,
    /href="([^"]*dagsorden[^"]*\.pdf[^"]*)"/gi,
    /data-url="([^"]*\.pdf[^"]*)"/gi
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(html);
    if (match && match[1]) {
      let pdfUrl = match[1];

      // Gør relativ URL absolut
      if (pdfUrl.startsWith('/')) {
        const domain = baseUrl.match(/^(https?:\/\/[^\/]+)/);
        if (domain) {
          pdfUrl = domain[1] + pdfUrl;
        }
      } else if (!pdfUrl.startsWith('http')) {
        // Relativ URL uden /
        const basePath = baseUrl.substring(0, baseUrl.lastIndexOf('/') + 1);
        pdfUrl = basePath + pdfUrl;
      }

      return pdfUrl;
    }
  }

  return null;
}

/**
 * Henter en PDF fra en URL
 */
function fetchPdfFromUrl_(url) {
  try {
    const response = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      followRedirects: true
    });

    if (response.getResponseCode() === 200) {
      const blob = response.getBlob();
      if (blob.getContentType() === 'application/pdf' || url.toLowerCase().includes('.pdf')) {
        const base64 = Utilities.base64Encode(blob.getBytes());
        return { success: true, content: "", isPdf: true, pdfBase64: base64 };
      }
    }
  } catch (e) {
    console.log(`  ⚠️ Kunne ikke hente PDF: ${e.message}`);
  }

  return { success: false, content: "", isPdf: false };
}

/**
 * Udtrækker tekst fra HTML
 */
function extractTextFromHtml_(html) {
  // Fjern script og style tags
  let text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '');

  // Erstat block-elementer med linjeskift
  text = text
    .replace(/<\/?(p|div|br|h[1-6]|li|tr)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#\d+;/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\n\s*\n/g, '\n')
    .trim();

  return text.slice(0, 100000); // Max 100k tegn
}

/* ═══════════════════════════════════════════════════════════════════════
   AI ANALYSE MED GEMINI
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Analyserer nye rækker med Gemini
 */
function analyzeNewRows_(sheet, startRow, numRows) {
  console.log(`\n🤖 Analyserer ${numRows} rækker med AI...`);

  const props  = PropertiesService.getScriptProperties();
  const apiKey = mustGet_(props, CFG.P_API_KEY);
  const values = sheet.getRange(startRow, 1, numRows, 15).getValues();
  const updates = [];

  for (let i = 0; i < values.length; i++) {
    const row            = values[i];
    const subject        = row[3];  // D: Emne
    const urls           = (row[6] || "").split(",").map(s => s.trim()).filter(Boolean);
    const snippet        = row[7];  // H: Snippet
    const attachmentInfo = row[8];  // I: Vedhæftninger

    console.log(`\n📋 Analyserer: ${subject}`);

    // TRIN 1: Check om det er administrativt
    if (isAdministrativeSubject_(subject)) {
      console.log(`   ⏭️ Sprunget over (administrativt)`);
      updates.push([
        "Administrativt punkt (ingen politisk behandling)",
        "Drift/formalia",
        "",
        "",
        1,
        ""
      ]);
      continue;
    }

    // TRIN 2: Hent indhold
    let contentForAnalysis = snippet;
    let pdfBase64 = null;

    // Prøv først URL'en
    if (urls.length > 0) {
      const urlContent = fetchContentFromUrl_(urls[0]);
      if (urlContent.success) {
        if (urlContent.isPdf) {
          pdfBase64 = urlContent.pdfBase64;
        } else {
          contentForAnalysis = urlContent.content || contentForAnalysis;
        }
      }
    }

    // TRIN 3: Kald Gemini
    const analysis = analyzeWithGemini_(apiKey, {
      subject: subject,
      committee: row[2],
      content: contentForAnalysis,
      pdfBase64: pdfBase64
    });

    updates.push([
      analysis.tldr         || "Kunne ikke analyseres",
      analysis.sfAnalysis   || "",
      analysis.facts        || "",
      analysis.amounts      || "",
      analysis.score        || 3,
      analysis.programMatch || ""
    ]);

    // Lille pause for at undgå rate limiting
    Utilities.sleep(500);
  }

  // Opdater sheet med analyseresultater
  sheet.getRange(startRow, 10, updates.length, 6).setValues(updates);
  console.log(`\n✅ Analyse færdig!`);
}

/**
 * Analyserer indhold med Gemini API
 */
function analyzeWithGemini_(apiKey, data) {
  const prompt = buildAnalysisPrompt_(data);

  try {
    let response;

    if (data.pdfBase64) {
      // Send PDF til Gemini
      response = callGeminiWithPdf_(apiKey, prompt, data.pdfBase64);
    } else {
      // Send tekst til Gemini
      response = callGeminiJson_(apiKey, prompt);
    }

    const parsed = parseJsonSafe_(response);
    if (parsed) {
      return parsed;
    }
  } catch (e) {
    console.log(`  ❌ Gemini fejl: ${e.message}`);
  }

  return { tldr: "Analyse fejlede", score: 1 };
}

/**
 * Bygger prompt til fakta-baseret analyse
 */
function buildAnalysisPrompt_(data) {
  return `
Du er politisk analytiker for SF Middelfart. Din opgave er at uddrage FAKTA fra kommunale dokumenter.

VIGTIGT: Du må KUN skrive om ting der FAKTISK står i dokumentet!
* INGEN gætteri eller antagelser
* INGEN politiske holdninger medmindre de fremgår af dokumentet
* Hvis du ikke kan finde informationen, skriv "Ikke angivet"

DOKUMENT:
Udvalg: ${data.committee}
Emne: ${data.subject}
${data.pdfBase64 ? "(PDF vedhæftet)" : "Indhold: " + (data.content || "").slice(0, 30000)}

OPGAVE: Analyser dokumentet og returner JSON i dette format:
{
  "tldr": "Kort, faktuel beskrivelse af hvad sagen handler om (max 100 ord)",
  "sfAnalysis": "Hvordan relaterer dette til SF's mærkesager? (velfærd, børn/unge, klima, lighed)",
  "facts": "Liste over KONKRETE fakta fra dokumentet (beslutninger, datoer, steder)",
  "amounts": "Alle beløb/tal nævnt i dokumentet (f.eks. '46 mio. kr. til renovering')",
  "score": <tal fra 1-5>,
  "programMatch": "Hvilke SF-mærkesager matcher dette? (velfærd/børn/klima/lighed)"
}

SCORING:
1 = Rent administrativt (mødeplan, konstituering)
2 = Driftsmæssigt (mindre justeringer, orientering)
3 = Relevant (påvirker borgere, men ikke SF-kerneområde)
4 = Vigtigt (SF-relevant: velfærd, børn, klima, lighed)
5 = Topprioritet (stor politisk sag med SF-vinkel)

Returner KUN valid JSON, ingen anden tekst.
`.trim();
}

/**
 * Kalder Gemini API med tekst (med retry ved fejl)
 */
function callGeminiJson_(apiKey, prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${CFG.MODEL_NAME}:generateContent`;

  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.2
    }
  };

  const options = {
    method: "post",
    contentType: "application/json",
    headers: { "x-goog-api-key": apiKey },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  // Retry op til 2 gange ved midlertidige fejl
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = UrlFetchApp.fetch(url, options);
    const code = response.getResponseCode();

    if (code === 429 || code >= 500) {
      console.log(`  ⚠️ API fejl ${code}, forsøg ${attempt + 1}/3...`);
      if (attempt < 2) { Utilities.sleep(2000 * (attempt + 1)); continue; }
      throw new Error(`API fejl ${code} efter 3 forsøg`);
    }

    const json = JSON.parse(response.getContentText());

    if (json.candidates && json.candidates[0]?.content?.parts?.[0]?.text) {
      return json.candidates[0].content.parts[0].text;
    }

    throw new Error(`Uventet API-svar (HTTP ${code})`);
  }
}

/**
 * Kalder Gemini API med PDF (med retry ved fejl)
 */
function callGeminiWithPdf_(apiKey, prompt, pdfBase64) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${CFG.MODEL_NAME}:generateContent`;

  const payload = {
    contents: [{
      parts: [
        { text: prompt },
        { inline_data: { mime_type: "application/pdf", data: pdfBase64 } }
      ]
    }],
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.2
    }
  };

  const options = {
    method: "post",
    contentType: "application/json",
    headers: { "x-goog-api-key": apiKey },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  // Retry op til 2 gange ved midlertidige fejl
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = UrlFetchApp.fetch(url, options);
    const code = response.getResponseCode();

    if (code === 429 || code >= 500) {
      console.log(`  ⚠️ PDF API fejl ${code}, forsøg ${attempt + 1}/3...`);
      if (attempt < 2) { Utilities.sleep(2000 * (attempt + 1)); continue; }
      throw new Error(`PDF API fejl ${code} efter 3 forsøg`);
    }

    const json = JSON.parse(response.getContentText());

    if (json.candidates && json.candidates[0]?.content?.parts?.[0]?.text) {
      return json.candidates[0].content.parts[0].text;
    }

    throw new Error(`Uventet API-svar fra PDF-analyse (HTTP ${code})`);
  }
}

/* ═══════════════════════════════════════════════════════════════════════
   UGENTLIGT NYHEDSBREV
   ═══════════════════════════════════════════════════════════════════════ */

function generateWeeklyDraft() {
  console.log("\n📰 Genererer ugentligt nyhedsbrev...\n");

  const props  = PropertiesService.getScriptProperties();
  const ss     = SpreadsheetApp.openById(mustGet_(props, CFG.P_SHEET_ID));
  const sheet  = ss.getSheetByName(props.getProperty(CFG.P_SHEET_NAME) || "Inbox");
  const apiKey = mustGet_(props, CFG.P_API_KEY);

  // Hent alle data
  const all = sheet.getDataRange().getValues();
  if (all.length < 2) {
    console.log("ℹ️ Ingen data at behandle");
    return;
  }

  // Find sager fra de sidste 7 dage
  const now     = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const weekItems = all.slice(1)
    .map(row => ({
      date:         parseDate_(row[0]),
      type:         row[1],
      committee:    row[2],
      subject:      row[3],
      tldr:         row[9],
      sfAnalysis:   row[10],
      facts:        row[11],
      amounts:      row[12],
      score:        Number(row[13]) || 1,
      programMatch: row[14]
    }))
    .filter(item => item.date && item.date >= weekAgo && item.date <= now);

  if (weekItems.length === 0) {
    console.log("ℹ️ Ingen sager fra denne uge");
    return;
  }

  console.log(`📋 Fandt ${weekItems.length} sager fra denne uge`);

  // Sorter efter score
  weekItems.sort((a, b) => b.score - a.score);

  // Del op i kategorier
  const topStories    = weekItems.filter(i => i.score >= 4);
  const mediumStories = weekItems.filter(i => i.score === 3);
  const adminItems    = weekItems.filter(i => i.score <= 2);

  console.log(`  🔥 Top-sager: ${topStories.length}`);
  console.log(`  📌 Mellem-sager: ${mediumStories.length}`);
  console.log(`  📁 Administrative: ${adminItems.length}`);

  // Generer nyhedsbrev
  const dateRange = formatDateRange_(weekAgo, now);
  const draftText = generateNewsletterWithGemini_(apiKey, {
    dateRange,
    topStories,
    mediumStories,
    adminItems
  });

  // Opret dokument
  const folderId = mustGet_(props, CFG.P_DRAFT_FOLDER_ID);
  const docUrl   = createDraftDocument_(folderId, draftText, dateRange);

  // Send notifikation
  GmailApp.sendEmail(
    Session.getEffectiveUser().getEmail(),
    `📰 SF Nyhedsbrev kladde klar (${dateRange})`,
    `Hej Maja!\n\nDit ugentlige nyhedsbrev er klar til gennemsyn.\n\n`
    + `Link: ${docUrl}\n\n`
    + `Statistik:\n`
    + `- Top-sager (score 4-5): ${topStories.length}\n`
    + `- Mellem-sager (score 3): ${mediumStories.length}\n`
    + `- Administrative (score 1-2): ${adminItems.length}\n\n`
    + `Husk at gennemse og tilføje din personlige SF-vinkel!\n\n`
    + `/Din SF Presse-Robot v7.2 🤖`
  );

  console.log(`\n✅ Nyhedsbrev oprettet: ${docUrl}`);
}

/**
 * Genererer nyhedsbrev-tekst med Gemini
 */
function generateNewsletterWithGemini_(apiKey, data) {
  const prompt = `
Du skriver et ugentligt nyhedsbrev for SF Middelfart til borgerne i kommunen.
Dato: ${data.dateRange}

SF MIDDELFARTS MÆRKESAGER:
1. Velfærd: Kortere ventetid til psykolog, bedre ældrepleje, tid til omsorg
2. Børn & Unge: Tidlig indsats, flere hænder i institutioner, mindre præstationspres
3. Klima: Grøn transport, cykelstier, naturbeskyttelse, klimaneutral kommune
4. Lighed: Plads til alle, fritidspas, bekæmpelse af ulighed

VIGTIGE REGLER:
* Skriv KUN om ting der fremgår af data nedenfor
* INGEN opdigtede citater eller holdninger
* Brug KONKRETE tal og fakta fra data
* Vær ærlig hvis der ikke er meget at skrive om

DATA:
TOP-SAGER (score 4-5):
${JSON.stringify(data.topStories, null, 2)}

MELLEM-SAGER (score 3):
${JSON.stringify(data.mediumStories, null, 2)}

ADMINISTRATIVE SAGER (score 1-2):
${JSON.stringify(data.adminItems, null, 2)}

STRUKTUR:
1. Overskrift og kort velkomst (2-3 sætninger)
2. UGENS VIGTIGSTE - Kun hvis der er top-sager med konkret indhold
3. SF'S FOKUS - Kort om hvad SF vil holde øje med (baseret på data!)
4. KORT NYT - Punktliste med mellem-sager
5. KALENDER - Kommende møder hvis nævnt i data
6. Afslutning

Hvis der ikke er konkrete sager at skrive om, så vær ærlig og skriv:
"Denne uge har primært budt på administrative sager. Vi følger op når der er nyt."

Skriv nyhedsbrevet på dansk:
`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${CFG.MODEL_NAME}:generateContent`;

    const payload = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.4,
        maxOutputTokens: 4000
      }
    };

    const response = UrlFetchApp.fetch(url, {
      method: "post",
      contentType: "application/json",
      headers: { "x-goog-api-key": apiKey },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    const json = JSON.parse(response.getContentText());

    if (json.candidates && json.candidates[0]?.content?.parts?.[0]?.text) {
      return json.candidates[0].content.parts[0].text;
    }
  } catch (e) {
    console.log(`❌ Fejl ved nyhedsbrev-generering: ${e.message}`);
  }

  return "Fejl ved generering af nyhedsbrev. Tjek loggen for detaljer.";
}

/**
 * Opretter Google Doc med nyhedsbrevet
 */
function createDraftDocument_(folderId, content, dateRange) {
  const doc  = DocumentApp.create(`SF Middelfart Nyhedsbrev (${dateRange})`);
  const body = doc.getBody();

  // Tilføj indhold
  body.setText(content);

  // Flyt til mappe
  const file   = DriveApp.getFileById(doc.getId());
  const folder = DriveApp.getFolderById(folderId);
  folder.addFile(file);
  DriveApp.getRootFolder().removeFile(file);

  return doc.getUrl();
}

/* ═══════════════════════════════════════════════════════════════════════
   HJÆLPEFUNKTIONER
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Checker om et emne er administrativt
 */
function isAdministrativeSubject_(subject) {
  const s = (subject || "").toLowerCase();
  return CFG.ADMIN_KEYWORDS.some(keyword => s.includes(keyword));
}

/**
 * Gætter udvalg fra emne
 */
function guessCommittee_(subject) {
  const s = (subject || "").toLowerCase();

  if (s.includes("byråd"))                                      return "Byrådet";
  if (s.includes("økonomi"))                                     return "Økonomiudvalget";
  if (s.includes("børn") || s.includes("kultur") || s.includes("fritid"))
                                                                  return "Børn- Kultur og Fritidsudvalget";
  if (s.includes("skole"))                                       return "Skoleudvalget";
  if (s.includes("social") || s.includes("sundhed"))             return "Social- og Sundhedsudvalget";
  if (s.includes("klima") || s.includes("natur") || s.includes("genbrug"))
                                                                  return "Klima- Natur og Genbrugsudvalget";
  if (s.includes("teknisk"))                                     return "Teknisk Udvalg";
  if (s.includes("beskæftigelse") || s.includes("arbejdsmarked"))
                                                                  return "Beskæftigelses- og Arbejdsmarkedsudvalget";
  if (s.includes("fritidsråd"))                                  return "Fritidsrådet";

  return "Andet";
}

/**
 * Gætter kildetype
 */
function guessSourceType_(from, subject, urls) {
  const text = (subject + " " + urls.join(" ")).toLowerCase();

  if (text.includes("referat") || text.includes("protokol") || text.includes("beslutning")) {
    return "Referat";
  }
  return "Dagsorden";
}

/**
 * Udtrækker URLs fra tekst — filtrerer afmeldings-links fra
 */
function extractUrls_(text) {
  if (!text) return [];
  const matches = text.match(/https?:\/\/[^\s<>()"]+/g) || [];
  return matches
    .map(url => url.replace(/[),.;!?]+$/, ''))
    .filter(url => {
      const lower = url.toLowerCase();
      return !CFG.BLOCKED_URL_PATTERNS.some(pattern => lower.includes(pattern));
    });
}

/**
 * Sikker hentning af plain body
 */
function safeGetPlainBody_(msg) {
  try {
    return msg.getPlainBody() || "";
  } catch (e) {
    return "";
  }
}

/**
 * Parser dato fra forskellige formater
 */
function parseDate_(value) {
  if (!value) return null;
  if (value instanceof Date) return value;

  const str   = String(value);
  const parts = str.split(/[- :]/);

  if (parts.length >= 3) {
    return new Date(parts[0], parts[1] - 1, parts[2], parts[3] || 0, parts[4] || 0);
  }

  return null;
}

/**
 * Formaterer dato-interval
 */
function formatDateRange_(from, to) {
  const months = ["jan", "feb", "mar", "apr", "maj", "jun",
                  "jul", "aug", "sep", "okt", "nov", "dec"];
  return `${from.getDate()}. ${months[from.getMonth()]} – ${to.getDate()}. ${months[to.getMonth()]} ${to.getFullYear()}`;
}

/**
 * Sikker JSON parsing
 */
function parseJsonSafe_(text) {
  try {
    // Prøv direkte parsing først
    return JSON.parse(text);
  } catch (e) {
    // Prøv at finde JSON i teksten
    const start = text.indexOf('{');
    const end   = text.lastIndexOf('}');

    if (start !== -1 && end !== -1) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch (e2) {
        // Ignorér
      }
    }

    return null;
  }
}

/**
 * Henter påkrævet property
 */
function mustGet_(props, key) {
  const value = props.getProperty(key);
  if (!value) {
    throw new Error(`Mangler Script Property: ${key}`);
  }
  return value;
}

/* ═══════════════════════════════════════════════════════════════════════
   DEBUG FUNKTIONER
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Test funktion til at checke vedhæftninger
 */
function debugCheckAttachments() {
  const props     = PropertiesService.getScriptProperties();
  const labelName = props.getProperty(CFG.P_LABEL) || "MFK/INBOX";
  const label     = GmailApp.getUserLabelByName(labelName);

  if (!label) {
    console.log(`Label '${labelName}' findes ikke`);
    return;
  }

  const threads = label.getThreads(0, 5);

  for (const thread of threads) {
    const msg = thread.getMessages()[0];
    console.log(`\n📧 ${msg.getSubject()}`);

    const attachments = msg.getAttachments();
    console.log(`   Vedhæftninger: ${attachments.length}`);

    for (const att of attachments) {
      console.log(`   - ${att.getName()} (${(att.getSize()/1024/1024).toFixed(2)} MB)`);
    }
  }
}

/**
 * Test funktion til at checke Gemini API
 */
function debugTestGemini() {
  const props  = PropertiesService.getScriptProperties();
  const apiKey = props.getProperty(CFG.P_API_KEY);

  if (!apiKey) {
    console.log("❌ Ingen API nøgle fundet i Script Properties");
    return;
  }

  const testPrompt = 'Returner JSON: {"test": "ok", "tal": 42}';

  try {
    const result = callGeminiJson_(apiKey, testPrompt);
    console.log("✅ Gemini virker!");
    console.log("Svar:", result);
  } catch (e) {
    console.log(`❌ Gemini fejl: ${e.message}`);
  }
}

/**
 * Test funktion til at hente indhold fra URL
 */
function debugTestUrlFetch() {
  const testUrl = "https://dagsordener.middelfart.dk/";
  const result  = fetchContentFromUrl_(testUrl);

  console.log("Success:", result.success);
  console.log("Er PDF:", result.isPdf);
  console.log("Indhold (første 500 tegn):", (result.content || "").slice(0, 500));
}

/**
 * Test funktion til at checke Sheet
 */
function debugCheckSheet() {
  const props   = PropertiesService.getScriptProperties();
  const sheetId = props.getProperty("SPREADSHEET_ID");

  console.log("SPREADSHEET_ID:", sheetId);

  if (!sheetId) {
    console.log("❌ SPREADSHEET_ID er ikke sat!");
    return;
  }

  try {
    const ss = SpreadsheetApp.openById(sheetId);
    console.log("✅ Spreadsheet fundet:", ss.getName());

    const sheets = ss.getSheets();
    console.log("📋 Ark i spreadsheet:");
    sheets.forEach(s => console.log("   -", `"${s.getName()}"`));

    const inbox = ss.getSheetByName("Inbox");
    if (inbox) {
      console.log("✅ 'Inbox' ark fundet!");
    } else {
      console.log("❌ 'Inbox' ark IKKE fundet!");
    }
  } catch (e) {
    console.log("❌ Fejl:", e.message);
  }
}
