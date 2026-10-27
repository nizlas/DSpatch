import { useEffect, useId, useMemo, useRef, useState, type JSX, type KeyboardEvent, type ReactNode } from 'react';

import type {
  AgentChoiceInfo,
  ModelListing,
  RecentWorkspaceEntry,
  RecentWorkspaces,
  StoredSessionProvider,
} from '../shared/bridge';
import {
  fullPathsText,
  matchesSearch,
  moreFoldersLabel,
  startPageSelection,
} from '../shared/recent-workspaces';

/**
 * The start page (DSP-149): the provider, the wordmark, Open Project and Remote Session,
 * Recent projects and a composer — and nothing else. Diagnostics, archives, samples and
 * explanations are elsewhere (Session details, Conversation History, the menus).
 *
 * The decoration is layers behind the content: CSS gradients, SVG bands anchored to the
 * bottom and right edges, and a few soft highlights. It is `aria-hidden`, takes no
 * pointer events and adds no scroll area; narrow and low windows get less of it.
 */

/** Shown on the inactive Remote Session button, on hover and on focus. */
export const REMOTE_SESSION_NOTE =
  'Remote sessions over SSH are not available yet. They are planned (DSP-111); nothing here connects anywhere.';

function FolderIcon(): JSX.Element {
  return (
    <svg className="start__icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.2l2 2h8.8A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z" />
    </svg>
  );
}

function TerminalIcon(): JSX.Element {
  return (
    <svg className="start__icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="3" y="4.5" width="18" height="15" rx="1.5" />
      <path d="M7 10l3 2.5L7 15M12 15.5h5" />
    </svg>
  );
}

function SendIcon(): JSX.Element {
  return (
    <svg className="start__send-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M21 3 10 14M21 3l-6.5 18-3.5-7-7-3.5z" />
    </svg>
  );
}

/** The DSpatch wordmark: real text, the S carrying the blue–turquoise gradient. */
export function Wordmark({ compact = false }: { readonly compact?: boolean }): JSX.Element {
  return (
    <h1 className={`wordmark${compact ? ' wordmark--compact' : ''}`} aria-label="DSpatch">
      <span aria-hidden="true">D</span>
      <span className="wordmark__s" aria-hidden="true">
        S
      </span>
      <span aria-hidden="true">patch</span>
    </h1>
  );
}

/**
 * The decoration, in three layers: the base light (CSS on `.start`), the translucent
 * bands, and their bright edges and glints. One SVG, its coordinates anchored to the
 * bottom-right corner (`preserveAspectRatio="xMaxYMax slice"`), so it keeps its
 * proportions and is cut at the outer edges rather than squeezed.
 */
