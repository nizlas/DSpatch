---
id: DSP-8
title: Prova uppgiftsstyrt modellval i utvecklingsloopen
status: To Do
assignee: []
created_date: '2026-09-13 11:56'
labels:
  - integration
  - reliability
dependencies:
  - DSP-7
documentation:
  - docs/MODEL_SELECTION.md
  - docs/DEVELOPMENT_LOOP.md
  - docs/loop/CALIBRATION.md
ordinal: 7000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
### Varför och önskat resultat

Niclas vill att utvecklingsloopen väljer modell efter uppgiftens karaktär och komplexitet. Alla fem specialister använder idag model: inherit, så en liten lokal ändring och en svår undersökning normalt får samma modell som huvudchatten. Vi vill kunna använda tillräcklig kapacitet för god kvalitet och bedöma tid och kostnad fram till ett verifierat resultat.

### Omfattning och gränser

Gäller den externa Cursor-loopen som bygger DSpatch. Det konkreta uppdraget, osäkerheten och konsekvensen av ett fel ska styra valet; rollen ska inte ensam avgöra det. Niclas ska kunna låsa modellvalet. Förslaget till beteende och första jämförelse finns i docs/MODEL_SELECTION.md. Exakta modellprofiler och teknisk lösning väljs när uppgiften tas upp utifrån då tillgängliga modeller och faktisk Cursor-funktion.

Cursor dokumenterar modellval i agentdefinitioner. Godtyckligt val per anrop är inte verifierat i vår lokala miljö. Ett faktiskt, spårbart modellbyte krävs för att kalla automatiken fungerande; om stödet saknas ska hindret och ett konkret nästa steg dokumenteras medan ett fast val används.

DSP-7 är baslinjen och får slutföras med oförändrat modellval. DSP-8 prioriteras separat efter kalibreringen och är inte en ny grind för DSP-1 eller för Etapp 0. Behåll den platta samordningen, befintliga mandat och återupptagning. Ingen ny modellväljande specialist, omfattande benchmarkplattform eller produkt-GUI ingår.

### Bedömning

Nytta bedöms från uppnådd kvalitet, tydligheten i modellvalen, omtag, tidsåtgång och tillgänglig förbrukning. Skilj dokumenterade möjligheter från lokalt verifierat beteende och små provresultat från generella modellrankningar.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Cursors faktiska väg för uppgiftsstyrt modellval är dokumenterad och provad på Niclas Windowsmiljö. Minst två olika modell-ID:n har använts i avgränsade specialistuppdrag med oberoende runtime-underlag; enbart begärd modell eller modellens egen identitetsuppgift räcker inte. Saknat styrstöd eller obekräftat utfall redovisas och lämnar automatiken ej klar.
- [ ] #2 Koordinatorns val tar hänsyn till uppdragets karaktär, komplexitet, osäkerhet, felkonsekvens, verktygs-/kontextbehov och givna resursramar. Två olika uppdrag inom samma roll visar att rollnamnet inte ensamt styr valet; enkla och svåra uppdrag samt fast användarval är provade.
- [ ] #3 Modellvalet görs inom tillgänglig och tillåten kapacitet. Fast användarval respekteras. Saknad modell, fallback och obekräftad faktisk modell/effort får ett tydligt utfall enligt det givna mandatet; de visas inte som ett lyckat byte till den begärda modellen.
- [ ] #4 Journal och översikt skiljer begärd modell/effort från faktisk bekräftad modell/effort och anger källa, kort motiv, anropsreferens, resultat, tid och tillgänglig förbrukning. Okända värden markeras som okända och Niclas kan förstå varför valet gjordes.
- [ ] #5 Ett motiverat byte efter otillräckligt resultat, ett verktygsfel/okänt utfall och resume är provade. Byte görs först efter avstämning; tidigare ändringar, kandidat, underlag och befintliga anrops-/omtagsgränser bevaras. Redan utfört arbete dubbelstartas inte.
- [ ] #6 Ett litet jämförbart prov omfattar enkel ändring, osäker uppgift och granskning mot fast modellval som referens. Rapporten redovisar verifierad kvalitet, nödvändiga omtag, tid, tillgänglig kostnad och begränsningar. Körinstruktionerna anger vad som faktiskt införts, hur Niclas väljer fast modell och vilket nästa steg resultaten motiverar.
<!-- AC:END -->
