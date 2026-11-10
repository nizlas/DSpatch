/**
 * A delegated review's result as a person reads it (DSP-158, reshaped by DSP-193): the
 * state first (the agent's assessment awaiting the person's decision, accepted by the
 * person, or not accepted), then what the agent examined and what it assessed acceptable,
 * then the findings, each with a heading and a short explanation, repeats gathered. Pure,
 * and only a reading: nothing here changes a result, a decision or what counts as
 * reviewed, and everything the agent said stays reachable from what it returns.
 *
 * **The agent's assessment is the agent's; the decision is the person's** (Niclas's
 * decision of 10 November 2026). What the agent examined and assessed is DSpatch's
 * statement, read from the checked ranges; the agent's own words are shown beside it as
 * its words and never decide the extent. A part is wholly assessed only when every changed
 * line in it is among the assessed lines; where the changed lines are not known, no exact
 * coverage is made up.
 *
 * **Older results read too.** They have one `text` for each finding and no summary, so the
 * heading is the first sentence and the summary the start of the assessment. A result the
 * person never decided about reads as awaiting their assessment, whenever it was made.
 */

import { changedLinesOf, lineKey, rangesOf, type AgentFinding, type DelegationResult, type DelegationScope, type LineRange, type PairFile, type PairMark } from './review-pair';

/** How far the agent's assessment reaches over the delegated part. `partial` is never `whole` with a smaller number. */
export type ReviewStanding = 'whole' | 'partial' | 'none' | 'insufficient';

/** The person's decision about the delegated review. */
export type DecisionState = 'awaiting' | 'accepted' | 'rejected';

export interface FindingGroup {
  readonly severity: AgentFinding['severity'];
  readonly title: string;
  /** The problem and what it leads to; empty when the heading says all of it. */
  readonly explanation: string;
  /** What is shown on request: its longer reasoning and any differently worded repeat. */
  readonly details: string;
  /** Each place it was reported at, once. */
  readonly places: readonly LineRange[];
  /** How many findings of the answer this gathers. */
  readonly reported: number;
}

export interface DelegatedReviewView {
  readonly standing: ReviewStanding;
  readonly decision: DecisionState;
  /** A few words for the folded line: the decision's state, or why there is nothing to decide. */
  readonly standingWords: string;
  /** The state, first: awaiting the person's assessment, accepted or not accepted, with the date and reason when there are any. */
  readonly stateLine: string;
  /** What the agent examined and what it assessed acceptable, from the checked ranges; no figure the material does not support. */
  readonly examinedLine: string;
  /** What the result itself reports as needing attention (problems, questions, things not established), or that nothing does. */
  readonly attentionLine: string;
  /** The agent's own short words, or `''`. */
  readonly agentSummary: string;
  /** The whole assessment, unless `agentSummary` already says all of it. */
  readonly reasoning: string;
  /** Problems first, then questions, then notes. */
  readonly findings: readonly FindingGroup[];
  readonly uncertainties: readonly string[];
  /** Changed lines of the part the agent did not assess acceptable, or `null` when they are not known. */
  readonly notAssessed: readonly LineRange[] | null;
  /** Whether the person can accept: the agent assessed something, and the review was not insufficient. */
  readonly acceptable: boolean;
}

const ORDER: readonly AgentFinding['severity'][] = ['problem', 'question', 'note'];

const HEADING_CHARS = 90;

const SUMMARY_CHARS = 240;

function lineCount(ranges: readonly LineRange[]): number {
  return ranges.reduce((total, range) => total + range.end - range.start + 1, 0);
}

function lines(count: number): string {
  return `${String(count)} changed ${count === 1 ? 'line' : 'lines'}`;
}

function counted(count: number, one: string, many: string): string {
  return `${String(count)} ${count === 1 ? one : many}`;
}

