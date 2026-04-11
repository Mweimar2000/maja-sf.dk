/***********************************************************************
* SF MIDDELFART NYHEDSBREV — v8.0 (FIRSTAGENDA API + FAKTABASERET)
*
* ÆNDRINGER FRA v7.2:
*   - STOR ÆNDRING: Henter nu dagsordenspunkter direkte via FirstAgenda API
*     i stedet for at forsøge at scrape JavaScript-renderet HTML
*   - Ny funktion: ingestFromFirstAgendaApi() henter alle udvalg og møder
*   - Dagsordenspunkter med fuld tekst (beslutning, indstilling, sagsbeskrivelse)
*   - Automatisk authentication mod dagsordener.middelfart.dk
*   - Bevarer email-baseret indsamling som supplement
*
* ÆNDRINGER FRA v7.1:
*   - Opdateret domænereferencer til dagsordener.middelfart.dk
*   - Opdateret Gemini model til stabil version
*   - Forbedret fejlhåndtering ved API-kald
*
* ÆNDRINGER FRA v7.0:
*   - Tilføjet BLOCKED_URL_PATTERNS i CFG (afmeldings-links blokeres)
*   - extractUrls_() filtrerer nu farlige links fra
*
* HOVEDÆNDRINGER FRA v6.0:
*   1. Håndterer ZIP-vedhæftninger fra e-mails
*   2. Udpakker og læser PDF'er direkte
*   3. Henter data via FirstAgenda API (dagsordener.middelfart.dk)
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

  // FirstAgenda API konfiguration
  FA_BASE_URL:  "https://dagsordener.middelfart.dk",
  FA_AUTH_PATH: "/Home/AnonymousAuthentication?callback=https%3a%2f%2fdagsordener.middelfart.dk%2f",
  FA_API_COMMITTEES: "/api/agenda/udvalgsliste",
  FA_API_AGENDA:     "/api/agenda/dagsorden/",  // + meetingId
  FA_DAYS_BACK:      7,  // Hent møder fra de sidste N dage

  // Model konfiguration
  MODEL_NAME: "gemini-3-flash-preview",

  // Live-hentet stilguide. Robotten forsøger at hente denne URL hver gang
  // den genererer et nyhedsbrev, så Pia kun behøver at redigere stilguide.md
  // og pushe til GitHub — så bruger robotten den nye tone næste gang.
  // Hvis fetch fejler, falder robotten tilbage til
  // SF_TONE_GUIDE_FALLBACK-konstanten som er embedded nedenfor.
  STILGUIDE_RAW_URL: "https://raw.githubusercontent.com/Mweimar2000/maja-sf.dk/main/stilguide.md",

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

  // Administrative emneord der KUN skal springes over (kun rene formalia)
  ADMIN_KEYWORDS: [
    "mødeplan", "mødedatoer", "fastsættelse af møde",
    "godkendelse af dagsorden", "godkendelse af referat",
    "beslutningsprotokol", "underskriftsark", "fraværende",
    "bemærkninger til dagsorden", "kompetencefordeling",
    "forretningsorden", "lukkede punkter", "konstituering"
  ]
};

/**
 * SF Nyhedsbrevs-tone — FALLBACK.
 *
 * Robotten forsøger først at hente den LEVENDE stilguide direkte fra
 * GitHub via loadToneGuide_() (se CFG.STILGUIDE_RAW_URL). Denne konstant
 * bruges KUN hvis fetchet fejler (netværk nede, GitHub nede, URL ændret).
 *
 * Du kan derfor redigere stilguide.md i repo-roden og pushe — robotten
 * læser den nye version næste gang den kører. Du behøver ikke længere
 * holde denne konstant i sync; den er en nødudgang.
 */
