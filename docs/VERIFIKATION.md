# Verifikation af nyhedsbrevsrobotten

Målet er, at tekniske fejl forbliver synlige og genforsøges, at originale kilder følger med analysen, og at faktatjek aldrig præsenterer et tomt eller ugyldigt modelsvar som en verificeret kladde.

## Bevisstandard

| Kontrol | Krav | Evidens |
|---|---|---|
| AI-resultater | Ugyldigt skema, manglende felter og afbrudt output giver aldrig en score eller grønt tjek | Isolerede Node-tests med simulerede Google-tjenester |
| Kildebelæg | Optælling beregnes i kode; understøttede/modsagte påstande kræver genfindeligt citat | Test af forkert optælling, opdigtede citater, manglende/afkortede kilder |
| Dækning | Nye/korrigerede kilder bevares; fejlmarkører behandles som manglende analyse | Tests af kildeopdatering, reparation og dokumentbanner |
| Sikkerhed | Kildestrenge udføres ikke som formler; URL-politik gælder også omdirigeringer | Test af formelinput, PDF-links, HTTPS og omdirigeringer |
| Drift | Kørende version, analyseefterslæb og kladde verificeres i Apps Script | 8.1.6 installeret og fuldt genlæst; kvotestop og nye driftstider kontrolleret. Den eksisterende 42-bilagskø fortsætter |

Ingen vægtet modelbedømmelse anvendes: dette er binære korrekthedskrav til kode. Ingen model er valgt som bedre på baggrund af disse tests. Modellerne testes med de samme simulerede API-svar, uden netværk, credentials eller rigtige emails.

## Reproducerbar kontrol

Kør med Node 22 eller nyere:

```sh
npm test
```

Der kræves ingen pakkeinstallation. Testene indlæser hele Apps Script-filen i en isoleret JavaScript-kontekst med simulerede tjenester og deaktiveret dynamisk kodegenerering. Koden kan ikke tilgå Node-moduler, miljøvariabler eller rigtige Google-konti fra testkonteksten.

Den første pakke på 20 kontroller gav 18 fejl mod Claude-versionen `df0b6394ab853e3864dec132913c07224fd9de75`, og alle 20 bestod efter rettelse. Flere tests er siden tilføjet for indsamling og genforsøg. **Seneste lokale kørsel: 190/190 bestået** (Node 24.19.0). `node --test` viser det aktuelle samlede antal.

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

- Apps Script kører `8.1.6-validation`, identisk med kodeleverancen i commit `a048c3a` efter normalisering af linjeskift. SHA-256 for hele hovedfilen er `1768347342dcbabb830b6795ff6bd6eb1341a568adf2ba780d011a25ecbb32c1`. Hele regnearket, hovedfilen, to hjælpefiler og manifestet er sikkerhedskopieret. Den private faktatjekmappe er kontrolleret som kun tilgængelig for ejeren. Den oprindelige skjulte manifestvisning er gendannet og verificeret efter genindlæsning.
- Indsamlingen gemte 109 nye/ændrede punkter. De første reparationskørsler gennemførte i alt 8 analyser. En ekstra kørsel 9. september kl. 08.17–08.19 gennemførte rækken om klassetildeling på Gelsted Skole; i alt 9 analyser er repareret. XLSX-sammenligningen før/efter den sidste kørsel viser kun ændringer i J-O på række 1182 (tom score til 4). 851 kildelinks blev rettet i kolonne G; kontrollen fandt ingen andre celleændringer fra selve linkreparationen.
- Arket har 1.185 datarækker. 147 historiske dagsordensrækker er erstattet af entydigt matchede referater i udvælgelsen og bevaret i arket. Det udelukker 68 historiske manglende analyser; det er ikke 68 reparationer. Der er efter den sidste reparation fortsat 437 aktive rækker uden gyldig analyse. 8.1.5-prøvekladden blev dannet før denne reparation og viser 114 manglende af 124 rækker i sin periode.
- 8.1.4 bestod modelprøven via Gemini 3.5 efter HTTP 429 på 3.7 og 3.6. Kladden beskrev spildevandssagens videre behandling korrekt, men faktatjekket med alle PDFer blev afbrudt efter seks minutter. Den uverificerede kladde og kildehenvisninger blev bevaret.
- Ingen emails er sendt. Den 9. september kl. 09.06 blev de tre driftstriggere opdateret. Hver gemt trigger er genåbnet og kontrolleret i Google: daglig indsamling kl. 9–10, daglig analyse kl. 11–12 og lørdagskladde kl. 13–14 (GMT+02 på kontroltidspunktet). Faktatjekkøens engangstrigger blev bevaret.

