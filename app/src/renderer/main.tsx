import { StrictMode, useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import { HostBrowser, HostLinkLine, SshQuestions } from './HostLink';
import { LoopEditor } from './LoopEditor';
import { PairReview } from './PairReview';
import { ReviewView } from './ReviewView';
import { WalkLoopFollow } from './WalkLoopFollow';
import './styles.css';
import './loop-editor.css';
import './start-page.css';
import './review.css';
import './follow.css';

const host = document.getElementById('root');

if (host === null) {
  throw new Error('The renderer root element #root is missing from index.html.');
}

/**
 * Which surface this window is: the chat workspace, or DSP-22's loop editor.
 *
 * A hash rather than a second window, a second HTML entry or a route table. The chat
 * workflow is what Niclas assesses and it runs from this same source, so the editor is
 * added beside it without touching it: `#editor` chooses, and `npm run editor` opens
 * the window on that hash.
 */
function chosenView(): 'editor' | 'chat' {
  const hash = window.location.hash.replace(/^#/, '');
  return hash === 'editor' ? 'editor' : 'chat';
}

/**
 * A review window (`?window=review`), opened by the main process for the review module.
 *
 * It shows review and nothing else: it never mounts the chat, never follows a hash
 * change and has only the review bridge (`review-preload.ts`). Review is reached from
 * the chat's *Open review* button or `npm run review`, both of which open such a
 * window; it is no longer a view the chat window can switch to.
 */
const isBrowseWindow = new URLSearchParams(window.location.search).get('window') === 'browse';

const isReviewWindow = new URLSearchParams(window.location.search).get('window') === 'review';

/** A review window over a chosen revision pair (DSP-150): the diff review, not a walk. */
const isDiffReview = isReviewWindow && new URLSearchParams(window.location.search).get('view') === 'diff';

/** The window that follows one walk preparation of a review (DSP-190). */
const isFollowView = isReviewWindow && new URLSearchParams(window.location.search).get('view') === 'follow';

/** The hash the window was opened on, which decides whether it has a chat to keep. */
const initialView = chosenView();

/**
 * The two surfaces, and which one is on screen.
 *
 * Moving between them used to reload the window. That was wrong in one specific way:
 * the open project lives in the chat's own state, and `session` is only ever set by
 * `startChatSession`, so a reload dropped the user back at the project chooser. The
 * session itself survives in the main process, but the window has no way to ask for it
 * back, so the work of opening a project was lost by looking at a graph.
 *
 * So the chat is mounted once and then kept, hidden rather than unmounted, and only the
 * editor comes and goes. Everything the chat holds — the open project, the transcript,
 * a loop run still walking and the journal lines arriving for it — is still there on
 * return, because it was never torn down.
 *
 * A window opened straight onto `#editor` has no chat to preserve, so it does not mount
 * one until the user asks for it; `npm run editor` therefore stays what it was.
 */
function Surfaces(): JSX.Element {
  const [view, setView] = useState<'editor' | 'chat'>(initialView);

  useEffect(() => {
    function follow(): void {
      setView(chosenView());
    }
    window.addEventListener('hashchange', follow);
    return () => {
      window.removeEventListener('hashchange', follow);
    };
  }, []);

  // Latched, not derived: once the chat has been on screen it stays mounted, so
  // returning to the editor a second time does not throw away what the first return
  // preserved. Writing the same value on every later render is why this is safe here.
  const chatMounted = useRef(initialView === 'chat');
  if (view === 'chat') {
    chatMounted.current = true;
  }

  return (
    <>
      {chatMounted.current && (
        // `contents` rather than a plain wrapper, so the chat's own layout is unchanged
        // by being wrapped: this element generates no box of its own when shown.
        <div style={{ display: view === 'chat' ? 'contents' : 'none' }}>
          <App />
        </div>
      )}
      {view === 'editor' && <LoopEditor />}
    </>
  );
}

// The panel is a page beside the code: its thread scrolls, the page itself never does.
if (new URLSearchParams(window.location.search).get('view') === 'panel') {
  document.documentElement.classList.add('panel-window');
}

createRoot(host).render(
  <StrictMode>{isBrowseWindow ? <HostBrowser /> : <><HostLinkLine /><SshQuestions />{isFollowView ? <WalkLoopFollow /> : isDiffReview ? <PairReview /> : isReviewWindow ? <ReviewView /> : <Surfaces />}</>}</StrictMode>,
);