const SF_TONE_GUIDE_FALLBACK = `
SF NYHEDSBREVS-TONE — STILGUIDE

OVERORDNET STEMME:
Personlig, varm og nærværende — som en samtale mellem venner der deler
politiske værdier. Aldrig bureaukratisk eller distanceret.

NØGLETRÆK:

1. PERSONLIG TILTALE OG 1. PERSON:
   Altid "Kære [fornavn]". Afsenderen er Pia, som skriver i jeg-form og
   deler sine egne tanker og følelser. Fx "Jeg tænker ofte på...",
   "For mig handler det om...", "Jeg er stadig helt høj."

2. EMOTIONELT OG KROPSLIGT SPROG:
   Følelser nævnes direkte — stolthed, vrede, glæde, frustration.
   Fysiske metaforer bruges: "nive mig selv i armen", "et åbent sår",
   "slider på de ældre". Teksten FØLER noget, den informerer ikke bare.

3. HVERDAGSDANSK MED PUNCH:
   Uformel og talesprogsnær. Korte, punchede sætninger.
   Fragmenter som stilmiddel: "Hold. Nu. Op." / "Bare sådan – som en
   tyv om natten." Udråbstegn og emojis (❤️💚🎉💪) i emnelinjer og
   nøglemomenter.

4. RETORISKE SPØRGSMÅL OG DIREKTE HENVENDELSE:
   "Kan du huske, da...?", "Prøv lige at smage på det",
   "For hvad er det egentlig, der bliver sagt?" Læseren inviteres ind
   i en tankerække, ikke bare serveret en konklusion.

5. VÆRDIER FØR POLICY:
   Start ALTID med det menneskelige og følelsesmæssige — en personlig
   refleksion, en historie, en observation — og DEREFTER det konkrete
   politiske forslag. Policy er midlet, mennesket er målet.

6. FÆLLESSKABS-RETORIK:
   "Vi" og "os" er bærende. "Det er jeres fortjeneste", "vi står sammen",
   "fællesskabet bliver stærkere, jo flere der er med." Modtageren
   gøres til medspiller, ikke passiv tilhører.

7. KLAR MODSTANDER-MARKERING UDEN PERSONANGREB:
   Kritik rettes mod politikker og systemer, ikke mennesker. "Skæve
   skattelettelser til de rigeste", "tillidsbrud", "hovsa-agtigt og
   uigennemtænkt" — hårdt i sagen, aldrig grimt mod personer.

8. AFSLUTNING MED VARME OG RETNING:
   Slut ALTID med et fremadrettet budskab og den personlige hilsen
   "De bedste hilsner, Pia", efterfulgt af en konkret CTA (link til
   udspil, medlemskab, deling).

SÆTNINGSSTRUKTUR:
- Korte afsnit (1-3 sætninger per afsnit)
- Hyppige linjeskift for læsevenlighed
- Bland meget korte fragmenter med lidt længere forklarende afsnit
- Emnelinjer er dramatiske, nysgerrighedsvækkende eller følelsesladede,
  ofte med emojis

UNDGÅ FOR ENHVER PRIS:
- Fagsprog, teknisk eller bureaukratisk sprog
- Passiv form ("det blev besluttet" → skriv hellere "de tog fridagen fra os")
- Neutral, objektiv nyhedsformidling — SF's nyhedsbreve er PARTISKE MED VILJE
- Lange opremsninger uden emotionel indramning
- Formuleringer som "Velkommen", "I denne uge har der været stor aktivitet",
  "Venlig hilsen, SF Middelfart" — det er den GAMLE bureaukratiske tone
`;

/**
 * Henter den LEVENDE stilguide fra GitHub (CFG.STILGUIDE_RAW_URL).
 * Falder tilbage til SF_TONE_GUIDE_FALLBACK hvis fetchet fejler.
 *
 * Resultatet caches i 1 time i Script Cache, så vi ikke rammer GitHub
 * flere gange per run (og så nyhedsbrev-generering bliver hurtigere
 * hvis noget kalder den gentagne gange).
 */
function loadToneGuide_() {
  const CACHE_KEY = "sf_tone_guide_v1";
  const cache = CacheService.getScriptCache();

  const cached = cache.get(CACHE_KEY);
  if (cached) {
    console.log("   📖 Bruger cached stilguide");
    return cached;
  }

  try {
    const response = UrlFetchApp.fetch(CFG.STILGUIDE_RAW_URL, {
      muteHttpExceptions: true,
      followRedirects: true,
      headers: {
        'User-Agent': 'SF-Middelfart-Bot/8.0',
        'Accept': 'text/plain, text/markdown, */*'
      }
    });

    if (response.getResponseCode() === 200) {
      const text = response.getContentText();
      if (text && text.length > 200) {  // sanity check: en rigtig stilguide er lang
        cache.put(CACHE_KEY, text, 3600);  // cache i 1 time
        console.log(`   📖 Stilguide hentet live fra GitHub (${text.length} tegn)`);
        return text;
      }
      console.log(`   ⚠️ Stilguide fra GitHub er mistænkeligt kort (${text.length} tegn) — bruger fallback`);
    } else {
      console.log(`   ⚠️ Kunne ikke hente stilguide: HTTP ${response.getResponseCode()} — bruger fallback`);
    }
  } catch (e) {
    console.log(`   ⚠️ Fejl ved hentning af stilguide: ${e.message} — bruger fallback`);
  }

  return SF_TONE_GUIDE_FALLBACK;
}