export function StartBackdrop(): JSX.Element {
  return (
    <div className="start__backdrop" aria-hidden="true">
      <svg viewBox="0 0 1536 1024" preserveAspectRatio="xMaxYMax slice" focusable="false">
        <defs>
          <linearGradient id="band-blue" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#1d4ed8" stopOpacity="0" />
            <stop offset="0.35" stopColor="#2563eb" stopOpacity="0.32" />
            <stop offset="0.7" stopColor="#0ea5e9" stopOpacity="0.22" />
            <stop offset="1" stopColor="#14b8a6" stopOpacity="0.05" />
          </linearGradient>
          <linearGradient id="band-teal" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0" stopColor="#0f766e" stopOpacity="0.1" />
            <stop offset="0.45" stopColor="#0891b2" stopOpacity="0.22" />
            <stop offset="1" stopColor="#1d4ed8" stopOpacity="0.08" />
          </linearGradient>
          <linearGradient id="edge-light" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#93c5fd" stopOpacity="0" />
            <stop offset="0.3" stopColor="#bae6fd" stopOpacity="0.75" />
            <stop offset="0.65" stopColor="#5eead4" stopOpacity="0.45" />
            <stop offset="1" stopColor="#93c5fd" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="edge-light-v" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0" stopColor="#5eead4" stopOpacity="0" />
            <stop offset="0.35" stopColor="#67e8f9" stopOpacity="0.7" />
            <stop offset="0.8" stopColor="#93c5fd" stopOpacity="0.5" />
            <stop offset="1" stopColor="#93c5fd" stopOpacity="0" />
          </linearGradient>
          <radialGradient id="glint">
            <stop offset="0" stopColor="#e0f2fe" stopOpacity="0.95" />
            <stop offset="0.35" stopColor="#7dd3fc" stopOpacity="0.45" />
            <stop offset="1" stopColor="#38bdf8" stopOpacity="0" />
          </radialGradient>
          <filter id="soft" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="6" />
          </filter>
        </defs>

        {/* Layer 2: translucent ribbons - strips with two edges, not filled areas - along
            the bottom and up the right, crossing near the bottom-right corner. */}
        <g className="start__bands">
          <path
            d="M0 735 C 260 735, 470 860, 720 935 S 1180 1010, 1536 930 L 1536 985 C 1190 1060, 900 1015, 690 975 S 250 805, 0 800 Z"
            fill="url(#band-blue)"
          />
          <path
            d="M0 840 C 230 805, 450 845, 700 925 S 1140 1015, 1536 1000 L 1536 1024 L 0 1024 Z"
            fill="url(#band-blue)"
            opacity="0.55"
          />
          <path
            d="M1180 1024 C 1300 880, 1400 680, 1440 470 S 1470 140, 1400 0 L 1470 0 C 1530 150, 1520 470, 1480 640 S 1340 900, 1270 1024 Z"
            fill="url(#band-teal)"
          />
          <path
            d="M1300 1024 C 1420 860, 1500 640, 1515 420 S 1520 120, 1536 60 L 1536 1024 Z"
            fill="url(#band-teal)"
            opacity="0.45"
          />
        </g>

        {/* Layer 3: the bright edges along the ribbons, and the glints where they cross. */}
        <g className="start__edges" fill="none" strokeLinecap="round">
          <path
            d="M0 735 C 260 735, 470 860, 720 935 S 1180 1010, 1536 930"
            stroke="url(#edge-light)"
            strokeWidth="1.6"
          />
          <path
            d="M0 800 C 250 805, 480 900, 690 975 S 1190 1060, 1536 985"
            stroke="url(#edge-light)"
            strokeWidth="1"
            opacity="0.6"
          />
          <path
            d="M1180 1024 C 1300 880, 1400 680, 1440 470 S 1470 140, 1400 0"
            stroke="url(#edge-light-v)"
            strokeWidth="1.6"
          />
          <path
            d="M1270 1024 C 1340 900, 1440 780, 1480 640 S 1530 150, 1470 0"
            stroke="url(#edge-light-v)"
            strokeWidth="1"
            opacity="0.65"
          />
          <path
            d="M1536 330 C 1480 520, 1380 680, 1260 780 S 1000 930, 840 1024"
            stroke="url(#edge-light-v)"
            strokeWidth="0.9"
            opacity="0.45"
          />
        </g>
        <g className="start__glints">
          <circle cx="1268" cy="782" r="24" fill="url(#glint)" filter="url(#soft)" />
          <circle cx="292" cy="772" r="18" fill="url(#glint)" filter="url(#soft)" opacity="0.75" />
        </g>
      </svg>
    </div>
  );
}

/** The provider choice, showing what is actually chosen; nothing is assumed (DSP-136). */
export function ProviderSelect({
  agentChoice,
  provider,
  disabled,
  onChoose,
}: {
  readonly agentChoice: AgentChoiceInfo;
  readonly provider: StoredSessionProvider | null;
  readonly disabled: boolean;
  readonly onChoose: (provider: StoredSessionProvider) => void;
}): JSX.Element {
  const shown = provider === 'claude' && !agentChoice.claudeEnabled ? null : provider;
  return (
    <label className={`provider${shown === null ? ' provider--none' : ''}`} title={agentChoice.claudeNote}>
      <span className={`provider__dot provider__dot--${shown ?? 'none'}`} aria-hidden="true" />
      <span className="sr-only">Agent</span>
      <select
        className="provider__select"
        data-ev="open-agent-select"
        value={shown ?? ''}
        disabled={disabled}
        onChange={(event) => {
          const value = event.target.value;
          if (value === 'cursor' || value === 'claude') {
            onChoose(value);
          }
        }}
      >
        <option value="" disabled>
          Choose an agent
        </option>
        <option value="cursor">Cursor</option>
        <option value="claude" disabled={!agentChoice.claudeEnabled}>
          {agentChoice.claudeEnabled ? 'Claude' : 'Claude (not available)'}
        </option>
      </select>
      <svg className="provider__chevron" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M7 10l5 5 5-5" />
      </svg>
    </label>
  );
}

