# SF Middelfarts nyhedsbrevsrobot

Google Apps Script, der indsamler kommunale dagsordener og referater samt mails, analyserer kilder med Gemini og gemmer et ugentligt nyhedsbrev som kladde med automatisk faktatjek.

- [Kode](sf-middelfart-robot-v8.gs)
- [Installation og driftskontrol](docs/INSTALLATION.md)
- [Tests, bevisgrundlag og begrænsninger](docs/VERIFIKATION.md)
- [Stilguide](stilguide.md)

**Status 9. september 2026 kl. 13.10.30: `8.2.0-validation` er installeret i Apps Script, og 296/296 lokale tests består.** Den fuldt genlæste kilde matcher SHA-256 `575af82b18e94948b673e4a66244ffae870b00e3432ca6fafba43387d49bdf07` efter normalisering af linjeskift. En ny rigtig nyhedsbrevstekst med statusrettelserne mangler fortsat redaktionel accept efter kvoter og overbelastning.

Robotten skelner mellem manglende analyse og lav relevans. Kildeændringer nulstiller gammel analyse, PDF'er genhentes ved reparation, og et tomt modelsvar kan ikke give grønt faktatjek. Kolonne P-Q holder styr på kildeændringer. I 8.2.0 registrerer kolonne R, `Erstattet af kilde-ID`, dokumenterede erstatninger med samme kildetype. Historiske rækker og deres bilagsreferencer bevares, mens gyldige erstatninger bruges i udvælgelse og analyse. Et ufuldstændigt FirstAgenda-katalog eller et tvetydigt match giver ingen ny R-markering.

Indsamling og analyse kører separat. `dailyIngest` gemmer kilder, `dailyRepairAnalyses` analyserer de nyeste ventende sager først, og `generateWeeklyDraft` gemmer kladden med dækningsstatus. `testGenerateNewsletterWithoutEmail` opretter en testkladde uden notifikationsmail, også i de efterfølgende faktatjekkørsler.

Faktatjekket fortsætter via `processPendingFactCheck` i egne kørsler: først originale tekster, derefter ét PDF-bilag ad gangen. Køen gemmer et checkpoint før langsomme kald. Resultatet gemmes i en separat privat rapport med den kontrollerede tekst og et link til kladden. Arbejdet ændrer aldrig den allerede gemte kladde; senere rettelser i nyhedsbrevet indgår ikke i kontrollen.

Analysereparationen genbruger en model, som allerede har leveret et gyldigt svar i samme kørsel. Modeller med gentagne kvotefejl springes over resten af kørslen. Alle modeller prøves igen ved næste eksekvering; ventende rækker bevares.

Skrivegrundlaget adskiller original kildetekst fra tidligere AI-uddrag. Politiske analysefelter og løsrevne beløbsfelter sendes ikke til skriveren som fakta. Tal, der kun findes i gamle AI-uddrag, udelades; det kan give færre detaljer fra PDF-bilag. En afgrænset statuskontrol afviser de reproducerede overdrivelser fra dagsorden/indstilling til gennemført behandling eller udsendt høring. Siden 8.1.8 følger korte, entydige henvisninger som »forslaget« emnet over afsnit, og en passeret mødedato må ikke fremstilles som samme kommende behandling. Slutrapporten bruger påstandens egen, genhentede beslutningstekst og kontrollerer også den gemte heltekst for disse fejltyper, selv hvis modellen udelod en påstand. Dette giver ikke fuld påstandsdækning; kladden og bilagskontrollen kræver fortsat redaktionel gennemgang.

Hvis en tidsstyret basiskørsel møder en optaget robotlås, gemmes et genforsøg tidligst syv minutter senere. Tre dedikerede retryhandlers bevarer deres UID hos trigger-ejeren og afviser gamle dubletter. Manuelle kald uden timer-event genstartes ikke automatisk. En vellykket basiskørsel rydder kun sit eget genforsøg.

Kør `npm test` med Node 22 eller nyere. Ingen afhængigheder skal installeres; tests bruger simulerede Google-tjenester og sender ingen emails.

Indsamlingen kl. 13.03.46–13.04.26 registrerede 39 erstatninger i R og nul nye/ændrede kildepunkter. Før/efter-kontrollen af alle 1.185 datarækker fandt kun ændringer i R: 40 celleværdier inklusive overskriften og 39 noter. Alle værdier, formler og noter i A–Q blev bevaret. Diagnosen kl. 13.10.30 viser 246 historiske rækker udeladt fra udvælgelsen, 939 aktive og 347 ventende analyser; 107 af de ventende ligger i nyhedsvinduets 123 rækker. Faldet fra 432 til 347 skyldes, at 85 historiske mangler nu udelades, og er ikke 85 analysereparationer. Det dokumenterede antal faktiske reparationer er fortsat 14. Uafhængigt review af 8.2.0 afsluttedes uden udestående P1/P2-fund. Se [driftsstatus og begrænsninger](docs/VERIFIKATION.md#driftsstatus-9-september-2026).

PDF-grænserne fra 8.1.9 gælder fortsat: 30 MiB pr. fil og samlet som dekodet input; hele JSON-anmodningen må højst være 45 MiB UTF-8 inklusive tekst, svarskema og systeminstruktion. Overskridelse stoppes før netværkskald og forsøges ikke hos flere modeller. ZIP- og mailgrænser er uændrede. Den 9. september kl. 12.16 accepterede Googles `countTokens` alle fem MOTAS-PDF’er med HTTP 200: 16.891.023 PDF-bytes, 22.528.508 bytes i hele anmodningen og 25.102 tokens. Den efterfølgende faktiske analyse fik HTTP 429 og afventer; tokenoptællingen beviser indlæsning, ikke analyse- eller skrivekvalitet.

**Publicering:** Denne 8.2.0-leverance omfatter kildehistorik i R, 56 nye regressionstests og opdateret driftsdokumentation. CI skal kontrolleres for den konkrete commit efter publicering på reparationsgrenen; de 296 lokale tests er ikke et CI-resultat. Senest verificerede CI før denne leverance bestod for 8.1.9-commit `4fa36e6`. `main` stod ved seneste kontrol på `f8596ade59383c91daedfb62045ce96010dd0fa6` med 8.1.8; opdatering af `main` afventer udtrykkelig godkendelse efter afvisning fra den automatiske godkendelseskontrol. Et GitHub-merge installerer ikke i sig selv kode i Apps Script. Se [publicering og kontrol](docs/VERIFIKATION.md#github-status-9-september-2026).
