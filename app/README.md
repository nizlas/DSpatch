# DSpatch – körbart skelett

Detta är DSpatchs första produktkod. Den visar ett fönster med appens namn och
de versioner den kör på, och den renderar adapterns förmågor. **Den ansluter
inte till någon agentleverantör.**

Adaptern finns som gränssnitt och en platshållare som kastar. Det är avsiktligt:
delsteg 2 ska belägga att teknikspåret fungerar, delsteg 3 att skelettet går att
paketera och delsteg 4 att agentanslutningen fungerar. Blandas de kan ett fel
inte härledas till rätt orsak.

Dokumentet är skrivet för en utvecklare som inte har skrivit koden och ska räcka
för att hämta repot, installera, köra i utvecklingsläge, bygga och köra den
paketerade artefakten.

## Förutsättningar

- Windows. Linux ingår i målbilden men är oprövat, och inget i denna
  beskrivning är provat där.
- Node 22.12 eller senare, med npm. Provat på Node 24.21.0 med npm 11.19.0.
- Git.
- Internetåtkomst vid första installationen och vid första paketeringen.
  Electrons binär och Electrons distributionsarkiv hämtas då.

Inga konton, nycklar eller miljöhemligheter behövs. Det finns ingen
agentanslutning att autentisera mot ännu.

## Hämta och installera

Klona repot och installera beroenden. All produktkod ligger i `app/`, så det är
därifrån alla kommandon nedan körs.

```powershell
git clone <repots URL>     # se `git remote -v` i en befintlig arbetskopia
cd DSpatch\app
npm install
```

Electron 44 hämtar inte sin binär vid installationen; paketet har ingen
`postinstall`. Nedladdningen sker vid första användningen, alltså under första
`npm run dev`, och tar en stund. Det är väntat och inget fel.

Hittas inte `node` eller `npm` i en redan öppen terminal kan PATH vara
inaktuell. Öppna en ny terminal, eller komplettera för sessionen:

```powershell
$env:PATH = "C:\Program Files\nodejs;$env:APPDATA\npm;$env:PATH"
```

## Kör i utvecklingsläge

```powershell
npm run dev
```

Kommandot kompilerar huvudprocessen och preload med `tsc`, startar Vites
utvecklingsserver för renderaren på port 5273 och öppnar Electron mot den.
Porten är låst med `strictPort`, så är den upptagen avbryts starten i stället
för att tyst flytta sig.

## Bygg och kör den paketerade artefakten

```powershell
npm run clean     # tar bort dist/
npm run package   # bygger allt och paketerar
```

`npm run package` kör `npm run build` och sedan `electron-builder` med
`electron-builder.yml`. Resultatet blir en uppackad körbar katalog:

```
app\release\win-unpacked\DSpatch.exe
```

Starta den direkt genom att dubbelklicka eller:

```powershell
.\release\win-unpacked\DSpatch.exe
```

Artefakten behöver **ingen** utvecklingsserver och inget `npm`. Den laddar
renderaren ur sitt eget `resources\app.asar`. Hela katalogen hör ihop —
`DSpatch.exe` kan inte flyttas ut ur den ensam.

Katalogen är cirka 370 MB, varav det mesta är Electrons runtime. Den är
`.gitignore`-ad och ska inte committas.

### Vad paketeringen inte är

Målet är `dir`, en körbar katalog. Det finns **ingen installerare, ingen
kodsignering och ingen automatisk uppdatering**. Det ligger utanför uppgiften
och ska inte läsas in i artefakten.

### Att `DSpatch.exe` är osignerad

Binären saknar digital signatur (`Get-AuthenticodeSignature` svarar
`NotSigned`). Vad det innebär i praktiken:

- **Bygger du artefakten själv** startar den normalt utan varning. Det är vad
  som observerades här: filen är lokalt skapad och har ingen märkning om att
  den kommit från internet.
- **Kopierar du artefakten från en annan maskin, eller hämtar den som en
  zip**, märker Windows filerna som nedladdade. Då visar SmartScreen dialogen
  *”Windows har skyddat din dator”*, och du måste välja **Mer information** och
  sedan **Kör ändå** för att starta. Utgivaren anges som okänd.
- Antivirusprogram kan dessutom flagga en osignerad Electron-binär. Det är inte
  provat här.

## Startprovet

Sätt `DSPATCH_SMOKE=1` för att starta appen, ladda renderaren, skriva vad som
observerades och avsluta med en exitkod. Provet finns för att ett startat
kommando inte är bevis för ett fönster: det lyckas först när fönstret har visats
**och** renderaren har målat och kvitterat via preload.

```powershell
$env:DSPATCH_SMOKE="1"; npm run dev                      # utvecklingsläge
$env:DSPATCH_SMOKE="1"; npx electron .                   # byggda filer, kräver npm run build
$env:DSPATCH_SMOKE="1"; .\release\win-unpacked\DSpatch.exe   # paketerad artefakt
```

