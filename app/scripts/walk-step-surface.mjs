// @ts-nocheck
/**
 * What the Step view shows of a walk definition's step, field by field (DSP-195): the summary, the
 * body (before Show more), "Why it matters" (shown below the Show more control, not behind it), and
 * the details (behind Show more). Read from the definition as written; the window trial checks the
 * view itself.
 *
 *     node scripts/walk-step-surface.mjs <definition.review.json> [<path-substring>] [<line>]
 */
import fs from 'node:fs';

const [file, wantedPath = '.vscode/launch.json', wantedLine = '0'] = process.argv.slice(2);
const definition = JSON.parse(fs.readFileSync(file, 'utf8'));
const en = (value) => (value === undefined || value === null ? '' : typeof value === 'string' ? value : value.en ?? value.sv ?? '');
for (const walk of definition.walks) {
  for (const step of walk.steps) {
    const at = step.places.map((place) => place.focus);
    const hit = at.some((focus) => focus.path.includes(wantedPath) && (Number(wantedLine) === 0 || (focus.side === 'target' && focus.start <= Number(wantedLine) && Number(wantedLine) <= focus.end)));
    if (!hit) continue;
    console.log(`## ${walk.id} › ${step.id} ${en(step.title)}`);
    console.log(`places: ${at.map((focus) => `${focus.path} ${String(focus.start)}–${String(focus.end)} (${focus.side})`).join('; ')}`);
    console.log('\n[summary, shown first]\n' + en(step.summary));
    console.log('\n[body, shown before Show more]\n' + en(step.body));
    console.log('\n[why, shown under "Why it matters", visible without Show more]\n' + (en(step.why) || '(empty)'));
    console.log('\n[details, behind Show more]\n' + (en(step.details) || '(empty)'));
    const visible = [en(step.summary), en(step.body), en(step.why)].join('\n').trim();
    console.log(`\n(visible before or without Show more: ${String(visible.length)} characters; behind Show more: ${String(en(step.details).length)})\n`);
  }
}
