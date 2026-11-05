/**
 * A delegated review's result as a person reads it (DSP-158): what was approved and what
 * remains first, then the findings, each with a heading and a short explanation, repeats
 * gathered. Pure, and only a reading: nothing here changes a result, a decision or what
 * counts as approved, and everything the agent said stays reachable from what it returns.
 *
 * **What was approved is DSpatch's statement, read from the checked ranges.** The agent's
 * own words are shown beside it as its words; they never decide whether a part reads as
 * wholly approved. A part is wholly approved only when every changed line in it is among
 * the approved lines. Where the changed lines are not known, it is never said to be whole.
 *
 * **Older results read too.** They have one `text` for each finding and no summary, so the
 * heading is the first sentence and the summary the start of the assessment. No new field
 * is required of them.
 */

import { changedLinesOf, lineKey, rangesOf, type AgentFinding, type DelegationResult, type DelegationScope, type LineRange, type PairFile } from './review-pair';

/** How the delegated part stands. `partial` is never `whole` with a smaller number. */
export type ReviewStanding = 'whole' | 'partial' | 'none' | 'insufficient';

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
  /** Three words for the folded line: the same fact as `approvedLine`. */
  readonly standingWords: string;
  /** What was approved, from the checked ranges. */
  readonly approvedLine: string;
  /** What remains or needs attention, or that nothing does. */
  readonly attentionLine: string;
  /** The agent's own short words, or `''`. */
  readonly agentSummary: string;
  /** The whole assessment, unless `agentSummary` already says all of it. */
  readonly reasoning: string;
  /** Problems first, then questions, then notes. */
  readonly findings: readonly FindingGroup[];
  readonly uncertainties: readonly string[];
  /** Changed lines of the part that were not approved, or `null` when they are not known. */
  readonly notApproved: readonly LineRange[] | null;
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

/** The changed lines of the part that were not approved, or `null` when `files` is not known. */
export function notApprovedOf(result: DelegationResult, scope: DelegationScope | null, files: readonly PairFile[] | null): { readonly total: number; readonly left: readonly LineRange[] } | null {
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

export function delegatedReviewView(result: DelegationResult, scope: DelegationScope | null, files: readonly PairFile[] | null): DelegatedReviewView {
  const findings = gatherFindings(result.findings);
  const uncertainties = [...new Map(result.uncertainties.map((entry) => [sameKey(entry), entry])).values()];
  const approved = lineCount(result.approved);
  const known = notApprovedOf(result, scope, files);
  const remaining = known === null ? 0 : lineCount(known.left);
  const standing: ReviewStanding = result.insufficient ? 'insufficient' : approved === 0 ? 'none' : known !== null && remaining === 0 ? 'whole' : 'partial';
  const approvedLine =
    standing === 'insufficient'
      ? 'Nothing approved: the agent could not judge this part from the code it could read.'
      : standing === 'none'
        ? 'Nothing approved in this part.'
        : known === null
          ? `${lines(approved)} reviewed and approved by the agent. Whether that is all of this part is not known here.`
          : // DSP-175: the coverage as a count, never a dominant "whole part approved" that
            // reads as if nothing remained; what remains is said apart from it.
            `${String(approved)}/${lines(known.total)} reviewed and approved by the agent.`;
  const count = (severity: AgentFinding['severity']): number => findings.filter((finding) => finding.severity === severity).length;
  const attention = [
    ...(remaining > 0 ? [`${lines(remaining)} not approved`] : []),
    ...(count('problem') > 0 ? [counted(count('problem'), 'problem', 'problems')] : []),
    ...(count('question') > 0 ? [counted(count('question'), 'question', 'questions')] : []),
    ...(uncertainties.length > 0 ? [counted(uncertainties.length, 'thing not established', 'things not established')] : []),
  ];
  const assessment = result.assessment.trim();
  const fromAssessment = clipped(firstSentence(assessment), SUMMARY_CHARS);
  const agentSummary = result.summary?.trim() || fromAssessment;
  return {
    standing,
    standingWords: standing === 'whole' ? 'all lines approved' : standing === 'partial' ? 'partly approved' : standing === 'none' ? 'nothing approved' : 'not enough to judge',
    approvedLine,
    attentionLine: attention.length === 0 ? 'Nothing else was reported as needing attention.' : `Needs attention: ${attention.join(', ')}.`,
    agentSummary,
    reasoning: tidy(assessment) === tidy(agentSummary) ? '' : assessment,
    findings,
    uncertainties,
    notApproved: known?.left ?? null,
  };
}