/* ═══════════════════════════════════════════════════════════════════════
   SETUP & TRIGGERS
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Kør denne funktion ÉN gang for at oprette triggers
 */
function setupOnce_createTriggers() {
  // Slet gamle triggers
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));

  // Daglig indsamling kl. 12:00 (primær: FirstAgenda API)
  ScriptApp.newTrigger("dailyIngest")
    .timeBased()
    .everyDays(1)
    .atHour(12)
    .create();

  // Ugentligt nyhedsbrev lørdag kl. 13:00
  ScriptApp.newTrigger("generateWeeklyDraft")
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.SATURDAY)
    .atHour(13)
    .create();

  console.log("✅ v8.0 Presse-Robot er klar!");
  console.log("📡 Daglig indsamling: Hver dag kl. 12:00 (FirstAgenda API + email)");
  console.log("📰 Ugentligt nyhedsbrev: Lørdag kl. 13:00");
}

/**
 * Kombineret daglig indsamling: Først API, derefter emails
 */
function dailyIngest() {
  console.log("🔄 Starter daglig indsamling...\n");

  // Primær kilde: FirstAgenda API (det faktiske indhold)
  try {
    ingestFromFirstAgendaApi();
  } catch (e) {
    console.log(`❌ FirstAgenda fejl: ${e.message}`);
    console.log("   Fortsætter med email-indsamling...\n");
  }

  // Supplerende kilde: Gmail (notifikationer)
  try {
    ingestInboxEmails();
  } catch (e) {
    console.log(`❌ Email-fejl: ${e.message}`);
  }

  console.log("\n✅ Daglig indsamling afsluttet");
}

/**
 * Test-funktion til at køre manuelt
 */
function testManualRun() {
  console.log("🧪 Starter manuel test...");
  ingestFromFirstAgendaApi();
  ingestInboxEmails();
  generateWeeklyDraft();
}

/**
 * RE-ANALYSERER eksisterende rækker med den nye scoring-prompt.
 * Gemmer progress, så den kan genoptages ved timeout (6 min grænse i GAS).
 * Kør denne FLERE gange indtil den siger "Alle rækker er færdige".
 */
function reanalyzeAllRows() {
  const MAX_RUNTIME_MS = 5 * 60 * 1000;  // Stop efter 5 min (sikkerhedsmargin)
  const startTime = Date.now();

  const props   = PropertiesService.getScriptProperties();
  const apiKey  = mustGet_(props, CFG.P_API_KEY);
  const ss      = SpreadsheetApp.openById(mustGet_(props, CFG.P_SHEET_ID));
  const sheet   = ss.getSheetByName(props.getProperty(CFG.P_SHEET_NAME) || "Inbox");
  const all     = sheet.getDataRange().getValues();

  if (all.length < 2) {
    console.log("ℹ️ Ingen data at re-analysere");
    return;
  }

  // Genoptag fra sidst (0-indexed row i data-array, 1 = første datarække)
  const startFrom = Number(props.getProperty("REANALYZE_PROGRESS") || 1);
  const total     = all.length - 1;

  console.log(`🔄 Re-analyserer rækker ${startFrom}–${total} med ny scoring-prompt...\n`);

  if (startFrom > total) {
    console.log("✅ Alle rækker er allerede færdige! Nulstiller progress.");
    props.deleteProperty("REANALYZE_PROGRESS");
    return;
  }

  let reanalyzed = 0;
  let lastProcessed = startFrom;

  for (let i = startFrom; i < all.length; i++) {
    // Tjek om vi nærmer os timeout
    if (Date.now() - startTime > MAX_RUNTIME_MS) {
      console.log(`\n⏱️ Timeout nærmer sig — gemmer progress ved række ${i}`);
      props.setProperty("REANALYZE_PROGRESS", String(i));
      console.log(`   Kør reanalyzeAllRows() igen for at fortsætte (${i - 1}/${total} færdige)`);
      return;
    }

    const row     = all[i];
    const subject = row[3];  // D: Emne
    const snippet = row[7];  // H: Snippet

    // Spring rene formalia over
    if (isAdministrativeSubject_(subject)) {
      sheet.getRange(i + 1, 10, 1, 6).setValues([["Formalia/procedurepunkt", "", "", "", 1, ""]]);
      lastProcessed = i + 1;
      continue;
    }

    console.log(`📋 [${i}/${total}] ${subject}`);

    try {
      const analysis = analyzeWithGemini_(apiKey, {
        subject: subject,
        committee: row[2],
        content: snippet,
        pdfBase64: null
      });

      sheet.getRange(i + 1, 10, 1, 6).setValues([[
        analysis.tldr         || "Kunne ikke analyseres",
        analysis.sfAnalysis   || "",
        analysis.facts        || "",
        analysis.amounts      || "",
        analysis.score        || 3,
        analysis.programMatch || ""
      ]]);

      reanalyzed++;
      Utilities.sleep(500);  // Rate limiting
    } catch (e) {
      console.log(`   ❌ Fejl: ${e.message}`);
    }

    lastProcessed = i + 1;
  }

  // Alle rækker er færdige
  props.deleteProperty("REANALYZE_PROGRESS");
  console.log(`\n✅ Re-analyse FÆRDIG! ${reanalyzed} rækker opdateret (${total} total).`);
  console.log("   Du kan nu køre generateWeeklyDraft() for at lave et nyt nyhedsbrev.");
}