/** Open Project and Remote Session, side by side and equal. Remote is inactive for now. */
export function WorkspaceEntrances({
  busy,
  onOpenProject,
}: {
  readonly busy: boolean;
  readonly onOpenProject: () => void;
}): JSX.Element {
  const noteId = useId();
  return (
    <div className="start__actions">
      <button type="button" className="start__action" data-ev="open-project" disabled={busy} onClick={onOpenProject}>
        <FolderIcon />
        Open Project
      </button>
      {/* Focusable but inactive, so its explanation can be reached by keyboard too. */}
      <span className="start__remote">
        <button
          type="button"
          className="start__action start__action--inactive"
          data-ev="remote-session"
          aria-disabled="true"
          aria-describedby={noteId}
          onClick={(event) => {
            event.preventDefault();
          }}
        >
          <TerminalIcon />
          Remote Session
        </button>
        <span role="tooltip" id={noteId} className="start__tip">
          {REMOTE_SESSION_NOTE}
        </span>
      </span>
    </div>
  );
}

/** One Recent row: the name opens it; the location is discreet; more is behind a menu. */
function RecentRow({
  entry,
  index,
  disabled,
  onOpen,
  onRemove,
}: {
  readonly entry: RecentWorkspaceEntry;
  readonly index: number;
  readonly disabled: boolean;
  readonly onOpen: (entry: RecentWorkspaceEntry) => void;
  readonly onRemove: (workspaceId: string) => void;
}): JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!menuOpen) {
      return undefined;
    }
    const close = (event: MouseEvent): void => {
      if (menuRef.current !== null && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    window.addEventListener('mousedown', close);
    return () => {
      window.removeEventListener('mousedown', close);
    };
  }, [menuOpen]);
  const more = moreFoldersLabel(entry.folders);
  return (
    <li className="recent__row" data-ev={`project-${String(index)}`} title={fullPathsText(entry.folders)}>
      <button
        type="button"
        className="recent__name"
        data-ev={`open-project-${String(index)}`}
        disabled={disabled}
        onClick={() => {
          onOpen(entry);
        }}
      >
        {entry.name}
      </button>
      <span className="recent__where">
        <span className="recent__path" data-ev={`project-${String(index)}-path`}>
          <bdi>{entry.folders[0] ?? ''}</bdi>
        </span>
        {more !== '' && <span className="recent__more">{more}</span>}
      </span>
      {entry.id !== null && (
        <div className="recent__menu" ref={menuRef}>
          <button
            type="button"
            className="recent__menu-button"
            aria-label={`More for ${entry.name}`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            data-ev={`project-menu-${String(index)}`}
            onClick={() => {
              setMenuOpen((open) => !open);
            }}
          >
            ⋯
          </button>
          {menuOpen && (
            <div className="recent__popup" role="menu">
              <button
                type="button"
                role="menuitem"
                data-ev={`remove-from-recent-${String(index)}`}
                onClick={() => {
                  setMenuOpen(false);
                  if (entry.id !== null) {
                    onRemove(entry.id);
                  }
                }}
              >
                Remove from recent
              </button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

export function RecentList({
  entries,
  disabled,
  onOpen,
  onRemove,
}: {
  readonly entries: readonly RecentWorkspaceEntry[];
  readonly disabled: boolean;
  readonly onOpen: (entry: RecentWorkspaceEntry) => void;
  readonly onRemove: (workspaceId: string) => void;
}): JSX.Element {
  return (
    <ul className="recent__list">
      {entries.map((entry, index) => (
        <RecentRow
          key={entry.id ?? `startup-${entry.folders[0] ?? ''}`}
          entry={entry}
          index={index}
          disabled={disabled}
          onOpen={onOpen}
          onRemove={onRemove}
        />
      ))}
    </ul>
  );
}

/** Enter sends, Shift+Enter breaks the line, an IME composition never sends. */
function sendKey(event: KeyboardEvent<HTMLTextAreaElement>, send: () => void): void {
  if (event.key === 'Enter' && !event.shiftKey && !event.altKey && !event.nativeEvent.isComposing) {
    event.preventDefault();
    send();
  }
}

export function StartPage({
  agentChoice,
  provider,
  onChooseProvider,
  recent,
  busy,
  problem,
  prompt,
  onPrompt,
  onSend,
  onOpenProject,
  onOpenRecent,
  onViewAll,
  onRemoveFromRecent,
  listHidden,
}: {
  readonly agentChoice: AgentChoiceInfo;
  readonly provider: StoredSessionProvider | null;
  readonly onChooseProvider: (provider: StoredSessionProvider) => void;
  readonly recent: RecentWorkspaces | null;
  readonly busy: boolean;
  /** What went wrong opening something, drawn by the window's own error panel, or `null`. */
  readonly problem: ReactNode | null;
  readonly prompt: string;
  readonly onPrompt: (text: string) => void;
  readonly onSend: () => void;
  readonly onOpenProject: () => void;
  readonly onOpenRecent: (entry: RecentWorkspaceEntry) => void;
  readonly onViewAll: () => void;
  readonly onRemoveFromRecent: (workspaceId: string) => void;
  /** While the View all dialog is open its list is the one on screen. */
  readonly listHidden: boolean;
}): JSX.Element {
  const shown = useMemo(
    () => (recent === null ? [] : startPageSelection(recent.entries, Date.now())),
    [recent],
  );
  const canSend = prompt.trim() !== '' && provider !== null && !busy;
  return (
    <div className="start" data-ev="start-page">
      <StartBackdrop />
      <header className="start__top">
        <ProviderSelect agentChoice={agentChoice} provider={provider} disabled={busy} onChoose={onChooseProvider} />
        <ModelSelect provider={provider === 'claude' && !agentChoice.claudeEnabled ? null : provider} disabled={busy} />
      </header>
      <main className="start__content">
        <Wordmark />
        <WorkspaceEntrances busy={busy} onOpenProject={onOpenProject} />
        {problem !== null && (
          <div className="start__problem" role="alert" data-ev="start-problem">
            {problem}
          </div>
        )}
        {!listHidden && (recent?.entries.length ?? 0) > 0 && (
          <section className="recent" aria-labelledby="recent-heading">
            <div className="recent__head">
              <h2 id="recent-heading" className="recent__title">
                Recent projects
              </h2>
              <button type="button" className="recent__all" data-ev="view-all" onClick={onViewAll}>
                View all
              </button>
            </div>
            <RecentList entries={shown} disabled={busy} onOpen={onOpenRecent} onRemove={onRemoveFromRecent} />
          </section>
        )}
        <div className="start__composer">
          <textarea
            className="start__input"
            data-ev="start-prompt"
            rows={1}
            aria-label="Message"
            placeholder={provider === null ? 'Choose an agent above to start a conversation' : 'What would you like to work on?'}
            value={prompt}
            onChange={(event) => {
              onPrompt(event.target.value);
            }}
            onKeyDown={(event) => {
              sendKey(event, () => {
                if (canSend) {
                  onSend();
                }
              });
            }}
          />
          <button
            type="button"
            className="start__send"
            aria-label="Send"
            data-ev="start-send"
            disabled={!canSend}
            onClick={onSend}
          >
            <SendIcon />
          </button>
        </div>
      </main>
    </div>
  );
}

/** View all: every workspace in Recent, with search, over whatever is on screen. */
export function RecentDialog({
  recent,
  busy,
  onOpenRecent,
  onOpenProject,
  onRemoveFromRecent,
  onClose,
}: {
  readonly recent: RecentWorkspaces | null;
  readonly busy: boolean;
  readonly onOpenRecent: (entry: RecentWorkspaceEntry) => void;
  readonly onOpenProject: () => void;
  readonly onRemoveFromRecent: (workspaceId: string) => void;
  readonly onClose: () => void;
}): JSX.Element {
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    searchRef.current?.focus();
  }, []);
  const entries = (recent?.entries ?? []).filter((entry) => matchesSearch(entry, query));
  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="recent-dialog-title"
        data-ev="projects"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            onClose();
          }
        }}
      >
        <div className="dialog__head">
          <h2 id="recent-dialog-title" className="dialog__title">
            Recent projects
          </h2>
          <button type="button" className="button" data-ev="dialog-open-project" disabled={busy} onClick={onOpenProject}>
            Open Project…
          </button>
          <button type="button" className="button button--quiet" aria-label="Close" data-ev="dialog-close" onClick={onClose}>
            ✕
          </button>
        </div>
        <input
          ref={searchRef}
          className="dialog__search"
          type="search"
          placeholder="Search by name or folder"
          aria-label="Search recent projects"
          data-ev="recent-search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
        />
        {recent?.error != null && <p className="app__note">{recent.error}</p>}
        {entries.length === 0 ? (
          <p className="dialog__empty">{query.trim() === '' ? 'No recent projects yet.' : 'Nothing matches.'}</p>
        ) : (
          <RecentList entries={entries} disabled={busy} onOpen={onOpenRecent} onRemove={onRemoveFromRecent} />
        )}
      </div>
    </div>
  );
}

