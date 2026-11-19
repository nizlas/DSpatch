/**
 * DSP-231: show, and on request write, the upgrade of a graph from its legacy roles to the shared
 * role catalog. The same `planRoleUpgrade` the editor's "Upgrade to shared roles…" uses; this is how
 * DSpatch's bundled graphs were migrated, and the table it prints is the before/after mapping.
 *
 *   node --import ./scripts/ts-resolve.mjs scripts/role-upgrade.ts <graph.json> <resourceRoot> <catalogDir> [--write]
 *
 * `catalogDir` is where the new references point, relative to the resource root. When it is not
 * DSpatch's own catalog, --write also copies the shared roles there with their index, as a
 * repository keeps them. Without --write nothing is written.
 */
import fs from 'node:fs';
import path from 'node:path';

import { createFileRoleResolver } from '../src/main/loop-graph-roles';
import { installedRoleCatalog, planCatalogCopies } from '../src/main/role-catalog-files';
import { parseLoopGraph } from '../src/shared/loop-graph-load';
import { serialiseLoopGraph } from '../src/shared/loop-graph-write';
import { catalogReference, planRoleUpgrade } from '../src/shared/role-catalog';

const [graphFile, root, catalogDir] = process.argv.slice(2);
const write = process.argv.includes('--write');
if (graphFile === undefined || root === undefined || catalogDir === undefined) {
  process.stderr.write('usage: role-upgrade.ts <graph.json> <resourceRoot> <catalogDir> [--write]\n');
  process.exit(2);
}
const text = fs.readFileSync(graphFile, 'utf8');
const parsed = parseLoopGraph(text);
if (!parsed.ok) throw new Error(`${graphFile} does not read as a graph`);
const catalog = installedRoleCatalog();
if (catalog === null) throw new Error('no installed role catalog');
const resolve = createFileRoleResolver(path.resolve(root));
const plan = planRoleUpgrade({
  graph: parsed.graph,
  instructions: null,
  catalog,
  resolve,
  catalogDir,
  resolveCatalog: (id, version) => resolve(catalogReference(id, version, catalogDir)),
});
const lines = [`### ${parsed.graph.name} (${parsed.graph.id})`, '', '| Node | Before | After | Requirements moved to the node | Task addition |', '| --- | --- | --- | --- | --- |'];
for (const mapping of plan.mappings) {
  lines.push(
    `| ${mapping.nodeId} | ${mapping.from.id} | ${mapping.to.id} v${String(mapping.to.version)} | ${mapping.requirementsMovedToNode.join(', ') || '—'} | ${mapping.taskAddition === '' ? '—' : `${String(mapping.taskAddition.split(/\s+/).length)} words`} |`,
  );
}
for (const kept of plan.kept) lines.push(`| ${kept.nodeId} | ${kept.roleId} | kept | — | ${kept.reason} |`);
for (const conflict of plan.conflicts) lines.push('', `Conflict: ${conflict}`);
process.stdout.write(`${lines.join('\n')}\n\n`);
if (write) {
  const target = path.resolve(root, catalogDir);
  if (path.resolve(target) !== path.resolve(root, 'docs/loop/roles/catalog')) {
    const copies = planCatalogCopies(target, plan.catalogRoles);
    if (copies.problems.length > 0) throw new Error(copies.problems.join('\n'));
    for (const file of copies.files) {
      fs.mkdirSync(path.dirname(file.path), { recursive: true });
      fs.writeFileSync(file.path, file.text);
      process.stderr.write(`wrote ${file.path}\n`);
    }
  }
  fs.writeFileSync(graphFile, serialiseLoopGraph(plan.graph));
  process.stderr.write(`wrote ${graphFile}\n`);
}
