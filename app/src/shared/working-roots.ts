/**
 * Several named working roots in a run, and the words DSpatch is allowed to use
 * about them.
 *
 * DSP-72. Until this module a run had one working copy: `SessionConfig.workspacePath`,
 * one `snapshotTree`, one folder in the prompt. A person
 * who wants to compare two repositories, or read code in one and port it to another,
 * cannot express that with one folder, and DSP-71 deliberately stopped short of
 * inventing what more than one would mean. This is that meaning, as a value.
 *
 * **An ordered list with one primary.** The primary is the working directory: the
 * shell's `cwd`, the folder the provider scopes its local agent store by, and
 * therefore part of the resume key. The others are roots of the same session. Order
 * is the person's; it is not sorted, because *the first one* is a thing people say.
 *
 * **What the provider actually does with them, measured rather than reasoned.**
 * `@cursor/sdk`'s `LocalAgentOptions` takes `cwd` and `dirs`, and `dirs` is on
 * `Agent.create` and `Agent.resume` and never on `send` — a session's roots are fixed
 * when it is created. Inside the SDK the two are merged (`cwd` first, duplicates
 * dropped by resolved path) and the merged list is passed on as `workspaceRoots`,
 * which the local runtime turns into **one rules service per root**. Probed on this
 * machine with no provider turn (`two-roots-rules-probe.mjs`): with one root the SDK
 * read 36 paths under it and none under the second folder; with both roots it read 36
 * and 32, and logged `LocalCursorRulesService load completed` twice instead of once.
 *
 * **Which files, counted per root rather than inferred from the total.** The first
 * version of this comment said the second root's `.cursor/mcp.json` and
 * `.cursor/hooks.json` were among them. They were not, and the probe log said so at
 * the time: re-read by filename (`which-file-under-which-root.log`), the second root
 * supplied `.cursor/rules` 4 reads, `AGENTS.md` 3, `.cursor/skills` 5, `.cursorignore`
 * 3 and `.cursorrules` 1 — while `.cursor/mcp.json` and `.cursor/hooks.json` were read
 * **once under `cwd` and never under the second root, in both arrangements**. The SDK
 * agrees and says why: project MCP is loaded from
 * `join(projectRoot ?? workingDirectory, '.cursor', 'mcp.json')` and project hooks from
 * `projectRoot ?? workingDirectory ?? workspaceRoots[0]` — a single path in each case,
 * never the list.
 *
 * **And the conclusion that paragraph drew is wrong, measured again on 22 September 2026
 * (DSP-91).** The probe above passed `settingSources: ['project']`; {@link
 * import('../adapter/cursor-sdk-adapter').localOptionsFor} passes `{ cwd }` and nothing
 * else. The SDK maps an absent `settingSources` to *every source off* — `Ox()` returns
 * `{project:false, user:false, team:false, mdm:false, plugins:false}` for `undefined` —
 * so on DSpatch's own path **no root loads any rules, skills or `AGENTS.md`**. Re-probed
 * on this machine with the product's own options: prewarm read the root and `.git` and
 * nothing else, against 39 paths including a project skill's body with `['project']`; and
 * a real provider turn through `CursorSdkAdapter` read nothing under the root at all,
 * with the model unable to quote any of four distinct tokens planted in a project skill's
 * description, that skill's body, `AGENTS.md`, and a file the skill told its reader to
 * open. What a loop agent is governed by is the role and task DSpatch sends it.
 *
 * MCP servers and hooks come from the working directory alone, and are likewise gated.
 *
 * **And what it does not do.** `dirs` grants nothing. The sandbox policy is computed
 * from `cwd` alone, has no notion of a folder list, and defaults to the SDK's own
 * `{type:"insecure_none"}`; DSP-1 measured an agent reading and modifying a file
 * outside the folder it was given and a shell command writing outside it. That is why
 * every string in this module is descriptive, and DSP-72 #6 is the property that no
 * string here asserts a restriction. A list a person believes is a boundary is worse
 * than no list. The sidebar no longer carries a note about it (DSP-125); what that
 * note said, checked against the code, is in app/README.md under "What the window
 * shows".
 *
 * No `node:fs` and no provider import: the renderer draws these and the main process
 * passes them to the adapter, and both must read the same rules.
 */

/** One folder a run works with, named for the person and for attribution. */
export interface WorkingRoot {
  /**
   * What this root is called on screen and in a report.
   *
   * The folder's last segment, made unique across the list — two roots both called
   * `app` would make "changed in app" unanswerable, and a per-root report whose names
   * do not distinguish the roots is not a per-root report.
   */
  readonly name: string;
  /** Absolute, resolved by the caller. */
  readonly path: string;
  /**
   * The working directory: the shell's `cwd`, and what the provider scopes its local
   * agent store by. Exactly one root in a usable list has it.
   */
  readonly primary: boolean;
}

