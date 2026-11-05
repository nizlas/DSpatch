import type { EvidenceLabel, Lang, LocalText, UnitKind } from '../shared/review-model';

/**
 * The review surface's own words, in its two display languages.
 *
 * Swedish and English are a product decision for this view (23 October 2026): the
 * reviewer chooses one, and both the interface and the prepared explanations follow
 * it. Code names, source code and repository documents stay English. Nothing here is
 * translated at run time, and the reviewer's own notes are never translated.
 */
/** The discussion panel's words. Short and about the action; detail behind Context. */
export interface DiscussionWords {
  readonly empty: string;
  readonly about: string;
  readonly wholeReview: string;
  readonly placeholder: string;
  readonly stop: string;
  readonly answering: string;
  readonly stopping: string;
  readonly context: string;
  readonly goToPoint: string;
  readonly pointGone: string;
  readonly status: { readonly sending: string; readonly unknown: string; readonly cancelled: string; readonly failed: string };
  readonly needsAcknowledgement: string;
  readonly sendAnyway: string;
  readonly continueAnyway: string;
  readonly readOnly: (reason: string) => string;
  readonly details: string;
  readonly hideDetails: string;
  readonly contextLabels: {
    readonly subject: string;
    readonly revisions: string;
    readonly code: string;
    readonly notes: string;
    readonly instruction: string;
    readonly providerContext: string;
    /** DSP-117: which agent answers here, and why not Claude. */
    readonly agent: string;
    readonly model: string;
    readonly sent: string;
  };
  /** DSP-132: the agent picker in the discussion's header. */
  readonly agentLabel: string;
  /** DSP-132: the picker's placeholder, and the line while no agent is chosen (Send held). */
  readonly chooseAgent: string;
  /** DSP-132: an agent that cannot be chosen, in the picker. */
  readonly notAvailable: string;
  /** DSP-132: the chosen agent cannot be used in this launch. */
  readonly agentUnavailable: (agent: string, reason: string) => string;
  /** DSP-132: what the chosen agent is given here. */
  readonly agentPolicy: (agent: string, policy: string) => string;
  /** DSP-132: after a switch, before the next question. */
  readonly switchNotice: (agent: string, exchanges: number) => string;
  readonly showRecap: string;
  readonly hideRecap: string;
  readonly leaveOut: string;
  readonly includeAgain: string;
  readonly recapLeftOut: (agent: string) => string;
  /** DSP-132: a question from before the agent was stored (format 1). */
  readonly recordedBeforeProvider: string;
  /** DSP-132: the disclosure with what the chosen agent may use here. */
  readonly agentLimits: string;
  readonly noCode: string;
  readonly noNotes: string;
  readonly notSent: string;
}