Den samlede reparation er endnu ikke afsluttet. Næste trin er at afslutte den igangværende faktatjekkø, kontrollere rapporten og afprøve det ændrede skrivegrundlag på en ny kladde.

## Genoptageligt faktatjek i 8.1.5

Den afsluttende prøve af 8.1.4 den 9. september kl. 01.15–01.21 blev afbrudt efter præcis seks minutter. Nyhedsbrevet og dækningsadvarslen blev bevaret. Spildevandssagens videre behandling var korrekt beskrevet, men modelkaldet med hele PDF-grundlaget nåede ikke at returnere. En kontrol af tidsbudgettet før UrlFetch kan ikke afbryde et igangværende netværkskald.

8.1.5 opdeler derfor forløbet i vedvarende faser. Originaltekster, tekstkontrol og hvert PDF-bilag behandles i egne afgrænsede trin. En genoptagelsestrigger og et checkpoint oprettes før langsomme kald. Et trin forsøges højst tre gange, og fejl registreres i en separat faktatjekrapport. De ti sager i driftsprøven svarer til 42 PDF-referencer; alle er med i den forberedte kontrolliste. Dette er endnu ikke bevis for, at alle 42 er gennemført i drift.

PDF-kontrollen bruger faste påstands-IDer. Ukendte IDer, dubletter og ugyldige svar afvises. Muligt belæg og mulige modsigelser fra PDFer vises særskilt til manuel kontrol og kan ikke i sig selv skabe et grønt faktatjek. De oprindelige tekstcitater kontrolleres fortsat med den eksisterende validator.

Workers ændrer aldrig den oprindelige kladde. Den separate rapport omfatter den tekst, der blev gemt ved kladdedannelsen, og markerer, at senere rettelser ikke er kontrolleret. Rapportens ID og forventede tekst gemmes før dens første skrivning. Genoptagelse læser kun eksisterende rapporter: en fuldt gemt rapport accepteres uden overskrivning, og en tvetydig rapport bevares, mens en ny forsøges. Der er højst tre oprettelsesforsøg. Et stop mellem oprettelse og checkpoint kan efterlade et tomt dokument. Ingen API-nøgler eller login-cookies gemmes i jobfilerne. Valget om ingen notifikation følger opgaven gennem alle senere callbacks.

[Googles kvoter](https://developers.google.com/apps-script/guides/services/quotas) angiver seks minutter pr. kørsel og 90 minutters samlet triggertid pr. døgn for forbrugerkonti. [Engangstriggerens after-metode](https://developers.google.com/apps-script/reference/script/clock-trigger-builder#after(Integer)) angiver en minimumsforsinkelse; den faktiske start kan ligge senere. Den nye opdeling er installeret og genoptager samme job i drift. Tekstkontrollen er gennemført, mens PDF-køen fortsat arbejder under HTTP 429/503-fejl.


Den separate testgennemgang af 8.1.5 bestod alle 136 tests (51 unit tests og 85 integrationstests). Den uafhængige kodegennemgang afsluttedes uden udestående P1/P2-fund. Testene afbryder simulerede eksekveringer under modelkald og rapportgemning, kontrollerer faste genforsøgsgrænser, gennemfører køen i nye eksekveringer og bevarer tekst samt billeder/formatering efter afbrydelse. En kladde læses eller ændres aldrig af senere workers. Dette er lokale kontroller med simulerede tjenester. Google-prøven har hentet alle 10 originalkilder og registreret alle 42 PDF-bilag, gennemført tekstkontrollen og genoptaget flere PDF-trin. Den separate slutrapport er endnu ikke færdig.


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

De 190 lokale tests omfatter 26 nye timerprøver og 12 statusprøver. Fem af de første otte statusprøver fejlede mod den faktiske 8.1.6-backup; de andre tre beskyttede gyldige formuleringer. Review fandt tre tilfælde af for streng kontrol (anden kilde/nyere tekst, forbehold og historisk vedtagelse), som blev rettet og dækket af yderligere prøver. Den samlede 8.1.7-leverance er under afsluttende review og endnu ikke installeret eller semantisk afprøvet med et nyt modelsvar.

Den friske XLSX-eksport kl. 09.19 indeholder præcis de samme celler, formler og cachede værdier som før 8.1.6-installationen: 0 ændrede celler, 1.185 datarækker og 437 aktive mangler. Af dem ligger 113 i det aktuelle nyhedsvindue. Samtlige ZIP-delindhold er byteidentiske; forskellig XLSX-hash skyldes containerens metadata.
