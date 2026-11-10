// @ts-nocheck: an evaluation harness over the product's untyped stores.
/**
 * Lay the texts of a profile-real-trial run side by side (DSP-192 follow-up): for the simple step
 * and the complex step, the three profiles as the loop's writer wrote them (one loop per profile,
 * each with its own plan) and the two alternatives the step explanation channel made after the
 * Standard walk, with the plans, the reviewer's verdicts and the runs' summaries.
 *
 *     node scripts/profile-real-collect.mjs <evidence folder> [<output .md>]
 *
 * Reads `summary.json` and `reviews-final/` under the evidence folder, which
 * scripts/profile-real-trial.mjs wrote. Nothing is judged here; the judgment is written by hand.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const evidence = path.resolve(process.argv[2] ?? '');
const out = path.resolve(process.argv[3] ?? path.join(evidence, 'side-by-side.md'));
const summary = JSON.parse(fs.readFileSync(path.join(evidence, 'summary.json'), 'utf8'));
const reviews = path.join(evidence, 'reviews-final');

const text = (value) => (typeof value === 'string' ? value : value === null || value === undefined ? '' : (value.en ?? value.sv ?? ''));
const files = (folder, suffix) => {
  const found = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(suffix)) found.push(full);
    }
  };
  walk(folder);
  return found;
};
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const minutes = (a, b) => (a && b ? `${(Math.round(((new Date(b) - new Date(a)) / 60000) * 10) / 10).toString()} min` : 'unknown');

function stepsOf(definition) {
  return definition.walks.flatMap((walk) =>
    walk.steps.map((step) => ({
      walkId: walk.id,
      walkTitle: text(walk.title),
      id: step.id,
      title: text(step.title),
      summary: text(step.summary),
      body: text(step.body),
      details: text(step.details),
      together: text(step.together),
      places: step.places.map((place) => ({ label: text(place.label), ...(place.focus ?? {}) })),
    })),
  );
}
const covers = (step, file, line) => step.places.some((place) => place.side === 'target' && String(place.path ?? '').replaceAll('\\', '/').endsWith(file) && place.start <= line && line <= place.end);
/** The two anchors: the registration in startSession (target session.ts line 4) and settle's body (target link.ts line 34). */
const anchors = {
  simple: { name: 'the registration in startSession', find: (steps) => steps.find((step) => covers(step, 'src/session.ts', 4)) ?? null },
  complex: { name: 'settle: the slot emptied and the callback deferred', find: (steps) => steps.find((step) => covers(step, 'src/link.ts', 34)) ?? steps.find((step) => covers(step, 'src/link.ts', 36)) ?? null },
};

function reviewerVerdicts(run) {
  const record = files(path.join(reviews, 'generated', run.key), 'record.jsonl').find((file) => file.includes(run.jobId));
  if (!record) return [];
  const lines = fs.readFileSync(record, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  return lines
    .filter((line) => line.line === 'agent-reply' && line.reply.nodeId === 'review')
    .map((line) => {
      const match = /```json\s*([\s\S]*?)```/.exec(line.reply.text);
      try {
        const parsed = JSON.parse(match ? match[1] : line.reply.text);
        return { occurrence: line.reply.occurrence, verdict: parsed.verdict ?? null, assessment: parsed.assessment ?? '', findings: parsed.findings ?? [] };
      } catch {
        return { occurrence: line.reply.occurrence, verdict: null, assessment: line.reply.text.slice(0, 400), findings: [] };
      }
    });
}
function loopSummary(run) {
  const file = files(path.join(reviews, 'generated', run.key), 'summary.json').find((entry) => entry.includes(run.jobId));
  return file ? readJson(file) : null;
}
function writerTurns(run) {
  const record = files(path.join(reviews, 'generated', run.key), 'record.jsonl').find((file) => file.includes(run.jobId));
  if (!record) return 0;
  return fs.readFileSync(record, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)).filter((line) => line.line === 'agent-reply' && line.reply.nodeId === 'write').length;
}

const runs = summary.runs.map((run) => {
  const definitionFile = files(path.join(reviews, 'generated', run.key), '.review.json').find((file) => path.basename(file).startsWith(run.jobId)) ?? null;
  const definition = definitionFile ? readJson(definitionFile) : null;
  const steps = definition ? stepsOf(definition) : [];
  return { ...run, definition, steps, verdicts: reviewerVerdicts(run), loop: loopSummary(run), writerTurns: writerTurns(run) };
});
const explanationFiles = files(reviews, '.explanations.json');
const explanations = explanationFiles.flatMap((file) => (readJson(file).entries ?? []).map((entry) => ({ ...entry, file: path.basename(file) })));
const entryText = (entry) => {
  for (const key of ['text', 'answer', 'body', 'markdown', 'explanation', 'content']) {
    if (typeof entry[key] === 'string' && entry[key].trim() !== '') return entry[key];
  }
  const long = Object.entries(entry).filter(([key, value]) => key !== 'prompt' && typeof value === 'string' && value.length > 80).map(([key, value]) => `**${key}:**\n\n${value}`);
  return long.length > 0 ? long.join('\n\n') : `_(no text field found; keys: ${Object.keys(entry).join(', ')})_`;
};

