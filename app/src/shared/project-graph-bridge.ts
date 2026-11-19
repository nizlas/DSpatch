/**
 * DSP-229: what the graph editor's "Apply to repository…" and "Project instructions…" window asks
 * the host, as one request type, and what it is answered. One bridge method carries them all.
 */
import type { ProjectGraphOrigin } from './loop-definition';
import type { LevelKey, ProjectDraftView, ProjectInstructionProposal } from './project-draft';
import type { InstructionSection, ProjectInstructions, ReferenceProblem } from './project-instructions';
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
  // DSP-230: the one shared draft of a project graph, which the panel and the window both edit.
  | { readonly kind: 'draft'; readonly definitionKey: string }
  | { readonly kind: 'draftEdit'; readonly definitionKey: string; readonly edits: readonly { readonly level: LevelKey; readonly section: InstructionSection }[] }
  | { readonly kind: 'draftSave' | 'draftDiscard' | 'draftTakeDisk'; readonly definitionKey: string }
  | { readonly kind: 'proposalApply' | 'proposalReject'; readonly definitionKey: string; readonly proposalId: string }
  | { readonly kind: 'proposals'; readonly conversationId: string }
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
  | { readonly kind: 'cancelRecommend'; readonly requestId: string }
  // DSP-231: shared, versioned roles. The roles a graph at `resourceRoot` can use; copies of shared
  // ones into a repository; a project's own role saved as a new identity or its next version; and the
  // reviewable upgrade of a graph from its legacy roles.
  | { readonly kind: 'roleCatalog'; readonly resourceRoot: string | null }
  | { readonly kind: 'roleSource'; readonly resourceRoot: string; readonly path: string }
  | { readonly kind: 'copyCatalogRoles'; readonly resourceRoot: string; readonly roles: readonly { readonly id: string; readonly version: number }[] }
  | { readonly kind: 'projectRoleSave'; readonly resourceRoot: string; readonly text: string }
  | { readonly kind: 'roleUpgrade'; readonly definitionKey: string; readonly choices?: Readonly<Record<string, string>> }
  | { readonly kind: 'roleUpgradeApply'; readonly definitionKey: string; readonly choices?: Readonly<Record<string, string>>; readonly graphSha256: string };

/** DSP-231: one role a graph can use. */
export interface CatalogRoleView {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  /** `dspatch` for DSpatch's catalog, `project` for the repository's own. */
  readonly origin: string;
  readonly versions: readonly number[];
  readonly derivedFrom?: string;
}

/** DSP-231: the upgrade of a graph from legacy roles, for review. */
export interface RoleUpgradeView {
  readonly graphName: string;
  readonly mappings: readonly {
    readonly nodeId: string;
    readonly nodeLabel: string;
    readonly from: string;
    readonly to: string;
    readonly version: number;
    readonly alternatives: readonly { readonly role: string; readonly when: string }[];
    readonly requirementsMovedToNode: readonly string[];
    readonly taskAddition: string;
    readonly reason: string;
  }[];
  readonly additions: readonly { readonly fromRole: string; readonly kind: 'role' | 'nodes'; readonly toRole?: string; readonly nodes?: readonly string[]; readonly reason: string }[];
  readonly kept: readonly { readonly nodeId: string; readonly roleId: string; readonly reason: string }[];
  readonly conflicts: readonly string[];
  readonly files: readonly PlannedFileView[];
  /** Why it cannot be applied now, when it cannot: an unsaved draft of the instructions, say. */
  readonly blocked: string | null;
}

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
  | { readonly kind: 'draft'; readonly view: ProjectDraftView; readonly note: string | null; readonly references: readonly ReferenceProblem[] }
  | { readonly kind: 'proposals'; readonly proposals: readonly ProjectInstructionProposal[] }
  | { readonly kind: 'checked'; readonly references: readonly ReferenceProblem[] }
  | { readonly kind: 'recommended'; readonly answer: RecommendationAnswer; readonly inventory: string; readonly dropped: readonly string[]; readonly agent: string }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'roleCatalog'; readonly roles: readonly CatalogRoleView[]; readonly catalogDir: string; readonly legacy: readonly string[] }
  | { readonly kind: 'roleSource'; readonly text: string }
  | { readonly kind: 'rolesCopied'; readonly written: readonly string[] }
  | { readonly kind: 'roleSaved'; readonly id: string; readonly version: number; readonly reference: string; readonly written: readonly string[] }
  | { readonly kind: 'roleUpgrade'; readonly plan: RoleUpgradeView; readonly graphSha256: string }
  | { readonly kind: 'roleUpgraded'; readonly written: readonly string[] }
  | { readonly kind: 'refused'; readonly problems: readonly string[]; readonly view?: ProjectDraftView };
