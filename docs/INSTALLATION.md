# Installation og driftskontrol

Denne ændring er ikke automatisk installeret i Apps Script. Et merge på GitHub opdaterer ikke robotten; kun stilguiden hentes automatisk derfra.

Version `8.1.7-validation` er installeret og genlæst i sin helhed, identisk med kodeleverancen fra commit `9b1fe812`. SHA-256: `b7c389315ed77b4b0765926c6d71fc37c006680ecdb039bd07273d82d983fb63`. De tre driftstriggere er gemt og kontrolleret til kl. 9–10, 11–12 og lørdag 13–14. Den eksisterende faktatjekkø fortsætter; slutrapporten og en ny kladde med den ændrede kildepolitik er stadig under driftskontrol. Se den daterede [driftsstatus](VERIFIKATION.md#driftsstatus-9-september-2026) før genoptagelse, så allerede gennemført indsamling ikke gentages uden grund.

## Før installation

1. Åbn det eksisterende Apps Script-projekt. Gem en kopi af alle aktuelle `.gs`-filer og manifestet som backup. Sammenlign med GitHub-leverancen, så eventuelle nyere lokale ændringer bevares.
2. Kontrollér, at kolonne P og Q i indbakke-arket er tomme eller allerede hedder `Kilde opdateret` og `Kildefingeraftryk`. Koden afbryder ved andre overskrifter.
3. Gem en kopi af regnearket. Kolonne A-O bevares; P-Q tilføjer metadata. Analysen i J-O nulstilles kun, når en ændret kilde gemmes.

## Indlæs og kontrollér

1. Indlæs den opdaterede `sf-middelfart-robot-v8.gs` i den eksisterende kodefil. Undgå at oprette endnu en fil med de samme globale funktioner og konstanter. Bevar projektets manifest og Script Properties.
2. Kontrollér `ROBOT_VERSION = "8.1.6-validation"`.
3. Kør `debugTestGemini()`. Fejl på alle modeller skal løses før næste trin.
4. Kør `debugDiagnoseSheet()` og notér antal sager uden gyldig analyse.
5. Kør `testManualRun()` for indsamling. Den gemmer kilder; efteranalysen har sit eget tidsbudget.
6. Kør `dailyRepairAnalyses()`, derefter `debugDiagnoseSheet()`. Gentag, mens antallet falder og modelkapacitet er tilgængelig. Ved gentagne kvotefejl springes den pågældende model over resten af eksekveringen; hvis alle modeller er ramt, stopper kørslen uden at ændre de resterende rækker. Næste eksekvering prøver modellerne igen. Fejlede sager får en genforsøgspause på mindst 15 minutter, så én fejl ikke blokerer resten.
7. Kør `testGenerateNewsletterWithoutEmail()` for en kladde uden notifikationsmail. Funktionen gemmer dokumentet og opretter en faktatjekkø; den samlede kontrol er ikke afsluttet, når denne første kørsel slutter. `processPendingFactCheck()` fortsætter automatisk via en engangstrigger. Brug `debugFactCheckJob()` til status. Kontrollér til sidst dækning, kildecitater, PDF-vurderinger og fejl i den separate faktatjekrapport. Rapporten ligger i den private mappe `SF Robotdata (privat)`; dens link vises i afslutningsloggen og i notifikationer, hvis de er aktiveret. Notifikation er slået fra i hele testkøen.
8. Efter driftskontrollen: kør `setupOnce_createTriggers()` én gang for at opdatere de tre robottriggere, også hvis deres navne allerede findes. Indsamling ligger kl. 09-10, analyse kl. 11-12 og lørdagskladden kl. 13-14 i projektets tidszone. Afstanden tager højde for Googles valg af minut inden for timen og kørslens varighed. Den tidligere analyse kl. 14 lå efter kladden. Funktionen erstatter kun `dailyIngest`, `dailyRepairAnalyses` og `generateWeeklyDraft`; øvrige projekttriggere bevares, herunder en eventuel igangværende `processPendingFactCheck`-fortsættelse.

## Indstillinger

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
- Sent offentliggjort materiale udvælges efter offentliggørelse/kildeændring, mens mødedatoen bevares.
- En kladde viser manglende analyse og ufuldstændigt kildegrundlag tydeligt.
- Faktatjekket genoptager samme opgave gennem flere kørsler, behandler alle registrerede bilag eller oplyser konkrete fejl og gemmer en separat rapport. Testkøen sender ingen mail.
- Egne rettelser i en aktiv kladde eller en afbrudt rapport overskrives ikke af en senere worker.
- Beløb, beslutninger, kalender og påstande om SF's stemmeafgivning efterprøves mod originale kilder.

## Tilbagerulning

Før ældre kode gendannes, stands engangstriggerne med handlerne `processPendingFactCheck`, `retryDailyIngest`, `retryDailyRepairAnalyses` og `retryWeeklyDraft`, så de ikke kalder en funktion, som mangler i den ældre version. Bevar jobfilerne til fejlsøgning. Gendan derefter den gemte kode fra før installationen, hvis en driftskontrol kræver tilbagerulning. Bevar regnearksbackuppen og P-Q, indtil data er sammenlignet; slet ikke kilder eller analyser for at nulstille robotten. Kør ikke den ældre kode automatisk over opdaterede data, før konsekvenserne er vurderet.

[Googles dokumentation om tidsstyrede triggere](https://developers.google.com/apps-script/guides/triggers/installable#time-driven_triggers) beskriver det varierende minut inden for den valgte time.