/**
 * Above a conversation that has no workspace yet: where to take it. Opening a workspace
 * moves this conversation into it; nothing is sent.
 */
export function NoWorkspaceBar({
  busy,
  onOpenProject,
  onRecent,
  onNewConversation,
}: {
  readonly busy: boolean;
  readonly onOpenProject: () => void;
  readonly onRecent: () => void;
  readonly onNewConversation: () => void;
}): JSX.Element {
  return (
    <div className="noworkspace" data-ev="no-workspace">
      <Wordmark compact />
      <span className="noworkspace__label">No workspace yet</span>
      <span className="noworkspace__spacer" />
      <button type="button" className="button" data-ev="loose-open-project" disabled={busy} onClick={onOpenProject}>
        Open Project…
      </button>
      <button type="button" className="button button--quiet" data-ev="loose-recent" disabled={busy} onClick={onRecent}>
        Recent projects
      </button>
      <button
        type="button"
        className="button button--quiet"
        data-ev="loose-new-conversation"
        disabled={busy}
        onClick={onNewConversation}
      >
        New conversation
      </button>
    </div>
  );
}

/**
 * The model for the chosen agent (DSP-149): every model the agent's SDK lists for this
 * account, by name, and *Default* for the provider's own choice. The technical id is in
 * the tooltip. A model that is chosen but not listed stays visible and says so; nothing
 * is replaced by another model.
 */
