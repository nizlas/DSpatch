import { StrictMode, useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import { LoopEditor } from './LoopEditor';
import './styles.css';
import './loop-editor.css';

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
  return window.location.hash.replace(/^#/, '') === 'editor' ? 'editor' : 'chat';
}

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

createRoot(host).render(
  <StrictMode>
    <Surfaces />
  </StrictMode>,
);
