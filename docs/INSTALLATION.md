# Installation og driftskontrol

**Status 9. september 2026 kl. 13.32.44: `8.2.1-validation` er installeret i Apps Script, og 315/315 lokale tests består.** Hele hovedfilen er genlæst og matcher SHA-256 `4709e03b7fc5b018b7431f256fd082d03ee3310f31e05f9f3bd37c14f1515204` efter normalisering af linjeskift. En ny rigtig nyhedsbrevstekst med statusrettelserne kunne endnu ikke produceres og kontrolleres på grund af kvoter og overbelastning. Et merge på GitHub deployer ikke koden til Apps Script; kun stilguiden hentes automatisk fra GitHub. Se [driftsstatus](VERIFIKATION.md#driftsstatus-9-september-2026) og [publiceringsstatus](VERIFIKATION.md#github-status-9-september-2026).

Indsamlingen kl. 13.31.14–13.31.53 udvidede 12 kildeuddrag og registrerede to yderligere erstatninger i R. Sammenligningen af hele arket viser præcis 14 ændrede celleværdier og to nye noter; alle øvrige værdier, formler og noter er bevaret. Arket indeholder fortsat 1.185 datarækker. Diagnosen kl. 13.32.44 viser 211 historiske dagsordener, 41 erstatninger via R og 933 aktive poster: 588 analyserede, fire formalia, 297 med tom og 44 med ugyldig analyse. Der er 341 aktive mangler, heraf 107 i nyhedsvinduets 123 poster. Faldet fra 347 til 341 skyldes historik; det kumulative antal faktiske analysereparationer er fortsat 14. Produktionsmodellerne og de tre allerede kontrollerede driftstriggere er uændrede. Den aktuelle installation er gennemført; gentag ikke førstegangsopsætningen.

Trinene nedenfor er en generel vejledning til førstegangsinstallation og senere opdateringer. De skal ikke gentages samlet for den allerede installerede version; brug den daterede driftsstatus til at se, hvad der allerede er gennemført.

## Før installation

1. Åbn det eksisterende Apps Script-projekt. Gem en kopi af alle aktuelle `.gs`-filer og manifestet som backup. Sammenlign med GitHub-leverancen, så eventuelle nyere lokale ændringer bevares.
2. Kontrollér, at kolonne P, Q og R i indbakke-arket er tomme eller allerede hedder henholdsvis `Kilde opdateret`, `Kildefingeraftryk` og `Erstattet af kilde-ID`. Koden afbryder ved andre overskrifter og ved data i R uden den tilhørende overskrift. Den tager ikke ejerskab over en fremmed R-kolonne.
3. Gem en kopi af regnearket. P-Q indeholder kildemetadata; R angiver erstatningskilden og har en note med kontrolgrundlaget. En R-markering bevarer A–Q, inklusive gammel analyse og bilagsreferencer. Den almindelige indsamling nulstiller fortsat analysen i J-O, når en ændret kilde gemmes.

## Indlæs og kontrollér

1. Indlæs den opdaterede `sf-middelfart-robot-v8.gs` i den eksisterende kodefil. Undgå at oprette endnu en fil med de samme globale funktioner og konstanter. Bevar projektets manifest og Script Properties.
2. Kontrollér `ROBOT_VERSION = "8.2.1-validation"` og hele kildefilens hash mod leverancen.
3. Kør `debugTestGemini()` og notér resultatet. Indsamling og arkdiagnose kan kontrolleres uafhængigt af modelkapaciteten; godkendelse af analyse og nyhedsbrev kræver et gyldigt modelsvar.
4. Kør `debugDiagnoseSheet()` og notér antal sager uden gyldig analyse.
5. Kør `testManualRun()` for indsamling. Den gemmer kilder; efteranalysen har sit eget tidsbudget.
6. Kør `dailyRepairAnalyses()`, derefter `debugDiagnoseSheet()`. Gentag, mens antallet falder og modelkapacitet er tilgængelig. Ved gentagne kvotefejl springes den pågældende model over resten af eksekveringen; hvis alle modeller er ramt, stopper kørslen uden at ændre de resterende rækker. Næste eksekvering prøver modellerne igen. Fejlede sager får en genforsøgspause på mindst 15 minutter, så én fejl ikke blokerer resten.
7. Kør `testGenerateNewsletterWithoutEmail()` for en kladde uden notifikationsmail. Funktionen gemmer dokumentet og opretter en faktatjekkø; den samlede kontrol er ikke afsluttet, når denne første kørsel slutter. `processPendingFactCheck()` fortsætter automatisk via en engangstrigger. Brug `debugFactCheckJob()` til status. Kontrollér til sidst dækning, kildecitater, PDF-vurderinger og fejl i den separate faktatjekrapport. Rapporten ligger i den private mappe `SF Robotdata (privat)`; dens link vises i afslutningsloggen og i notifikationer, hvis de er aktiveret. Notifikation er slået fra i hele testkøen.
8. Ved førstegangsinstallation eller nødvendig opdatering af triggeropsætningen: kør efter driftskontrollen `setupOnce_createTriggers()` én gang for at opdatere de tre robottriggere, også hvis deres navne allerede findes. **I den aktuelle installation blev opsætningen allerede gennemført 9. september 2026 kl. 09.06, og triggere er kontrolleret. Kør ikke opsætningen igen nu.** Indsamling ligger kl. 09-10, analyse kl. 11-12 og lørdagskladden kl. 13-14 i projektets tidszone. Afstanden tager højde for Googles valg af minut inden for timen og kørslens varighed. Den tidligere analyse kl. 14 lå efter kladden. Funktionen erstatter kun `dailyIngest`, `dailyRepairAnalyses` og `generateWeeklyDraft`; øvrige projekttriggere bevares, herunder en eventuel igangværende `processPendingFactCheck`-fortsættelse.

## Gamle afkortede kildetekster

I 8.2.1 kan en gammel kildetekst på præcis 8.000 tegn udvides til højst 45.000 tegn, når det gemte, ikke-tomme kildefingeraftryk er identisk med den friske fulde kilde, og hele det gamle uddrag er et ordret præfiks. Kun H ændres; kildedato, analyse, fingerprint og kilde-ID bevares. En rigtig kildeændring nulstiller fortsat analysen. Udvidelse tælles særskilt og er hverken ny offentliggørelse eller analysereparation.

Udvidelsen sker ved normal indsamling. Andre længder, manglende fingerprint eller en redigeret tekst udvides ikke automatisk. En erstatning i R kræver bagefter, at den friske tekst faktisk er gemt.

## Kildehistorik i kolonne R

En ny R-markering kræver et fuldstændigt, valideret FirstAgenda-katalog, hvor det gamle møde ikke længere findes, samt et entydigt erstatningspunkt hentet i samme kørsel og gemt i arket. Dato/tid, udvalg, titel, punktnummer, sagsnummer og kildetype skal matche. En gammel dagsorden bliver derfor ikke til et referat gennem R. Et HTTP 500-svar, et ufuldstændigt katalog eller en gammel cache er ikke bevis for, at kilden er erstattet; uden tilstrækkeligt belæg oprettes ingen ny markering.

R-noten registrerer begge offentlige kildelinks, tidspunkt, kataloghash og forskellen i bilagsnavne og -antal. Den historiske række bevares. Læserne bruger kun R med robottens præcise overskrift og kontrollerer, at målet findes entydigt med samme type og sagsnøgle. Manglende mål, cykler og tvetydige kæder udelukker ikke rækken via R.

Gyldig R-historik fjernes fra kandidaterne, før dagsorden/referat-match afgøres. Ellers kunne et erstattet referat få en gammel dagsorden til at blive valgt igen. Denne sammensætning er regressionstestet gennem skriverens udvælgelse og manuel intervalanalyse. Samme filter bruges i automatisk analyse, manuel analyse, kladdeudvælgelse og diagnose; intervalanalyse kan også finde et erstatningsmål uden for det valgte interval.

Den aktuelle installation har allerede gennemført R-opdateringen: 40 ændrede værdier inklusive overskriften og 39 noter, udelukkende i R. Alle A–Q-værdier, formler og noter er sammenlignet og bevaret. Færre aktive mangler efter denne ændring skal registreres som udeladt historik, ikke som gennemførte analyser.

## Indstillinger

PDF-input må højst fylde 30 MiB pr. fil og samlet efter dekodning. Den færdige JSON-anmodning må højst fylde 45 MiB UTF-8, inklusive base64, tekst, svarskema og systeminstruktion. Robotten giver særskilte fejl for MIME-type, PDF-signatur og størrelse; en for stor anmodning sendes ikke og genforsøges ikke på en anden model. ZIP- og mailbilag har fortsat deres egne, uændrede grænser.

Disse grænser blev indført i 8.1.9. MOTAS-prøven den 9. september kl. 12.16 fik HTTP 200 fra `countTokens` med alle fem PDF’er: 16.891.023 PDF-bytes, 22.528.508 bytes i anmodningen og 25.102 tokens. Den faktiske analyse kl. 12.37–12.38 fik HTTP 429 på alle tre produktionsmodeller og ændrede ikke arket. Tokenoptælling dokumenterer indlæsning, ikke en gennemført analyse.

De eksisterende properties bruges fortsat: `SPREADSHEET_ID`, `INBOX_SHEET_NAME`, `INBOX_LABEL`, `GEMINI_API_KEY` og `DRAFT_FOLDER_ID`.

`SOURCE_HOSTS` kan indeholde yderligere godkendte værtsnavne adskilt af komma. Standardlisten er `middelfart.dk`, `www.middelfart.dk`, `dagsordener.middelfart.dk`, `sf.dk` og `www.sf.dk`. FirstAgendas signerede PDF-rute på `staticresources.firstagenda.com/api/v1/signed/` tillades også. Automatisk hentning kræver HTTPS; afmeldingslinks blokeres også ved omdirigeringer. Udvid kun listen med konkrete kendte dokumentkilder.

For emails bevarer A den faktiske modtagelsesdato, mens P registrerer første indlæsning. Kun mails, der var højst syv dage gamle ved indlæsningen, kan bæres til næste kladde efter en weekendgrænse; ældre arkivmails bliver ikke til aktuelle nyheder.

`BASE_RETRY_retryDailyIngest`, `BASE_RETRY_retryDailyRepairAnalyses` og `BASE_RETRY_retryWeeklyDraft` i UserProperties gemmer kun UID for den enkelte trigger-ejers gyldige genforsøg. De tre retryhandlers reagerer kun på det gemte timer-event. Manuel test uden mail skaber ingen baggrundskørsel, når låsen er optaget. Genforsøg gælder låseafslag; et allerede påbegyndt arbejde gentages ikke automatisk efter en exception.

`FA_SCAN_NEXT_ID`, `GMAIL_SCAN_OFFSET` og `ANALYSIS_RETRY_*` styres af robotten. De muliggør genoptagelse og pauser mellem genforsøg. Der gemmes ingen API-nøgler eller PDF-indhold i disse nye properties.

Faktatjekket opretter en intern mappe, `SF Robotdata (privat)`, uden at kopiere kladdemappens deling. Jobfiler og eventuelle kopier af mailbilag opbevares dér; Script Properties `FACTCHECK_DATA_FOLDER_ID` og `PENDING_FACTCHECK_JOB_ID` indeholder kun fil-IDer. API-nøgler og login-cookies gemmes ikke i opgaven.

En aktiv kø genoptages ved gentagen kladdedannelse, så der ikke oprettes en ekstra kladde. Hver del prøves højst tre gange. Manglende kilder eller bilag forbliver synlige i den afsluttende rapport. Workers ændrer aldrig den oprindelige kladde. Rapporten kontrollerer den gemte tekst og omfatter ikke senere manuelle rettelser. En påbegyndt rapport overskrives heller ikke under genoptagelse: den accepteres, hvis den forventede tekst allerede er gemt, ellers bevares den og en ny rapport forsøges. Rapportoprettelse har højst tre forsøg. Et stop mellem dokumentoprettelse og checkpoint kan efterlade et tomt dokument; automatisk oprydning sletter det ikke. Den planlagte fortsættelse oprettes før langsomme kald, så en seksminutters afbrydelse ikke fjerner fremdriften.

## Godkendelseskriterier

- Den kørende version matcher den testede leverance.
- Mindst én tidligere fejlet aktuel sag gennemføres, og antal manglende analyser falder.
- Et korrigeret referat erstatter kildetekst og gammel analyse; samme uændrede input udløser ikke genanalyse.
- Erstatning til et nyt kilde-ID markeres i R med dokumenteret mål og bevaret A–Q-historik. Ufuldstændigt katalog og tvetydige mål må ikke skabe nye markeringer. Erstattede referater må ikke genaktivere en gammel dagsorden i udvælgelsen.
- Diagnosen skelner mellem historik udeladt fra udvælgelsen og analyser, der faktisk er repareret; et fald i aktive mangler er ikke alene bevis for analysefremdrift.
- Sent offentliggjort materiale udvælges efter offentliggørelse/kildeændring, mens mødedatoen bevares.
- En kladde viser manglende analyse og ufuldstændigt kildegrundlag tydeligt.
- Faktatjekket genoptager samme opgave gennem flere kørsler, behandler alle registrerede bilag eller oplyser konkrete fejl og gemmer en separat rapport. Testkøen sender ingen mail.
- Egne rettelser i en aktiv kladde eller en afbrudt rapport overskrives ikke af en senere worker.
- Beløb, beslutninger, kalender og påstande om SF's stemmeafgivning efterprøves mod originale kilder.
- Pronomenhenvisninger og mødetidspunkt kontrolleres i hele den rigtige kladde. En statusnote kan også skyldes en påstand, som modellen ikke tog med i sin liste; fravær af en note beviser ikke fuldstændig dækning. Dette redaktionelle kriterium er endnu ikke dokumenteret opfyldt af en ny tekst med statusrettelserne i 8.1.8 eller senere.

## Tilbagerulning

Før ældre kode gendannes, stands engangstriggerne med handlerne `processPendingFactCheck`, `retryDailyIngest`, `retryDailyRepairAnalyses` og `retryWeeklyDraft`, så de ikke kalder en funktion, som mangler i den ældre version. Bevar jobfilerne til fejlsøgning. Gendan derefter den gemte kode fra før installationen, hvis en driftskontrol kræver tilbagerulning. Bevar regnearksbackuppen og P-R inklusive noter, indtil data er sammenlignet; slet ikke kilder eller analyser for at nulstille robotten. Kode før 8.2.0 bruger ikke R og kan derfor medtage pensioneret kildehistorik igen. Kontrollér udvælgelse og pendingtal før automatisk drift med ældre kode.

[Googles dokumentation om tidsstyrede triggere](https://developers.google.com/apps-script/guides/triggers/installable#time-driven_triggers) beskriver det varierende minut inden for den valgte time.
