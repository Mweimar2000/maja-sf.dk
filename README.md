# SF Middelfarts nyhedsbrevsrobot

Google Apps Script, der indsamler kommunale dagsordener og referater samt mails, analyserer kilder med Gemini og gemmer et ugentligt nyhedsbrev som kladde med automatisk faktatjek.

- [Kode](sf-middelfart-robot-v8.gs)
- [Installation og driftskontrol](docs/INSTALLATION.md)
- [Tests, bevisgrundlag og begrænsninger](docs/VERIFIKATION.md)
- [Stilguide](stilguide.md)

Version `8.1.7-validation` skelner mellem manglende analyse og lav relevans. Kildeændringer nulstiller gammel analyse, PDF'er genhentes ved reparation, og et tomt modelsvar kan ikke give grønt faktatjek. Regnearkets nye kolonner P-Q holder styr på kildeændringer.

Indsamling og analyse kører separat. `dailyIngest` gemmer kilder, `dailyRepairAnalyses` analyserer de nyeste ventende sager først, og `generateWeeklyDraft` gemmer kladden med dækningsstatus. `testGenerateNewsletterWithoutEmail` opretter en testkladde uden notifikationsmail, også i de efterfølgende faktatjekkørsler.

Faktatjekket fortsætter via `processPendingFactCheck` i egne kørsler: først originale tekster, derefter ét PDF-bilag ad gangen. Køen gemmer et checkpoint før langsomme kald. Resultatet gemmes i en separat privat rapport med den kontrollerede tekst og et link til kladden. Arbejdet ændrer aldrig den allerede gemte kladde; senere rettelser i nyhedsbrevet indgår ikke i kontrollen.

Analysereparationen genbruger en model, som allerede har leveret et gyldigt svar i samme kørsel. Modeller med gentagne kvotefejl springes over resten af kørslen. Alle modeller prøves igen ved næste eksekvering; ventende rækker bevares.

Skrivegrundlaget adskiller original kildetekst fra tidligere AI-uddrag. Politiske analysefelter og løsrevne beløbsfelter sendes ikke til skriveren som fakta. Tal, der kun findes i gamle AI-uddrag, udelades; det kan give færre detaljer fra PDF-bilag. En afgrænset statuskontrol afviser de reproducerede overdrivelser fra dagsorden/indstilling til gennemført behandling eller udsendt høring. Slutrapporten bruger påstandens egen, genhentede beslutningstekst. Kladden og bilagskontrollen kræver fortsat redaktionel gennemgang.

Hvis en tidsstyret basiskørsel møder en optaget robotlås, gemmes et genforsøg tidligst syv minutter senere. Tre dedikerede retryhandlers bevarer deres UID hos trigger-ejeren og afviser gamle dubletter. Manuelle kald uden timer-event genstartes ikke automatisk. En vellykket basiskørsel rydder kun sit eget genforsøg.

Kør `npm test` med Node 22 eller nyere. Ingen afhængigheder skal installeres; tests bruger simulerede Google-tjenester og sender ingen emails.

Et GitHub-merge installerer ikke koden i Apps Script. Den kørende version og den faktiske reparation skal kontrolleres efter installation.
