# Verifikation af nyhedsbrevsrobotten

Målet er, at tekniske fejl forbliver synlige og genforsøges, at originale kilder følger med analysen, og at faktatjek aldrig præsenterer et tomt eller ugyldigt modelsvar som en verificeret kladde.

**Status 9. september 2026 kl. 13.32.44: `8.2.1-validation` er installeret i Apps Script, og 315/315 lokale tests består.** Hele hovedfilen er genlæst og matcher SHA-256 `4709e03b7fc5b018b7431f256fd082d03ee3310f31e05f9f3bd37c14f1515204` efter normalisering af linjeskift. En ny rigtig nyhedsbrevstekst med statusrettelserne kunne endnu ikke produceres og kontrolleres på grund af kvoter og overbelastning. Der er 341 aktive mangler og fortsat 14 dokumenterede analysereparationer. [Driftsstatus](#driftsstatus-9-september-2026) og [GitHub-status](#github-status-9-september-2026) skelner mellem installation, lokale tests og publiceringskontrol.

## Bevisstandard

| Kontrol | Krav | Evidens |
|---|---|---|
| AI-resultater | Ugyldigt skema, manglende felter og afbrudt output giver aldrig en score eller grønt tjek | Isolerede Node-tests med simulerede Google-tjenester |
| Kildebelæg | Optælling beregnes i kode; understøttede/modsagte påstande kræver genfindeligt citat | Test af forkert optælling, opdigtede citater, manglende/afkortede kilder |
| Dækning | Nye/korrigerede kilder bevares; fejlmarkører behandles som manglende analyse | Tests af kildeopdatering, reparation og dokumentbanner |
| Sikkerhed | Kildestrenge udføres ikke som formler; URL-politik gælder også omdirigeringer | Test af formelinput, PDF-links, HTTPS og omdirigeringer |
| Kildehistorik | Kun dokumenterede, entydige erstatninger bruges; historiske kildedata bevares | 56 nye tests; live-sammenligning viser 39 R-markeringer og bevarede værdier, formler og noter i A–Q |
| Kildetekst | Kun kendt 8.000-tegnsafkortning af samme kildeversion udvides | 19 tests; live 12 H-udvidelser og to R-markeringer med alle øvrige celler bevaret |
| Drift | Kørende version, analyseefterslæb og kladde verificeres i Apps Script | 8.2.1 installeret og fuldt genlæst; 341 aktive mangler kl. 13.32.44. Fem MOTAS-PDF’er accepteret via countTokens; den faktiske analyse fik HTTP 429. En ny rigtig tekst er fortsat udestående |

Ingen vægtet modelbedømmelse anvendes: dette er binære korrekthedskrav til kode. Ingen model er valgt som bedre på baggrund af disse tests. Modellerne testes med de samme simulerede API-svar, uden netværk, credentials eller rigtige emails.

## Reproducerbar kontrol

Kør med Node 22 eller nyere:

```sh
npm test
```

Der kræves ingen pakkeinstallation. Testene indlæser hele Apps Script-filen i en isoleret JavaScript-kontekst med simulerede tjenester og deaktiveret dynamisk kodegenerering. Koden kan ikke tilgå Node-moduler, miljøvariabler eller rigtige Google-konti fra testkonteksten.

**Seneste lokale kørsel: 315/315 bestået** for 8.2.1 i det rigtige checkout. De eksisterende 296 tests er bevaret, og 19 nye tests dækker afkortet kildeinput, grænser, genkørsler, afbrydelser og syntetiske analysefelter i testdata. Ni af de nye tests fejler mod 8.2.0. Uafhængigt review fandt ingen P1/P2-fejl og bestod 19 målrettede prøver samt seks yderligere grænsekontroller. Fixture indeholder offentlige kildetekster og syntetiske analyse-/datofelter; private Sheets-analyser er ikke publiceret. Et lokalt resultat er ikke et CI-resultat eller en modelbenchmark.

De 56 nye tests giver 18 fejl mod 8.1.9: 11 viser ændret adfærd, mens syv alene skyldes, at den nye hjælpefunktion ikke findes i baselinen. De resterende 38 består. En særskilt uafhængig reproduktion af blandet R-/referathistorik fejlede i fem læserveje før rettelsen og bestod bagefter. Testene er ikke et bevis for analyse- eller skrivekvalitet fra en rigtig model.

Historisk bestod 8.1.9 alle 240 tests, inklusive 23 PDF-/størrelsesprøver, hvoraf 13 fejlede mod 8.1.8. Den første pakke på 20 kontroller gav 18 fejl mod Claude-versionen `df0b6394ab853e3864dec132913c07224fd9de75`, og alle 20 bestod efter rettelse. Flere tests er siden tilføjet for indsamling, genforsøg og kildehistorik.

Den separate integrationstest blev skrevet af en subagent og gennemgået ved integration. En uafhængig gennemgang af alle 11 ændrede filer blev gennemført 8. september 2026. Den fandt to fejl: analysen var planlagt efter lørdagskladden, og historiske emails fik indlæsningsdato som nyhedsdato. Tre nye integrationstests reproducerede fejlene før rettelse. Fra `8.1.2-validation` definerer opsætningen indsamling og analyse før kladden (de eksisterende triggere blev opdateret 9. september kl. 09.06), og mails beholder deres faktiske modtagelsesdato i A. En mail, der var højst syv dage gammel ved første indlæsning i P, kan bæres frem til den følgende kladde. Arkivmails bliver ikke aktuelle alene ved import eller reparation, heller ikke med en nyere dato i P. En fjerde regressionstest dækker lørdagsmail efter indsamlingen: den kommer med ugen efter uden at blive gentaget endnu en uge senere. Sene FirstAgenda-offentliggørelser bruger fortsat deres særskilte kildedato.

## Kontrolleret driftsbevis

1. Kontrollér `ROBOT_VERSION` i Apps Script mod leverancen.
2. Kør `debugDiagnoseSheet()` og notér dækningsstatus.
3. Kør indsamling separat fra analyse; kontrollér et sent offentliggjort møde og et opdateret referat.
4. Kør `dailyRepairAnalyses()` og sammenlign antal manglende analyser før/efter. Adskil gennemførte analyser fra historiske rækker, som nu udelades af R-/referatfiltreringen. Ved gentagne kilde-/modelfejl anvendes en pause på 15 minutter, stigende til højst et døgn.
5. Generér en kladde og kontrollér banner, originale kildepassager, beslutninger, tal, datoer og eventuelle påstande om SF's konkrete handlinger.

## Kendte grænser

- En model kan overse påstande eller fejlfortolke et korrekt kildecitat. Den automatiske kontrol er ikke en garanti for fuldstændighed eller sandhed.
- PDF'er sendes til både analyse og faktatjek, men denne JavaScript-kontrol kan kun genfinde citater i tekstkilder. PDF-grundlag mærkes derfor som krævende manuel kontrol.
- Store dokumenter og bilag afvises synligt frem for at blive lydløst afkortet. Meget store sager kræver særskilt behandling.
- Referater efterprøves inden for 90 dage, samt ældre møder med en offentliggørelsesdato inden for syv dage. Ændringer uden ajourført offentliggørelsesdato længere tilbage kræver historisk genindlæsning.
- Ved første overgang fra gamle rækker uden kildefingeraftryk sammenlignes den gemte tekst og metadata. Ændringer, der ligger uden for en tidligere afkortet tekst, kan ikke tidsfæstes bagefter.
- R dokumenterer en erstatningsrelation og bevarer den gamle række; den rekonstruerer ikke bortfaldne bilag eller dokumenterer en ny beslutning. Ved mangelfuldt katalog eller tvetydig identitet oprettes ingen ny markering. Historiske mangler kan derfor fortsat kræve manuel afklaring.
- Semgrep var ikke installeret og havde intet tilgængeligt MCP-værktøj. Der er udført kodegennemgang og konkrete sikkerhedstests; ingen Semgrep-scanning er påstået.

## Primære referencer

- [Gemini generateContent API](https://ai.google.dev/api/generate-content): svarstruktur, finishReason og systeminstruktioner.
- [Apps Script Range.setValues](https://developers.google.com/apps-script/reference/spreadsheet/range#setvaluesvalues): strenge, der begynder med lighedstegn, fortolkes som formler.
- [FirstAgenda udvalgsliste](https://dagsordener.middelfart.dk/api/agenda/udvalgsliste): møde- og offentliggørelsesdatoer.
- [Apps Script projects.getContent](https://developers.google.com/apps-script/api/reference/rest/v1/projects/getContent): kildekode skal læses via Apps Script API eller editoren; Drive-metadata beviser ikke versionsidentitet.

- [FirstAgenda offentlig klient](https://dagsordener.middelfart.dk/dist/js/vis.2d1ff8215da6f675bb40.js): de observerede ruter for `Felter[].DocumentId` og `Bilag[].Id`. Begge PDF-typer blev hentet fra en offentlig budgetsag den 8. september 2026; testene bruger samme skema, men ikke signed URL-tokens.

## Opfølgning på driftsprøven

PDF-kald i driftsprøven ramte HTTP 429/503, og flere reservesvar blev afvist på faktafeltets type eller indhold. Version 8.1.2 sender derfor et native svarskema for både tekst og PDF-analyser; den lokale validering er fortsat afgørende. Aktuelle møder/mails prioriteres foran nyligt genoffentliggjorte arkivsager. Oprindelige datoer sendes med til modellen og skal bevares i teksten. Tre ekstra regressionstests dækker disse forhold. Dette ændrer ikke modelvalg og er ikke en modelbenchmark.

Schema-feltet følger [generateContent-reference](https://ai.google.dev/api/generate-content#v1beta.GenerationConfig); robotten bruger fortsat sin eksisterende generateContent-transport.

FirstAgenda-kildelinks er ændret til kommunens observerede offentlige punkt-rute `/vis?id=...&punktid=...`. Eksisterende links rettes i G ved indsamling og kladdedannelse uden at ændre dato, analyse eller nyhedsstatus. Den rettede rute svarede HTTP 200 i driftskontrollen; den gamle `/Vis/Referat/...` svarede 404. To regressionstests dækker nye og gamle links samt bevarelse af mailkilder.

Version 8.1.3 udvælger et eksisterende referat frem for den tilhørende gamle dagsorden, når dato, udvalg, titel, punktnummer og sagsnummer matcher entydigt. Dette håndterer FirstAgendas skift af kilde-ID ved offentliggørelse af referat. De gamle rækker bevares uændret som historik og rapporteres særskilt i diagnosen; de tælles ikke som reparerede analyser. Tvetydige eller mangelfulde match forbliver aktive. Fire regressionstests dækker udvælgelse, bevaret historik, fejlagtige match, tomme metadata, tvetydighed og delte kilde-IDer. Rækkeindeks sikrer, at kun den konkrete historiske dagsorden udelades.

Prøvekladden i 8.1.2 viste en overdrivelse af et udvalgs godkendelse til endelig vedtagelse, selv om behandlingsplanen nævnte senere Økonomiudvalg og Byråd. Analyse-, skrive- og faktatjekprompts præciserer nu beslutningsniveauet. Faktatjekket ramte også `MAX_TOKENS`; det bruger nu et native claims-skema, `thinkingLevel: LOW` og et særskilt svarloft på 16.384 tokens. Ufuldstændige svar afvises fortsat. Indstillingerne følger [ThinkingConfig i generateContent](https://ai.google.dev/api/generate-content#ThinkingConfig) og [de understøttede tænkeniveauer](https://ai.google.dev/gemini-api/docs/thinking#controlling_thinking). Der er ikke skiftet model. Den faktuelle virkning skal kontrolleres på den nye driftskladde; lokale tests er ikke en modelbenchmark.

Alle kladder får desuden en deterministisk kildeliste med oprindelige datoer og godkendte offentlige links. Listen gemmes med kladden og bevares, også når faktatjekket fejler. En integrationstest dækker netop dette fejlforløb og fravær af mailafsendelse.

Version 8.1.4 henter først alle FirstAgenda-originaltekster og derefter PDFer inden for den resterende tid. Et langsomt bilag kan derfor ikke fortrænge senere beslutningstekster; manglende PDFer er fortsat markeret som ufuldstændigt grundlag. Ved videre behandling i en kilde fjernes det gamle AI-resumé fra skriveinputtet, og den reproducerede formulering om udvalgets endelige vedtagelse afvises lokalt før gemning. Dette er en supplerende kontrol af den konkrete fejltype, ikke en generel garanti for faktuel korrekthed. Fem regressionstests dækker kilderækkefølgen med bevaret tid til modelkald, beslutningskontrollen, adskillelse af forskellige sager fra samme udvalg og fallback før en forkert formulering kan gemmes.

Et kildeindeks, hvis citat ikke kan bekræftes, knyttes ikke længere til den uverificerede påstand i rapporten. Den generelle kildeliste bevares til manuel gennemgang.


## Driftsstatus 9. september 2026

**Status 9. september 2026 kl. 13.32.44: `8.2.1-validation` er installeret i Apps Script, og 315/315 lokale tests består.** Hele hovedfilen er genlæst og matcher SHA-256 `4709e03b7fc5b018b7431f256fd082d03ee3310f31e05f9f3bd37c14f1515204` efter normalisering af linjeskift. En ny rigtig nyhedsbrevstekst med statusrettelserne kunne endnu ikke produceres og kontrolleres på grund af kvoter og overbelastning.

I 8.2.1 kan en gammel kildetekst på præcis 8.000 tegn udvides til højst 45.000 tegn, når det gemte, ikke-tomme kildefingeraftryk er identisk med den friske fulde kilde, og hele det gamle uddrag er et ordret præfiks. Kun H ændres; kildedato, analyse, fingerprint og kilde-ID bevares. En rigtig kildeændring nulstiller fortsat analysen. Udvidelse tælles særskilt og er hverken ny offentliggørelse eller analysereparation.

Indsamlingen kl. 13.31.14–13.31.53 udvidede 12 kildeuddrag og registrerede to yderligere erstatninger i R. Sammenligningen af hele arket viser præcis 14 ændrede celleværdier og to nye noter; alle øvrige værdier, formler og noter er bevaret. Arket indeholder fortsat 1.185 datarækker. Diagnosen kl. 13.32.44 viser 211 historiske dagsordener, 41 erstatninger via R og 933 aktive poster: 588 analyserede, fire formalia, 297 med tom og 44 med ugyldig analyse. Der er 341 aktive mangler, heraf 107 i nyhedsvinduets 123 poster. Faldet fra 347 til 341 skyldes historik; det kumulative antal faktiske analysereparationer er fortsat 14.

De udvidede rækker er 681, 683, 684, 695, 697, 698, 740, 747, 1054, 1058, 1070 og 1077. Række 989 henviser til 1077, og 1035 til 1070. Alle tidligere 39 R-noter er bevaret. De to nye noter matcher forhåndskontrollen, bortset fra frisk tidspunkt og kataloghash. Et nyt offentligt HTTP 200-svar bekræftede livehashen; katalogindholdet var identisk efter sortering af mødelister efter ID. Kun rækkefølgen af to møder fra 2025 var ændret.

Den aktive 8.1.7-prøvekø var kl. 13.20.43 nået til 25 af 43 PDF-trin: 12 modelvurderinger og 13 udtrykkelige fejl. Køen er ikke afsluttet, og mail er slået fra. De tidligere beskrevne kvote- og kapacitetsbegrænsninger består.

## Dateret driftskontrol af 8.2.0 kl. 13.10

Apps Script kører `8.2.0-validation`. Hele den genlæste hovedfil matcher leverancen efter normalisering af linjeskift: SHA-256 `575af82b18e94948b673e4a66244ffae870b00e3432ca6fafba43387d49bdf07`. 296/296 lokale tests består. To uafhængige reviews afsluttedes uden udestående P1/P2-fund efter rettelsen af sammensat R-/referathistorik.

Den faktiske FirstAgenda-indsamling kl. 13.03.46–13.04.26 registrerede 39 erstatninger i R og nul nye/ændrede kildepunkter. En fuld sammenligning af arkeksporterne før/efter viser fortsat 1.185 datarækker og kun ændringer i R: 40 værdier inklusive overskriften samt 39 noter. Alle værdier, formler og noter i A–Q er bevaret. De 39 mål matcher forhåndskontrollen præcist; kontrolnoterne matcher også, bortset fra det friske kontroltidspunkt. Indsamlingen reparerede ingen analyser.

Arkdiagnosen kl. 13.10.30 viser:

| Optælling | Antal |
|---|---:|
| Datarækker i alt | 1.185 |
| Historiske dagsordener erstattet af referat | 207 |
| Historiske rækker erstattet via R | 39 |
| Historiske rækker udeladt i alt | 246 |
| Aktive rækker | 939 |
| Aktive rækker med gyldig analyse | 588 |
| Aktive formaliarækker | 4 |
| Aktive rækker med tom analyse | 303 |
| Aktive rækker med ugyldig analyse | 44 |
| Aktive manglende/ugyldige analyser | 347 |
| Aktive rækker i nyhedsvinduet | 123 |
| Heraf manglende/ugyldige analyser | 107 |

Faldet fra 432 til 347 aktive mangler skyldes udelukkelse af yderligere 85 historiske mangler, ikke 85 reparerede analyser. Det kumulative antal dokumenterede reparationer er fortsat 14. De seneste fem blev faktisk gennemført af den planlagte genforsøgskørsel kl. 11.09–11.11 efter et låseafslag kl. 11.01.

En ny rigtig nyhedsbrevstekst med statusrettelserne er fortsat udestående efter kvotefejl på de tre produktionsmodeller og overbelastede 3.8-prøver. Ingen model eller betalingsindstilling er ændret. Den afsluttede ældre faktatjekkø er ikke bevis for en ny, godkendt skrivning. Testkøen fra 8.1.7 var kl. 13.10.17 nået til 23 af 43 PDF-opgaver: 12 modelvurderinger og 11 registrerede fejl. Køen er fortsat i PDF-fasen, og notifikationsmail er slået fra. Modelfortolkningerne kræver fortsat manuel kontrol.

## Kildehistorik og sammensætning i 8.2.0

Kolonne R, `Erstattet af kilde-ID`, registrerer en dokumenteret erstatning med samme kildetype. Et fuldstændigt katalog skal vise, at det gamle møde mangler, og et entydigt nyt punkt skal være hentet i samme kørsel og gemt med matchende dato/tid, udvalg, titel, punktnummer og sagsnummer. Katalog med manglende grupper/mødelister, ugyldige identiteter, dubletter eller tegn på delvis levering giver ingen nye R-markeringer. HTTP 500, et afbrudt kald eller en gammel cache kan ikke alene dokumentere, at en kilde er forsvundet.

R-noten bevarer kontroltidspunkt, kataloghash, begge offentlige kildelinks og forskelle i bilagsnavne og -antal. Læserne kræver robottens præcise R-overskrift og et eksisterende, entydigt mål med samme type og sagsnøgle. Kæder kan følges, men manglende mål, tvetydighed eller cykler udelukker ikke en række via R. De historiske rækker slettes ikke og tælles ikke som reparerede analyser.

Review reproducerede en sammensætningsfejl: et gammelt referat B erstattet af C kunne få en tilhørende gammel dagsorden A til at blive aktiv igen, fordi referatkontrollen først så både B og C. Slutkoden filtrerer gyldig R-historik før referatkontrollen og bevarer de oprindelige rækkeindekser. Regressionerne kontrollerer skriverens faktiske udvalg, analyse af et manuelt interval med erstatningen uden for intervallet, ugyldig R med fortsat tvetydighed og blandede kæder. Et uafhængigt review efterprøvede også pendinganalyse og manuel fuldanalyse. Dermed må et pensioneret referat ikke skabe falsk tvetydighed, mens reelt konkurrerende referater fortsat gør det.

Budgeteksemplet er række 1059 → 1119. Begge er fortsat `Dagsorden`; erstatningen dokumenterer ingen gennemført behandling. Den gamle rækkes 23 bilagsreferencer er bevaret, mens den aktuelle kilde har 21. R-noten navngiver de to bilag, som kun findes i det gamle grundlag: »Samlet Høringssvar« og »Indkomne høringssvar efter tidsfrist«. Historikken bevares uden at skjule forskellen i det aktuelle bilagsgrundlag.

## PDF-grænser og driftsprøver i 8.1.9

8.1.9 blev installeret og genlæst i sin helhed kl. 12.23 med SHA-256 `47f6ca1dd51352d2ce950edad398514863f156ae6d46e9e5fbb36c178a2455d6`. Den version bestod 240/240 lokale tests og uafhængigt review uden udestående P1/P2-fund. PDF-rettelsen er bevaret i 8.2.0.

MOTAS-sagens årsrapport var en gyldig PDF på 16.393.175 bytes, som den gamle grænse på 15 MiB afviste. Alle fem originale PDF’er blev den 9. september kl. 12.16 hentet i Apps Script og matchede deres lokale SHA-256-værdier. Googles `countTokens` accepterede hele pakken med HTTP 200: 16.891.023 PDF-bytes, 22.528.508 bytes i anmodningen og 25.102 tokens. Denne prøve brugte ikke `generateContent` og beviser derfor hverken analyse eller faktuel skrivekvalitet.

Siden 8.1.9 tillades 30 MiB pr. PDF og samlet som dekodet input. Alle Gemini-kald kontrollerer den færdige JSON-anmodnings præcise UTF-8-størrelse efter tilføjelse af systeminstruktion; grænsen er 45 MiB. For store requests stoppes før netværk uden model-fallback. MIME- og signaturkrav bevares med særskilte fejl. ZIP- og mailgrænser er uændrede. Tests omfatter den konkrete femfilsstørrelse, alle bilags bevarelse, forkert type/signatur, padding, Unicode, systeminstruktion og nul netværkskald ved afvisning.

Grænserne blev kontrolleret mod [Apps Scripts 50 MB POST-grænse](https://developers.google.com/apps-script/guides/services/quotas) og [Gemini-dokumentationen for inline-input](https://ai.google.dev/gemini-api/docs/generate-content/file-input-methods) ved 8.1.9-leverancen den 9. september. [PDF-dokumentationen](https://ai.google.dev/gemini-api/docs/generate-content/document-processing) og den faktiske tokenprøve blev kontrolleret særskilt. Større sager afvises fortsat synligt.

Den faktiske MOTAS-analyse kl. 12.37–12.38 nåede modelkaldet, men alle tre produktionsmodeller gav HTTP 429/RESOURCE_EXHAUSTED. Kørslen sluttede uden arkændringer; analysen afventer fortsat. Tokenoptællingens HTTP 200 må derfor ikke fremstilles som en gennemført analyse.

Den tidligere arkdiagnose kl. 11.48 viste 1.185 datarækker, 147 historiske dagsordener og 432 aktive manglende/ugyldige analyser, heraf 108 i nyhedsvinduet. Det er sammenligningsgrundlaget for 8.2.0-opdateringen, ikke den aktuelle optælling.

## Tidligere driftsprøver 9. september 2026

- Apps Script fik `8.1.8-validation` installeret 9. september kl. 11.16; hele hovedfilen blev genlæst og matchede den daværende leverance efter normalisering af linjeskift: SHA-256 `00227f9452351649d2337a86a4ed212347e6e5b8413255f10a98eeb5e5edd36f`. 217/217 lokale tests bestod, og Paulis sidste review af denne leverance havde ingen udestående P1/P2-fund. Regneark, hovedfil, to hjælpefiler og manifest blev sikkerhedskopieret; den private rapportmappe og projektets skjulte manifestvisning var tidligere kontrolleret.
- Indsamlingen gemte 109 nye/ændrede punkter. De første reparationskørsler gennemførte i alt 8 analyser. En ekstra kørsel 9. september kl. 08.17–08.19 gennemførte rækken om klassetildeling på Gelsted Skole; dermed var i alt 9 analyser repareret på det tidspunkt. XLSX-sammenligningen før/efter den kørsel viste kun ændringer i J-O på række 1182 (tom score til 4). 851 kildelinks blev rettet i kolonne G; kontrollen fandt ingen andre celleændringer fra selve linkreparationen.
- Status kl. 10.00: Arket havde 1.185 datarækker. 147 historiske dagsordensrækker var erstattet af entydigt matchede referater i udvælgelsen og bevaret i arket. Det udelukkede 68 historiske manglende analyser; det var ikke 68 reparationer. Der var efter Gelsted-reparationen fortsat 437 aktive rækker uden gyldig analyse. 8.1.5-prøvekladden blev dannet før denne reparation og viste 114 manglende af 124 rækker i sin periode.
- 8.1.4 bestod modelprøven via Gemini 3.5 efter HTTP 429 på 3.7 og 3.6. Kladden beskrev spildevandssagens videre behandling korrekt, men faktatjekket med alle PDFer blev afbrudt efter seks minutter. Den uverificerede kladde og kildehenvisninger blev bevaret.
- Ingen emails er sendt. Den 9. september kl. 09.06 blev de tre driftstriggere opdateret. Hver gemt trigger er genåbnet og kontrolleret i Google: daglig indsamling kl. 9–10, daglig analyse kl. 11–12 og lørdagskladde kl. 13–14 (GMT+02 på kontroltidspunktet). Faktatjekkøens engangstrigger blev bevaret.

Den ældre 8.1.5-kø blev afsluttet under 8.1.7 den 9. september kl. 10.37.45: 42/42 PDF-opgaver er registreret præcis én gang som 36 modelvurderinger og seks konkrete fejl. Rapporten viser 11 verificerede, ni uverificerede og nul modsagte tekstpåstande; 14/14 afslutningskontroller består, og ingen mail blev sendt. Det er et teknisk afsluttet forløb med synlige indholdsbegrænsninger, ikke en godkendelse af alle facts.

Den rigtige 8.1.7-prøve blev startet kl. 10.39.48 uden mail. Den viste to P2-fejl: et pronomen over afsnit fik en foreslået høring til at fremstå gennemført, og budgettets førstebehandling den 8. september blev beskrevet som kommende. De konkrete kodeveje er rettet i 8.1.8 og dækket af regressionstests. Ved skriveprøven kl. 11.19 gav Gemini 3.7, 3.6 og 3.5 Flash alle HTTP 429/RESOURCE_EXHAUSTED; der kom ingen tekst. Den observerede gratisgrænse var 20 kald pr. døgn pr. model. En rigtig tekst med 8.1.8 er derfor fortsat udestående.

To kontrollerede, læsende Gemini 3.8-prøver kl. 11.29 og 11.32 gav begge HTTP 503 på grund af overbelastning. Ingen af dem gav en godkendt rigtig 8.1.8-tekst. Modellen er ikke aktiveret i produktion; produktionslisten er fortsat Gemini 3.7 Flash med 3.6 og 3.5 Flash som reserver.

## Genoptageligt faktatjek i 8.1.5

Den afsluttende prøve af 8.1.4 den 9. september kl. 01.15–01.21 blev afbrudt efter præcis seks minutter. Nyhedsbrevet og dækningsadvarslen blev bevaret. Spildevandssagens videre behandling var korrekt beskrevet, men modelkaldet med hele PDF-grundlaget nåede ikke at returnere. En kontrol af tidsbudgettet før UrlFetch kan ikke afbryde et igangværende netværkskald.

8.1.5 opdeler derfor forløbet i vedvarende faser. Originaltekster, tekstkontrol og hvert PDF-bilag behandles i egne afgrænsede trin. En genoptagelsestrigger og et checkpoint oprettes før langsomme kald. Et trin forsøges højst tre gange, og fejl registreres i en separat faktatjekrapport. De ti sager i driftsprøven svarer til 42 PDF-referencer; alle er med i den forberedte kontrolliste. Ved afslutningen kl. 10.37.45 var alle 42 registreret én gang som enten gennemført vurdering (36) eller konkret fejl efter højst tre forsøg (6).

PDF-kontrollen bruger faste påstands-IDer. Ukendte IDer, dubletter og ugyldige svar afvises. Muligt belæg og mulige modsigelser fra PDFer vises særskilt til manuel kontrol og kan ikke i sig selv skabe et grønt faktatjek. De oprindelige tekstcitater kontrolleres fortsat med den eksisterende validator.

Workers ændrer aldrig den oprindelige kladde. Den separate rapport omfatter den tekst, der blev gemt ved kladdedannelsen, og markerer, at senere rettelser ikke er kontrolleret. Rapportens ID og forventede tekst gemmes før dens første skrivning. Genoptagelse læser kun eksisterende rapporter: en fuldt gemt rapport accepteres uden overskrivning, og en tvetydig rapport bevares, mens en ny forsøges. Der er højst tre oprettelsesforsøg. Et stop mellem oprettelse og checkpoint kan efterlade et tomt dokument. Ingen API-nøgler eller login-cookies gemmes i jobfilerne. Valget om ingen notifikation følger opgaven gennem alle senere callbacks.

[Googles kvoter](https://developers.google.com/apps-script/guides/services/quotas) angiver seks minutter pr. kørsel og 90 minutters samlet triggertid pr. døgn for forbrugerkonti. [Engangstriggerens after-metode](https://developers.google.com/apps-script/reference/script/clock-trigger-builder#after(Integer)) angiver en minimumsforsinkelse; den faktiske start kan ligge senere. Opdelingen genoptog samme job i drift trods HTTP 429/503-fejl. Både tekstkontrollen og registreringen af alle PDF-opgaver er nu afsluttet; seks PDF-opgaver endte som eksplicitte fejl.


Den separate testgennemgang af 8.1.5 bestod alle 136 tests (51 unit tests og 85 integrationstests). Den uafhængige kodegennemgang afsluttedes uden udestående P1/P2-fund. Testene afbryder simulerede eksekveringer under modelkald og rapportgemning, kontrollerer faste genforsøgsgrænser, gennemfører køen i nye eksekveringer og bevarer tekst samt billeder/formatering efter afbrydelse. En kladde læses eller ændres aldrig af senere workers. Dette er lokale kontroller med simulerede tjenester. Google-prøven har hentet alle 10 originalkilder og registreret alle 42 PDF-bilag, gennemført tekstkontrollen og genoptaget flere PDF-trin. Den separate slutrapport blev færdiggjort under 8.1.7 kl. 10.37.45; den efterfølgende kontrol er beskrevet nedenfor.


## Modelkapacitet og skrivegrundlag i 8.1.6

Driftsloggen fra kl. 08.17–08.19 viser gentagne kald til de samme kvoteramte modeller for hver analyserække. 8.1.6 genbruger den seneste model med lokalt valideret svar og springer modeller med gentagne HTTP 429/RESOURCE_EXHAUSTED over resten af eksekveringen. Når alle er ramt, stoppes reparationen før hentning eller ændring af de øvrige rækker. Tilstanden nulstilles ved næste eksekvering. Faktatjekworkerens eksplicitte modelvalg og ét kald pr. trin er uændret. Dette øger ikke Googles kvoter og dokumenterer ikke i sig selv, om en konkret kvotefejl gælder pr. minut eller døgn.

Den uafhængige gennemgang af 8.1.5-kladden mod originaltekster og 42 PDFer fandt én forkert beløbsafgrænsning og to udokumenterede statuspåstande: 1,4 mio. kr. årligt gælder både klippekort og 'fremtidens ældreliv'; budgetkilden dokumenterede en indstilling om videresendelse, og Trådværket-kilden dokumenterede en planlagt høring. Den automatiske tekstkontrol havde overset budgettets videresendelsespåstand. Det er en konstateret begrænsning ved modelkontrollen, selv når citatet kan genfindes ordret.

Skriveren får derfor ikke længere de gamle felter tldr, sfAnalysis, amounts og programMatch som fakta. Tidligere facts mærkes udtrykkeligt som uverificeret AI-uddrag, og original snippet har forrang. Løsrevne beløb gentages ikke i en separat nøgletalsblok. Skriveinstruktionen udelader detaljer, som kun findes i gamle AI-uddrag; dette kan reducere bilagsdetaljerne i kladden. Analyse-, skrive- og kontrolprompts kræver fuld beløbsafgrænsning og skelnen mellem indstilling, beslutning og gennemførelse. Faktatjekket skal også kontrollere bisætninger og hver del af sammensatte påstande. Promptændringerne er risikoreduktion, ikke et bevis for fejlfri semantik. Den eksisterende, snævre kontrol af udvalgets endelige vedtagelse bevares.


8.1.6 består 152/152 lokale tests. 16 nye regressioner dækker genbrug/cooldown, nulstilling på tværs af eksekveringer, bevarelse af ventende rækker, uændret eksplicit modelvalg samt udeladelse af de konstateret fejlbehæftede AI-felter fra skriveinputtet. De nye scenarier blev også kørt mod 5a8e96f for at bekræfte regressionerne. Uafhængigt review af modelgenbrug og kildekontekst fandt ingen udestående P1/P2-fejl. Faktuel efterlevelse i et rigtigt modelsvar er endnu ikke bevist af disse tests.


8.1.6-prøven kl. 08.43–08.44 viste kvotestoppet i drift: alle tre modeller gav gentagne 429-fejl, hvorefter reparationen standsede med 437 ventende rækker. Den kørsel reparerede ingen yderligere analyser. Den tidligere vellykkede reparation af Gelsted Skole er dokumenteret særskilt; den må ikke tilskrives denne prøve.

En særskilt, midlertidig prøve undersøgte Gemini 3.5 Flash-Lite, fordi kontoens kvotevisning viste højere gratis kapacitet. Fire læsende kald mod samme offentlige budgetbilag bestod JSON-valideringen, men bevarede ikke stabilt alle afgrænsninger og forbehold. Modellen er derfor ikke aktiveret i robotten, og prøvefilen er fjernet igen. De tre produktionsmodeller er uændrede. Dette er en afgrænset kvalitetskontrol, ikke en generel modelbenchmark. En tilsyneladende årsfejl, 2027–2023, blev også bekræftet visuelt i selve kommunens PDF; det rigtige slutår er ikke gættet.


## Statuskontrol og planlagte genforsøg i 8.1.7

En direkte 8.1.6-skriveprøve den 9. september kl. 09.28–09.32 brugte samme ti kilder som den eksisterende kladde. Den skabte ingen ny Googlekladde eller faktatjekkø og sendte ingen mail. Det tidligere forkert afgrænsede klippekortbeløb blev udeladt, men to statusoverdrivelser bestod: Økonomiudvalget blev beskrevet som havende gennemført førstebehandlingen, og Skoleudvalget som havende sendt Trådværket-forslaget i høring. En dramatisk beskrivelse af Lillebælts aktuelle tilstand var desuden ikke dokumenteret af kilderne. Andre efterprøvede tal stemte med originalmaterialet. Prøvefilen blev fjernet; hovedkoden blev genlæst identisk med 8.1.6.

8.1.7 udtrækker den faktiske beslutningstekst og afviser de reproducerede formuleringer om gennemført behandling/videresendelse fra en dagsorden uden beslutning og om udsendt høring fra en sag, der kun er taget til efterretning. Dette er en snæver kontrol af konkrete fejltyper, ikke en generel semantisk garanti. Forbehold, historiske beslutninger om andre handlinger og dokumenterede beslutninger bevares. Også genoptagede jobs får kontrollen i slutrapporten; den bindes til påstandens eget kildeindeks og den genhentede tekst. Rapportens oprindelige jobresultater ændres ikke. En yderligere skriveinstruktion adskiller følelser og værdier fra faktapåstande om en aktuel miljøtilstand.

En uafhængig lokal reproduktion viste, at planlagte basiskørsler mistedes, hvis en factworker holdt scriptlåsen: ét sekunds låseforsøg og derefter return uden genforsøg. 8.1.7 lader kun faktiske timer-events planlægge deres egen retry tidligst efter syv minutter. Tre kendte handlers og UID i UserProperties for samme trigger-ejer forhindrer gamle events i at arbejde igen. Oprettelse sker før gammelt genforsøg fjernes; den korte brugerlås serialiserer UID/triggerovergangen og frigives før driftsarbejdet. Indsamlingen holder én scriptlås om begge interne kilder. Basistriggere og faktatjekkø bevares.

Manuelle prøver uden event bliver ikke genstartet, og et mailfravalg tabes derfor ikke til en senere timer. Allerede påbegyndt arbejde gentages ikke efter exception eller hård afbrydelse. Hvis Google nægter både triggeroprettelse og registrering, kan et allerede forbrugt event ikke garanteres genoprettet; fejlen kastes synligt. Flere trigger-ejere koordineres ikke af denne løsning.

De 190 lokale tests omfatter 26 nye timerprøver og 12 statusprøver. Fem af de første otte statusprøver fejlede mod den faktiske 8.1.6-backup; de andre tre beskyttede gyldige formuleringer. Review fandt tre tilfælde af for streng kontrol (anden kilde/nyere tekst, forbehold og historisk vedtagelse), som blev rettet og dækket af yderligere prøver. Den samlede 8.1.7-kode bestod dengang uafhængigt review uden udestående P1/P2-fund og blev installeret kl. 10.02 samt genlæst i sin helhed. Den efterfølgende rigtige skriveprøve fandt yderligere kontekst- og datofejl; rettelserne og den fortsat udestående 8.1.8-skriveprøve er beskrevet nedenfor.

Den friske XLSX-eksport kl. 09.19 indeholder præcis de samme celler, formler og cachede værdier som før 8.1.6-installationen: 0 ændrede celler, 1.185 datarækker og 437 aktive mangler. Af dem ligger 113 i det aktuelle nyhedsvindue. Samtlige ZIP-delindhold er byteidentiske; forskellig XLSX-hash skyldes containerens metadata.


To supplerende integrationstests bringer totalen til 192. De gennemfører den rigtige kladde-/job-/rapportstyring med simulerede tjenester gennem nye eksekveringer: en tidsstyret retry giver præcis én kladde og én notifikation trods forsinkede dubletter; en manuel prøve uden mail annullerer sit gamle genforsøg og forbliver uden mail gennem alle workers. De supplerer de fokuserede låsetests med hele forløbet. Ingen rigtige emails sendes af testene.

Den planlagte `dailyIngest` kørte automatisk den 9. september kl. 09.52.29–09.53.59 under 8.1.6, før 8.1.7-installationen. Loggen viser begge indsamlingstrin og 0 nye/ændrede FirstAgenda-kildepunkter. Det er et konkret bevis for den ændrede daglige tidsplan, men ikke en fremprovokeret driftsprøve af det nye genforsøg ved låseafslag.


## Afsluttet faktatjek i drift

Den eksisterende 8.1.5-prøve blev afsluttet med den installerede 8.1.7-kode den 9. september kl. 10.37.45. Jobbet bevarede sit oprindelige ID gennem opdateringerne. Alle 10 originalkilder var hentet; alle 42 PDF-opgaver var dækket præcis én gang af 36 gennemførte modelvurderinger og seks navngivne fejl. Ingen del blev forsøgt mere end tre gange.

Den separate private rapport viser 11 verificerede, ni uverificerede og nul modsagte tekstpåstande samt tydelige advarsler om ufuldstændig kontrol og behov for manuel PDF-gennemgang. Den lokale statuskontrol nedgraderede den tidligere verificerede høringspåstand til uverificeret med en forklaring om den manglende beslutning. Et grønt samlet resultat vises ikke. At 36 PDF-kald er gennemført betyder ikke, at deres fortolkning er verificeret.

Rapportens eksporterede tekst matcher jobbets forventede rapport efter normalisering af mellemrum. Den oprindelige kladde matcher sin første eksport, og dokumentets ændringstid er uændret siden oprettelsen. Alle 14 kontrolpunkter for rapport, dækning, genforsøgsgrænser og bevarelse består. Loggen siger udtrykkeligt, at testens notifikationsmail er slået fra. Det efterfølgende debugkald viser ingen afventende faktatjek, og Google viser kun de tre basistriggere.

Den gamle kladde er bevaret som testbevis og bør ikke udsendes uændret. En budgetbisætning blev ikke udvalgt af den ældre tekstmodel, og et PDF-svar fortolkede det kombinerede klippekortbeløb for snævert. Det sidste står som muligt PDF-belæg til manuel kontrol og opgraderer ikke den uverificerede påstand. Disse begrænsninger er ikke skjult af den teknisk gennemførte kø; den nye skriver skal efterprøves selvstændigt.

## Kontekst, mødedato og heltekstkontrol i 8.1.8

Den rigtige 8.1.7-kladde viste, at samme-afsnitskontrollen ikke var tilstrækkelig. Høringspåstanden brugte et pronomen i et senere afsnit, og en dagsorden med passeret mødedato blev omtalt som en kommende førstebehandling. 8.1.8 tilføjer afgrænsede kontroller af netop disse fejltyper:

- Korte henvisninger som »Forslaget«, »Sagen« og »Det« bindes til seneste nære, entydige emne på tværs af almindelige linjeskift. Alle historier bruges til at opdage emneskift, også sager med godkendte beslutninger. Overskrifter, anden/flertydig sag og afstand ud over tre efterfølgende sætninger eller 800 tegn afbryder bindingen. Rene aktør-/udvalgsord og generelle procesord er ikke selvstændige sagsidentiteter.
- Rapportens eksplicitte kildeindeks kontrollerer også pronomenpåstande uden emnenavn eller afsluttende punktum. Hver historie bruger sin egen genhentede tekst; en frisk, godkendende beslutning kan derfor ændre vurderingen. Originaljob, gemt kladde og oprindeligt modelresultat omskrives ikke.
- Den gemte nyhedsbrevstekst gennemgås desuden for de samme afgrænsede statusfejl, også når modellen udelod en bisætning fra sine claims. Et fund tilføjer en tydelig rapportnote, ikke nye modelpåstande eller en påstand om fuld dækning.
- Den oprindelige mødedato indgår i skrivegrundlaget. En passeret dagsorden dokumenterer hverken afholdelse eller udsættelse. Den reproducerede formulering om en kommende behandling afvises, når organ og behandlingstrin svarer til den passerede dato; andre organer, senere trin og tydelige forbehold må ikke afvises alene af den grund. Fakta og kildestatus har forrang for toneeksempler.

217/217 tests bestod på den endelige 8.1.8-kilde, og det daværende afsluttende uafhængige review havde ingen udestående P1/P2-fund. Kontekstprøver omfatter de 11 faktiske historiers emner og beslutningsuddrag, den korte påstand uden punktum, emneskift, afstandsgrænser, kildebinding og uændrede jobdata. Datoprøver dækker fortid/fremtid, organ, behandlingstrin og forbehold. Alle model-/servicereaktioner i testene er simulerede; de beviser kodeadfærd, ikke at et nyt rigtigt modelsvar vil være fejlfrit.

Skriveprøven kl. 11.19 gav ingen tekst på grund af kvotefejl. Afslutningen af den ældre 8.1.5-kø må derfor ikke bruges som bevis for en gennemført redaktionel accept af 8.1.8. Modeller kan fortsat overse påstande og fejlfortolke PDF-belæg; de sproglige guards er mønsterkontroller med begrænset rækkevidde.

## GitHub-status 9. september 2026

**Publicering:** Denne 8.2.1-leverance tilføjer den afgrænsede tekstudvidelse og 19 tests oven på 8.2.0. Senest verificerede CI før leverancen bestod for [8.2.0-commit 2e58d10](https://github.com/Mweimar2000/maja-sf.dk/commit/2e58d103209b501f9e852d6f3cf2a2c62c87bf9d). CI skal kontrolleres for den konkrete nye commit efter publicering på reparationsgrenen; 315 lokale tests er ikke et CI-resultat. `main` stod ved seneste kontrol på 8.1.8/f8596 og afventer udtrykkelig godkendelse efter afvisning fra den automatiske godkendelseskontrol. Et GitHub-merge installerer ikke i sig selv kode i Apps Script.

[8.2.0-CI bestod](https://github.com/Mweimar2000/maja-sf.dk/actions/runs/34345453720) på reparationsgrenen, og alle fem publicerede filer blev bytekontrolleret mod det lokale checkout. Denne kørsel gælder 8.2.0. Se [GitHub Actions](https://github.com/Mweimar2000/maja-sf.dk/actions/workflows/robot-tests.yml) for den konkrete senere commits resultat.

**Historik for 8.1.8:** Koden blev installeret og flettet på main, og de angivne GitHub Actions-kørsler bestod. Den [testede leverance](https://github.com/Mweimar2000/maja-sf.dk/commit/67771cddf083b3b6ee3afb3bcba7d0a60f13ac18) blev flettet med en [normal mergecommit](https://github.com/Mweimar2000/maja-sf.dk/commit/db0499f07b51b2c43ad6293275b14c27a1c59139), der bevarer begge forældres historik. Begge forældre og hele træet er genlæst og verificeret. Ingen øvrige main-filer gik tabt. Opdateringen brugte ikke force-push. GitHub Actions består på både [reparationsgrenen](https://github.com/Mweimar2000/maja-sf.dk/actions/runs/34335756175) og [mergecommitten på main](https://github.com/Mweimar2000/maja-sf.dk/actions/runs/34335989826). Livefilen i Apps Script er genlæst i sin helhed efter fjernelse af den midlertidige skriveprøve og matcher SHA-256 `00227f9452351649d2337a86a4ed212347e6e5b8413255f10a98eeb5e5edd36f`. Stilguiden er med i samme leverance. Repositoryets Pull requests-funktion var slået fra ved kontrollen, og PR #5 gav derfor 404; publiceringen ændrede ikke denne indstilling. Den bekræftede kodepublicering og installation gør ikke den blokerede rigtige skriveprøve til et bestået resultat; begrænsningerne ovenfor gælder fortsat.
