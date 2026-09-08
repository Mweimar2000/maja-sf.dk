# Verifikation af nyhedsbrevsrobotten

Målet er, at tekniske fejl forbliver synlige og genforsøges, at originale kilder følger med analysen, og at faktatjek aldrig præsenterer et tomt eller ugyldigt modelsvar som en verificeret kladde.

## Bevisstandard

| Kontrol | Krav | Evidens |
|---|---|---|
| AI-resultater | Ugyldigt skema, manglende felter og afbrudt output giver aldrig en score eller grønt tjek | Isolerede Node-tests med simulerede Google-tjenester |
| Kildebelæg | Optælling beregnes i kode; understøttede/modsagte påstande kræver genfindeligt citat | Test af forkert optælling, opdigtede citater, manglende/afkortede kilder |
| Dækning | Nye/korrigerede kilder bevares; fejlmarkører behandles som manglende analyse | Tests af kildeopdatering, reparation og dokumentbanner |
| Sikkerhed | Kildestrenge udføres ikke som formler; URL-politik gælder også omdirigeringer | Test af formelinput, PDF-links, HTTPS og omdirigeringer |
| Drift | Kørende version, analyseefterslæb og kladde verificeres i Apps Script | Afventer adgang og installation; lokale tests beviser ikke driftsstatus |

Ingen vægtet modelbedømmelse anvendes: dette er binære korrekthedskrav til kode. Ingen model er valgt som bedre på baggrund af disse tests. Modellerne testes med de samme simulerede API-svar, uden netværk, credentials eller rigtige emails.

## Reproducerbar kontrol

Kør med Node 22 eller nyere:

```sh
npm test
```

Der kræves ingen pakkeinstallation. Testene indlæser hele Apps Script-filen i en isoleret JavaScript-kontekst med simulerede tjenester og deaktiveret dynamisk kodegenerering. Koden kan ikke tilgå Node-moduler, miljøvariabler eller rigtige Google-konti fra testkonteksten.

Den første pakke på 20 kontroller gav 18 fejl mod Claude-versionen `df0b6394ab853e3864dec132913c07224fd9de75`, og alle 20 bestod efter rettelse. Flere tests er siden tilføjet for indsamling og genforsøg. **Seneste lokale kørsel: 63/63 bestået** (Node 24.19.0). `node --test` viser det aktuelle samlede antal.

Den separate integrationstest blev skrevet af en subagent og gennemgået ved integration. En planlagt uafhængig gennemgang af hele ændringen blev afbrudt af en forbrugsgrænse. Hovedagenten gennemgik derefter hele diffen og de relevante kaldesteder; der påstås ikke en fuldført uafhængig kodegodkendelse.

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
