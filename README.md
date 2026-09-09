# SF Middelfarts nyhedsbrevsrobot

Google Apps Script, der indsamler kommunale dagsordener og referater samt mails, analyserer kilder med Gemini og gemmer et ugentligt nyhedsbrev som kladde med automatisk faktatjek.

- [Kode](sf-middelfart-robot-v8.gs)
- [Installation og driftskontrol](docs/INSTALLATION.md)
- [Tests, bevisgrundlag og begrænsninger](docs/VERIFIKATION.md)
- [Stilguide](stilguide.md)

**Status 9. september 2026 kl. 13.32.44: `8.2.1-validation` er installeret i Apps Script, og 315/315 lokale tests består.** Hele hovedfilen er genlæst og matcher SHA-256 `4709e03b7fc5b018b7431f256fd082d03ee3310f31e05f9f3bd37c14f1515204` efter normalisering af linjeskift. En ny rigtig nyhedsbrevstekst med statusrettelserne kunne endnu ikke produceres og kontrolleres på grund af kvoter og overbelastning.

Robotten skelner mellem manglende analyse og lav relevans. Kildeændringer nulstiller gammel analyse, PDF'er genhentes ved reparation, og et tomt modelsvar kan ikke give grønt faktatjek. Kolonne P-Q holder styr på kildeændringer. I 8.2.0 registrerer kolonne R, `Erstattet af kilde-ID`, dokumenterede erstatninger med samme kildetype. Historiske rækker og deres bilagsreferencer bevares, mens gyldige erstatninger bruges i udvælgelse og analyse. Et ufuldstændigt FirstAgenda-katalog eller et tvetydigt match giver ingen ny R-markering.

Indsamling og analyse kører separat. `dailyIngest` gemmer kilder, `dailyRepairAnalyses` analyserer de nyeste ventende sager først, og `generateWeeklyDraft` gemmer kladden med dækningsstatus. `testGenerateNewsletterWithoutEmail` opretter en testkladde uden notifikationsmail, også i de efterfølgende faktatjekkørsler.

Faktatjekket fortsætter via `processPendingFactCheck` i egne kørsler: først originale tekster, derefter ét PDF-bilag ad gangen. Køen gemmer et checkpoint før langsomme kald. Resultatet gemmes i en separat privat rapport med den kontrollerede tekst og et link til kladden. Arbejdet ændrer aldrig den allerede gemte kladde; senere rettelser i nyhedsbrevet indgår ikke i kontrollen.

Analysereparationen genbruger en model, som allerede har leveret et gyldigt svar i samme kørsel. Modeller med gentagne kvotefejl springes over resten af kørslen. Alle modeller prøves igen ved næste eksekvering; ventende rækker bevares.

Skrivegrundlaget adskiller original kildetekst fra tidligere AI-uddrag. Politiske analysefelter og løsrevne beløbsfelter sendes ikke til skriveren som fakta. Tal, der kun findes i gamle AI-uddrag, udelades; det kan give færre detaljer fra PDF-bilag. En afgrænset statuskontrol afviser de reproducerede overdrivelser fra dagsorden/indstilling til gennemført behandling eller udsendt høring. Siden 8.1.8 følger korte, entydige henvisninger som »forslaget« emnet over afsnit, og en passeret mødedato må ikke fremstilles som samme kommende behandling. Slutrapporten bruger påstandens egen, genhentede beslutningstekst og kontrollerer også den gemte heltekst for disse fejltyper, selv hvis modellen udelod en påstand. Dette giver ikke fuld påstandsdækning; kladden og bilagskontrollen kræver fortsat redaktionel gennemgang.

Hvis en tidsstyret basiskørsel møder en optaget robotlås, gemmes et genforsøg tidligst syv minutter senere. Tre dedikerede retryhandlers bevarer deres UID hos trigger-ejeren og afviser gamle dubletter. Manuelle kald uden timer-event genstartes ikke automatisk. En vellykket basiskørsel rydder kun sit eget genforsøg.

Kør `npm test` med Node 22 eller nyere. Ingen afhængigheder skal installeres; tests bruger simulerede Google-tjenester og sender ingen emails.

I 8.2.1 kan en gammel kildetekst på præcis 8.000 tegn udvides til højst 45.000 tegn, når det gemte, ikke-tomme kildefingeraftryk er identisk med den friske fulde kilde, og hele det gamle uddrag er et ordret præfiks. Kun H ændres; kildedato, analyse, fingerprint og kilde-ID bevares. En rigtig kildeændring nulstiller fortsat analysen. Udvidelse tælles særskilt og er hverken ny offentliggørelse eller analysereparation.

Indsamlingen kl. 13.31.14–13.31.53 udvidede 12 kildeuddrag og registrerede to yderligere erstatninger i R. Sammenligningen af hele arket viser præcis 14 ændrede celleværdier og to nye noter; alle øvrige værdier, formler og noter er bevaret. Arket indeholder fortsat 1.185 datarækker. Diagnosen kl. 13.32.44 viser 211 historiske dagsordener, 41 erstatninger via R og 933 aktive poster: 588 analyserede, fire formalia, 297 med tom og 44 med ugyldig analyse. Der er 341 aktive mangler, heraf 107 i nyhedsvinduets 123 poster. Faldet fra 347 til 341 skyldes historik; det kumulative antal faktiske analysereparationer er fortsat 14. Se [driftsstatus](docs/VERIFIKATION.md#driftsstatus-9-september-2026).

PDF-grænserne fra 8.1.9 gælder fortsat: 30 MiB pr. fil og samlet som dekodet input; hele JSON-anmodningen må højst være 45 MiB UTF-8 inklusive tekst, svarskema og systeminstruktion. Overskridelse stoppes før netværkskald og forsøges ikke hos flere modeller. ZIP- og mailgrænser er uændrede. Den 9. september kl. 12.16 accepterede Googles `countTokens` alle fem MOTAS-PDF’er med HTTP 200: 16.891.023 PDF-bytes, 22.528.508 bytes i hele anmodningen og 25.102 tokens. Den efterfølgende faktiske analyse fik HTTP 429 og afventer; tokenoptællingen beviser indlæsning, ikke analyse- eller skrivekvalitet.

**Publicering:** Denne 8.2.1-leverance tilføjer den afgrænsede tekstudvidelse og 19 tests oven på 8.2.0. Senest verificerede CI før leverancen bestod for [8.2.0-commit 2e58d10](https://github.com/Mweimar2000/maja-sf.dk/commit/2e58d103209b501f9e852d6f3cf2a2c62c87bf9d). CI skal kontrolleres for den konkrete nye commit efter publicering på reparationsgrenen; 315 lokale tests er ikke et CI-resultat. `main` stod ved seneste kontrol på 8.1.8/f8596 og afventer udtrykkelig godkendelse efter afvisning fra den automatiske godkendelseskontrol. Et GitHub-merge installerer ikke i sig selv kode i Apps Script.