function tidy(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** The first sentence: a full stop or the like followed by a space, or a line break. */
function firstSentence(text: string): string {
  const found = /^[\s\S]*?(?:[.!?](?=\s)|\n)/.exec(text.trim());
  return tidy(found?.[0] ?? text);
}

/** At most `limit` characters, cut between words. */
function clipped(text: string, limit: number): string {
  if (text.length <= limit) {
    return text;
  }
  const cut = text.slice(0, limit - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > limit / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** A heading and the explanation under it, for a finding with a heading or an older one without. */
export function headed(finding: AgentFinding): { readonly title: string; readonly explanation: string } {
  const text = finding.text.trim();
  if (finding.title !== undefined) {
    return { title: tidy(finding.title), explanation: tidy(finding.title) === tidy(text) ? '' : text };
  }
  const sentence = firstSentence(text);
  if (sentence.length > HEADING_CHARS) {
    return { title: clipped(sentence, HEADING_CHARS - 10), explanation: text };
  }
  const rest = text.startsWith(sentence) ? text.slice(sentence.length).trim() : tidy(text) === sentence ? '' : text;
  return { title: sentence.replace(/[.:]$/, ''), explanation: rest };
}

/** Two findings are the same when they differ only in case, spacing or a number such as a line. */
export function sameKey(text: string): string {
  return text.toLowerCase().replace(/\d+/g, '#').replace(/[^\p{L}\p{N}#]+/gu, ' ').trim();
}

function samePlace(a: LineRange, b: LineRange): boolean {
  return a.side === b.side && a.path === b.path && a.start === b.start && a.end === b.end;
}

/** The findings with repeats gathered: nothing the agent said is dropped. */
export function gatherFindings(findings: readonly AgentFinding[]): readonly FindingGroup[] {
  interface Gathering {
    severity: AgentFinding['severity'];
    readonly title: string;
    readonly explanation: string;
    readonly more: string[];
    readonly places: LineRange[];
    reported: number;
  }
  const groups = new Map<string, Gathering>();
  for (const finding of findings) {
    const { title, explanation } = headed(finding);
    const key = sameKey(finding.title ?? finding.text);
    let group = groups.get(key);
    if (group === undefined) {
      group = { severity: finding.severity, title, explanation, more: [], places: [], reported: 0 };
      groups.set(key, group);
    } else {
      // The same thing reported twice stands at the more serious of the two.
      if (ORDER.indexOf(finding.severity) < ORDER.indexOf(group.severity)) {
        group.severity = finding.severity;
      }
      if (explanation !== '' && sameKey(explanation) !== sameKey(group.explanation) && !group.more.some((entry) => sameKey(entry) === sameKey(explanation))) {
        group.more.push(explanation);
      }
    }
    group.reported += 1;
    const details = finding.details?.trim() ?? '';
    if (details !== '' && !group.more.some((entry) => sameKey(entry) === sameKey(details))) {
      group.more.push(details);
    }
    const place = finding.location;
    if (place !== null && !group.places.some((known) => samePlace(known, place))) {
      group.places.push(place);
    }
  }
  return [...groups.values()]
    .map(({ more, ...group }) => ({ ...group, details: more.join('\n\n') }))
    .sort((a, b) => ORDER.indexOf(a.severity) - ORDER.indexOf(b.severity));
}

function inRange(range: LineRange, line: { readonly side: LineRange['side']; readonly path: string; readonly line: number }): boolean {
  return range.side === line.side && range.path === line.path && line.line >= range.start && line.line <= range.end;
}

/** The changed lines of the part the agent did not assess acceptable, or `null` when `files` is not known. */
export function notAssessedOf(result: DelegationResult, scope: DelegationScope | null, files: readonly PairFile[] | null): { readonly total: number; readonly left: readonly LineRange[] } | null {
  if (scope === null || files === null || files.length === 0) {
    return null;
  }
  const inScope = files.flatMap((file) => changedLinesOf(file)).filter((line) => scope.ranges.some((range) => inRange(range, line)));
  const unique = [...new Map(inScope.map((line) => [lineKey(line), line])).values()];
  if (unique.length === 0) {
    return null;
  }
  return { total: unique.length, left: rangesOf(unique.filter((line) => !result.approved.some((range) => inRange(range, line)))) };
}

/** The day of an ISO time, for a sentence; `''` when it cannot be read. */
function dayOf(iso: string): string {
  return /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : '';
}

/** How the person's decision about the job reads: `null` or a withdrawn decision is awaiting. */
export function decisionStateOf(decision: PairMark | null): DecisionState {
  return decision?.op === 'accept-agent' ? 'accepted' : decision?.op === 'reject-agent' ? 'rejected' : 'awaiting';
}

export function delegatedReviewView(result: DelegationResult, scope: DelegationScope | null, files: readonly PairFile[] | null, decision: PairMark | null = null): DelegatedReviewView {
  const findings = gatherFindings(result.findings);
  const uncertainties = [...new Map(result.uncertainties.map((entry) => [sameKey(entry), entry])).values()];
  const examined = lineCount(result.reviewed);
  const assessed = lineCount(result.approved);
  const known = notAssessedOf(result, scope, files);
  const remaining = known === null ? 0 : lineCount(known.left);
  const standing: ReviewStanding = result.insufficient ? 'insufficient' : assessed === 0 ? 'none' : known !== null && remaining === 0 ? 'whole' : 'partial';
  const state = decisionStateOf(decision);
  const acceptable = standing !== 'insufficient' && assessed > 0;
  const day = decision === null ? '' : dayOf(decision.at);
  const reason = decision === null || decision.reason.trim() === '' ? '' : ` Your note: ${decision.reason.trim()}`;
  const stateLine =
    state === 'accepted'
      ? `Accepted by you${day === '' ? '' : ` on ${day}`}: the lines the agent assessed count as reviewed through this delegation.${reason}`
      : state === 'rejected'
        ? `Not accepted by you${day === '' ? '' : ` on ${day}`}: nothing from this review counts as reviewed.${reason}`
        : standing === 'insufficient'
          ? 'Agent review complete: the agent could not judge this part from the code it could read, so there is nothing to accept.'
          : assessed === 0
            ? 'Agent review complete: the agent assessed nothing as acceptable, so there is nothing to accept.'
            : 'Agent review complete — awaiting your assessment. Nothing counts as reviewed until you accept it.';
  const examinedLine =
    standing === 'insufficient'
      ? `The agent examined ${lines(examined)} and found the material not enough to judge this part; it assessed none as acceptable.`
      : known === null
        ? `The agent examined ${lines(examined)} and assessed ${assessed === 0 ? 'none' : String(assessed)} as acceptable. Whether that is all of this part is not known here.`
        : `The agent examined ${String(examined)} of ${lines(known.total)} in this part and assessed ${assessed === 0 ? 'none' : String(assessed)} as acceptable.${remaining > 0 && assessed > 0 ? ` ${lines(remaining)} of the part ${remaining === 1 ? 'is' : 'are'} not assessed acceptable.` : ''}`;
  const count = (severity: AgentFinding['severity']): number => findings.filter((finding) => finding.severity === severity).length;
  const attention = [
    ...(count('problem') > 0 ? [counted(count('problem'), 'problem', 'problems')] : []),
    ...(count('question') > 0 ? [counted(count('question'), 'open question', 'open questions')] : []),
    ...(uncertainties.length > 0 ? [counted(uncertainties.length, 'verification gap', 'verification gaps')] : []),
  ];
  const assessment = result.assessment.trim();
  const fromAssessment = clipped(firstSentence(assessment), SUMMARY_CHARS);
  const agentSummary = result.summary?.trim() || fromAssessment;
  return {
    standing,
    decision: state,
    standingWords:
      state === 'accepted'
        ? 'accepted by you'
        : state === 'rejected'
          ? 'not accepted by you'
          : standing === 'insufficient'
            ? 'not enough to judge'
            : assessed === 0
              ? 'nothing assessed acceptable'
              : 'awaiting your assessment',
    stateLine,
    examinedLine,
    attentionLine: attention.length === 0 ? 'The agent reported nothing else as needing attention.' : `Reported by the agent: ${attention.join(' · ')}.`,
    agentSummary,
    reasoning: tidy(assessment) === tidy(agentSummary) ? '' : assessment,
    findings,
    uncertainties,
    notAssessed: known?.left ?? null,
    acceptable,
  };
}