/** Windows paths differ in case without differing. Same rule as `ProjectStore`. */
function samePath(left: string, right: string, caseInsensitive: boolean): boolean {
  return caseInsensitive ? left.toLowerCase() === right.toLowerCase() : left === right;
}

/**
 * The last segment of a path.
 *
 * Deliberately string work rather than `path.basename`, for the reason
 * `workspace-folders.ts` gives: the renderer draws these and must not import a Node
 * module to do it.
 */
function lastSegment(folderPath: string): string {
  const trimmed = folderPath.replace(/[\\/]+$/, '');
  const cut = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  const name = cut === -1 ? trimmed : trimmed.slice(cut + 1);
  return name === '' ? folderPath : name;
}

/**
 * The segment before the last one, for telling two roots of the same name apart.
 *
 * `…/left/app` and `…/right/app` become `left/app` and `right/app`, which is what a
 * person would say if you asked them which `app` they meant.
 */
function parentQualified(folderPath: string): string | null {
  const trimmed = folderPath.replace(/[\\/]+$/, '');
  const cut = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  if (cut <= 0) {
    return null;
  }
  const parent = lastSegment(trimmed.slice(0, cut));
  return parent === trimmed.slice(0, cut) && parent.includes(':')
    ? // A drive root as the parent: `C:\app` qualifies as `C:/app` rather than as
      // `C:\/app`, so the separator is normalised rather than doubled.
      `${parent.replace(/[\\/]+$/, '')}/${lastSegment(folderPath)}`
    : `${parent}/${lastSegment(folderPath)}`;
}

/**
 * Names that distinguish, given the paths in this list.
 *
 * Last segment when it is unique; qualified by its parent when it is not; and a
 * numbered suffix as the last resort, because two different paths must never share a
 * name however alike they look.
 */