/* ═══════════════════════════════════════════════════════════════════════
   FIRSTAGENDA API — DIREKTE INDSAMLING FRA dagsordener.middelfart.dk
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Henter dagsordenspunkter direkte fra FirstAgenda API'en.
 * Dette er den PRIMÆRE datakilde — langt bedre end email-scraping.
 */
function ingestFromFirstAgendaApi() {
  console.log("📡 Starter indsamling fra FirstAgenda API...\n");

  const props   = PropertiesService.getScriptProperties();
  const sheetId = mustGet_(props, CFG.P_SHEET_ID);
  const ss      = SpreadsheetApp.openById(sheetId);
  const sheetName = props.getProperty(CFG.P_SHEET_NAME) || "Inbox";
  const sheet   = ss.getSheetByName(sheetName);

  if (!sheet) {
    throw new Error(`❌ Ark '${sheetName}' findes ikke!`);
  }

  // TRIN 1: Autenticer mod FirstAgenda (anonym auth)
  const cookies = authenticateFirstAgenda_();

  // TRIN 2: Hent udvalgsliste med møder
  const committees = fetchCommitteeList_(cookies);

  // TRIN 3: Find møder fra de sidste N dage
  const cutoff   = new Date(Date.now() - CFG.FA_DAYS_BACK * 24 * 60 * 60 * 1000);
  const lastFaMs = Number(props.getProperty("LAST_FA_PROCESSED_MS") || 0);
  const tz       = Session.getScriptTimeZone();
  const newRows  = [];

  for (const committee of committees) {
    for (const meeting of committee.meetings) {
      const meetingDate = new Date(meeting.Dato);

      // Spring over møder der er for gamle eller allerede behandlet
      if (meetingDate < cutoff) continue;
      if (meetingDate.getTime() <= lastFaMs) continue;

      console.log(`\n📋 ${committee.name}: ${meeting.Navn || "Møde"} (${meeting.Dato.slice(0,10)})`);

      // TRIN 4: Hent fuld dagsorden for dette møde
      const agendaItems = fetchMeetingAgenda_(cookies, meeting.Id);

      if (!agendaItems || agendaItems.length === 0) {
        console.log(`   ℹ️ Ingen åbne punkter`);
        continue;
      }

      console.log(`   📝 ${agendaItems.length} dagsordenspunkter`);

      for (const item of agendaItems) {
        if (!item.IsOpen) continue;  // Spring lukkede punkter over

        const content = extractContentFromAgendaItem_(item);
        const receivedAt = Utilities.formatDate(meetingDate, tz, "yyyy-MM-dd HH:mm");
        const sourceType = meeting.Afsluttet ? "Referat" : "Dagsorden";
        const itemUrl = `${CFG.FA_BASE_URL}/Vis/${sourceType === "Referat" ? "Referat" : "Dagsorden"}/${meeting.Id}`;

        newRows.push([
          receivedAt,                              // A: Modtaget
          sourceType,                              // B: Type
          committee.name,                          // C: Udvalg
          item.Caption || item.Navn || "Ukendt",   // D: Emne
          "FirstAgenda API",                        // E: Fra
          `FA:${meeting.Id}:${item.Id}`,           // F: ID
          itemUrl,                                  // G: URL
          content.slice(0, 8000),                  // H: Snippet (mere tekst = bedre analyse)
          item.Bilag ? item.Bilag.map(b => b.Navn).join("; ") : "",  // I: Bilag
          "",                                       // J: TLDR
          "",                                       // K: SF Analyse
          "",                                       // L: Konkrete fakta
          "",                                       // M: Beløb/tal
          "",                                       // N: Score
          ""                                        // O: Match
        ]);
      }
    }
  }

  if (newRows.length > 0) {
    console.log(`\n✅ ${newRows.length} nye dagsordenspunkter fra FirstAgenda`);

    // Tjek for duplikater (baseret på ID i kolonne F)
    const existingIds = new Set();
    const allData = sheet.getDataRange().getValues();
    for (let i = 1; i < allData.length; i++) {
      existingIds.add(String(allData[i][5]));
    }

    const uniqueRows = newRows.filter(row => !existingIds.has(String(row[5])));
    console.log(`   📊 ${uniqueRows.length} nye (${newRows.length - uniqueRows.length} duplikater sprunget over)`);

    if (uniqueRows.length > 0) {
      const startRow = sheet.getLastRow() + 1;
      sheet.getRange(startRow, 1, uniqueRows.length, uniqueRows[0].length).setValues(uniqueRows);

      // Analyser med Gemini
      analyzeNewRows_(sheet, startRow, uniqueRows.length);

      // Gem tidsstempel
      const maxMs = Math.max(...newRows.map(r => new Date(r[0]).getTime()));
      props.setProperty("LAST_FA_PROCESSED_MS", String(maxMs));
    }
  } else {
    console.log("\nℹ️ Ingen nye dagsordenspunkter fra FirstAgenda");
  }
}