export interface ReviewWords {
  readonly opening: string;
  readonly openDefinition: string;
  readonly openAnother: string;
  readonly noDefinition: string;
  /** The empty review window opened for a folder: names it, chooses nothing. */
  readonly chooseFor: (folder: string) => string;
  readonly language: string;
  readonly details: string;
  readonly hideDetails: string;
  readonly saving: string;
  readonly saved: string;
  readonly notSaved: (reason: string) => string;
  readonly openFindings: (count: number) => string;
  readonly tabs: {
    readonly walks: string;
    readonly files: string;
    readonly coverage: string;
    readonly notes: string;
    readonly search: string;
  };
  readonly walkProgress: (opened: number, total: number) => string;
  readonly stepOf: (index: number, total: number) => string;
  readonly whatHappens: string;
  readonly whyItMatters: string;
  readonly places: string;
  readonly placeOf: (index: number, total: number) => string;
  readonly previousPlace: string;
  readonly nextPlace: string;
  readonly previousStep: string;
  readonly nextStep: string;
  readonly nextWalk: (id: string) => string;
  readonly navigationNote: string;
  readonly howDoWeKnow: string;
  readonly showSources: string;
  readonly hideSources: string;
  readonly evidenceLabel: Record<EvidenceLabel, string>;
  readonly evidenceMeaning: Record<EvidenceLabel, string>;
  readonly reviewSection: string;
  /** The right column's two tabs: the step's own text, or the discussion about the code (DSP-127). */
  readonly rightTabs: { readonly step: string; readonly discussion: string };
  readonly discussion: DiscussionWords;
  readonly markWalked: string;
  readonly walkedUndo: string;
  readonly walkedNote: string;
  readonly outsideWalk: string;
  readonly backTo: (stepId: string) => string;
  readonly backToCode: string;
  readonly view: {
    readonly before: string;
    readonly after: string;
    readonly both: string;
    /** A walk pane of a file the change does not touch: the one revision it shows. */
    readonly shownFrom: string;
    readonly shownTo: string;
    readonly focus: string;
    readonly wholeFile: string;
    readonly highlightWalk: string;
    readonly noChangeHere: string;
    readonly unchangedHere: string;
    readonly unchangedFile: string;
    readonly moreAbove: string;
    readonly moreBelow: string;
    readonly wholeContext: string;
    readonly hiddenLines: (count: number) => string;
    /** A fold that opens a few lines of a larger one. */
    readonly moreLines: (count: number, hidden: number) => string;
    /** A fold that opens the rest of the place's function or other unit. */
    readonly restOfUnit: (name: string, count: number) => string;
    readonly reading: string;
    readonly fileMissing: (path: string, side: string) => string;
    readonly nothingBefore: string;
    readonly nothingAfter: string;
    readonly invalidReference: (problem: string) => string;
    readonly binary: string;
    readonly selectLine: string;
    readonly legendOld: string;
    readonly legendNew: string;
    readonly legendFocus: string;
    readonly legendWalk: string;
  };
  readonly side: { readonly base: string; readonly target: string };
  readonly levels: {
    readonly change: string;
    readonly file: string;
    readonly context: string;
    readonly unit: Record<UnitKind, string>;
    readonly label: string;
  };
  readonly timeline: {
    readonly label: string;
    readonly hint: string;
    readonly call: string;
    readonly resize: string;
    readonly sourceIn: (place: string) => string;
    readonly showSource: (place: string) => string;
    readonly openSource: string;
    readonly sourceFor: (place: string) => string;
    readonly lineAt: (line: number) => string;
    readonly linesAt: (start: number, end: number) => string;
  };
  readonly nav: {
    readonly previous: string;
    readonly next: string;
    readonly placeOf: (stepId: string, index: number, total: number) => string;
  };
  readonly tree: { readonly title: string; readonly onlyChanged: string };
  readonly overviewTitle: string;
  readonly showMore: string;
  readonly showLess: string;
  /** The heading right above the walk list, after what it holds (Niclas's trial feedback, 29 October 2026). */
  readonly walksHeading: (walks: number, readings: number) => string;
  /** The discreet tag of a reading in the list and the step panel. */
  readonly readingTag: string;
  /** What deserves attention across the change, under the summary. */
  readonly attentionTitle: string;
  /** Long source lines wrap within the code pane. */
  readonly wrapLines: string;
  readonly wrapLinesTitle: string;
  /** The left column's divider, for screen readers. */
  readonly navigationWidth: string;
  /** Choosing among several preparations over the same change. */
  readonly preparedWalks: string;
  readonly purpose: string;
  readonly status: Record<'added' | 'modified' | 'deleted' | 'type-changed', string>;
  readonly decisions: {
    readonly changesHere: string;
    readonly noChangesHere: string;
    readonly remaining: string;
    readonly accepted: string;
    readonly exempted: string;
    readonly accept: string;
    readonly exempt: string;
    readonly withdraw: string;
    readonly confirm: string;
    readonly cancel: string;
    readonly reasonRequired: string;
    readonly commentOptional: string;
    readonly scope: (where: string, revision: string) => string;
    readonly notGuarantee: string;
    readonly yours: string;
  };
  readonly changeAt: (path: string, lines: string) => string;
  readonly newLines: (range: string) => string;
  readonly oldLines: (range: string) => string;
  readonly removedAfter: (line: number) => string;
  readonly note: {
    readonly question: string;
    readonly finding: string;
    readonly open: string;
    readonly resolved: string;
    readonly resolution: string;
    readonly markResolved: string;
    readonly reopen: string;
    readonly duringStep: (stepId: string) => string;
    readonly hereTitle: string;
  };
  readonly coverage: {
    readonly intro: (total: number) => string;
    readonly planned: string;
    readonly opened: string;
    readonly walked: string;
    readonly accepted: string;
    readonly exempted: string;
    readonly remaining: string;
    readonly agent: string;
    readonly agentNone: string;
    readonly open: string;
    readonly lines: (count: number) => string;
    readonly partly: (count: number) => string;
    readonly onlyOutside: (count: number) => string;
    readonly change: string;
    readonly yes: string;
    readonly no: string;
    readonly part: string;
  };
  readonly notesTab: { readonly notesTitle: string; readonly none: string; readonly historyTitle: string; readonly noDecisions: string };
  readonly search: {
    readonly revision: string;
    readonly placeholder: string;
    readonly button: string;
    readonly hits: (count: number, truncated: boolean) => string;
    readonly filter: (count: number, side: string) => string;
  };
  readonly filesTab: { readonly hunks: (count: number) => string; readonly binary: string; readonly decided: (accepted: number, exempted: number, remaining: number) => string };
  readonly detailsPanel: {
    readonly revisions: string;
    readonly base: string;
    readonly target: string;
    readonly oneCommit: string;
    readonly severalCommits: string;
    readonly repository: string;
    readonly definition: string;
    readonly readFromGit: string;
    readonly explanations: (mode: string) => string;
    readonly decisionsInfo: string;
    readonly validated: (all: number, anchored: number) => string;
    readonly problems: string;
    readonly languagesMissing: string;
    readonly definitionHistory: (count: number) => string;
  };
  readonly notices: {
    readonly unusable: (keptAs: string) => string;
    readonly definitionChanged: (carried: number, moved: number) => string;
    readonly dismiss: string;
  };
}

