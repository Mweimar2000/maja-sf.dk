# SF Middelfarts nyhedsbrevsrobot

Google Apps Script, der indsamler kommunale dagsordener og referater samt mails, analyserer kilder med Gemini og gemmer et ugentligt nyhedsbrev som kladde med automatisk faktatjek.

- [Kode](sf-middelfart-robot-v8.gs)
- [Installation og driftskontrol](docs/INSTALLATION.md)
- [Tests, bevisgrundlag og begrænsninger](docs/VERIFIKATION.md)
- [Stilguide](stilguide.md)

Version `8.1.8-validation` skelner mellem manglende analyse og lav relevans. Kildeændringer nulstiller gammel analyse, PDF'er genhentes ved reparation, og et tomt modelsvar kan ikke give grønt faktatjek. Regnearkets nye kolonner P-Q holder styr på kildeændringer.

Indsamling og analyse kører separat. `dailyIngest` gemmer kilder, `dailyRepairAnalyses` analyserer de nyeste ventende sager først, og `generateWeeklyDraft` gemmer kladden med dækningsstatus. `testGenerateNewsletterWithoutEmail` opretter en testkladde uden notifikationsmail, også i de efterfølgende faktatjekkørsler.

Faktatjekket fortsætter via `processPendingFactCheck` i egne kørsler: først originale tekster, derefter ét PDF-bilag ad gangen. Køen gemmer et checkpoint før langsomme kald. Resultatet gemmes i en separat privat rapport med den kontrollerede tekst og et link til kladden. Arbejdet ændrer aldrig den allerede gemte kladde; senere rettelser i nyhedsbrevet indgår ikke i kontrollen.

Analysereparationen genbruger en model, som allerede har leveret et gyldigt svar i samme kørsel. Modeller med gentagne kvotefejl springes over resten af kørslen. Alle modeller prøves igen ved næste eksekvering; ventende rækker bevares.

Skrivegrundlaget adskiller original kildetekst fra tidligere AI-uddrag. Politiske analysefelter og løsrevne beløbsfelter sendes ikke til skriveren som fakta. Tal, der kun findes i gamle AI-uddrag, udelades; det kan give færre detaljer fra PDF-bilag. En afgrænset statuskontrol afviser de reproducerede overdrivelser fra dagsorden/indstilling til gennemført behandling eller udsendt høring. I 8.1.8 følger korte, entydige henvisninger som »forslaget« emnet over afsnit, og en passeret mødedato må ikke fremstilles som samme kommende behandling. Slutrapporten bruger påstandens egen, genhentede beslutningstekst og kontrollerer også den gemte heltekst for disse fejltyper, selv hvis modellen udelod en påstand. Dette giver ikke fuld påstandsdækning; kladden og bilagskontrollen kræver fortsat redaktionel gennemgang.

Hvis en tidsstyret basiskørsel møder en optaget robotlås, gemmes et genforsøg tidligst syv minutter senere. Tre dedikerede retryhandlers bevarer deres UID hos trigger-ejeren og afviser gamle dubletter. Manuelle kald uden timer-event genstartes ikke automatisk. En vellykket basiskørsel rydder kun sit eget genforsøg.

Kør `npm test` med Node 22 eller nyere. Ingen afhængigheder skal installeres; tests bruger simulerede Google-tjenester og sender ingen emails.

Den 9. september 2026 er `8.1.8-validation` installeret og genlæst identisk med leverancen. 217/217 lokale tests består, og det afsluttende uafhængige review har ingen udestående P1/P2-fund. Den ældre 8.1.5-kø er afsluttet uden mail med alle 42 PDF-opgaver registreret som vurdering eller konkret fejl. Der foreligger endnu ingen rigtig 8.1.8-skrivetekst: alle tre produktionsmodeller ramte HTTP 429 ved prøven kl. 11.19. To kontrollerede, læsende Gemini 3.8-prøver kl. 11.29 og 11.32 gav begge HTTP 503 på grund af overbelastning. Produktionsmodellerne er uændrede; prøverne gav ikke en godkendt rigtig tekst. Se den daterede [driftsstatus og begrænsninger](docs/VERIFIKATION.md#driftsstatus-9-september-2026).

**Status: 8.1.8 er installeret og flettet på main; GitHub Actions består.** Koden på main og i Apps Script matcher den samme verificerede SHA-256. Se [publiceringen og testresultatet](docs/VERIFIKATION.md#github-status-9-september-2026). Et GitHub-merge installerer ikke i sig selv koden i Apps Script. Den rigtige skriveprøve er fortsat udestående på grund af kvoter og overbelastning.