/**
 * Autenticer mod FirstAgenda (anonym authentication)
 * Returnerer cookies til brug i efterfølgende requests
 */
function authenticateFirstAgenda_() {
  console.log("🔑 Autenticerer mod FirstAgenda...");

  const authUrl = CFG.FA_BASE_URL + CFG.FA_AUTH_PATH;
  const response = UrlFetchApp.fetch(authUrl, {
    muteHttpExceptions: true,
    followRedirects: false,
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; SF-Middelfart-Bot/8.0)'
    }
  });

  // Udtræk Set-Cookie headers
  const headers = response.getAllHeaders();
  const setCookies = headers['Set-Cookie'] || [];
  const cookieList = Array.isArray(setCookies) ? setCookies : [setCookies];

  const cookies = cookieList
    .map(c => c.split(';')[0])
    .filter(Boolean)
    .join('; ');

  console.log(`   ✅ Auth OK (${cookieList.length} cookies)`);
  return cookies;
}

/**
 * Henter udvalgsliste med møder fra FirstAgenda API
 */
function fetchCommitteeList_(cookies) {
  console.log("📋 Henter udvalgsliste...");

  const url = CFG.FA_BASE_URL + CFG.FA_API_COMMITTEES;
  const response = UrlFetchApp.fetch(url, {
    muteHttpExceptions: true,
    headers: {
      'Cookie': cookies,
      'User-Agent': 'Mozilla/5.0 (compatible; SF-Middelfart-Bot/8.0)',
      'Accept': 'application/json'
    }
  });

  if (response.getResponseCode() !== 200) {
    throw new Error(`FirstAgenda API fejl: HTTP ${response.getResponseCode()}`);
  }

  const data = JSON.parse(response.getContentText());
  const committees = [];

  // data.Udvalg er et objekt med gruppenavn som nøgler
  for (const [groupName, udvalgList] of Object.entries(data.Udvalg)) {
    for (const udvalg of udvalgList) {
      committees.push({
        id: udvalg.Id,
        name: udvalg.Navn,
        meetings: udvalg.Moeder || []
      });
    }
  }

  console.log(`   ✅ Fandt ${committees.length} udvalg`);
  return committees;
}

/**
 * Henter fuld dagsorden for et specifikt møde
 */
function fetchMeetingAgenda_(cookies, meetingId) {
  const url = CFG.FA_BASE_URL + CFG.FA_API_AGENDA + meetingId;

  try {
    const response = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      headers: {
        'Cookie': cookies,
        'User-Agent': 'Mozilla/5.0 (compatible; SF-Middelfart-Bot/8.0)',
        'Accept': 'application/json'
      }
    });

    if (response.getResponseCode() !== 200) {
      console.log(`   ⚠️ Kunne ikke hente dagsorden: HTTP ${response.getResponseCode()}`);
      return [];
    }

    const data = JSON.parse(response.getContentText());
    return data.Dagsordenpunkter || [];
  } catch (e) {
    console.log(`   ❌ Fejl ved hentning af dagsorden: ${e.message}`);
    return [];
  }
}

/**
 * Returnerer kommende møder (ikke afsluttede) inden for de næste
 * `daysAhead` dage, sorteret efter dato.
 *
 * Bruges af generateWeeklyDraft() til at bygge kalender-sektionen
 * for NÆSTE uge — ikke den uge der lige er gået.
 */
