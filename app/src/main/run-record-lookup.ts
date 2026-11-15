/**
 * The loop editor's way back to a finished run after a restart (Niclas, 15 November 2026):
 * the run records on disk, read for the latest run of one loop and the graph it walked.
 * Reading only.
 */

import fs from 'node:fs';
import path from 'node:path';

import { parseLoopGraph } from '../shared/loop-graph-load';
import { parseRunRecord, type RunRecordIdentity } from '../shared/loop-record';
import { runViewFromRecord, type RecordedRunLookup } from '../shared/run-inspection';
import { RUN_GRAPH_SNAPSHOT_FILE, graphVersionIdFor } from './run-record-store';

/**
 * The latest recorded run of the loop whose graph file is `graphPath`, on the graph it walked
 * (Niclas, 15 November 2026): for the loop editor's Run mode after a restart, when no run is
 * held in memory. `dir` is where the project host writes its run records; this reads
 * them and writes nothing. The graph is the copy saved beside the record, or the graph file
 * itself when its hash is still the run's `graphVersionId`; otherwise there is no view, and
 * the answer says why rather than drawing the run on a graph it did not walk.
 */
export function latestRecordedRun(dir: string, graphPath: string): RecordedRunLookup {
  const wanted = path.resolve(graphPath).toLowerCase();
  let best: { readonly file: string; readonly identity: RunRecordIdentity } | null = null;
  let names: string[];
  try {
    names = fs.readdirSync(dir).filter((name) => name.endsWith('.jsonl'));
  } catch {
    return { kind: 'none' };
  }
  for (const name of names) {
    const file = path.join(dir, name);
    let header: unknown;
    try {
      const handle = fs.openSync(file, 'r');
      try {
        const buffer = Buffer.alloc(65536);
        const read = fs.readSync(handle, buffer, 0, buffer.length, 0);
        const first = buffer.toString('utf8', 0, read).split(/\r?\n/)[0] ?? '';
        header = JSON.parse(first);
      } finally {
        fs.closeSync(handle);
      }
    } catch {
      continue;
    }
    const identity = (header as { identity?: RunRecordIdentity }).identity;
    if (identity === undefined || typeof identity.graphPath !== 'string' || path.resolve(identity.graphPath).toLowerCase() !== wanted) {
      continue;
    }
    if (best === null || identity.startedAtUtc > best.identity.startedAtUtc) {
      best = { file, identity };
    }
  }
  if (best === null) {
    return { kind: 'none' };
  }
  const { identity } = best;
  const found = { kind: 'found' as const, runId: identity.runId, mandate: identity.mandate, startedAtUtc: identity.startedAtUtc };
  let record;
  try {
    record = parseRunRecord(fs.readFileSync(best.file, 'utf8'));
  } catch (error) {
    return { ...found, view: null, graphSource: null, problem: `Its run record could not be read: ${error instanceof Error ? error.message : String(error)}` };
  }
  const readIfSame = (file: string): string | null => {
    try {
      const text = fs.readFileSync(file, 'utf8');
      return graphVersionIdFor(text) === identity.graphVersionId ? text : null;
    } catch {
      return null;
    }
  };
  const saved = readIfSame(path.join(path.dirname(best.file), identity.runId, RUN_GRAPH_SNAPSHOT_FILE));
  const unchanged = saved === null ? readIfSame(identity.graphPath) : null;
  const graphText = saved ?? unchanged;
  if (graphText === null) {
    return {
      ...found,
      view: null,
      graphSource: null,
      problem:
        'This run was recorded without a copy of its graph, and the loop’s graph file has changed since, so the run cannot be ' +
        'shown on the graph it walked. Its results are not drawn on today’s graph; its step reports are in the chat.',
    };
  }
  const parsed = parseLoopGraph(graphText);
  return {
    ...found,
    view: runViewFromRecord(record, graphText, parsed.ok ? parsed.graph.name : identity.graphId),
    graphSource: saved !== null ? 'saved-with-run' : 'unchanged-file',
    problem: null,
  };
}
