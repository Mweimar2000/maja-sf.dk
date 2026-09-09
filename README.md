# SF Middelfarts nyhedsbrevsrobot

Google Apps Script, der indsamler kommunale dagsordener og referater samt mails, analyserer kilder med Gemini og gemmer et ugentligt nyhedsbrev som kladde med automatisk faktatjek.

- [Kode](sf-middelfart-robot-v8.gs)
- [Installation og driftskontrol](docs/INSTALLATION.md)
- [Tests, bevisgrundlag og begrænsninger](docs/VERIFIKATION.md)
- [Stilguide](stilguide.md)

Version `8.1.9-validation` skelner mellem manglende analyse og lav relevans. Kildeændringer nulstiller gammel analyse, PDF'er genhentes ved reparation, og et tomt modelsvar kan ikke give grønt faktatjek. Regnearkets nye kolonner P-Q holder styr på kildeændringer.

Indsamling og analyse kører separat. `dailyIngest` gemmer kilder, `dailyRepairAnalyses` analyserer de nyeste ventende sager først, og `generateWeeklyDraft` gemmer kladden med dækningsstatus. `testGenerateNewsletterWithoutEmail` opretter en testkladde uden notifikationsmail, også i de efterfølgende faktatjekkørsler.

Faktatjekket fortsætter via `processPendingFactCheck` i egne kørsler: først originale tekster, derefter ét PDF-bilag ad gangen. Køen gemmer et checkpoint før langsomme kald. Resultatet gemmes i en separat privat rapport med den kontrollerede tekst og et link til kladden. Arbejdet ændrer aldrig den allerede gemte kladde; senere rettelser i nyhedsbrevet indgår ikke i kontrollen.

Analysereparationen genbruger en model, som allerede har leveret et gyldigt svar i samme kørsel. Modeller med gentagne kvotefejl springes over resten af kørslen. Alle modeller prøves igen ved næste eksekvering; ventende rækker bevares.

Skrivegrundlaget adskiller original kildetekst fra tidligere AI-uddrag. Politiske analysefelter og løsrevne beløbsfelter sendes ikke til skriveren som fakta. Tal, der kun findes i gamle AI-uddrag, udelades; det kan give færre detaljer fra PDF-bilag. En afgrænset statuskontrol afviser de reproducerede overdrivelser fra dagsorden/indstilling til gennemført behandling eller udsendt høring. I 8.1.8 følger korte, entydige henvisninger som »forslaget« emnet over afsnit, og en passeret mødedato må ikke fremstilles som samme kommende behandling. Slutrapporten bruger påstandens egen, genhentede beslutningstekst og kontrollerer også den gemte heltekst for disse fejltyper, selv hvis modellen udelod en påstand. Dette giver ikke fuld påstandsdækning; kladden og bilagskontrollen kræver fortsat redaktionel gennemgang.

Hvis en tidsstyret basiskørsel møder en optaget robotlås, gemmes et genforsøg tidligst syv minutter senere. Tre dedikerede retryhandlers bevarer deres UID hos trigger-ejeren og afviser gamle dubletter. Manuelle kald uden timer-event genstartes ikke automatisk. En vellykket basiskørsel rydder kun sit eget genforsøg.

Kør `npm test` med Node 22 eller nyere. Ingen afhængigheder skal installeres; tests bruger simulerede Google-tjenester og sender ingen emails.

Den 9. september 2026 er `8.1.9-validation` installeret og genlæst identisk med leverancen. 240/240 lokale tests består, og det uafhængige review af PDF-rettelsen har ingen udestående P1/P2-fund. Alle fem PDF’er i MOTAS-sagen blev accepteret af Googles `countTokens`-API: 16.891.023 PDF-bytes, 22.528.508 bytes i hele anmodningen og HTTP 200. Dette er en teknisk indlæsningsprøve; en ny rigtig nyhedsbrevstekst med statusrettelserne er fortsat udestående efter kvoter og overbelastning. Se [driftsstatus og begrænsninger](docs/VERIFIKATION.md#driftsstatus-9-september-2026).

**Status: 8.1.9 er installeret i Apps Script.** PDF-grænserne er 30 MiB pr. fil og samlet som dekodet input; hele JSON-anmodningen må højst være 45 MiB UTF-8 inklusive tekst, svarskema og systeminstruktion. Overskridelse stoppes før netværkskald og forsøges ikke hos flere modeller. ZIP- og mailgrænser er uændrede. Et GitHub-merge installerer ikke i sig selv kode i Apps Script. Se [publicering og kontrol](docs/VERIFIKATION.md#github-status-9-september-2026).