---
id: DSP-1
title: Verify the technology choice and first Cursor connection
status: In Progress
assignee: []
created_date: '2026-09-13'
updated_date: '2026-09-13 21:48'
labels:
  - integration
milestone: m-0
dependencies:
  - DSP-7
documentation:
  - docs/VISION.md
  - BACKLOG.md
ordinal: 1000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
### Purpose and intended result

Niclas uses Cursor at home. His decision on 13 September 2026 makes Cursor on Windows, with TypeScript, React and Electron, the starting point for implementation and testing. The vision includes a consistent workspace on Windows and Linux. The first milestone must also support a bounded code change, a diff and a build or test. This technical spike must therefore establish a path to that whole workflow. Integration information in the vision is input to the experiment, not already verified DSpatch functionality.

### Scope and proposed approach

Start from the selected TypeScript, React and Electron stack in VISION.md section 9.1. Select and verify a Cursor connection using current official documentation and Niclas's actual account and Windows computer. Test a minimal packaged Windows application with the Electron/React view and agent connection working together; a development-server test alone does not establish packaging support. Record versions, rationale, observations, limitations and open questions in a short technical note. Document concrete obstacles if the stack needs reconsideration.

Keep platform-specific parts separate so Linux support can be added incrementally. Aim for consistent layout, typography, icons and workflows; display scaling, text rendering and system dialogs need later Linux testing. Linux packaging and tests are not required in DSP-1 or Phase 0. Record known assumptions and outstanding tests.

VS Code and Copilot remain in the vision, but need not be implemented or run for DSP-1 or Phase 0. Put Cursor-specific calls and session data behind a thin adapter; shared UI logic, project data and build instructions must not depend on Cursor's internal state. Assess the future VS Code/Copilot path from documentation, recording assumptions, obstacles and outstanding tests. This is an architectural assessment, not verified compatibility. Do not build a general adapter framework or a second working integration now.

Use a separate small test repository to exercise startup, streaming, a follow-up, a real text-code change and a relevant build or test. Compare actual files before and after the change, capture command output and exit code, and test cancellation. Commands may run through agent tools or a local process controlled by DSpatch; document the chosen path and its limitations.

Keep credentials outside the repository. Clarify account type, authentication, file and tool access, and the distinction between local execution and remote model requests. Identify the billing path without building a cost dashboard.

### Verification and human involvement

Save commands, versions, the tested revision or content-addressed snapshot, and observations. If the account or target computer is unavailable, state what can still be done and exactly which check needs Niclas. Reading documentation, mocked responses or code displayed only in chat do not satisfy the working-connection and file-change criteria.

### References

