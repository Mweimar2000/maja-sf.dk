# Installation og driftskontrol

Denne ændring er ikke automatisk installeret i Apps Script. Et merge på GitHub opdaterer ikke robotten; kun stilguiden hentes automatisk derfra.

Senest verificeret drift er `8.1.3-validation`; leverancen her er `8.1.4-validation`. Se den daterede [driftsstatus](VERIFIKATION.md#driftsstatus-9-september-2026) før genoptagelse, så allerede gennemført indsamling ikke gentages uden grund.

## Før installation

1. Åbn det eksisterende Apps Script-projekt. Gem en kopi af alle aktuelle `.gs`-filer og manifestet som backup. Sammenlign med GitHub-leverancen, så eventuelle nyere lokale ændringer bevares.
2. Kontrollér, at kolonne P og Q i indbakke-arket er tomme eller allerede hedder `Kilde opdateret` og `Kildefingeraftryk`. Koden afbryder ved andre overskrifter.
3. Gem en kopi af regnearket. Kolonne A-O bevares; P-Q tilføjer metadata. Analysen i J-O nulstilles kun, når en ændret kilde gemmes.

## Indlæs og kontrollér

1. Indlæs den opdaterede `sf-middelfart-robot-v8.gs` i den eksisterende kodefil. Undgå at oprette endnu en fil med de samme globale funktioner og konstanter. Bevar projektets manifest og Script Properties.
2. Kontrollér `ROBOT_VERSION = "8.1.4-validation"`.
3. Kør `debugTestGemini()`. Fejl på alle modeller skal løses før næste trin.
4. Kør `debugDiagnoseSheet()` og notér antal sager uden gyldig analyse.
5. Kør `testManualRun()` for indsamling. Den gemmer kilder; efteranalysen har sit eget tidsbudget.
6. Kør `dailyRepairAnalyses()`, derefter `debugDiagnoseSheet()`. Gentag, mens antallet falder. Fejlede sager får en genforsøgspause på mindst 15 minutter, så én fejl ikke blokerer resten.
7. Kør `testGenerateNewsletterWithoutEmail()` for en kladde uden notifikationsmail. Kontrollér dækning, kildecitater og advarsler. Funktionen opretter et dokument i den konfigurerede kladdemappe.
8. Efter driftskontrollen: kør `setupOnce_createTriggers()` én gang for at opdatere de tre robottriggere, også hvis deres navne allerede findes. Indsamling ligger kl. 09-10, analyse kl. 11-12 og lørdagskladden kl. 13-14 i projektets tidszone. Afstanden tager højde for Googles valg af minut inden for timen og kørslens varighed. Den tidligere analyse kl. 14 lå efter kladden. Funktionen erstatter kun `dailyIngest`, `dailyRepairAnalyses` og `generateWeeklyDraft`; øvrige projekttriggere bevares.

## Indstillinger

De eksisterende properties bruges fortsat: `SPREADSHEET_ID`, `INBOX_SHEET_NAME`, `INBOX_LABEL`, `GEMINI_API_KEY` og `DRAFT_FOLDER_ID`.

`SOURCE_HOSTS` kan indeholde yderligere godkendte værtsnavne adskilt af komma. Standardlisten er `middelfart.dk`, `www.middelfart.dk`, `dagsordener.middelfart.dk`, `sf.dk` og `www.sf.dk`. FirstAgendas signerede PDF-rute på `staticresources.firstagenda.com/api/v1/signed/` tillades også. Automatisk hentning kræver HTTPS; afmeldingslinks blokeres også ved omdirigeringer. Udvid kun listen med konkrete kendte dokumentkilder.

For emails bevarer A den faktiske modtagelsesdato, mens P registrerer første indlæsning. Kun mails, der var højst syv dage gamle ved indlæsningen, kan bæres til næste kladde efter en weekendgrænse; ældre arkivmails bliver ikke til aktuelle nyheder.

`FA_SCAN_NEXT_ID`, `GMAIL_SCAN_OFFSET` og `ANALYSIS_RETRY_*` styres af robotten. De muliggør genoptagelse og pauser mellem genforsøg. Der gemmes ingen API-nøgler eller PDF-indhold i disse nye properties.

## Godkendelseskriterier

- Den kørende version matcher den testede leverance.
- Mindst én tidligere fejlet aktuel sag gennemføres, og antal manglende analyser falder.
- Et korrigeret referat erstatter kildetekst og gammel analyse; samme uændrede input udløser ikke genanalyse.
- Sent offentliggjort materiale udvælges efter offentliggørelse/kildeændring, mens mødedatoen bevares.
- En kladde viser manglende analyse og ufuldstændigt kildegrundlag tydeligt.
- Beløb, beslutninger, kalender og påstande om SF's stemmeafgivning efterprøves mod originale kilder.

## Tilbagerulning

Gendan den gemte kode fra før installationen, hvis en driftskontrol fejler. Bevar regnearksbackuppen og P-Q, indtil data er sammenlignet; slet ikke kilder eller analyser for at nulstille robotten. Kør ikke den ældre kode automatisk over opdaterede data, før konsekvenserne er vurderet.

[Googles dokumentation om tidsstyrede triggere](https://developers.google.com/apps-script/guides/triggers/installable#time-driven_triggers) beskriver det varierende minut inden for den valgte time.
