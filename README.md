# SF Middelfarts nyhedsbrevsrobot

Google Apps Script, der indsamler kommunale dagsordener og referater samt mails, analyserer kilder med Gemini og gemmer et ugentligt nyhedsbrev som kladde med automatisk faktatjek.

- [Kode](sf-middelfart-robot-v8.gs)
- [Installation og driftskontrol](docs/INSTALLATION.md)
- [Tests, bevisgrundlag og begrænsninger](docs/VERIFIKATION.md)
- [Stilguide](stilguide.md)

Version `8.1.1-validation` skelner mellem manglende analyse og lav relevans. Kildeændringer nulstiller gammel analyse, PDF'er genhentes ved reparation, og et tomt modelsvar kan ikke give grønt faktatjek. Regnearkets nye kolonner P-Q holder styr på kildeændringer.

Indsamling og analyse kører separat. `dailyIngest` gemmer kilder, `dailyRepairAnalyses` analyserer de nyeste ventende sager først, og `generateWeeklyDraft` gemmer kladden med dækningsstatus. `testGenerateNewsletterWithoutEmail` opretter en testkladde uden notifikationsmail.

Kør `npm test` med Node 22 eller nyere. Ingen afhængigheder skal installeres; tests bruger simulerede Google-tjenester og sender ingen emails.

Et GitHub-merge installerer ikke koden i Apps Script. Den kørende version og den faktiske reparation skal kontrolleres efter installation.