export function ModelSelect({
  provider,
  disabled,
  compact = false,
}: {
  readonly provider: StoredSessionProvider | null;
  readonly disabled: boolean;
  readonly compact?: boolean;
}): JSX.Element | null {
  const [listing, setListing] = useState<ModelListing | null>(null);
  const [chosen, setChosen] = useState<string>('');
  useEffect(() => {
    let live = true;
    setListing(null);
    if (provider !== null) {
      void window.dspatch.listModels(provider).then(
        (answer) => {
          if (live) {
            setListing(answer);
            setChosen(answer.chosen);
          }
        },
        () => undefined,
      );
    }
    return () => {
      live = false;
    };
  }, [provider]);
  if (provider === null) {
    return null;
  }
  const models = listing?.models ?? [];
  const offered = chosen === '' || models.some((model) => model.id === chosen);
  const current = models.find((model) => model.id === chosen);
  return (
    <label
      className={`provider provider--model${compact ? ' provider--compact' : ''}`}
      title={
        listing === null
          ? 'Reading the models this agent offers…'
          : listing.error !== null
            ? `The models could not be read: ${listing.error}`
            : `${current === undefined ? (chosen === '' ? 'The provider chooses' : chosen) : `${current.displayName} (${current.id})`} · from ${listing.source}`
      }
    >
      <span className="sr-only">Model</span>
      <select
        className="provider__select"
        data-ev="model-select"
        value={chosen}
        disabled={disabled || listing === null}
        onChange={(event) => {
          const next = event.target.value;
          setChosen(next);
          void window.dspatch.setRequestedModel(next).then(
            (inForce) => {
              setChosen(inForce);
            },
            () => undefined,
          );
        }}
      >
        <option value="">Default model</option>
        {!offered && <option value={chosen}>{`${chosen} (not offered to this account)`}</option>}
        {models.map((model) => (
          <option key={model.id} value={model.id} title={model.description ?? model.id}>
            {model.displayName}
          </option>
        ))}
      </select>
      <svg className="provider__chevron" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M7 10l5 5 5-5" />
      </svg>
      {listing?.error != null && (
        <span className="provider__error" data-ev="model-list-error">
          Models unavailable
        </span>
      )}
    </label>
  );
}