function uniqueNames(paths: readonly string[]): readonly string[] {
  const counts = new Map<string, number>();
  for (const folder of paths) {
    const name = lastSegment(folder);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const used = new Set<string>();
  return paths.map((folder) => {
    const plain = lastSegment(folder);
    let name = (counts.get(plain) ?? 0) > 1 ? (parentQualified(folder) ?? plain) : plain;
    if (used.has(name)) {
      let suffix = 2;
      while (used.has(`${name} (${String(suffix)})`)) {
        suffix += 1;
      }
      name = `${name} (${String(suffix)})`;
    }
    used.add(name);
    return name;
  });
}

/**
 * The run's roots, from the folders that are open and which of them is the working
 * directory.
 *
 * Deduplicated by path, primary first, and **the primary is moved to the front rather
 * than assumed to be there**: the run's `cwd` is the first entry the provider is given
 * and a caller that listed the folders in a different order would otherwise change
 * which folder the agent's shell starts in without meaning to.
 *
 * An empty list in means an empty list out. A run with no root is refused elsewhere,
 * with a sentence; inventing a root here would hide that.
 */
export function workingRootsFrom(
  folderPaths: readonly string[],
  primaryPath: string | null,
  caseInsensitive: boolean,
): readonly WorkingRoot[] {
  const unique: string[] = [];
  for (const folder of folderPaths) {
    if (folder !== '' && !unique.some((kept) => samePath(kept, folder, caseInsensitive))) {
      unique.push(folder);
    }
  }
  const primaryIndex =
    primaryPath === null
      ? -1
      : unique.findIndex((folder) => samePath(folder, primaryPath, caseInsensitive));
  const ordered =
    primaryIndex <= 0
      ? unique
      : [unique[primaryIndex] as string, ...unique.filter((_, index) => index !== primaryIndex)];
  const names = uniqueNames(ordered);
  return ordered.map((folder, index) => ({
    name: names[index] as string,
    path: folder,
    primary: index === 0,
  }));
}

/** The working directory, or `null` for an empty list. */
export function primaryRootOf(roots: readonly WorkingRoot[]): WorkingRoot | null {
  return roots.find((root) => root.primary) ?? roots[0] ?? null;
}

/**
 * The paths to hand the provider, working directory first.
 *
 * The SDK merges `cwd` with `dirs` itself and drops duplicates by resolved path, and
 * it treats a merged list of one as no list at all. This returns the same list it
 * would build, so the adapter can decide whether there is anything worth sending and
 * a single-root session stays byte-for-byte the call it was before this card.
 */
export function providerRootPathsFor(roots: readonly WorkingRoot[]): readonly string[] {
  const primary = primaryRootOf(roots);
  if (primary === null) {
    return [];
  }
  return [primary.path, ...roots.filter((root) => root !== primary).map((root) => root.path)];
}

/**
 * Which root a path belongs to, or `null` for a path under none of them.
 *
 * Longest match wins, so a root nested inside another attributes to the inner one —
 * the more specific answer is the one a person means, and the alternative is a change
 * reported against a folder that also happens to contain it.
 */
export function rootForPath(
  roots: readonly WorkingRoot[],
  absolutePath: string,
  caseInsensitive: boolean,
): WorkingRoot | null {
  const candidate = caseInsensitive ? absolutePath.toLowerCase() : absolutePath;
  let best: WorkingRoot | null = null;
  for (const root of roots) {
    const prefix = caseInsensitive ? root.path.toLowerCase() : root.path;
    const withSeparator = prefix.replace(/[\\/]+$/, '');
    if (
      candidate === withSeparator ||
      candidate.startsWith(`${withSeparator}\\`) ||
      candidate.startsWith(`${withSeparator}/`)
    ) {
      if (best === null || root.path.length > best.path.length) {
        best = root;
      }
    }
  }
  return best;
}

/**
 * What the agent is told about where things are.
 *
 * **Where things are, not how to work.** `INTERACTION_MODEL.md` v1.3 governs: the
 * agent chooses its own tools, commands and method, so this names the folders, says
 * which one the shell starts in, and stops. There is no instruction to stay inside
 * them — partly because DSP-72 #6 forbids a string that reads as a restriction, and
 * partly because an instruction DSpatch cannot enforce and does not check would be
 * the prompt claiming a boundary the run does not have.
 *
 * **One folder is named too, and that is DSP-91 #2.** This used to return `[]` below two
 * roots, on the ground that one folder needs no list to say which of it is which. The
 * consequence was that the message the 21 September coordinator received *never named the
 * project at all*: it was told there was a role file at a relative path, given a mandate
 * about a project, and left to work out from its own `cwd` which was which. Naming the one
 * folder is what makes the loop's resources, the task's working folders and the run's
 * result storage three distinguishable things rather than one undifferentiated "here".
 *
 * **And it says the assignment decides whether the folder is used.** Not that it may not be
 * read — that would be a restriction, and a false one. That the list is an address and not
 * an instruction to go there.
 */
export function describeWorkingRootsForAgent(roots: readonly WorkingRoot[]): readonly string[] {
  const primary = primaryRootOf(roots);
  if (primary === null) {
    return [];
  }
  const several = roots.length > 1;
  return [
    several
      ? `This assignment has ${String(roots.length)} working folders. They are:`
      : 'This assignment has one working folder:',
    ...roots.map(
      (root, index) =>
        `  ${String(index + 1)}. ${root.name} \u2014 ${root.path}` +
        (root.primary ? '   (the working directory)' : ''),
    ),
    '',
    `Your shell starts in ${primary.path}. ${
      several
        ? `All ${String(roots.length)} folders are open in this session. Refer to them by ` +
          'the names above when you report what you did'
        : 'Refer to it by the name above when you report what you did'
    }, and choose your own tools and commands for the work. This is an address, not an ` +
      'instruction: whether this assignment needs anything in ' +
      `${several ? 'these folders' : 'there'} read or changed at all is decided by the task ` +
      'below.',
    '',
  ];
}

/**
 * What a record says about the folders it did not look at.
 *
 * DSP-72 #4, and the word is **not observed**. "No changes outside the roots" would
 * be a measurement DSpatch did not make: it snapshots each named root and nothing
 * else, so a file written elsewhere leaves no trace in the record at all. Saying
 * "none" there is the exact shape of the untruth this card is about.
 */
export function describeUnobservedOutside(
  roots: readonly WorkingRoot[],
  /**
   * Why no snapshot was taken of the roots either, when that is the case (DSP-91 #7).
   *
   * Left out, the run measured its roots and the sentence is the one it has always been.
   * Supplied, **the roots join the folders this record says nothing about** — and it says
   * that rather than letting three empty file lists read as a measurement that found
   * nothing changed. The before/after hash is the only thing in DSpatch that can
   * contradict an agent claiming it changed nothing, so a run that skips it owes the
   * reader the distinction in the same words the rest of this module uses for it.
   */
  skippedBecause?: string,
): string {
  if (roots.length === 0) {
    return 'No working root was recorded, so no change anywhere was observed.';
  }
  const named = roots.map((root) => `${root.name} (${root.path})`).join(', ');
  if (skippedBecause !== undefined) {
    return (
      `No change anywhere was observed. DSpatch took no before-and-after snapshot of the ` +
      `${roots.length === 1 ? 'working root' : `${String(roots.length)} working roots`} ` +
      `\u2014 ${named} \u2014 and none of anywhere else. ${skippedBecause} So this record ` +
      'contains no measurement of what changed: not observed is not the same as none, and ' +
      'nothing here corroborates or contradicts what any step said it did.'
    );
  }
  return (
    `Changes were measured inside ${String(roots.length)} named ` +
    `${roots.length === 1 ? 'root' : 'roots'}: ${named}. Folders outside these were ` +
    'not observed. DSpatch took no snapshot of them, so this record says nothing ' +
    'about whether anything there changed \u2014 not observed is not the same as none.'
  );
}