function fetchUpcomingMeetings_(daysAhead) {
  try {
    const cookies = authenticateFirstAgenda_();
    const committees = fetchCommitteeList_(cookies);

    const now   = new Date();
    const limit = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);

    const upcoming = [];
    for (const committee of committees) {
      for (const m of committee.meetings) {
        if (!m.Dato) continue;
        const d = new Date(m.Dato);
        if (isNaN(d.getTime())) continue;
        if (d < now) continue;       // ikke fortid
        if (d > limit) continue;      // ikke længere ude end vinduet
        if (m.Afsluttet) continue;    // referat allerede lagt ud = mødet er slut

        upcoming.push({
          committee: committee.name,
          name:      m.Navn || "Møde",
          date:      d,
          meetingId: m.Id
        });
      }
    }

    upcoming.sort((a, b) => a.date - b.date);
    console.log(`   📅 ${upcoming.length} kommende møder inden for ${daysAhead} dage`);
    return upcoming;
  } catch (e) {
    console.log(`   ⚠️ Kunne ikke hente kommende møder: ${e.message}`);
    return [];
  }
}

/**
 * Udtrækker læsbar tekst fra et dagsordenspunkt
 * API'en returnerer HTML i Felter[].Html med beslutninger, indstillinger, sagsbeskrivelser
 */
function extractContentFromAgendaItem_(item) {
  const parts = [];

  // Titel
  parts.push(`PUNKT ${item.Number || item.Punktnummer}: ${item.Caption || item.Navn}`);

  // Sagsnummer
  if (item.CaseNumber || item.SagsNummer) {
    parts.push(`Sagsnr: ${item.CaseNumber || item.SagsNummer}`);
  }

  // Udtræk indhold fra Felter (her ligger alt det gode)
  if (item.Felter && item.Felter.length > 0) {
    for (const felt of item.Felter) {
      if (felt.Html) {
        // Konverter HTML til læsbar tekst
        const text = extractTextFromHtml_(felt.Html);
        parts.push(text);
      }
      if (felt.Tekst) {
        parts.push(felt.Tekst);
      }
    }
  }

  // Bilag navne
  if (item.Bilag && item.Bilag.length > 0) {
    parts.push(`\nBILAG: ${item.Bilag.map(b => b.Navn).join(", ")}`);
  }

  return parts.join("\n\n");
}

/* ═══════════════════════════════════════════════════════════════════════
   DAGLIG INDSAMLING FRA EMAIL (SUPPLEMENT)
   ═══════════════════════════════════════════════════════════════════════ */

