# SF Middelfarts nyhedsbrevsrobot

Google Apps Script, der indsamler kommunale dagsordener og referater samt mails, analyserer kilder med Gemini og gemmer et ugentligt nyhedsbrev som kladde med automatisk faktatjek.

- [Kode](sf-middelfart-robot-v8.gs)
- [Installation og driftskontrol](docs/INSTALLATION.md)
- [Tests, bevisgrundlag og begrænsninger](docs/VERIFIKATION.md)
- [Stilguide](stilguide.md)

**Version `8.2.2-validation` retter fejlagtig afvisning af nyhedsbreve og giver reservemodellen konkret feedback om en afvist tekst.** Kontrollen skelner nu mellem et sagsnavn og organets navn: »Byrådet« i titlen på et forslag må ikke få en dokumenteret beslutning om en anden sag afvist. En reel overdrivelse af et forslag til en beslutning afvises fortsat. Fejlmailen skelner mellem indholdsafvisning og API-fejl.

Versionen bygger på 8.2.1 og bevarer rettelserne til store PDF'er, erstattede kilder og afkortede kildetekster. Installation og en rigtig skriveprøve med 8.2.2 skal stadig gennemføres i det eksisterende Apps Script-projekt. Et GitHub-merge installerer ikke koden dér.

Hvis en planlagt skrivning rammer en midlertidig netværks-/API-fejl, kan den prøves igen senere med samme ugeperiode. Der er højst tre skrivekørsler inden for 48 timer. Manuel test uden mail opretter ingen sådan baggrundskørsel. Forkerte adgangsoplysninger, ugyldigt modelindhold og fejl efter dokumentoprettelse genstarter ikke skrivningen automatisk. Se [installation og driftskontrol](docs/INSTALLATION.md) for opdatering af den eksisterende robot.

Robotten skelner mellem manglende analyse og lav relevans. Kildeændringer nulstiller gammel analyse, PDF'er genhentes ved reparation, og et tomt modelsvar kan ikke give grønt faktatjek. Kolonne P-Q holder styr på kildeændringer. I 8.2.0 registrerer kolonne R, `Erstattet af kilde-ID`, dokumenterede erstatninger med samme kildetype. Historiske rækker og deres bilagsreferencer bevares, mens gyldige erstatninger bruges i udvælgelse og analyse. Et ufuldstændigt FirstAgenda-katalog eller et tvetydigt match giver ingen ny R-markering.

Indsamling og analyse kører separat. `dailyIngest` gemmer kilder, `dailyRepairAnalyses` analyserer de nyeste ventende sager først, og `generateWeeklyDraft` gemmer kladden med dækningsstatus. `testGenerateNewsletterWithoutEmail` opretter en testkladde uden notifikationsmail, også i de efterfølgende faktatjekkørsler.

Faktatjekket fortsætter via `processPendingFactCheck` i egne kørsler: først originale tekster, derefter ét PDF-bilag ad gangen. Køen gemmer et checkpoint før langsomme kald. Resultatet gemmes i en separat privat rapport med den kontrollerede tekst og et link til kladden. Arbejdet ændrer aldrig den allerede gemte kladde; senere rettelser i nyhedsbrevet indgår ikke i kontrollen.

Analysereparationen genbruger en model, som allerede har leveret et gyldigt svar i samme kørsel. Modeller med gentagne kvotefejl springes over resten af kørslen. Alle modeller prøves igen ved næste eksekvering; ventende rækker bevares.

Skrivegrundlaget adskiller original kildetekst fra tidligere AI-uddrag. Politiske analysefelter og løsrevne beløbsfelter sendes ikke til skriveren som fakta. Tal, der kun findes i gamle AI-uddrag, udelades; det kan give færre detaljer fra PDF-bilag. En afgrænset statuskontrol afviser de reproducerede overdrivelser fra dagsorden/indstilling til gennemført behandling eller udsendt høring. Siden 8.1.8 følger korte, entydige henvisninger som »forslaget« emnet over afsnit, og en passeret mødedato må ikke fremstilles som samme kommende behandling. Slutrapporten bruger påstandens egen, genhentede beslutningstekst og kontrollerer også den gemte heltekst for disse fejltyper, selv hvis modellen udelod en påstand. Dette giver ikke fuld påstandsdækning; kladden og bilagskontrollen kræver fortsat redaktionel gennemgang.

Hvis en tidsstyret basiskørsel møder en optaget robotlås, gemmes et genforsøg tidligst syv minutter senere. Tre dedikerede retryhandlers bevarer deres UID hos trigger-ejeren og afviser gamle dubletter. Manuelle kald uden timer-event genstartes ikke automatisk. En vellykket basiskørsel rydder kun sit eget genforsøg.

Kør `npm test` med Node 22 eller nyere. Ingen afhængigheder skal installeres; tests bruger simulerede Google-tjenester og sender ingen emails.

I 8.2.1 kan en gammel kildetekst på præcis 8.000 tegn udvides til højst 45.000 tegn, når det gemte, ikke-tomme kildefingeraftryk er identisk med den friske fulde kilde, og hele det gamle uddrag er et ordret præfiks. Kun H ændres; kildedato, analyse, fingerprint og kilde-ID bevares. En rigtig kildeændring nulstiller fortsat analysen. Udvidelse tælles særskilt og er hverken ny offentliggørelse eller analysereparation.

De detaljerede målinger fra 9. september er historiske og findes i [verifikationshistorikken](docs/VERIFIKATION.md#driftsstatus-9-september-2026). De dokumenterer ikke den aktuelle modelkapacitet eller installation af 8.2.2.

PDF-grænserne fra 8.1.9 gælder fortsat: 30 MiB pr. fil og samlet som dekodet input; hele JSON-anmodningen må højst være 45 MiB UTF-8 inklusive tekst, svarskema og systeminstruktion. Overskridelse stoppes før netværkskald og forsøges ikke hos flere modeller. ZIP- og mailgrænser er uændrede. Den 9. september kl. 12.16 accepterede Googles `countTokens` alle fem MOTAS-PDF’er med HTTP 200: 16.891.023 PDF-bytes, 22.528.508 bytes i hele anmodningen og 25.102 tokens. Den efterfølgende faktiske analyse fik dengang HTTP 429; tokenoptællingen beviser indlæsning, ikke analyse- eller skrivekvalitet.

**GitHub og drift:** Testworkflowet kører på `main`, `codex/**` og pull requests. Beståede tests bruger simulerede Google-tjenester; de beviser ikke, at Gemini er tilgængelig, eller at den nye kode er installeret i Apps Script. Produktionsmodellerne er uændrede.
