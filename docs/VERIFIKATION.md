# Verifikation af nyhedsbrevsrobotten

Målet er, at tekniske fejl forbliver synlige og genforsøges, at originale kilder følger med analysen, og at faktatjek aldrig præsenterer et tomt eller ugyldigt modelsvar som en verificeret kladde.

## Bevisstandard

| Kontrol | Krav | Evidens |
|---|---|---|
| AI-resultater | Ugyldigt skema, manglende felter og afbrudt output giver aldrig en score eller grønt tjek | Isolerede Node-tests med simulerede Google-tjenester |
| Kildebelæg | Optælling beregnes i kode; understøttede/modsagte påstande kræver genfindeligt citat | Test af forkert optælling, opdigtede citater, manglende/afkortede kilder |
| Dækning | Nye/korrigerede kilder bevares; fejlmarkører behandles som manglende analyse | Tests af kildeopdatering, reparation og dokumentbanner |
| Sikkerhed | Kildestrenge udføres ikke som formler; URL-politik gælder også omdirigeringer | Test af formelinput, PDF-links, HTTPS og omdirigeringer |
| Drift | Kørende version, analyseefterslæb og kladde verificeres i Apps Script | 8.1.3 installeret og afprøvet; 8.1.4 afventer installation og afsluttende driftsprøve |

Ingen vægtet modelbedømmelse anvendes: dette er binære korrekthedskrav til kode. Ingen model er valgt som bedre på baggrund af disse tests. Modellerne testes med de samme simulerede API-svar, uden netværk, credentials eller rigtige emails.

## Reproducerbar kontrol

Kør med Node 22 eller nyere:

```sh
npm test
```

Der kræves ingen pakkeinstallation. Testene indlæser hele Apps Script-filen i en isoleret JavaScript-kontekst med simulerede tjenester og deaktiveret dynamisk kodegenerering. Koden kan ikke tilgå Node-moduler, miljøvariabler eller rigtige Google-konti fra testkonteksten.

Den første pakke på 20 kontroller gav 18 fejl mod Claude-versionen `df0b6394ab853e3864dec132913c07224fd9de75`, og alle 20 bestod efter rettelse. Flere tests er siden tilføjet for indsamling og genforsøg. **Seneste lokale kørsel: 82/82 bestået** (Node 24.19.0). `node --test` viser det aktuelle samlede antal.

Den separate integrationstest blev skrevet af en subagent og gennemgået ved integration. En uafhængig gennemgang af alle 11 ændrede filer blev gennemført 8. september 2026. Den fandt to fejl: analysen var planlagt efter lørdagskladden, og historiske emails fik indlæsningsdato som nyhedsdato. Tre nye integrationstests reproducerede fejlene før rettelse. Fra `8.1.2-validation` definerer opsætningen indsamling og analyse før kladden (de eksisterende triggere skal genoprettes), og mails beholder deres faktiske modtagelsesdato i A. En mail, der var højst syv dage gammel ved første indlæsning i P, kan bæres frem til den følgende kladde. Arkivmails bliver ikke aktuelle alene ved import eller reparation, heller ikke med en nyere dato i P. En fjerde regressionstest dækker lørdagsmail efter indsamlingen: den kommer med ugen efter uden at blive gentaget endnu en uge senere. Sene FirstAgenda-offentliggørelser bruger fortsat deres særskilte kildedato.

## Kontrolleret driftsbevis

1. Kontrollér `ROBOT_VERSION` i Apps Script mod leverancen.
2. Kør `debugDiagnoseSheet()` og notér dækningsstatus.
3. Kør indsamling separat fra analyse; kontrollér et sent offentliggjort møde og et opdateret referat.
4. Kør `dailyRepairAnalyses()` og sammenlign antal manglende analyser før/efter. Ved gentagne kilde-/modelfejl anvendes en pause på 15 minutter, stigende til højst et døgn.
5. Generér en kladde og kontrollér banner, originale kildepassager, beslutninger, tal, datoer og eventuelle påstande om SF's konkrete handlinger.

## Kendte grænser