[Technology decision in VISION.md, section 9.1](../../docs/VISION.md#91-selected-stack-and-platforms), and sections 9–10 and 12–15.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The selected TypeScript, React and Electron stack and a selected Cursor connection work together in a minimal packaged Windows experiment. Versions, target environment, rationale and limitations are documented. The record describes the path to Linux and VS Code/Copilot and outstanding compatibility tests; those later tests are not required in this task.
- [x] #2 A runnable experiment has received a real streaming response and a relevant follow-up through Niclas's intended Cursor account; commands and provider versions are recorded.
- [ ] #3 Two scenarios are tested and documented through the real connection: actual cancellation, both during streaming and during a running test, and a deliberately induced connection failure. Both record what happened to already changed files, whether anything kept running and whether an active remote request could be stopped. The experiment induces the failure itself; do not wait for a provider outage. A simulated failure without a real connection does not satisfy this criterion.
- [ ] #4 Authentication, file and tool access boundaries, and the billing path are established with sources and dates; uncertain cost information is marked.
- [ ] #5 Another developer can follow the experiment instructions without secrets in the repository; the next step towards the workspace is concrete and bounded.
- [ ] #6 The agent has made a real bounded code change in the test repository, the change has been checked against the files, and a relevant build or test has run with its command, output, exit code and tested code version documented.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
The Backlog Planner prepared this plan, the Reviewer examined it twice, and Niclas approved it on 13 September 2026 during DSP-7. Evidence is in `.dspatch-loop/runs/20260913-114021-4slh/reports/` (001 plan v1, 002 review, 003 plan v2, 004 reconciliation). Investigate the cheapest potentially blocking findings first. Resume an interrupted pass at the correct step below.

### Bounded follow-up on the connection choice

Supplement step 1's evidence before fixing the shared adapter interface. Start from saved reports and experiments; repeat checks only to resolve a concrete uncertainty. The coordinator records this follow-up as the current focus and keeps the existing run and counters when resuming.

- **Cursor and Copilot.** Compare the official TypeScript SDKs against VISION's seven capabilities: start, stream, cancel, resume, model selection, approvals and cost reporting. Record sources, dates, assessed versions and what is documented, observed or unknown. Explain consequences for shared operations, events and storage, including pending approvals and provider-specific session IDs. Distinguish Copilot as an agent provider from integration with an existing VS Code chat and its extension tools. A second working integration or VS Code test is outside scope.
- **Conclusions and evidence.** Distinguish successful SDK loading and contact with an authentication endpoint from a tested packaged end-to-end workflow. Limit network-probe conclusions to observed access. Check package provenance against official installation instructions; for the reported naming confusion, establish from available command logs whether the third-party package was only inspected or also installed. Investigate the reported local `blobEncryptionKey` without copying its value into a report or repository.
- **Review.** The Reviewer assesses the supplementary evidence and whether the Cursor path remains justified without excluding Copilot. The coordinator saves the conclusion, remaining tests and next step in the task. A role with terminal access performs practical checks when needed; the documentation comparison requires no new provider login.

Accepting this follow-up means the connection-choice evidence has been assessed. DSP-1 is not `Done` until its existing acceptance criteria, including the packaged experiment and Niclas's assessment, are met. Then continue the remaining steps within the mandate; do not introduce another approval gate for routine choices.

### Prerequisite: account and authentication

Use Niclas's existing private Cursor account. Account access is an **open technical question**, not an assumed blocker: steps 1 and 4 establish the connection path, its actual authentication method and whether anything is missing. If a key beyond normal login is required, propose storage—Windows credential storage first, with an environment variable or file outside the repository as alternatives—and let Niclas decide then. Involve him when only he can complete login or when additional spending requires a decision. Report an obstacle when established, not merely suspected.

### Steps

1. **Select the connection and inventory the computer.** Separate execution from documentation research because read-only roles lack terminal access in this environment. The coordinator or Implementer records commands and output for the Windows version, `node`, `npm`, Cursor CLI version if present, and available packages. The Researcher assesses the TypeScript SDK, ACP over JSON-RPC and headless CLI against actual versions. A viable path **must** support startup, streaming, cancellation, file changes and tool execution, and be callable from Node in a packaged Electron application. **Assess and report** session resumption (DSP-4 AC#2 depends on it), per-tool approvals, model selection and cost reporting; absent support is a valid finding for these four. Deliver a recommendation, fallback and capability matrix that explicitly identifies missing support.
2. **Runnable development skeleton.** TypeScript, React and Electron open a Windows window with pinned versions and a committed lockfile. The adapter exists as an interface without making calls. It is **session-granular**, not run-granular, and includes `dispose()` and the approval state specified by the follow-up decisions in Implementation Notes. Fields explicitly deferred there are outside this step.
3. **Package the empty skeleton.** Produce a runnable artifact without a development server before adding the agent connection. Record its content hash and source snapshot so it cannot be confused with step 7's artifact. Separating packaging failures from connection failures is the intended benefit, based on experience rather than established evidence. If bundling the main process, account for Cursor's documented lazy-loading failure `Cannot find module './986.js'` on the first `Agent.create()`; see the packaging mitigation in Implementation Notes. **Write the first startup instructions now**, leaving only the connected packaged workflow to add later.
4. **Real connection and streaming.** Run the adapter outside the rendering thread, connect through Niclas's account and obtain a real streaming response and follow-up in the same session. Keep credentials outside the repository. Record two observations for AC#4: actual authentication requirements and credential source, and an initial usage or cost reading. Missing values are unknown, never zero.
5. **Real code change and build or test.** Give the agent an explicit change request for a separate small test repository with a known deterministic test. Compare files before and after, run the test command, capture output and exit code, and document the execution path. If step 1 found interactive approvals, handle them explicitly; a pending approval must not be described as a hang. Run the access probes below **after** documenting the code change and test so a denied probe cannot contaminate AC#6 evidence. Read usage again after a short interval because cost reporting may be delayed.
6. **Cancellation and connection failure as separate scenarios.** *Scenario A, actual cancellation:* cancel during streaming and during a running test. *Scenario B, a deliberately induced failure through the real connection:* the experiment causes the failure; do not wait for a provider outage. Both record already changed files, any continuing execution and, specifically, whether an active remote model request cannot be stopped.
7. **Packaged Windows experiment with the connection.** Rebuild with the adapter starting an external process. Run the **whole minimal workflow** from the artifact without a development server: the window opens and shows connection status for Niclas's account; a prompt produces a streaming response; a follow-up is answered in the same session; an explicit change request changes a test-repository file on disk; its test runs with visible output and exit code; and Cancel during streaming gives an understandable status. Connection and streaming alone are insufficient. Relate that status to AC#3: has streaming stopped, and is anything still running? Identify the artifact by SHA-256 of the executable or directory-content manifest, source snapshot including lockfile, build command and timestamp—not its path. Before delivery, perform an explicit secrets check: search experiment code and committed files for key/token patterns and account names; check `.gitignore` covers local settings and key files; verify saved raw logs are redacted; and inspect the index before committing. The Verifier checks this independently. Niclas assesses the instructions when running the artifact; supplement this with a clean session without loop history following the instructions and reporting missing knowledge. Allow for an unsigned-binary warning.
8. **Technical record.** Record versions, rationale, target environment, tested and untested behaviour, authentication and key storage, observed file/tool access from step 5, billing sources and dates with observed or unknown values, the step 1 matrix, the path to Linux and VS Code/Copilot with outstanding tests, and local execution versus remote model requests—including requests that cannot be stopped. Describe any actual obstacles to the chosen stack and their extent. End with a concrete bounded next step for DSP-2.

### What the access probes in step 5 check

The probes ask **what an agent can actually access when DSpatch runs it**. Reaching Cursor is a different question, tested in step 4. Observations inform what containment DSpatch needs and belong in the technical record before DSP-2 begins.

- **File probe 1.** Create a dedicated temporary directory outside the selected working copy and a file within it. Ask the agent to read and modify that file. Record success, denial or an approval request.
- **File probe 2.** Repeat with a command that writes to the temporary directory.
- **Minimal network probe.** Start a dedicated listener on a free port at `127.0.0.1` and ask the agent to fetch that address. An entry in our own log establishes access to that local test server, not unrestricted internet access or access to other addresses. No third party or external service is involved and no data leaves the computer. This is approved as a bounded connection check within the technical experiment.

Do not probe the DSpatch repository, Niclas's other projects or external systems. Any broader probe—for example a real outgoing connection to an external address—requires its purpose and scope to be presented to Niclas first.

### Scope boundaries

The workspace itself belongs to DSP-2, deeper error handling to DSP-3, and saved history and restart to DSP-4. Exclude Linux packaging/testing, implementing or testing VS Code/Copilot, a general adapter framework or second integration, a cost dashboard, MCP tools and registry, code signing, installers and automatic updates, commit/push/PR handling, parallel writing agents, Maestro, a custom editor and advanced code understanding. UI work beyond what this experiment needs is deliberately deferred.

The experiment is a spike. **Niclas's decision, 13 September 2026:** suitable adapter code may be reused in DSP-2; its UI choices are not inherited by DSP-2.

### Acceptance-criterion mapping

AC#1: steps 2, 3, 7 and 8. AC#2: step 4, including commands, model name and provider versions. AC#3: both step 6 scenarios. AC#4: empirical observations from steps 4 and 5, summarised with dated sources in step 8—not step 8 alone. AC#5: step 7. AC#6: step 5.

Evidence includes exact commands and exit codes; Windows, Node, Electron and provider package/CLI versions; the committed lockfile; before/after test-repository contents as content-addressed snapshots; redacted raw logs; artifact hash, build command and source snapshot; and probe outcomes. The Verifier must be able to repeat checks against the same code version.

Agent runs cannot substitute for Niclas's assessment: the intended account was used, the artifact starts and behaves reasonably on his computer, startup instructions suffice for someone who did not write the code, and the connection path and friction are acceptable. Until he has run and assessed it, the task belongs in `Review`, not `Done`.

### Questions resolved by the steps

Steps 1 and 4 determine the connection path; the fallback keeps that choice reversible. Approvals and resumption are initially unknown and assessed in step 1 without requiring a decision from Niclas. Billing is partly unknown and addressed through dated documentation and the two readings in steps 4 and 5. Test the agent-within-agent risk at least once from an ordinary terminal and record differences. Prefer having DSpatch start the build subprocess so exit code, cancellation and snapshot association are under its control; this is reversible, and the other path's limitations must be documented. Use a purpose-built small TypeScript repository with a fast deterministic test, not a real project. Packaging-tool selection was the smallest remaining open question when this plan was approved; later decisions are recorded in Implementation Notes.

Clarify in the task description when starting: "packaged" in AC#1 means a build-tool-produced runnable artifact that starts without a development server, excluding installers, signing and automatic updates. Experiment code and instructions belong in DSpatch; the working copy changed by the agent is a separate repository.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
### Current handoff at the language migration

The pushed DSP-1 record covers the reviewed skeleton and Windows packaging (steps 2–3). The provider connection in step 4 still needs the real authentication flow and subsequent tests. The language migration changes text only and does not extend that runtime evidence. Niclas approved the current colour palette as a visual starting point; this does not complete the remaining UX or whole-workflow criteria.

### Historical evidence — original language

The following implementation and verification notes predate the English-language policy. They are preserved verbatim, including Swedish observations, quotations and identifiers. They describe the versions and dates recorded below; new findings must be written in English.

### Pass 1, 13 september 2026 — delsteg 1 klart, anslutningsvägen vald

Körjournal: `.dspatch-loop/runs/20260913-175023-g8t7/` (lokal, Git-ignorerad). Bascommit `5fd842c`, gren `main`, ren arbetskopia före och efter. Två specialistanrop av tolv, noll omtag. Ingen produktkod är skriven ännu och inget debiterat leverantörsanrop har gjorts.

Miljö: Windows 11 Home 10.0.26200.0 AMD64, Node v24.21.0, npm 11.19.0, Git 2.53.0, Python 3.12.10, Backlog.md 1.52.0, Cursor-appen 3.17.8 (commit `2fdd31c9f33f7fbe501f2d57772dc5bf64b63620`).

### Beslut: anslutningsvägen är A, `@cursor/sdk`

**Vald väg: `@cursor/sdk` 1.0.31, körd som adapter i en Node-process utanför renderingstråden. Reservväg: headless CLI (`agent`) med `--print --output-format stream-json`.**

Skälet är att A bär **sex** av de sju förmågorna i VISION 9.1:s integrationskontrakt med dokumenterat stöd och är den enda av de tre vägarna som exponerar kostnad i ören alls, med strukturerad skalutmatning med exitkod och ett avbrott vars effekt på pågående verktygsanrop är beskriven.

Den sjunde förmågan, **godkännanden per verktygsanrop, saknar A i programmatisk form.** Cursors dokumentation anger under *Known limitations* att "Hooks are file-based only (`.cursor/hooks.json`). No programmatic callbacks.", och under *Sandbox options* att "There's no human-in-the-loop approval flow in headless SDK runs". Det är dokumenterat frånvarande, inte okänt. Väg B, ACP, är den enda av de tre som dokumenterar ett godkännandeprotokoll. Det är inget hinder i Etapp 0, där DSpatch inte behöver grinda verktygsanrop — men det ska stå som saknat stöd och inte som uppfyllt. *(Korrigerat under uppföljningen; motiveringen påstod tidigare att samtliga sju förmågor var dokumenterade för A.)* Den bär dessutom DSP-4 genom `Agent.resume(agentId)` mot ett lokalt lager som överlever processomstart, vilket gör att DSP-4 AC#2 kan uppfyllas med leverantörens egen återupptagning i stället för att DSpatch återför sammanhanget själv.

Beslutet är reversibelt. Byt till reservvägen om SDK:t inte går att ladda i en **paketerad** Electron-app, om den lokala agentloopen visar sig instabil på Windows, eller om nyckelhanteringen visar sig oacceptabel medan `agent login` fungerar. Priset för ett byte är förlorad kostnadsrapportering och strukturerad exitkod, plus att avbrott får byggas på processdödning.

### Stödmatris från delsteg 1

`JA` = dokumenterat stöd, `DELVIS` = med förbehåll, `OKÄNT` = dokumentationen tiger, `NEJ` = dokumenterat frånvarande. Underlag: rapport 001.

| Punkt | A. `@cursor/sdk` | B. ACP | C. Headless CLI |
| --- | --- | --- | --- |
| Starta körning programmatiskt | JA | JA | JA |
| Strömmande svar | JA | JA | JA |
| Avbryta pågående körning | JA | JA | DELVIS |
| Ändra filer i arbetskopia | JA | JA | JA |
| Köra kommando, fånga resultat | JA | DELVIS | DELVIS |
| Anropbar från Node i paketerad Electron | **JA i dev-läge, paketering oprövad** | DELVIS | DELVIS |
| Återupptagning av session | JA | JA | JA |
| Godkännanden: programmatisk callback per verktygsanrop | **NEJ** (dokumenterat frånvarande) | JA | DELVIS |
| Godkännanden: policybaserad grindning (filhooks, sandlåda, auto-review) | JA | DELVIS | DELVIS |
| Godkännanden: svarsväg på strömhändelsen `{type:"request"}` | OKÄNT | — | — |
| Modellval och utläsning | JA | DELVIS | JA |
| Kostnad och förbrukning | JA | OKÄNT | NEJ |

### Electron-lastprovet — det som avgjorde valet

Punkt 6 var det enda måstekravet utan dokumentationsstöd: ingen Cursor-dokumentation nämner Electron. Provet kördes därför först, i en Git-ignorerad skrapkatalog, utan inloggning och utan debiterat anrop. Underlag: rapport 002 och råloggarna `logs/002-*.log`.

Resultatet är att **samtliga elva kontroller gav identiskt utfall i Electron 44.3.0 och i vanlig Node 24** — ingen runtimeskillnad alls. Electron 44 bär `node:sqlite`, `import('@cursor/sdk')` ger 76 toppnivåexporter, och `Agent.create()` går igenom både med och utan uttryckligt lager.

Tre fynd är värda att bära vidare:

- **Den vendorade tree-sitter-addonen laddas i båda runtimeerna** trots olika ABI (137 mot 149). Den är byggd mot Node-API och behöver inte byggas om för Electron. Detta var den största dolda Electron-risken och den är utesluten för dev-läge.
- **Med en medvetet ogiltig nyckel når anropet fram till Cursors autentiseringsendpoint** och får ett strukturerat avslag, `AuthenticationError: "Invalid User API Key"`. Det belägger tre saker: att modulen laddas, att initieringen fungerar, och att ett HTTPS-anrop från Electron-huvudprocessen till Cursors API kommer fram och besvaras i dev-läge på denna maskin. Det belägger **inte** att utgående nätverk fungerar i allmänhet, och inte att kedjan fungerar från en paketerad artefakt. Det som återstår är Niclas riktiga behörighet plus paketeringsprovet. *(Formuleringen preciserad under uppföljningen; den löd tidigare att "utgående nätverk fungerar från Electron-processen", vilket drog en vidare slutsats än provet bär.)*
- **`app.quit()` slukar exitkoden**; `app.exit(code)` gör det inte. Upptäckt genom en negativ kontroll som satte koden till 7 och fick 0 tillbaka. Gäller delsteg 3 och 7 där artefaktens exitkod ska redovisas.

### Fynd som ändrar planeringen framåt

**SDK:t återanvänder inte Cursor-appens inloggning.** Dokumentationen säger uttryckligen att det inte sker någon automatisk upptäckt av lokala inloggningsuppgifter. Delsteg 4 behöver därför antingen `CURSOR_API_KEY` eller ett engångs `Cursor.auth.login()` som öppnar webbläsaren och sparar en användarnyckel med 90 dagars livslängd i `~/.cursor/sdk/auth.json`. Rekommendationen är inloggningsflödet: inget hamnar i repot och Niclas insats blir ett webbläsarklick.

**Åtkomstsonderna i delsteg 5 väntas lyckas snarare än nekas.** Cursors sandlåda körs på Windows som deras Linux-sandlåda inne i WSL2, och både SDK och CLI kör osandlådat som default. Utfallet "lyckas" ska därför förväntas i förväg och inte tolkas som ett fel i provet — det säger i stället något viktigt om vad DSpatch själv måste bygga i fråga om inneslutning. Sondens utfall visar dock bara vad agenten nådde i just det provet: filsonderna en katalog utanför arbetskopian, nätverkssonden en lokal lyssnare på `127.0.0.1`. Det är inte den fulla omfattningen av vad agenten skulle kunna nå, och det belägger inte fri internetåtkomst.

**Två korrigeringar av felaktiga antaganden.** Den fristående CLI:n installeras på Windows i `%LOCALAPPDATA%\cursor-agent`, inte under `Programs\`; den saknas på båda platserna. Och npm-paketet `cursor-agent` 1.0.3 är **tredje part** — utgivare "Jacky", repo `zalab-inc/cursor_agent` — utan koppling till Cursor. Det ska inte installeras. Båda verifierade av koordinatorn med egna kommandon.

**Tredjepartspaketet installerades aldrig.** Klarlagt av koordinatorn under uppföljningen: det undersöktes enbart med `npm view`, som läser registermetadata utan att installera. Belägg — `cursor-agent` saknas i `probe-electron/package.json`, saknas som post i `package-lock.json` (ingen referens till `zalab-inc`), saknas i `node_modules` på disk, och `npm ls -g --depth=0` visar endast `backlog.md@1.52.0`. Det rätta paketet är bekräftat mot Cursors **egen installationsanvisning**, som anger `npm install @cursor/sdk` och uttryckligen varnar för namnförväxling; de fem plattformspaketen följer med som `optionalDependencies` pinnade till samma version och installeras inte separat.

**`cursor.cmd agent` är inte den dokumenterade headless-agenten.** `cursor.cmd agent --version` ger appens egen version, identisk med `cursor.cmd --version`; flaggan konsumeras av den yttre CLI:n. Sonden laddade inte ned någonting. Frågan om exakt vad underkommandot startar är inte helt besvarad men är inte längre beslutsrelevant.

**Hemlighetshygien:** det lokala agentlagret skriver `blobEncryptionKey` i klartext i `agents.ndjson`. Lagerfiler får aldrig committas eller läggas omaskerade i en rålogg. Ska in i delsteg 7:s namngivna hemlighetskontroll.

**Vad `blobEncryptionKey` faktiskt är** — utrett under uppföljningen ur SDK:ts egen typdeklaration (`dist/cjs/executor-types.d.ts`, stickprovskontrollerad av koordinatorn mot filen på disk). Fältet är en **per agent**-nyckel i hexform som skickas som HTTP-headern `x-blob-encryption-key` vid varje varv, så att servern håller sin tvärvarvscache av blobbar vid liv. Den krypterar alltså **inte** det lokala lagret på disk och är **ingen autentiseringsuppgift**. Utelämnas den faller runtimen tillbaka på en stabil process-intern nyckel; effekten blir en missad cache-träff, inte ett fel. Värdet ligger i agentpostens SDK-ägda metadataobjekt (`LocalAgentDocument.sdkMetadata`).

Allvarlighetsgraden ska skrivas ut rätt i delsteg 7: en läckt nyckel innebär att **konversationsinnehåll kan läsas** ur serverns cache för just den agenten — inte att kontot kan kapas, och ingen debiterad körning kan startas med den. Filen är ändå känslig utan nyckeln, eftersom den bär agent-ID, `cwd` och namn. Praktisk följd: lägg lagerkatalogen **utanför repot från början** när DSpatch sätter `JsonlLocalAgentStore` uttryckligen. Okänt: algoritm, nyckellängd, om servern roterar nyckeln och hur länge cachen lever — dokumentationssidan nämner aldrig fältet.

### Vad som inte är bevisat

Paketeringsfallet är oprövat — körningen skedde i dev-läge. Det som syntes pekar ut vad som måste lösas: `@cursor/sdk-win32-x64` innehåller `rg.exe`, `cursorsandbox.exe` och två `.node`-filer som måste ligga uppackade utanför asar-arkivet. Strömning, avbrott av pågående fjärranrop, agentens skalverktyg utan TTY, återupptagning och kostnadsrapportering är alla behörighetsberoende och återstår. Om Niclas privata konto kan prägla en användarnyckel är rimligt men oprövat.

### Pass 2, 13 september 2026 — avgränsad uppföljning av anslutningsvalet, genomförd

Samma körjournal, `.dspatch-loop/runs/20260913-175023-g8t7/`. Bascommit `7953f68`. Två specialistanrop (3 och 4), fyra av tolv förbrukade totalt, noll omtag. Underlag: rapport 003 (Researcher, jämförelse) och 004 (Reviewer, avstämning). Fortfarande ingen produktkod och inget debiterat leverantörsanrop.

### Slutsats: väg A står sig, och Copilot låses inte ute

Reviewer accepterade underlaget. Ingenting i jämförelsen motsäger valet av `@cursor/sdk`. Alla sju förmågor bärs av **Copilots** SDK (`@github/copilot-sdk` 1.0.13) och sex av sju av Cursors; den enda skillnaden till Copilots fördel är programmatiska godkännanden, och den är ett skäl att forma gränssnittet rätt — inte att byta väg.

Uppföljningen var befogad: pass 1:s underlag jämförde bara tre Cursor-vägar med varandra, och tre av de fyra inlåsningsriskerna nedan hade annars byggts in i delsteg 2.

**Detta är dokumentation, inget prov.** Ingen Copilot-integration är byggd, ingen körning gjord, inget konto använt. AC#1 kräver att vägen till VS Code/Copilot beskrivs och att kvarstående kompatibilitetsprov redovisas; det är vad detta är. Kalla det aldrig verifierad kompatibilitet.

### Fyra inlåsningsrisker som delsteg 2 ska undvika

1. **`Run` som förstklassigt objekt.** Copilot har ingen körningsnivå — `send()` returnerar ett meddelande-ID och händelser hör till sessionen. Modellera avbrott som "avbryt aktuellt varv i session X".
2. **Kostnad som ett tal i ören.** Cursor ger ören, Copilot ger nano-AIU, premiummultiplikatorer och kvot. En gemensam siffra vore påhittad. Bär enhet, omfattning och källa i varje post.
3. **Verktygens argument och resultat.** Cursor varnar uttryckligen att `args` och `result` saknar stabilt schema. Normalisera **envelopen** — ID, namn, status, tidsstämpel — aldrig innehållet, och spara råhändelsen bredvid.
4. **Prenumeration bunden till körning i stället för session** — Reviewers fynd, och det enda som är en korrekthetsfråga. `subscribe(runId)` efter `send()` tappar händelser hos båda: Copilots mönster är `session.on(...)` **före** första prompten, och Cursors race-fria väg är `onDelta`/`onStep` som skickas **in i** `send()`. Backlog-garantin för SSE gäller moln, inte den lokala runtime DSpatch använder.

Följden för delsteg 2: gränssnittet är **sessionsgranulärt**. `subscribe(sessionId, onEvent)` etableras vid sessionsstart före första `send`, och `cancel(sessionId)` betyder aktuellt varv. `dspatchRunId` bärs som fält på varje händelse så att gruppering per körning fungerar utan en körningsnivå i adaptern.

**Skriv ut invarianten: högst en aktiv körning per session.** Copilot dokumenterar "No session locking — concurrent access to same session is undefined" och lämnar det till applikationen; Cursor kastar `AgentBusyError` för moln. VISION 14 kräver ändå bara en skrivande körning i taget i Etapp 0.

**En operation som saknades: `dispose()`.** Copilots SDK startar en CLI-barnprocess (`client.start()`/`stop()`), Cursor har `agent.close()` och säger "Always dispose agents when done". En Electron-app som avslutas utan avveckling lämnar en runtimeprocess eller ett oavvecklat lager med WAL-filer kvar.

### Beslut: godkännanden bärs av gränssnittet från början

**Tillståndet `awaiting_approval` och metoden `respondToApproval` ingår i delsteg 2**, trots att Cursor-adaptern svarar "stöds inte" genom hela Etapp 0. Rutinmässigt och reversibelt gränssnittsval inom mandat; beslutat av koordinatorn efter Reviewers tillstyrkan.

Motiveringen vilar på Cursor och på beslutad målbild, inte på Copilot:

- Cursors egen strömtyp `SDKMessage` innehåller redan `{type:"request", request_id}`, dokumenterad som "Awaiting user input or approval". En adapter utan tillstånd för den måste kasta bort händelsen eller märka den fel.
- Delsteg 5 kräver redan att "en väntande godkännandefråga får inte rapporteras som en hängning", och VISION 13 kräver att väntan visas som väntan och att saknade uppgifter aldrig visas som positivt resultat.
- Kostnaden i delsteg 2 är ett medlemsnamn i en union och en metodsignatur, eftersom gränssnittet ännu inte anropar något. Det är att reservera ett namn, inte att bygga ett ramverk.

Tre villkor så att det förblir just ett reserverat namn:

1. Beslutsvokabulären hålls vid `allow-once` och `deny` med skäl. Copilots sju beslutstyper och scope-semantik ingår inte.
2. `capabilities().approvals` är `"unsupported"` för Cursor-SDK-adaptern, inte `"unknown"`. Det okända är svarsvägen på en enskild strömhändelse, inte förmågan.
3. Cursor-adaptern mappar `{type:"request"}` till tillståndet och sparar råhändelsen. Det gör det okända observerbart under delsteg 4–7 utan extra arbete.

`capabilities()` gäller **per adapterinstans, alltså leverantör plus transport** — inte per leverantör. Godkännanden är `unsupported` för Cursors SDK-väg men dokumenterat stödda för Cursors ACP-väg; ett svar per leverantör skulle ljuga så snart reservvägen används.

### Fältbeslut som skjuts upp från delsteg 2

Delsteg 2 skriver ett gränssnitt som ännu inget anropar. Dessa normaliserar mot noll faktiska utfall och låses därför inte nu: `pendingApproval.kind` med sex värden; Copilot-enheterna `nanoAiu` och `premiumRequests` i `unit`; `scope: 'agent'` (Cursors ord för det DSpatch kallar session); `seq` på händelseposten och `workspaceRevision` på körningen, som är DSpatchs egna observationer och hör till DSP-4; samt en egen felkodstaxonomi, som hör till DSP-3. Behåll `{message, providerCode?}`.

Två fältregler som däremot ska in, båda härledda ur beslutad målbild: `capabilities()` med tre värden inklusive `"unknown"`, eftersom VISION 9.1 kräver att saknat stöd framgår; och `value: null` för okänd förbrukning, aldrig `0`, eftersom VISION 12 säger att ett saknat kostnadsvärde inte ska presenteras som noll. `null` skiljer inte "dröjer" från "finns inte" — låt `source` och `observedAt` plus de två läsningarna i delsteg 4 och 5 bära den skillnaden.

### Paketeringsrisken är nu konkret, med dokumenterad motåtgärd

Cursors dokumentation har ett avsnitt, **Single-file bundles and compiled executables**, som pass 1 missade och som talar direkt till delsteg 3 och 7. Kontrollerat av koordinatorn direkt mot sidan:

> "The default build loads parts of itself lazily at runtime. Single-file bundlers can't follow those loads, so a compiled app fails on the first `Agent.create()` with an error like `Cannot find module './986.js'`."

Motåtgärden är dokumenterad: ett flat engångsbygge under ingångarna `@cursor/sdk/bundled` och `@cursor/sdk/bundled/sqlite`. Vidare gäller att nativa binärer inte kan ligga inne i en JavaScript-bunt — `node_modules/@cursor/sdk-<plattform>/` ska ligga bredvid den körbara filen, annars faller sökningen tillbaka på `rg` i `PATH` och `sandboxOptions` kastar `ConfigurationError`.

**Villkoret ska läsas rätt:** asar är ett arkiv, inte en bunt. Paketerar delsteg 3 utan att bunta huvudprocessen gäller lazy-load-problemet sannolikt inte. Buntas huvudprocessen med esbuild eller liknande — vanligt i Electron-uppsättningar — gäller det, och `@cursor/sdk/bundled` är då vägen. Detta ersätter inte paketeringsprovet; det gör felet igenkännbart i förväg.

### Två korrigeringar av rapport 003

Rapporterna är journalposter och skrivs inte om i efterhand. Dessa två punkter i rapport 003 är korrigerade här och ska inte hämtas direkt ur rapporten:

- **Stödmatrisens godkännanderad.** Rapporten föreslog `okänt` för Cursor. Rätt värde är dokumenterat frånvarande för den programmatiska callbacken; se den tredelade raden i matrisen ovan.
- **Påståendet om `agentId`-prefixet.** Rapporten varnade för att ett eget ID "riskerar att styra runtime-detektionen fel". Dokumentationen säger tvärtom: "Runtime is auto-detected from the ID prefix (`bc-` is cloud, **anything else is local**)", och `agentId` beskrivs som "Durable agent ID. Pass to keep a stable ID across invocations." Ett godtyckligt DSpatch-ID detekteras alltså som lokalt, vilket är rätt runtime. Den enda verkliga regeln är: **prägla aldrig ett ID som börjar med `bc-`.** Rekommendationen att DSpatch äger egna ID:n med mappning till leverantörens står kvar — den behövs för Copilot, där ett eget filnamnssäkert ID är en förutsättning för återupptagning.

### Kvarstående efter uppföljningen

Copilots pending-semantik utan handler, dess sju beslutstyper och `request.kind`-värdena är obekräftade av Reviewer och ska inte citeras som kontrollerade. Svarsvägen på Cursors `{type:"request"}` är fortfarande okänd, men blir observerbar genom villkor 3 ovan. Om avbrott stoppar det pågående fjärranropet är odokumenterat hos **båda** — AC#3 frågar uttryckligen, så delsteg 6 måste mäta det. Copilot-SDK:ts Electron-lämplighet är helt oprövad. Allt som pass 1 listade som obevisat står kvar oförändrat.

### Pass 2, forts. — delsteg 2 genomfört, men Implementer-anropet avbröts

**Avvikelse att känna till:** Implementer-anropet (anrop 5) avbröts av plattformen innan agenten hann lämna sin slutrapport. Arbetet hann bli klart och ligger på disk; det som saknas är agentens egen redovisning. Koordinatorn klarlade utfallet genom att köra kontrollerna själv i stället för att upprepa anropet, enligt regeln att ett okänt utfall ska klarläggas före omtag. **Ingen oberoende verifiering av delsteg 2 har gjorts än** — koordinatorns körningar är evidens, men inte oberoende.

Skelettet ligger i `app/`, skilt från `scripts/` och `tests/` som innehåller Python-verktyg för utvecklingsloopen.

**Versioner, exakt låsta utan `^` eller `~`:** Electron 44.3.0 (samma som lastprovet i pass 1, så att en verifierad variabel inte byts), React 19.3.0, TypeScript 7.0.2, Vite 8.3.0, `@vitejs/plugin-react` 6.1.1, `@types/node` 24.13.4. Lockfilen `app/package-lock.json` är spårbar i git; `git check-ignore` ger ingen träff. `node_modules/` och `/app/dist/` är ignorerade.

**Bygguppsättningen buntar inte huvudprocessen.** Renderaren byggs av Vite, huvudprocessen och preload av `tsc` till vanliga moduler som löser `node_modules` normalt. Det är ett medvetet val mot Cursors dokumenterade lazy-load-problem: en buntad huvudprocess skulle falla på första `Agent.create()` med `Cannot find module './986.js'` i delsteg 4. Renderaren rör aldrig SDK:t.

**Inget SDK-beroende.** `@cursor/sdk` finns inte i `package.json` och lockfilen innehåller ingen referens till `cursor`. Det är avsiktligt: delsteg 3 ska paketera ett tomt skelett, så att paketeringsfel och anslutningsfel kan skiljas åt.

**Kontroller körda av koordinatorn på detta innehåll:**

| Kommando | Utfall | Exitkod |
| --- | --- | --- |
| `npm run typecheck` (node, renderer, tools) | rent | 0 |
| `npm run build` (`tsc` + `vite build`, 16 moduler) | rent | 0 |
| `DSPATCH_SMOKE=1 npx electron .` | fönstret visas, renderaren målar | 0 |

Rökprovets utmatning är den egentliga evidensen för att fönstret öppnas, inte att kommandot startade: `did-finish-load`, sedan `renderer-ready heading="DSpatch" capabilities=7`, sedan `fönstret visas bounds={"x":800,"y":266,"width":960,"height":860}`.

**Adaptergränssnittet följer den beslutade formen.** Sessionsgranulärt — `subscribe(sessionId, …)` och `cancel(sessionId)`, ingen körningsnivå; `RunReference` bär bara `dspatchRunId`. `dispose()` finns. `RunStatus` innehåller `awaiting_approval`. `CapabilitySupport` har tre värden. Samtliga uppskjutna fältbeslut är utelämnade: `ApprovalRequest` har tre fält utan `kind`, `UsageUnit` är `tokens | cents`, `UsageScope` saknar `agent`, `AdapterError` är `{message, providerCode?}`. `ApprovalDecision` är `allow-once` eller `deny` med skäl. `NotImplementedAdapter` kastar på allt och rapporterar `unsupported`.

**Ett rapporterat Electron-fynd som inte kunde återskapas.** Implementer dokumenterade i `main.ts` att processen inte avslutas alls om man försöker avsluta i `did-fail-load` innan fönstret visats — att varken `app.exit()` eller `process.exit()` terminerade, att timers slutade köra, och att ett prov hängde i tre minuter. Koden väntar därför på att fönstret visas innan den avslutar.

**Verifier kunde inte återskapa hängningen** (13 september 2026, Electron 44.3.0 på denna maskin). Sex varianter — `ERR_FILE_NOT_FOUND` och `ERR_CONNECTION_REFUSED`, vardera med `app.exit(9)` direkt, `process.exit(9)` direkt och väntan på `show` — avslutade samtliga med kod 9 inom 0,4 till 3,8 sekunder. Timers fortsatte köra. Ingen process behövde dödas utifrån.

Statusen är därmed **okänd, inte falsk**: Implementers ursprungliga provkod och logg finns inte bevarad, eftersom anropet avbröts. Påståendet ska inte bäras vidare som konstaterat faktum. **Mekanismen behålls** — väntan på att fönstret visas fungerar och kostar ingenting, vilket negativprovet nedan visar — men kodkommentarens formulering bör nedgraderas till en observation vid nästa tillfälle någon ändå arbetar i `main.ts`.

**`SessionConfig.workspacePath` är avsedd.** Verifier frågade om fältet hör hemma på adapterns yta. Ja: det är indata till sessionen, inte en observation. Det som skjuts upp är `workspaceRevision` på körningen, som är något DSpatch själv observerar.

### Pass 2, forts. — delsteg 2 oberoende verifierat och godkänt

**Kandidat:** manifest `.dspatch-loop/runs/20260913-175023-g8t7/snapshots/delsteg-2-source-v2.sha256`, 20 källfiler under `app/`, filens egen SHA-256 `ba7e6dbd9334db031b6cad07dc097a48af5a20d5508c30dff1c3dfe6975e1e74`. Den summan går att kontrollera direkt med `Get-FileHash` eller `sha256sum`.

*(Den första ögonblicksbilden hade två fel som Verifier fann: den missade `app/vite.config.mts`, som styr renderarbygget och CSP-injiceringen, och dess angivna summa var beräknad på normaliserat innehåll i stället för filens byte och gick därför inte att reproducera. Båda rättade ovan.)*

**Omdöme: delsteg 2 håller. Inga blockerande fynd.** Verifier bekräftade samtliga sex av koordinatorns påståenden med egna körningar och fann **ingen avvikelse i någon riktning** i adaptergränssnittet — varken något som saknas eller något uppskjutet som smugit sig in. Sexton kontrollpunkter mot besluten, alla PASS.

**Fem kontroller utöver koordinatorns, alla godkända:**

- **Bygget är bit-identiskt reproducerbart.** Efter `clean` och ombygge är alla 16 artefakter oförändrade, inklusive `dist/main/main.js`.
- **Renderaren når bevisligen ingen Node.** Utvärderat i renderarens eget världskontext via DevTools-protokollet: `require`, `process`, `module`, `global`, `__dirname` och `Buffer` är alla `undefined`, och `require("node:fs")` kastar. `window.dspatch` exponerar exakt två funktioner. Att `sandbox: true` slog igenom är belagt separat — renderarprocessens kommandorad bär `--enable-sandbox`, och ingen av de fyra Electron-processerna har `--no-sandbox`.
- **Huvudprocessen buntas verkligen inte.** `dist/main/main.js` är `tsc`-utmatning med tre `require`-anrop och en modulgraf som ligger kvar som separata filer. Vite rör den inte. Det är det som håller Cursors lazy-load-problem borta i delsteg 4.
- **Rökprovet kan misslyckas.** Utan byggd renderare ger det exitkod **2**, utan `renderer-ready` och utan framgångsrad. Ett prov som alltid ger 0 vore värdelöst som evidens.
- **Dev-läget fungerar också**, inte bara byggda filer: Vite på `http://localhost:5273/`, fönstret visas, exit 0, porten släppt efteråt. Delsteg 2 handlar ordagrant om dev-läge, så det var den kontroll som saknades.

**En nyans att bära vidare:** `did-finish-load` loggas **även** för Chromiums egen felsida och skiljer alltså inte framgång från fel. De diskriminerande raderna är `renderer-ready …` och `startprovet lyckades …`.

**Oprövat:** rökprovets exitkoder 3 (tidsgräns) och 4 (`render-process-gone`) är dokumenterade men inte framkallade; de blir relevanta i delsteg 3 och 7. `npm install` från tom `node_modules` är inte körd. Reproducerbarheten gäller denna maskin i dag, inte över tid eller maskiner.

**Väntar på Niclas:** att fönstret ser rimligt ut och att adaptergränssnittets form är den han vill leva med. Belagt är att fönstret visas och målar rätt rubrik, sju förmågerader och rätt versioner — inte att det ser bra ut.

### Pass 2, forts. — delsteg 3 genomfört och oberoende verifierat

**Paketeringsverktyget var planens sista öppna punkt. Valet är `electron-builder` 26.15.3, målet `dir`** — en uppackad körbar katalog, ingen installerare. Det motsvarar AC#1:s definition av "paketerat": en körbar artefakt producerad av byggverktyget som startar utan dev-server. Konfigurationen ligger i `app/electron-builder.yml` i stället för i `package.json`, eftersom den måste bära en kommenterad vägvisare inför delsteg 7 och strikt JSON inte kan det.

Ett val Implementer gjorde på eget initiativ och som är rätt: `directories.output` är `release`, inte electron-builders standard `dist`, som redan ägs av `tsc` och Vite. De hade skrivit över varandra.

**Artefakten:** `app/release/win-unpacked/DSpatch.exe`, 234,7 MB, katalogen 386 403 525 byte i 72 filer. Identifierad med innehåll, inte sökväg:

| | SHA-256 |
| --- | --- |
| Källmanifest (21 filer) | `74b98aa0965dcd9620670e0b2923c9fd5d948dc7aa4dd874740007c0a9a00148` |
| Katalogmanifest (72 filer) | `a480598062fd178ce5578681e7b4517c218f043e27bfcbb789aef40aa935add6` |
| `DSpatch.exe` | `d65d0acc65e166e842fd63fec33f856231ddc5d1b1bbdb721bbd0f0e0ee2add7` |
| `app.asar` | `9b90003085da29a01474e08016c54033e6c8b0c80268e2692d718cda4d24b3ae` |

Artefakten kan inte förväxlas med delsteg 7:s, och det gäller alla tre summorna: `app.asar` ändras av SDK-innehållet, `DSpatch.exe` ändras därför att asar-integritetssumman skrivs in i den, och katalogmanifestet ändras av `app.asar.unpacked`.

**Omdöme: delsteg 3 håller. Inga blockerande fynd.** Verifier prövade åtta påståenden självständigt, alla PASS.

- **Artefakten startar utan dev-server**, exitkod 0, med `renderer-ready` och `startprovet lyckades`. Laddar `file:///…/app.asar/dist/renderer/index.html`; ingen `http://`-URL förekommer.
- **Beviset diskriminerar.** Samma artefakt pekad mot den stängda dev-porten ger exitkod **2**. `did-finish-load` loggas även då, för Chromiums felsida — det är de två andra raderna som skiljer.
- **Noll produktionsberoenden i artefakten.** `asar list` ger 24 poster: bara `dist/**` och `package.json`. Vite har buntat in React, så ingenting ur `node_modules` behövs.
- **Paketeringen är byte-identiskt reproducerbar.** Tre byggen från rent läge gav samma bytes, alla 72 filer. Gäller denna maskin, denna dag, med varm cache — inte över maskiner eller tid.
- **Osignerad**, belagt med `Get-AuthenticodeSignature`. Byggloggens rad om `signtool.exe` avser asar-integritetssumman, inte kodsignering.
- **17 av 20 filer byte-identiska med delsteg 2:s verifierade kandidat.** Ingen applikationskod ändrades av paketeringen.

**Startinstruktionens första utkast ligger i `app/README.md`**, inte i en ny fil — filen var redan startinstruktionen för samma målgrupp. Den täcker klona, installera, dev-läge, bygga, paketera och köra artefakten, plus vad som inte fungerar ännu. Hemlighetssökning över alla 21 källfiler gav inga nycklar, inga kontonamn och inga maskinspecifika sökvägar. Klon-URL:en är skriven som `<repots URL>` eftersom den verkliga innehåller ett kontonamn.

**AC#5 bärs inte av detta.** Verifier korrigerade en felskrivning i överlämningen: planen tilldelar AC#5 till delsteg 7, och delsteg 3 skriver bara ett första utkast. AC#5 har dessutom en andra halva om nästa steg mot arbetsytan som README inte berör. Inget acceptanskriterium har kryssats på delsteg 3.

### Två rättelser som bärs in i delsteg 7

Båda sitter i `app/` och rättas **inte** nu, eftersom en ändring skulle bryta den nyss verifierade kandidaten `74b98aa0…` utan att tillföra något i detta läge.

1. **README:s SmartScreen-stycke saknar förbehåll på sin mittersta punkt.** Första och tredje punkten är märkta som observerad respektive oprovad. Den mellersta — dialogen "Windows har skyddat din dator" vid kopierad eller nedladdad artefakt — står omärkt och läses därför som provad. Den är den inte. En mening räcker.
2. **`asarUnpack`-vägvisaren nämner inte fällan som faktiskt fäller delsteg 7.** Kommentaren är i övrigt bra, men `files`-listan slutar med `!node_modules/**/*`, och den raden utesluter produktionsberoenden **tyst**. Det är belagt, inte teoretiskt: bygget har redan släppt igenom två deklarerade beroenden — `react` och `react-dom` finns i artefaktens `package.json` men inte i arkivet — med exitkod 0 och utan en enda varning. I dag harmlöst, eftersom Vite buntat in dem. I delsteg 7 blir samma tystnad ett fel som visar sig först vid första `Agent.create()`, **med en felsignatur som liknar lazy-load-problemet** — två olika orsaker med snarlik yta. Vägvisaren ska säga att negationen måste hävas eller ordnas efter det nya `files`-mönstret, och att innehållet ska kontrolleras med `asar list` efteråt.

### Kvarstående inför delsteg 4

Rökprovets exitkoder 3 (tidsgräns) och 4 (renderarprocessen försvann) är dokumenterade men aldrig framkallade; 0 och 2 är nu belagda från artefakten. SmartScreen-dialogen är oobserverad, bekräftat av två oberoende parter. Bara Windows x64, ingen ikon, `author` saknas — allt korrekt redovisat och utan betydelse för målet `dir`.

**Väntar på Niclas:** att köra `app\release\win-unpacked\DSpatch.exe` och bedöma intrycket, och att bedöma om adaptergränssnittets form är den han vill leva med. Att fönstret visas och målar rätt innehåll är belagt maskinellt; att det ser bra ut är det inte.

*(Everything above this line is preserved Swedish evidence from passes 1–2, as DSP-10 provides. Notes from step 4 onward are written in English.)*

### Pass 2, continued — step 4 completed and independently verified

**AC#2 is met and checked.** The adapter connects from the Electron main process through Niclas's own account, streams a real answer and answers a follow-up in the same session. Verified independently by the Verifier, who reproduced every substantive claim and found nothing blocking.

**Candidate:** manifest `.dspatch-loop/runs/20260913-175023-g8t7/snapshots/delsteg-4-source.sha256`, 23 source files under `app/`, the manifest file's own SHA-256 `9d33ac43e069851830acddc3f92d4d28b36b9a701c651c3a9f23bd9ea6a4fde6`, computed on file bytes so it reproduces with `Get-FileHash`. Re-checked by the coordinator after all verification runs: 23 of 23 match, no drift.

`@cursor/sdk` is pinned to **1.0.31** exactly, as a production dependency. New code is `app/src/adapter/cursor-sdk-adapter.ts` and `app/src/main/probe-cursor.ts`. `tsconfig.renderer.json` now excludes the SDK adapter so that a renderer-side import fails typecheck. **The renderer was not touched**; a chat surface is deliberately a later step.

### How the login actually works, and what it required

The coordinator ran `Cursor.auth.login()` once with Niclas present. The flow is a one-time challenge, a browser page at `cursor.com/loginDeepControl?…&redirectTarget=sdk`, polling, and then a session token used exactly once to mint a named, expiring user API key. The key is stored at `C:\Users\nicla\.cursor\sdk\auth.json` — **258 bytes, outside the repository** — and expires **2026-12-12**. It is named `DSpatch DSP-1 (Niclas hemdator)` in the dashboard so it can be revoked on its own. `CURSOR_API_KEY` was never set. The value has never been written to screen, log, report or repository.

**AC#4's first observation — authentication requirements and credential source.** The adapter needed **nothing from DSpatch**: no API key argument, no environment variable, no file read of its own. The SDK resolves the credential itself from its own store. That is a genuinely useful property — DSpatch never handles the secret — and it is also the thing to re-check for a packaged artifact in step 7, since credential resolution has only been observed in development mode.

### Streaming is real, but the stated criterion does not discriminate

Requested model `claude-haiku-4-5`; reported model `claude-haiku-4-5`. Turn 1 produced **12 chunks at 12 distinct times**, first at 4788.2 ms and last at 4957.9 ms after send, with the run finishing at 5138.7 ms. `agent.send()` resolved at 2332.8 ms, *before* the first chunk, which is the structural evidence that delivery is push-based rather than a return value.

The Verifier sharpened this and the sharpening matters. Chunks arrive in **three bursts** separated by 154.3 ms and 8.1 ms, and the last chunk lands 184 ms before the run ends, so the stream is genuinely incremental. But ten of the twelve inter-chunk gaps are 0.1–0.7 ms — the event loop draining a batch, not twelve separate arrivals. **The probe's own pass criterion, "two chunks at two distinct times", would also accept a fully buffered replay.** The claim is true; the test that checks it is weaker than the claim. Tighten the criterion before step 7 relies on it.

### The follow-up is in the same session, and now there is a control proving the test can fail

Turn 1 planted the nonce `7UXDHRDTPH`; turn 2 recalled it, under agent `agent-40e0d9d0-…` with two distinct run IDs. On its own that shows only that something was recalled.

The Verifier added the missing **negative control**: a *fresh* session, asked turn 2's question word for word with no nonce ever planted, replied *"I don't have any record of you asking me to remember a token in our current conversation. This appears to be the start of our chat."* It invented no nonce and did not leak the one from the other session. So the continuity test discriminates, and sessions are isolated from each other despite sharing a local store root.

### Two findings that change how DSpatch must be built

**1. Cursor's agent ID must be `agent-<uuid>`; DSpatch must map its own ID rather than pass it through.** An arbitrary DSpatch ID is accepted by `Agent.create`, streams two complete turns, and is only then rejected by the usage API with `Agent ID must be in the format 'bc-<uuid>' (cloud) or 'agent-<uuid>' (local)`. Create and send are lenient while the usage path validates. **This corrects the earlier note that the only rule was "never `bc-`".** The failure surfaces late and far from its cause, which is exactly the kind of thing to pin down now.

**2. `vite build` succeeds with exit code 0 when a renderer file imports the SDK adapter**, bundling the whole SDK into a 3.7 MB renderer full of throwing Node stubs. `npm run typecheck` catches it; `build` and `package` never run typecheck. This is the same silent-success shape as the `!node_modules/**/*` trap already signposted for step 7. **Decision: `package` must depend on `typecheck`.** To be applied in the next implementation call.

### AC#4's usage reading: tokens yes, cost refused — and the refusal is narrow

`agent.getUsage()` is **refused for this account**: `UnknownAgentError [feature_unavailable]`, twice, twenty seconds apart, so it is not billing lag.

The Verifier established, and the coordinator reproduced independently in plain Node with no adapter and no Electron, that the refusal is **narrower than first reported**:

| Agent ID passed to `Agent.getUsage()` | Answer |
| --- | --- |
| local `agent-<uuid>`, never existed | **HTTP 403** `feature_unavailable` |
| cloud `bc-<uuid>`, never existed | **HTTP 404** `agent_not_found` |

The 403 arrives even for an agent that never existed, so the gate is evaluated **before lookup**. The cloud path answering 404 shows the endpoint authenticates and works for this account. **Only usage reporting for local SDK agents is gated.** That makes the question to Niclas a narrow one about entitlement rather than an open-ended billing investigation.

**Cost in cents is therefore `unknown`, never `0`.** Per-turn tokens do arrive, on a different path — `SDKUsageMessage` on the run stream:

| Turn | input | output | cacheRead | cacheWrite | total | reasoning |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 1372 | 155 | 0 | 0 | **1527** | **unknown** (field absent) |
| 2 | 1485 | 82 | 0 | 0 | **1567** | **unknown** (field absent) |

Turn 1 emitted 26 reasoning deltas, so the model demonstrably reasoned while the field is absent from the payload. Recording `0` would have been **factually false**, not merely imprecise. This is the concrete case the `value: null` rule was written for.

**Decision: `capabilities().usageReporting` is changed from `supported` to `unknown`.** The Verifier's reasoning is accepted: a UI told `supported` will render a cost field and leave it blank, which is precisely the "missing cost presented as zero" that VISION 12 forbids. The per-reading data is already honest through `unit`, `source` and `value: null`; it is the one-word summary that overstates. The field is **not** split — that would reopen a step 2 decision for a presentation problem `unknown` already solves. To be applied in the next implementation call.

**How much this weakens the step 1 choice: very little.** The choice was comparative, and a 403 here does not give the headless CLI a cost API it never had. Cost *is* exposed by this path; one route is gated for this account. Per-turn tokens are a workable order-of-magnitude substitute so long as they are never presented as a billed amount.

### Containment and hygiene

The agent's workspace was a dedicated scratch directory under `%TEMP%`, **refused in code** if it were inside the repository or non-empty. It was **empty after the run** and the run reported `tools: []`, so the agent touched no file. The SDK's local agent store landed outside the repository under `~/.cursor/projects/…/sdk-agent-store/…`. A secret search across all TypeScript sources returns only the probe's own redaction allowlist, no values.

**One earlier concern is withdrawn.** The reported un-checkpointed WAL files over 1 MB surviving `dispose()` were an artefact of when the measurement was taken — `describeLocalState()` runs inside the probe body while disposal happens in the outer `finally`. After process exit no `-wal` or `-shm` file exists anywhere. Struck from remaining work.

### What step 4 cost, and what it did not establish

**Seven billed turns in total:** the Implementer needed four sessions rather than one — the first failed on the ID format, the second on the usage API plus a probe that treated a refusal as fatal, the third exposed that `assistant` messages are increments rather than cumulative snapshots, and the fourth is the delivered candidate. The Verifier spent three, two for the probe and one for the negative control. No failed call was retried unchanged.

`cancel` and `resume` are implemented and **explicitly untested**; steps 5 and 6 exercise them. `respondToApproval` throws by design, and `{type:"request"}` never occurred in any run, so Cursor's approval response path remains unobserved. Packaging with the SDK present is untested — that is step 7, and it is where the lazy-load and `asarUnpack` signposts finally get exercised. Step 3's verification still stands: the English-migration commit changed 15 of its 21 files, and all 82 changed non-comment lines were read and are string literals, JSX text, or one `lang` attribute.

### Next step

**Step 5: a real bounded code change plus a build or test** in a separate small test repository, with `toolPolicy: 'provider-default'`. Two corrections travel with it: make `package` depend on `typecheck`, and set `capabilities().usageReporting` to `unknown`. Then step 6 (cancellation and induced failure), a UI call before step 7, step 7 (the packaged experiment) and step 8 (the technical record).

**Waiting on Niclas, neither blocking step 5:** running `app\release\win-unpacked\DSpatch.exe` and judging the impression, judging whether the adapter interface is the shape he wants to live with, and the narrow entitlement question — *does this Cursor plan include usage reporting for local SDK agents?* — which decides whether AC#4 records the cost path as gated-for-this-account or as available-once-enabled.
<!-- SECTION:NOTES:END -->