Kom ihåg att rensa variabeln efteråt (`Remove-Item Env:\DSPATCH_SMOKE`), annars
avslutar sig appen direkt nästa gång.

| Exitkod | Betydelse |
| --- | --- |
| 0 | Fönstret visades och renderaren målade. |
| 2 | Renderaren kunde inte laddas. |
| 3 | Villkoren uppfylldes inte inom 30 sekunder. |
| 4 | Renderarprocessen försvann. |

Läs utmatningen med urskillning. `did-finish-load` loggas **även** när Chromium
visar sin egen felsida, så den raden skiljer inte lyckat från misslyckat. De
avgörande raderna är `renderer-ready …` och `startprovet lyckades …`.

Startas `DSpatch.exe` som en Windows-GUI-process syns loggen inte i terminalen
av sig själv. Omdirigera den till fil:

```powershell
$env:DSPATCH_SMOKE="1"
Start-Process .\release\win-unpacked\DSpatch.exe -Wait -PassThru `
  -RedirectStandardOutput smoke.log -RedirectStandardError smoke.err
```

`-PassThru` ger objektet vars `ExitCode` du vill läsa.

## Kommandon

| Kommando | Vad det gör |
| --- | --- |
| `npm run dev` | Utvecklingsläge: Vite-server plus Electron. |
| `npm run build` | Bygger huvudprocess och preload med `tsc`, renderaren med Vite. |
| `npm start` | Startar Electron mot de byggda filerna. Kräver `npm run build` först. |
| `npm run package` | Bygger och paketerar till `release/win-unpacked/`. |
| `npm run typecheck` | Typkontrollerar huvudprocess, preload, renderare och byggverktyg. |
| `npm run clean` | Tar bort `dist/`. |

`npm run clean` rör inte `release/`. Vill du paketera från helt rent läge:

```powershell
npm run clean
Remove-Item -Recurse -Force release
npm run package
```

## Vad fönstret visar

- Rubriken `DSpatch` och en notis om att ingen leverantör är ansluten.
- **Körmiljö:** versioner för Electron, Chromium, Node och V8, plattform,
  appversion, och om renderaren laddades från utvecklingsserver eller byggda
  filer. Det sista fältet är användbart just för att se vilket läge du kör.
- **Adaptern `not-implemented`:** integrationskontraktets sju förmågor — starta
  körning, strömmande svar, avbryta körning, återupptagning, modellval,
  godkännanden, förbrukning och kostnad.

Alla sju står som **stöds inte**. Det är med flit. Platshållaradaptern stöder
ingenting, och det är ett sant besked om just den instansen — inte en
förhandsbedömning av vad en ansluten Cursor-adapter kommer att klara. Värdet
`okänt` finns också och visas aldrig som ett positivt resultat.

## Vad som inte fungerar ännu

- **Ingen agentanslutning.** Inget SDK är installerat, ingen leverantör anropas,
  ingen nätverksanslutning öppnas. Varje adapteroperation kastar
  `AdapterNotImplementedError`.
- Ingen chattvy, ingen inmatning, ingen anslutningsstatus.
- Ingen meny. Electrons standardmeny är borttagen därför att den erbjuder poster
  vi inte byggt.
- Ingen installerare, signering eller automatisk uppdatering.
- Ingen Linuxprovning.

Inget av det ska låtsas finnas innan det gör det.

## Uppbyggnad

```
src/main/            Huvudprocessen. Kompileras av tsc, buntas inte.
src/preload/         Bryggan. Sandlådad, exponerar en enda yta via contextBridge.
src/renderer/        React-gränssnittet. Buntas av Vite.
src/shared/          Kontraktet mellan renderare och huvudprocess. Enbart typer.
src/adapter/         Leverantörsadapterns gränssnitt och platshållaren.
scripts/dev.mjs      Startar utvecklingsserver och Electron.
electron-builder.yml Paketeringskonfigurationen.
dist/                Byggresultat. Ignoreras av git.
release/             Paketeringsresultat. Ignoreras av git.
```

Huvudprocessen buntas medvetet inte. Cursors SDK laddar delar av sig själv lazy,
och en enfilsbunt kan inte följa de laddningarna; dokumentationen beskriver att
en buntad app då faller på första `Agent.create()`. Genom att kompilera till
vanliga moduler som löser `node_modules` normalt undviks problemet.

Renderaren når aldrig Node. Fönstret körs med `contextIsolation`, utan
`nodeIntegration` och i sandlåda, och all kontakt går genom preload.

Artefakten innehåller inga `node_modules`. Renderaren är buntad av Vite, och
huvudprocessen kräver bara `node:path`, `electron` och sina egna byggda filer.
`react` och `react-dom` är därför byggberoenden i praktiken. Det ändras i det
delsteg som lägger till agentanslutningen: dess paket bär körbara filer som
måste packas upp ur asar-arkivet. `electron-builder.yml` har en anteckning om
det.