- En model kan overse påstande eller fejlfortolke et korrekt kildecitat. Den automatiske kontrol er ikke en garanti for fuldstændighed eller sandhed.
- PDF'er sendes til både analyse og faktatjek, men denne JavaScript-kontrol kan kun genfinde citater i tekstkilder. PDF-grundlag mærkes derfor som krævende manuel kontrol.
- Store dokumenter og bilag afvises synligt frem for at blive lydløst afkortet. Meget store sager kræver særskilt behandling.
- Referater efterprøves inden for 90 dage, samt ældre møder med en offentliggørelsesdato inden for syv dage. Ændringer uden ajourført offentliggørelsesdato længere tilbage kræver historisk genindlæsning.
- Ved første overgang fra gamle rækker uden kildefingeraftryk sammenlignes den gemte tekst og metadata. Ændringer, der ligger uden for en tidligere afkortet tekst, kan ikke tidsfæstes bagefter.
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

Alle kladder får desuden en deterministisk kildeliste med oprindelige datoer og godkendte offentlige links. Listen indgår både i den første gemning og den afsluttende gemning, også når faktatjekket fejler. En integrationstest dækker netop dette fejlforløb og fravær af mailafsendelse.

Version 8.1.4 henter først alle FirstAgenda-originaltekster og derefter PDFer inden for den resterende tid. Et langsomt bilag kan derfor ikke fortrænge senere beslutningstekster; manglende PDFer er fortsat markeret som ufuldstændigt grundlag. Ved videre behandling i en kilde fjernes det gamle AI-resumé fra skriveinputtet, og den reproducerede formulering om udvalgets endelige vedtagelse afvises lokalt før gemning. Dette er en supplerende kontrol af den konkrete fejltype, ikke en generel garanti for faktuel korrekthed. Fem regressionstests dækker kilderækkefølgen med bevaret tid til modelkald, beslutningskontrollen, adskillelse af forskellige sager fra samme udvalg og fallback før en forkert formulering kan gemmes.

Et kildeindeks, hvis citat ikke kan bekræftes, knyttes ikke længere til den uverificerede påstand i rapporten. Den generelle kildeliste bevares til manuel gennemgang.


## Driftsstatus 9. september 2026

- Apps Script kører `8.1.3-validation`, identisk med commit `8be0162` efter normalisering af linjeskift. Hele regnearket, hovedfilen, to hjælpefiler og manifestet blev sikkerhedskopieret før ændringerne.
- Indsamlingen gemte 109 nye/ændrede punkter. Fire reparationskørsler gennemførte i alt 8 analyser, herunder 2 oprindeligt uanalyserede aktuelle rækker. 851 kildelinks blev rettet i kolonne G; kontrollen fandt ingen andre celleændringer fra selve linkreparationen.
- Arket har 1.185 datarækker. 147 historiske dagsordensrækker er erstattet af entydigt matchede referater i udvælgelsen og er bevaret i arket. Det udelukker 68 historiske manglende analyser; det er ikke 68 reparationer. Der er fortsat 438 aktive rækker uden gyldig analyse, heraf 114 af 124 rækker i prøvekladdens periode.
- Faktatjekket i 8.1.3 gennemførtes, men gav 0 verificerede, 12 uverificerede og 0 modsagte påstande samt advarsel om manglende kildegrundlag. Kladden overdriver stadig et udvalgs godkendelse til endelig vedtagelse. Prøven er derfor ikke afsluttet tilfredsstillende.
- `8.1.4-validation` er lokalt testet. Gennemgangen fandt to randtilfælde i første udkast: for lidt resterende tid til faktatjek og for bred afvisning af beslutninger fra samme udvalg. Begge er rettet og regressionstestet. Den uafhængige efterkontrol blev afbrudt af Codex' forbrugsgrænse; der foreligger ikke en afsluttende godkendelse af denne version.
- Ingen emails er sendt. De eksisterende triggere er fortsat indsamling kl. 12–13, analyse kl. 14–15 og lørdagskladde kl. 13–14. Ændringen til kl. 9, 11 og lørdag 13 afventer den afsluttende driftsprøve.

Næste trin er at afslutte efterkontrollen, installere og genlæse 8.1.4, køre modelprøve og en kladde uden mail, kontrollere beslutningsniveau og kildehenvisninger, opdatere og kontrollere triggere samt gendanne editorens oprindelige visning af manifestet. Den samlede reparation er endnu ikke afsluttet.