const PROFILE_NAMES = { essens: 'Essentials', standard: 'Standard', pedagog: 'Teacher' };
const lines = [];
const push = (...rows) => lines.push(...rows);
push('# The three profiles through the real provider flow: the texts side by side', '');
push(`Provider **${summary.provider}**, model **${summary.model}**, instruction version ${String(runs[0]?.definition?.presentation?.version ?? "unknown")}. The synthetic connect case (base ${summary.project.base.slice(0, 12)}, target ${summary.project.target.slice(0, 12)}), the same two files at the same two revisions in every run. Three loop runs, one per profile, each with the planner's own plan; then on the Standard walk the reading profile switched to Essentials and to Teacher on the two steps, which made a step explanation through the step explanation channel. Generation path is named at every text.`, '');

push('## The runs', '', '| Profile | Generation path | Started (UTC) | Duration | Walks / steps | Writer turns | Reviewer |', '| --- | --- | --- | --- | --- | --- | --- |');
for (const run of runs) {
  const verdicts = run.verdicts.map((v) => `${String(v.occurrence)}: ${v.verdict ?? '?'}${v.findings.length > 0 ? ` (${String(v.findings.length)} finding(s))` : ''}`).join('; ');
  push(`| ${PROFILE_NAMES[run.profile] ?? run.profile} | the loop (planner, writer, reviewer) | ${String(run.startedAt ?? '').slice(0, 19).replace('T', ' ')} | ${minutes(run.startedAt, run.endedAt)} | ${run.definition ? `${String(run.definition.walks.length)} / ${String(run.steps.length)}` : 'no definition'} | ${String(run.writerTurns)} | ${verdicts || 'none'} |`);
}
for (const entry of explanations) {
  push(`| ${PROFILE_NAMES[entry.profile] ?? entry.profile} (alternative of ${entry.stepId}) | the step explanation channel, after the Standard walk | ${String(entry.at ?? entry.startedAt ?? "").slice(0, 19).replace('T', ' ')} | ${(entry.instructionVersion ? `v${String(entry.instructionVersion)}, ${entry.trigger ?? ""}` : "")} | – | – | – |`);
}
push('');

push('## The plans', '');
for (const run of runs) {
  push(`### ${PROFILE_NAMES[run.profile] ?? run.profile} run (${run.jobId})`, '');
  if (!run.definition) {
    push('_No definition was written._', '');
    continue;
  }
  for (const walk of run.definition.walks) {
    push(`- **${walk.id}** ${text(walk.title)}`);
    for (const step of walk.steps) push(`  - ${step.id} ${text(step.title)} · ${step.places.map((place) => `${place.focus?.path ?? ''} ${String(place.focus?.start ?? '')}–${String(place.focus?.end ?? '')} (${place.focus?.side ?? ''})`).join('; ')}`);
  }
  push('');
  for (const verdict of run.verdicts) {
    push(`Reviewer, visit ${String(verdict.occurrence)}: **${verdict.verdict ?? 'unreadable'}**. ${verdict.assessment}`);
    for (const finding of verdict.findings) push(`- ${typeof finding === 'string' ? finding : `${finding.steps ? `${(Array.isArray(finding.steps) ? finding.steps : [finding.steps]).join(', ')}: ` : ''}${finding.what ?? finding.text ?? finding.problem ?? JSON.stringify(finding)}`}`);
    push('');
  }
}

for (const [key, anchor] of Object.entries(anchors)) {
  push(`## The ${key} step: ${anchor.name}`, '');
  for (const run of runs) {
    const step = anchor.find(run.steps);
    push(`### ${PROFILE_NAMES[run.profile] ?? run.profile}, written during the walk (the loop's writer; ${run.profile} run, ${step ? `${step.id} ${step.title}` : 'no step covers this place'})`, '');
    if (!step) {
      push('_The plan of this run has no step over this place._', '');
      continue;
    }
    push(`Places: ${step.places.map((place) => `${place.label} (${place.path} ${String(place.start)}–${String(place.end)}, ${place.side})`).join('; ')}`, '');
    push(step.body.trim(), '');
    if (step.details.trim() !== '') push('**Show more:**', '', step.details.trim(), '');
    if (step.together.trim() !== '') push('**Together:**', '', step.together.trim(), '');
  }
  const standard = runs.find((run) => run.profile === 'standard');
  const standardStep = standard ? anchor.find(standard.steps) : null;
  for (const entry of explanations.filter((item) => standardStep !== null && item.stepId === standardStep.id)) {
    push(`### ${PROFILE_NAMES[entry.profile] ?? entry.profile}, made after the walk (the step explanation channel on the Standard walk's ${entry.stepId}; status ${entry.status}${entry.action ? `, ${entry.action}` : ''})`, '');
    push(entryText(entry).trim(), '');
  }
}

push('## The loop runs\' own summaries', '');
for (const run of runs) {
  push(`### ${PROFILE_NAMES[run.profile] ?? run.profile}`, '', '```json', JSON.stringify(run.loop, (key, value) => (key === 'prompt' ? undefined : value), 2).slice(0, 4000), '```', '');
}

fs.writeFileSync(out, `${lines.join('\n')}\n`);
console.log(JSON.stringify({ out, runs: runs.map((run) => ({ profile: run.profile, steps: run.steps.length, simple: anchors.simple.find(run.steps)?.id ?? null, complex: anchors.complex.find(run.steps)?.id ?? null })), explanations: explanations.map((entry) => `${entry.stepId}:${entry.profile}:${entry.status}`) }, null, 2));
