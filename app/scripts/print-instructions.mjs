// Prints the instruction sections a writer and a step explanation receive, per profile, from the
// current source, so the texts before and after a change can be kept side by side.
import { PRESENTATION_INSTRUCTION_VERSION, PROFILES, PUBLIC_PROFILES, presentationPromptSection, walkExplanationSection } from '../src/shared/presentation-profiles.ts';
import { readPlanAnswer, reviewPrompt, writeStepPrompt } from '../src/shared/walk-loop.ts';
import fs from 'node:fs';

const out = [`# Instructions at version ${String(PRESENTATION_INSTRUCTION_VERSION)}`, ''];
for (const id of PUBLIC_PROFILES) {
  out.push(`## ${PROFILES[id].promptName}: the reader`, '', ...PROFILES[id].reader.map((line) => `- ${line}`), '');
}
out.push('## The walk generator\'s section (one call), Standard', '', '```', walkExplanationSection('standard'), '```', '');
out.push('## A step explanation (present), Essentials', '', '```', presentationPromptSection({ profile: 'essens', mode: 'present', shown: [] }) ?? '', '```', '');
const role = { id: 'walk-writer', sourcePath: 'docs/loop/roles/review/walk-writer.role.md', instructions: '(role text)', targets: ['claude-code'], targetsDeclared: true, requirements: [] };
const plan = readPlanAnswer({ summary: 'S', background: '', walks: [{ kind: 'walk', title: 'T', question: 'Q', purpose: 'P', steps: [{ title: 'S', summary: 's', brief: 'b', places: [{ label: 'l', path: 'src/a.ts', side: 'target', start: 1, end: 2 }] }] }] }).plan;
const material = { pair: { repository: '/r', base: 'a'.repeat(40), target: 'b'.repeat(40) }, repositoryName: 'r', baseSubject: '', targetSubject: '', files: [], diff: '', diffLeftOut: [] };
const folder = { base: material.pair.base, target: material.pair.target, files: 1, skipped: [], skippedCount: 0 };
const writer = writeStepPrompt({ role, plan, stepId: 'W1.1', profile: 'pedagog', language: 'en', material, folder, fresh: true, rework: null });
out.push('## The loop writer\'s instruction section, Teacher', '', '```', writer.slice(writer.indexOf('## How to explain the step'), writer.indexOf('## Answer format') > 0 ? writer.indexOf('## Answer format') : undefined), '```', '');
const reviewer = reviewPrompt({ role: { ...role, id: 'walk-reviewer' }, plan, texts: new Map(), profile: 'essens', language: 'en', material, folder, final: false, earlier: null, fresh: true });
out.push('## The loop reviewer\'s judging section, Essentials', '', '```', reviewer.slice(reviewer.indexOf('## The reader'), reviewer.indexOf('## The walks as the person')), '```', '');
fs.writeFileSync(process.argv[2], out.join('\n'));
console.log('written', process.argv[2]);