const sv: ReviewWords = {
  opening: 'Öppnar granskningen …',
  openDefinition: 'Öppna en granskningsdefinition …',
  openAnother: 'Öppna en annan granskning …',
  noDefinition: 'Ingen granskning angavs vid start. Välj en granskningsdefinition (*.review.json).',
  chooseFor: (folder) =>
    `Ingen granskning har öppnats för ${folder} ännu. Välj en granskningsdefinition (*.review.json); filväljaren börjar i den mappen.`,
  language: 'Språk',
  details: 'Detaljer',
  hideDetails: 'Dölj detaljer',
  saving: 'Sparar …',
  saved: 'Sparat',
  notSaved: (reason) =>
    `Inte sparat. Dina senaste ändringar finns bara i det här fönstret och sparas igen vid nästa ändring. Orsak: ${reason}`,
  openFindings: (count) => (count === 1 ? '1 öppet fynd' : `${String(count)} öppna fynd`),
  tabs: { walks: 'Walks', files: 'Ändrade filer', coverage: 'Täckning', notes: 'Anteckningar och beslut', search: 'Sök' },
  walkProgress: (opened, total) => `${String(opened)} av ${String(total)} steg öppnade`,
  stepOf: (index, total) => `Steg ${String(index)} av ${String(total)}`,
  whatHappens: 'Vad händer',
  whyItMatters: 'Varför det spelar roll',
  places: 'Kodställen i steget',
  placeOf: (index, total) => `${String(index)} av ${String(total)}`,
  previousPlace: 'Föregående kodställe',
  nextPlace: 'Nästa kodställe',
  previousStep: '← Föregående steg',
  nextStep: 'Nästa steg →',
  nextWalk: (id) => `Nästa walk (${id}) →`,
  navigationNote: 'Att gå vidare godkänner ingenting.',
  howDoWeKnow: 'Hur vet vi det?',
  showSources: 'Visa underlaget',
  hideSources: 'Dölj underlaget',
  evidenceLabel: {
    analysis: 'Läst ur koden',
    'test-simulated': 'Visat i ett automatiskt test med ersatta delar',
    'test-real-substitute': 'Visat i ett test med en riktig ersättningsprocess',
    'not-observed': 'Inte observerat',
  },
  evidenceMeaning: {
    analysis: 'Det här är vad vi kan läsa ut ur koden. Det visar inte i sig att det fungerar när programmet körs.',
    'test-simulated': 'Ett automatiskt test har visat beteendet, men delar av systemet var ersatta i testet. Underlaget nedan säger vilket test och vad som var ersatt.',
    'test-real-substitute': 'Ett test med en riktig lokal process som står i för en annan. Underlaget nedan säger vad den ersätter och vad som fortfarande var simulerat.',
    'not-observed': 'Ingenting i underlaget har observerat det här.',
  },
  reviewSection: 'Granskning',
  rightTabs: { step: 'Steg', discussion: 'Diskussion' },
  discussion: {
    empty: 'Fråga om koden du tittar på. Inget skickas förrän du trycker Enter.',
    about: 'Om',
    wholeReview: 'granskningen som helhet',
    placeholder: 'Fråga om koden – Enter skickar, Skift+Enter ny rad',
    stop: 'Stoppa',
    answering: 'Svaret är på väg…',
    stopping: 'Stoppar… räknas som stoppat först när leverantören bekräftar.',
    context: 'Kontext',
    goToPoint: 'Gå till punkten',
    pointGone: 'Punkten finns inte längre i walken; koden frågan gällde visas i stället.',
    status: { sending: 'Skickar…', unknown: 'Utfallet okänt', cancelled: 'Stoppad', failed: 'Misslyckades' },
    needsAcknowledgement: 'En tidigare fråga har inget känt utfall. Inget skickades om.',
    sendAnyway: 'Skicka ändå',
    continueAnyway: 'Fortsätt ändå',
    readOnly: (reason) => `Diskussionen kan bara läsas: ${reason}`,
    details: 'Detaljer',
    hideDetails: 'Dölj detaljer',
    agentLabel: 'Agent',
    chooseAgent: 'Välj en agent för diskussionen',
    notAvailable: 'inte tillgänglig',
    agentUnavailable: (agent, reason) => `${agent} kan inte användas här: ${reason}`,
    agentPolicy: (agent, policy) => `${agent} · ${policy}`,
    switchNotice: (agent, exchanges) =>
      `Nästa fråga startar en ny ${agent}-session; den får kodkontexten som visas under Kontext och en sammanfattning av ${String(exchanges)} tidigare ${exchanges === 1 ? 'utbyte' : 'utbyten'}`,
    showRecap: 'Visa',
    hideRecap: 'Dölj',
    leaveOut: 'Utelämna',
    includeAgain: 'Ta med igen',
    recapLeftOut: (agent) => `Nästa fråga startar en ny ${agent}-session med bara kodkontexten; sammanfattningen utelämnas.`,
    recordedBeforeProvider: 'Cursor (registrerat innan leverantören sparades)',
    agentLimits: 'Vad den får använda här',
    contextLabels: {
      subject: 'Gäller',
      revisions: 'Revisioner',
      code: 'Kod som skickades',
      notes: 'Dina anteckningar som skickades',
      instruction: 'DSpatchs instruktion',
      providerContext: 'Tillagt av leverantören',
      agent: 'Agent',
      model: 'Modell som begärdes',
      sent: 'Exakt text som skickades',
    },
    noCode: 'Ingen kod skickades.',
    noNotes: 'Inga.',
    notSent: 'Frågan nådde aldrig leverantören.',
  },
  markWalked: 'Markera steget som genomgånget',
  walkedUndo: 'Genomgånget ✓ – ångra',
  walkedNote: 'Genomgånget är din egen markering av framsteg. Det godkänner ingen kod.',
  outsideWalk: 'Utanför walken',
  backTo: (stepId) => `Tillbaka till ${stepId}`,
  backToCode: 'Tillbaka till koden',
  view: {
    before: 'Före',
    after: 'Efter',
    both: 'Före → Efter',
    shownFrom: 'Från',
    shownTo: 'Till',
    focus: 'Fokus',
    wholeFile: 'Hela filen',
    highlightWalk: 'Markera hela walken',
    noChangeHere: 'Ingen ändring på det här stället',
    unchangedHere: 'Oförändrad kod',
    unchangedFile: 'Filen är oförändrad mellan versionerna',
    moreAbove: 'Visa 20 rader till ovanför',
    moreBelow: 'Visa 20 rader till nedanför',
    wholeContext: 'Visa hela sammanhanget',
    hiddenLines: (count) => `⋯ visa ${String(count)} oförändrade rader`,
    moreLines: (count, hidden) => `⋯ visa ${String(count)} rader till (${String(hidden)} dolda)`,
    restOfUnit: (name, count) => `⋯ visa resten av ${name} (${String(count)} rader)`,
    reading: 'Läser filen …',
    fileMissing: (path, side) => `${path} finns inte i ${side}.`,
    nothingBefore: 'Ingen gammal kod här – de här raderna är nya.',
    nothingAfter: 'Ingen ny kod här – de här raderna är borttagna.',
    invalidReference: (problem) => `Kodreferensen kunde inte bekräftas mot versionen: ${problem}`,
    binary: 'Binärt innehåll visas inte.',
    selectLine: 'Välj raden för en anteckning (skift-klick utökar)',
    legendOld: 'Före (gammal kod)',
    legendNew: 'Efter (ny kod)',
    legendFocus: 'Det som steget förklarar',
    legendWalk: 'Övriga ställen i walken',
  },
  side: { base: 'gamla versionen', target: 'nya versionen' },
  levels: {
    change: 'Ändringen',
    file: 'Hela filen',
    context: 'Sammanhanget',
    unit: {
      function: 'Funktionen',
      method: 'Metoden',
      constructor: 'Konstruktorn',
      declaration: 'Deklarationen',
      type: 'Typen',
      class: 'Klassen',
      member: 'Medlemmen',
      block: 'Kodblocket',
    },
    label: 'Visa',
  },
  timeline: {
    label: 'Walkens kodställen i tidsordning',
    lineAt: (line) => `rad ${String(line)}`,
    linesAt: (start, end) => `rad ${String(start)}–${String(end)}`,
    hint: 'Shift + vänster musknapp och dra panorerar kartan. Mushjulsknappen och dra scrollar en panel. Shift + scrollhjul eller Alt + ← / → stegar.',
    call: 'källa',
    sourceIn: (place) => `källan visas i ${place}`,
    showSource: (place) => ` · visa källan i ${place}`,
    openSource: ' · öppna källan (den visas inte i walken)',
    sourceFor: (place) => `källa för ${place} →`,
    resize: 'Dra för att ändra bredd. Dubbelklicka för att passa den längsta raden.',
  },
  nav: {
    previous: '← Föregående',
    next: 'Nästa →',
    placeOf: (stepId, index, total) => `${stepId} · kodställe ${String(index)} av ${String(total)}`,
  },
  tree: { title: 'Filer', onlyChanged: 'Bara ändrade' },
  overviewTitle: 'Om ändringen',
  showMore: 'Visa mer',
  showLess: 'Visa mindre',
  walksHeading: (walks, readings) => (readings === 0 ? 'Walks' : walks === 0 ? 'Läsningar' : 'Walks och läsningar'),
  readingTag: 'Läsning',
  attentionTitle: 'Värt att granska',
  wrapLines: 'Radbryt',
  wrapLinesTitle: 'Bryt långa rader inom kodpanelen. Radnumren är filens egna.',
  navigationWidth: 'Vänsterspaltens bredd',
  preparedWalks: 'Förberedda walks',
  purpose: 'Syfte',
  status: { added: 'ny fil', modified: 'ändrad', deleted: 'borttagen', 'type-changed': 'typ ändrad' },
  decisions: {
    changesHere: 'Ändringar på det här stället',
    noChangesHere: 'Det här stället innehåller ingen ändring att fatta beslut om.',
    remaining: 'Inget beslut',
    accepted: 'Accepterad av dig',
    exempted: 'Undantagen av dig',
    accept: 'Acceptera …',
    exempt: 'Undanta …',
    withdraw: 'Återkalla beslutet',
    confirm: 'Bekräfta',
    cancel: 'Avbryt',
    reasonRequired: 'Skäl (krävs)',
    commentOptional: 'Kommentar (valfri)',
    scope: (where, revision) => `Gäller ${where}, i den granskade versionen (${revision}), som ditt eget beslut.`,
    notGuarantee: 'Acceptansen gäller bara den här ändringen i den här versionen och är ingen garanti för att koden är korrekt.',
    yours: 'du',
  },
  changeAt: (path, lines) => `ändringen i ${path}, ${lines}`,
  newLines: (range) => `nya rader ${range}`,
  oldLines: (range) => `gamla rader ${range}`,
  removedAfter: (line) => `borttaget efter ny rad ${String(line)}`,
  note: {
    question: 'Fråga',
    finding: 'Fynd',
    open: 'öppen',
    resolved: 'löst',
    resolution: 'Svar eller lösning (valfritt)',
    markResolved: 'Markera som löst',
    reopen: 'Öppna igen',
    duringStep: (stepId) => `under ${stepId}`,
    hereTitle: 'Anteckningar här',
  },
  coverage: {
    intro: (total) =>
      `Räknat i ändrade rader i diffen (tillägg + borttagningar): ${String(total)}. Varje rad är ett eget faktum; inget av dem följer av något annat.`,
    planned: 'Ingår i en walk',
    opened: 'I kodställen du har öppnat',
    walked: 'I steg du markerat som genomgångna',
    accepted: 'Accepterat av dig',
    exempted: 'Undantaget av dig',
    remaining: 'Inget beslut',
    agent: 'Accepterat av en agent',
    agentNone: 'inget – delegerad granskning finns inte i den här vyn',
    open: 'Öppna fynd / frågor',
    lines: (count) => `${String(count)} rader`,
    partly: (count) => ` + ${String(count)} ändringar delvis`,
    onlyOutside: (count) => `Visa bara ändringar utanför alla walks (${String(count)})`,
    change: 'Ändring',
    yes: 'ja',
    no: 'nej',
    part: 'delvis',
  },
  notesTab: {
    notesTitle: 'Frågor och fynd',
    none: 'Inga ännu.',
    historyTitle: 'Beslutshistorik',
    noDecisions: 'Inga beslut. Ingen ändring är accepterad.',
  },
  search: {
    revision: 'Version',
    placeholder: 'Sök text i hela repot',
    button: 'Sök',
    hits: (count, truncated) => `${String(count)} träffar${truncated ? ' (bara de första 500)' : ''}`,
    filter: (count, side) => `Filtrera alla ${String(count)} filer i ${side}`,
  },
  filesTab: {
    hunks: (count) => (count === 1 ? '1 ändring' : `${String(count)} ändringar`),
    binary: 'binär',
    decided: (accepted, exempted, remaining) =>
      `accepterade ${String(accepted)} · undantagna ${String(exempted)} · utan beslut ${String(remaining)}`,
  },
  detailsPanel: {
    revisions: 'Versioner',
    base: 'Gammal version (bas)',
    target: 'Ny version (mål)',
    oneCommit: 'En commit: basen är målets förälder.',
    severalCommits: 'Flera commits mellan bas och mål.',
    repository: 'Repo',
    definition: 'Walk-definition',
    readFromGit: 'All kod läses ur git vid de två versionerna, inte från en arbetskatalog.',
    explanations: (mode) =>
      `Förklaringarna är förberedd text, skriven i läget ”${mode}”. Vyn anpassar dem inte, och ingen agent är ansluten. Granskningsdjupet väljer du själv; inget på skärmen ändras av det.`,
    decisionsInfo: 'Beslut fattas bara av dig. Delegerad agentgranskning finns inte här och simuleras aldrig.',
    validated: (all, anchored) =>
      `Alla ${String(all)} kodreferenser i walkarna har kontrollerats mot sin version (sökväg och rader); ${String(anchored)} av dem även mot sin ankartext.`,
    problems: 'Problem i definitionen',
    languagesMissing: 'Den här definitionen har bara text på ett språk; den visas som den är skriven.',
    definitionHistory: (count) =>
      `Posten har använts med ${String(count)} tidigare version${count === 1 ? '' : 'er'} av walk-definitionen.`,
  },
  notices: {
    unusable: (keptAs) =>
      `En sparad post för den här granskningen kunde inte användas och sparades oförändrad som ${keptAs}. Granskningen börjar med en tom post.`,
    definitionChanged: (carried, moved) =>
      `Walk-definitionen har ändrats sedan posten sparades. Dina anteckningar och beslut gäller samma kod och finns kvar.${
        moved > 0
          ? ` ${String(moved)} steg som du öppnat eller markerat som genomgångna har ändrat innehåll; de markeringarna sparas som historik och räknas inte. Öppnat registreras när du öppnar steget igen, och genomgånget kräver din markering på nytt.`
          : ''
      }${carried > 0 ? ` ${String(carried)} steg är oförändrade och behåller sina markeringar.` : ''}`,
    dismiss: 'Stäng',
  },
};

