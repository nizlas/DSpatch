/**
 * DSP-229: what the graph editor's "Apply to repository…" and "Project instructions…" window asks
 * the host, as one request type, and what it is answered. One bridge method carries them all.
 */
import type { ProjectGraphOrigin } from './loop-definition';
import type { ProjectInstructions, ReferenceProblem } from './project-instructions';
import type { GraphOutline, RecommendationAnswer, RecommendationTarget } from './project-recommendations';

/** The graph a window works on: a built-in template not applied yet, or a project graph. */
export type ProjectGraphSource = { readonly templateKey: string } | { readonly definitionKey: string };

export type ProjectGraphRequest =
  | { readonly kind: 'options' }
  | { readonly kind: 'describe'; readonly source: ProjectGraphSource }
  | {
      readonly kind: 'plan' | 'apply';
      readonly templateKey: string;
      readonly repository: string;
      readonly name: string;
      readonly instructions: ProjectInstructions;
    }
  | { readonly kind: 'save'; readonly definitionKey: string; readonly instructions: ProjectInstructions; readonly expectedSha256: string | null }
  | { readonly kind: 'check'; readonly repository: string; readonly source: ProjectGraphSource; readonly instructions: ProjectInstructions }
  | {
      readonly kind: 'recommend';
      readonly requestId: string;
      readonly repository: string;
      readonly source: ProjectGraphSource;
      readonly target: RecommendationTarget;
      readonly instructions: ProjectInstructions;
      readonly inventory: string | null;
    }
  | { readonly kind: 'cancelRecommend'; readonly requestId: string };

/** A file to be written, as the window shows it before saving. */
export interface PlannedFileView {
  readonly relative: string;
  readonly action: 'create' | 'change';
  readonly what: string;
}

export interface ProjectGraphDescription {
  readonly outline: GraphOutline;
  /** Each role's generic instructions, as copied or to be copied, for showing what a step inherits. */
  readonly roleTexts: Readonly<Record<string, { readonly sourcePath: string; readonly instructions: string }>>;
  /** Fan-out steps and the steps their branches may run as. */
  readonly fanOuts: readonly { readonly id: string; readonly runsAs: readonly string[] }[];
  /** For a project graph: its repository, instructions, their hash as read, its origin. */
  readonly repository: string | null;
  readonly instructions: ProjectInstructions;
  readonly instructionsFile: string | null;
  readonly instructionsSha256: string | null;
  readonly origin: ProjectGraphOrigin | null;
  readonly problems: readonly string[];
}

export type ProjectGraphAnswer =
  | {
      readonly kind: 'options';
      readonly templates: readonly { readonly key: string; readonly name: string; readonly description: string | null }[];
      readonly repositories: readonly { readonly path: string; readonly name: string }[];
      /** The workspace's chosen agent, and why recommendations cannot use it when they cannot. */
      readonly agent: { readonly provider: string | null; readonly model: string | null; readonly recommendRefusal: string | null };
    }
  | { readonly kind: 'described'; readonly description: ProjectGraphDescription }
  | { readonly kind: 'planned'; readonly files: readonly PlannedFileView[]; readonly references: readonly ReferenceProblem[] }
  | { readonly kind: 'applied'; readonly definitionKey: string; readonly written: readonly string[]; readonly references: readonly ReferenceProblem[] }
  | { readonly kind: 'saved'; readonly sha256: string; readonly references: readonly ReferenceProblem[] }
  | { readonly kind: 'checked'; readonly references: readonly ReferenceProblem[] }
  | { readonly kind: 'recommended'; readonly answer: RecommendationAnswer; readonly inventory: string; readonly dropped: readonly string[]; readonly agent: string }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'refused'; readonly problems: readonly string[] };