function ingestInboxEmails() {
  console.log("📥 Starter email-indsamling (supplement)...");

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
        'User-Agent': 'Mozilla/5.0 (compatible; SF-Middelfart-Bot/8.0)',
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

    const from = row[4];  // E: Fra

    // TRIN 1: Check om det er rent administrativt (kun baseret på emne)
    if (isAdministrativeSubject_(subject)) {
      console.log(`   ⏭️ Sprunget over (formalia)`);
      updates.push([
        "Formalia/procedurepunkt",
        "",
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

    // For FirstAgenda-data: snippet indeholder allerede det fulde indhold
    // For email-data: prøv at hente indhold fra URL (men spring kendte dead-ends over)
    if (from !== "FirstAgenda API" && urls.length > 0) {
      const activeUrls = urls.filter(u =>
        !u.includes("bcdagsorden.dk") &&           // Nedlagt domæne
        !u.includes("dagsordener.middelfart.dk")    // Giver altid 302, brug API i stedet
      );
      if (activeUrls.length > 0) {
        const urlContent = fetchContentFromUrl_(activeUrls[0]);
        if (urlContent.success) {
          if (urlContent.isPdf) {
            pdfBase64 = urlContent.pdfBase64;
          } else {
            contentForAnalysis = urlContent.content || contentForAnalysis;
          }
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

SCORING — VIGTIGT: Scor baseret på INDHOLDET, ikke overskriften!
En sag der hedder "orientering om nøgletal" kan sagtens score 4 hvis den indeholder konkrete tal om beskæftigelse, økonomi osv.

1 = Ren formalia UDEN indhold (godkendelse af dagsorden, underskriftsark, mødeplan)
2 = Generel orientering UDEN konkrete tal, beslutninger eller politisk substans
3 = Sag med konkret indhold der påvirker borgere (regnskab, budget, anlæg, planer)
4 = SF-relevant sag med konkrete fakta (velfærd, børn, klima, lighed, økonomi, normeringer)
5 = Topprioritet — stor politisk sag med direkte SF-vinkel og konkrete konsekvenser

HUSK: De fleste sager med konkrete tal, beløb eller beslutninger bør score MINDST 3.
Sager om budget, regnskab, beskæftigelse, sundhed, børn, klima = score 4 eller 5.

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

  // Hent NÆSTE uges møder til kalender-sektionen
  // (9 dage = hele næste kalenderuge, uanset hvilken ugedag robotten kører)
  console.log("📅 Henter kommende møder...");
  const upcomingMeetings = fetchUpcomingMeetings_(9);

  // Generer nyhedsbrev
  const dateRange = formatDateRange_(weekAgo, now);
  const draftText = generateNewsletterWithGemini_(apiKey, {
    dateRange,
    topStories,
    mediumStories,
    adminItems,
    upcomingMeetings
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
    + `/Din SF Presse-Robot v8.0 🤖`
  );

  console.log(`\n✅ Nyhedsbrev oprettet: ${docUrl}`);
}

/**
 * Genererer nyhedsbrev-tekst med Gemini i Pias personlige SF-stemme.
 * Tonen hentes live fra stilguide.md via loadToneGuide_() — med
 * SF_TONE_GUIDE_FALLBACK som nødudgang hvis GitHub ikke kan nås.
 */
function generateNewsletterWithGemini_(apiKey, data) {
  // Byg kalender-blokken fra fetchUpcomingMeetings_ — formateret på dansk
  // så Gemini ikke kan hallucinere datoer eller weekdays.
  const tz = Session.getScriptTimeZone();
  const upcoming = data.upcomingMeetings || [];
  const calendarBlock = upcoming.length > 0
    ? upcoming.map(m => {
        const day = Utilities.formatDate(m.date, tz, "EEEE d. MMMM");
        const time = Utilities.formatDate(m.date, tz, "HH:mm");
        return `- ${day} kl. ${time}: ${m.committee} – ${m.name}`;
      }).join("\n")
    : "(Der er ingen åbne møder planlagt i den kommende uge.)";

  // Hent den aktuelle stilguide (live fra GitHub, ellers fallback-konstant)
  const toneGuide = loadToneGuide_();

  const prompt = `
Du skriver SF Middelfarts ugentlige nyhedsbrev. Afsenderen er Pia — en SF-politiker
i Middelfart. Du skriver ikke som "robotten", du skriver SOM Pia, i 1. person.

Perioden der lige er gået: ${data.dateRange}

════════════════════════════════════════
TONE — DETTE ER DET VIGTIGSTE AFSNIT
════════════════════════════════════════
${toneGuide}
════════════════════════════════════════

SF MIDDELFARTS MÆRKESAGER (brug dem som VÆRDI-RAMME, ikke som punktliste):
1. Velfærd: Kortere ventetid til psykolog, bedre ældrepleje, tid til omsorg
2. Børn & Unge: Tidlig indsats, flere hænder i institutioner, mindre præstationspres
3. Klima: Grøn transport, cykelstier, naturbeskyttelse, klimaneutral kommune
4. Lighed: Plads til alle, fritidspas, bekæmpelse af ulighed

════════════════════════════════════════
ABSOLUTTE ANTI-HALLUCINATIONS-REGLER
════════════════════════════════════════
* Skriv KUN om sager der fremgår af DATA-sektionen nedenfor.
* INGEN opdigtede citater, holdninger eller hændelser — heller ikke når du
  forsøger at ramme Pias personlige tone. Følelser er tilladt, facts er ikke.
* Brug KONKRETE tal og fakta fra data (beløb, procenter, datoer, navne).
* KALENDEREN må KUN indeholde møder fra KOMMENDE MØDER-blokken nedenfor.
  Tilføj ALDRIG andre datoer. Hvis listen er tom, så sig det ærligt.
* Hvis ugen er stille, så sig det ærligt i Pias personlige stemme — digt
  IKKE sager op for at fylde nyhedsbrevet.

════════════════════════════════════════
DATA — UGENS SAGER (${data.dateRange})
════════════════════════════════════════

TOP-SAGER (score 4-5) — disse er ugens vigtigste politiske historier:
${JSON.stringify(data.topStories, null, 2)}

MELLEM-SAGER (score 3):
${JSON.stringify(data.mediumStories, null, 2)}

ADMINISTRATIVE SAGER (score 1-2) — disse skal normalt IKKE nævnes i prosa,
med mindre de giver en politisk pointe:
${JSON.stringify(data.adminItems, null, 2)}

════════════════════════════════════════
KOMMENDE MØDER (NÆSTE UGE) — KALENDER-KILDE
════════════════════════════════════════
Kun disse datoer må stå i KALENDER-sektionen:
${calendarBlock}

════════════════════════════════════════
STRUKTUR — i DENNE rækkefølge (værdier før policy!)
════════════════════════════════════════

FØRSTE LINJE: Skriv "EMNE: " efterfulgt af en dramatisk, nysgerrighedsvækkende
eller følelsesladet emnelinje med emoji (f.eks. ❤️💚🎉💪). INGEN dato i emnet.

DEREFTER et tomt linjeskift og så selve nyhedsbrevet:

1. HILSEN: "Kære [fornavn]," — nøjagtig sådan. [fornavn] er en placeholder
   som Pia selv udfylder i sin mailtjeneste bagefter.

2. PERSONLIG ÅBNING (3-6 korte linjer):
   Start med en følelse, en refleksion, et billede, en fysisk metafor —
   noget MENNESKELIGT, som kobler til én af ugens top-sager. IKKE et resume,
   IKKE en opremsning. Læseren skal føle noget.

3. UGENS SAG(ER): Fortæl de vigtigste top-sager som Pia ville fortælle dem
   til en ven. Brug konkrete tal fra data, men pak dem ind i værdier: hvad
   betyder det her for de mennesker det rammer? Brug korte afsnit, retoriske
   spørgsmål, "vi/os"-sprog.

4. KORT NYT (valgfrit): Kun hvis der er mellem-sager der faktisk rykker.
   Må godt være en lille liste — men HVER linje skal have et menneskeligt
   greb, ikke bare en faktaopremsning.

5. KALENDER — NÆSTE UGE:
   En kort intro-linje i Pias stemme ("Her er hvad vi holder øje med i den
   kommende uge:" eller lignende), og DEREFTER præcis de møder der står i
   KOMMENDE MØDER-blokken ovenfor — ingen andre datoer. Hvis blokken er tom,
   så sig det ærligt i én sætning.

6. VARM AFSLUTNING (2-4 linjer):
   Fremadrettet budskab. Fællesskabs-retorik. Afslut med præcis:
   "De bedste hilsner,
   Pia"
   og DEREFTER én linje med en konkret CTA (f.eks. "PS: Kender du nogen der
   også burde være med? Del det her nyhedsbrev 💚" eller "PS: Bliv medlem
   af SF — sammen er vi stærkere ❤️").

════════════════════════════════════════
FORBUDTE FORMULERINGER (disse er den GAMLE tone og må IKKE bruges)
════════════════════════════════════════
- "Velkommen" / "I denne uge har der været stor aktivitet"
- "Vi har set nærmere på..."
- "Venlig hilsen, SF Middelfart"
- Passiv form ("det blev besluttet", "der er iværksat")
- Bureaukratiske udtryk ("budgetopfølgning viser", "forvaltningen vurderer")
- Neutrale overskrifter som "VELKOMMEN", "AFSLUTNING", "UGENS VIGTIGSTE"
  (brug hellere emotionelle mellemrubrikker eller helt slip overskrifterne)

Skriv nyhedsbrevet nu — på dansk, i Pias stemme, fra hjertet.
`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${CFG.MODEL_NAME}:generateContent`;

    const payload = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.7,
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
 * Test funktion til FirstAgenda API
 */
function debugTestFirstAgendaApi() {
  console.log("🧪 Tester FirstAgenda API...\n");

  // 1. Auth
  const cookies = authenticateFirstAgenda_();
  console.log("✅ Auth OK\n");

  // 2. Hent udvalg
  const committees = fetchCommitteeList_(cookies);
  console.log(`✅ ${committees.length} udvalg fundet:\n`);
  for (const c of committees) {
    console.log(`   📋 ${c.name} (${c.meetings.length} møder)`);
  }

  // 3. Hent nyeste møde fra første udvalg
  if (committees.length > 0 && committees[0].meetings.length > 0) {
    const firstMeeting = committees[0].meetings[0];
    console.log(`\n📝 Henter dagsorden for: ${committees[0].name} (${firstMeeting.Dato.slice(0,10)})`);

    const items = fetchMeetingAgenda_(cookies, firstMeeting.Id);
    console.log(`   ${items.length} dagsordenspunkter:\n`);

    for (const item of items) {
      if (!item.IsOpen) { console.log(`   🔒 ${item.Caption} (lukket)`); continue; }

      const content = extractContentFromAgendaItem_(item);
      console.log(`   📄 ${item.Caption}`);
      console.log(`      ${content.slice(0, 300)}...\n`);
    }
  }
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