const en: ReviewWords = {
  opening: 'Opening the review…',
  openDefinition: 'Open a review definition…',
  openAnother: 'Open another review…',
  noDefinition: 'No review was named at start. Choose a review definition (*.review.json).',
  chooseFor: (folder) =>
    `No review has been opened for ${folder} yet. Choose a review definition (*.review.json); the file chooser starts in that folder.`,
  language: 'Language',
  details: 'Details',
  hideDetails: 'Hide details',
  saving: 'Saving…',
  saved: 'Saved',
  notSaved: (reason) =>
    `Not saved. Your latest changes exist only in this window and are saved again with the next change. Reason: ${reason}`,
  openFindings: (count) => (count === 1 ? '1 open finding' : `${String(count)} open findings`),
  tabs: { walks: 'Walks', files: 'Changed files', coverage: 'Coverage', notes: 'Notes and decisions', search: 'Search' },
  walkProgress: (opened, total) => `${String(opened)} of ${String(total)} steps opened`,
  stepOf: (index, total) => `Step ${String(index)} of ${String(total)}`,
  whatHappens: 'What happens',
  whyItMatters: 'Why it matters',
  places: 'Code places in this step',
  placeOf: (index, total) => `${String(index)} of ${String(total)}`,
  previousPlace: 'Previous place',
  nextPlace: 'Next place',
  previousStep: '← Previous step',
  nextStep: 'Next step →',
  nextWalk: (id) => `Next walk (${id}) →`,
  navigationNote: 'Moving on approves nothing.',
  howDoWeKnow: 'How do we know?',
  showSources: 'Show the evidence',
  hideSources: 'Hide the evidence',
  evidenceLabel: {
    analysis: 'Read from the code',
    'test-simulated': 'Shown by an automated test with substituted parts',
    'test-real-substitute': 'Shown by a test with a real stand-in process',
    'not-observed': 'Not observed',
  },
  evidenceMeaning: {
    analysis: 'This is what we can read from the code. That alone does not show that it works when the program runs.',
    'test-simulated': 'An automated test has shown the behaviour, but parts of the system were substituted in the test. The evidence below says which test and what was substituted.',
    'test-real-substitute': 'A test with a real local process standing in for another. The evidence below says what it stands in for and what was still simulated.',
    'not-observed': 'Nothing in the evidence has observed this.',
  },
  reviewSection: 'Review',
  rightTabs: { step: 'Step', discussion: 'Discussion' },
  discussion: {
    empty: 'Ask about the code you are looking at. Nothing is sent until you press Enter.',
    about: 'About',
    wholeReview: 'the review as a whole',
    placeholder: 'Ask about this code – Enter sends, Shift+Enter for a new line',
    stop: 'Stop',
    answering: 'Answer on its way…',
    stopping: 'Stopping… it counts as stopped only when the provider confirms.',
    context: 'Context',
    goToPoint: 'Go to point',
    pointGone: 'This point is no longer in the walk; showing the code it was asked about.',
    status: { sending: 'Sending…', unknown: 'Outcome unknown', cancelled: 'Stopped', failed: 'Failed' },
    needsAcknowledgement: 'An earlier question has no known outcome. Nothing was resent.',
    sendAnyway: 'Send anyway',
    continueAnyway: 'Continue anyway',
    readOnly: (reason) => `This discussion is read-only: ${reason}`,
    details: 'Details',
    hideDetails: 'Hide details',
    agentLabel: 'Agent',
    chooseAgent: 'Choose an agent for this discussion',
    notAvailable: 'not available',
    agentUnavailable: (agent, reason) => `${agent} cannot be used here: ${reason}`,
    agentPolicy: (agent, policy) => `${agent} · ${policy}`,
    switchNotice: (agent, exchanges) =>
      `Next question starts a new ${agent} session; it carries the code context shown under Context and a recap of ${String(exchanges)} earlier exchange${exchanges === 1 ? '' : 's'}`,
    showRecap: 'Show',
    hideRecap: 'Hide',
    leaveOut: 'Leave out',
    includeAgain: 'Include again',
    recapLeftOut: (agent) => `Next question starts a new ${agent} session with the code context only; the recap is left out.`,
    recordedBeforeProvider: 'Cursor (recorded before the provider was stored)',
    agentLimits: 'What it may use here',
    contextLabels: {
      subject: 'About',
      revisions: 'Revisions',
      code: 'Code sent',
      notes: 'Your notes sent',
      instruction: "DSpatch's instruction",
      providerContext: 'Added by the provider',
      agent: 'Agent',
      model: 'Model asked for',
      sent: 'Exact text sent',
    },
    noCode: 'No code was sent.',
    noNotes: 'None.',
    notSent: 'The question never reached the provider.',
  },
  markWalked: 'Mark this step walked through',
  walkedUndo: 'Walked through ✓ – undo',
  walkedNote: 'Walked through is your own mark of progress. It approves no code.',
  outsideWalk: 'Outside the walk',
  backTo: (stepId) => `Back to ${stepId}`,
  backToCode: 'Back to the code',
  view: {
    before: 'Before',
    after: 'After',
    both: 'Before → After',
    shownFrom: 'From',
    shownTo: 'To',
    focus: 'Focus',
    wholeFile: 'Whole file',
    highlightWalk: 'Highlight entire walk',
    noChangeHere: 'No change at this place',
    unchangedHere: 'Unchanged code',
    unchangedFile: 'The file is the same in both versions',
    moreAbove: 'Show 20 more lines above',
    moreBelow: 'Show 20 more lines below',
    wholeContext: 'Show the whole context',
    hiddenLines: (count) => `⋯ show ${String(count)} unchanged lines`,
    moreLines: (count, hidden) => `⋯ show ${String(count)} more lines (${String(hidden)} hidden)`,
    restOfUnit: (name, count) => `⋯ show the rest of ${name} (${String(count)} lines)`,
    reading: 'Reading the file…',
    fileMissing: (path, side) => `${path} does not exist in the ${side}.`,
    nothingBefore: 'No old code here – these lines are new.',
    nothingAfter: 'No new code here – these lines were removed.',
    invalidReference: (problem) => `The code reference could not be confirmed against the version: ${problem}`,
    binary: 'Binary content is not shown.',
    selectLine: 'Select this line for a note (shift-click extends)',
    legendOld: 'Before (old code)',
    legendNew: 'After (new code)',
    legendFocus: 'What this step explains',
    legendWalk: 'Other places in the walk',
  },
  side: { base: 'old version', target: 'new version' },
  levels: {
    change: 'The change',
    file: 'Whole file',
    context: 'The context',
    unit: {
      function: 'The function',
      method: 'The method',
      constructor: 'The constructor',
      declaration: 'The declaration',
      type: 'The type',
      class: 'The class',
      member: 'The member',
      block: 'The block',
    },
    label: 'Show',
  },
  timeline: {
    label: 'The walk’s code places in time order',
    lineAt: (line) => `line ${String(line)}`,
    linesAt: (start, end) => `lines ${String(start)}–${String(end)}`,
    hint: 'Shift + left mouse button and drag pans the map. The wheel button and drag scrolls one pane. Shift + scroll wheel or Alt + ← / → steps.',
    call: 'source',
    sourceIn: (place) => `the source is shown in ${place}`,
    showSource: (place) => ` · show the source in ${place}`,
    openSource: ' · open the source (no pane of the walk shows it)',
    sourceFor: (place) => `source for ${place} →`,
    resize: 'Drag to change the width. Double-click to fit the longest line.',
  },
  nav: {
    previous: '← Previous',
    next: 'Next →',
    placeOf: (stepId, index, total) => `${stepId} · place ${String(index)} of ${String(total)}`,
  },
  tree: { title: 'Files', onlyChanged: 'Changed only' },
  overviewTitle: 'About the change',
  showMore: 'Show more',
  showLess: 'Show less',
  walksHeading: (walks, readings) => (readings === 0 ? 'Walks' : walks === 0 ? 'Readings' : 'Walks and readings'),
  readingTag: 'Reading',
  attentionTitle: 'Worth checking',
  wrapLines: 'Wrap lines',
  wrapLinesTitle: "Wrap long lines within the code pane. The line numbers stay the file's own.",
  navigationWidth: 'Width of the left column',
  preparedWalks: 'Prepared walks',
  purpose: 'Purpose',
  status: { added: 'new file', modified: 'changed', deleted: 'deleted', 'type-changed': 'type changed' },
  decisions: {
    changesHere: 'Changes at this place',
    noChangesHere: 'This place contains no change to decide on.',
    remaining: 'No decision',
    accepted: 'Accepted by you',
    exempted: 'Exempted by you',
    accept: 'Accept…',
    exempt: 'Exempt…',
    withdraw: 'Withdraw the decision',
    confirm: 'Confirm',
    cancel: 'Cancel',
    reasonRequired: 'Reason (required)',
    commentOptional: 'Comment (optional)',
    scope: (where, revision) => `Applies to ${where}, in the reviewed version (${revision}), as your own decision.`,
    notGuarantee: 'Acceptance covers only this change in this version and is no guarantee that the code is correct.',
    yours: 'you',
  },
  changeAt: (path, lines) => `the change in ${path}, ${lines}`,
  newLines: (range) => `new lines ${range}`,
  oldLines: (range) => `old lines ${range}`,
  removedAfter: (line) => `removed after new line ${String(line)}`,
  note: {
    question: 'Question',
    finding: 'Finding',
    open: 'open',
    resolved: 'resolved',
    resolution: 'Answer or resolution (optional)',
    markResolved: 'Mark resolved',
    reopen: 'Reopen',
    duringStep: (stepId) => `during ${stepId}`,
    hereTitle: 'Notes here',
  },
  coverage: {
    intro: (total) =>
      `Counted in changed lines of the diff (additions + deletions): ${String(total)}. Each row is a separate fact; none follows from another.`,
    planned: 'In a walk',
    opened: 'In code places you opened',
    walked: 'In steps you marked walked through',
    accepted: 'Accepted by you',
    exempted: 'Exempted by you',
    remaining: 'No decision',
    agent: 'Accepted by an agent',
    agentNone: 'none – delegated review is not available in this view',
    open: 'Open findings / questions',
    lines: (count) => `${String(count)} lines`,
    partly: (count) => ` + ${String(count)} changes partly`,
    onlyOutside: (count) => `Show only changes outside every walk (${String(count)})`,
    change: 'Change',
    yes: 'yes',
    no: 'no',
    part: 'partly',
  },
  notesTab: {
    notesTitle: 'Questions and findings',
    none: 'None yet.',
    historyTitle: 'Decision history',
    noDecisions: 'No decisions. No change is accepted.',
  },
  search: {
    revision: 'Version',
    placeholder: 'Search text in the whole repository',
    button: 'Search',
    hits: (count, truncated) => `${String(count)} hits${truncated ? ' (first 500 only)' : ''}`,
    filter: (count, side) => `Filter all ${String(count)} files in the ${side}`,
  },
  filesTab: {
    hunks: (count) => (count === 1 ? '1 change' : `${String(count)} changes`),
    binary: 'binary',
    decided: (accepted, exempted, remaining) =>
      `accepted ${String(accepted)} · exempted ${String(exempted)} · no decision ${String(remaining)}`,
  },
  detailsPanel: {
    revisions: 'Versions',
    base: 'Old version (base)',
    target: 'New version (target)',
    oneCommit: 'One commit: the base is the target’s parent.',
    severalCommits: 'Several commits between base and target.',
    repository: 'Repository',
    definition: 'Walk definition',
    readFromGit: 'All code is read from git at the two versions, not from a working tree.',
    explanations: (mode) =>
      `The explanations are prepared text, written in the “${mode}” mode. The view does not adapt them, and no agent is connected. Review depth is your choice; nothing on screen changes with it.`,
    decisionsInfo: 'Decisions are made only by you. Delegated agent review is not available here and is never simulated.',
    validated: (all, anchored) =>
      `All ${String(all)} code references in the walks were checked against their version (path and lines); ${String(anchored)} of them also against their anchor text.`,
    problems: 'Problems in the definition',
    languagesMissing: 'This definition has text in only one language; it is shown as written.',
    definitionHistory: (count) =>
      `This record has been used with ${String(count)} earlier version${count === 1 ? '' : 's'} of the walk definition.`,
  },
  notices: {
    unusable: (keptAs) =>
      `A stored record for this review could not be used and was kept unchanged as ${keptAs}. The review starts with an empty record.`,
    definitionChanged: (carried, moved) =>
      `The walk definition has changed since the record was saved. Your notes and decisions are about the same code and are kept.${
        moved > 0
          ? ` ${String(moved)} steps you opened or marked walked through have changed content; those marks are kept as history and no longer count. Opened is registered when you open the step again, and walked through needs your mark again.`
          : ''
      }${carried > 0 ? ` ${String(carried)} steps are unchanged and keep their marks.` : ''}`,
    dismiss: 'Close',
  },
};

export const WORDS: Record<Lang, ReviewWords> = { sv, en };

/** A prepared text in the chosen language. */
export function pick(text: LocalText, lang: Lang): string {
  return text[lang];
}
