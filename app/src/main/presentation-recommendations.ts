/**
 * DSP-229, SIMULATED: the presentation adapter's answer to a project-instruction recommendation
 * prompt, so the window can be tried with no model. It lists the repository the session runs in —
 * instruction files, Markdown documents at the root and under docs/ — and proposes them by the
 * targets the prompt asks for. Every reason says it is simulated; it judges nothing.
 */
import fs from 'node:fs';
import path from 'node:path';

import { RECOMMENDATION_MARKER } from '../shared/project-recommendations';

export function simulatedRecommendation(prompt: string, folder: string): string | null {
  if (!prompt.startsWith(RECOMMENDATION_MARKER)) return null;
  const list = (dir: string): string[] => {
    try {
      return fs.readdirSync(path.join(folder, dir)).filter((name) => /\.md$/i.test(name)).map((name) => (dir === '' ? name : `${dir}/${name}`));
    } catch {
      return [];
    }
  };
  const documents = [...list(''), ...list('docs')];
  const governing = documents.filter((doc) => /AGENTS|CLAUDE|CONTRIBUTING/i.test(doc));
  const others = documents.filter((doc) => !governing.includes(doc));
  // The targets the prompt names: the line "Recommend, for X" or "for each of X, Y".
  const line = /Recommend, for (?:each of )?(.+?): a short addition/.exec(prompt)?.[1] ?? 'common';
  const targets = line.split(/,\s*/).map((target) => target.trim()).filter((target) => target !== '');
  const reused = prompt.includes('An inventory made earlier in this window is below');
  const recommendations = targets.slice(0, 4).map((target, index) => ({
    target,
    text: `SIMULATED: follow the project's own rules in ${governing[0] ?? 'its instruction files'} for ${target}.`,
    textWhy: 'SIMULATED: written by the presentation adapter, not by a model.',
    documents: (target === 'common' ? governing : others.slice(index, index + 1)).map((doc) => ({
      path: doc,
      purpose: `SIMULATED: ${doc} is relevant to ${target}`,
      when: target === 'common' ? 'before starting' : 'when the step needs it',
      why: 'SIMULATED',
    })),
  }));
  const answer = {
    inventory: {
      governing: governing.map((doc) => ({ path: doc, why: 'SIMULATED: an instruction file' })),
      agentDefinitions: [],
      history: [],
      examples: [],
    },
    recommendations,
    missing: reused ? ['SIMULATED: the earlier inventory was reused'] : [],
    conflicts: [],
    uncertain: ['SIMULATED: no model judged this repository'],
  };
  return `SIMULATED recommendations.\n\n\`\`\`json\n${JSON.stringify(answer, null, 2)}\n\`\`\``;
}
