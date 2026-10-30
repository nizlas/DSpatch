/**
 * The walk window's explanation on its own (Niclas's decision of 30 October 2026): the
 * right panel, with Step and Discussion, moved to a window of its own so the code gets the
 * width. Docked is the default; this is chosen.
 *
 * Nothing is made anew for the move. The window is opened from the walk window's page
 * (`window.open`, same origin), and the panel's elements are moved into it: the same React
 * tree keeps rendering them, from the walk window's page, with its bridges. The discussion,
 * an answer on its way, the draft, the selection to ask about, the tab and the reading
 * position stay what they were, and no session, chat or agent job is started or asked
 * again. The main process allows only this window name, one per walk window
 * (`review-windows.ts`), keeps it on a screen, and closes it with the walk window; where it
 * was left is a review preference.
 */

// The same stylesheets as the page (`main.tsx`), in the same order.
import baseRules from './styles.css?inline';
import editorRules from './loop-editor.css?inline';
import startRules from './start-page.css?inline';
import reviewRules from './review.css?inline';

/** The window name the main process allows a walk window to open, and nothing else. */
export const EXPLANATION_FRAME = 'dspatch-explanation';

export interface DetachedPanel {
  readonly window: Window;
  /** Where the panel goes in it: an `.rv` surface filling the window. */
  readonly root: HTMLElement;
}

/**
 * Open the explanation's own window and give it the walk window's look: its stylesheets,
 * the page's attributes, and an `.rv` surface for the panel. `null` when it was not opened.
 */
export function openExplanationWindow(
  title: string,
  bounds: { readonly x: number; readonly y: number; readonly width: number; readonly height: number } | null,
): DetachedPanel | null {
  // Where it was last left; the main process keeps it on a screen.
  const features = bounds === null ? '' : `left=${String(bounds.x)},top=${String(bounds.y)},width=${String(bounds.width)},height=${String(bounds.height)}`;
  const child = window.open('about:blank', EXPLANATION_FRAME, features);
  if (child === null) {
    return null;
  }
  const doc = child.document;
  doc.title = title;
  for (const attribute of [...document.documentElement.attributes]) {
    doc.documentElement.setAttribute(attribute.name, attribute.value);
  }
  // The review's own rules, as stylesheets made in that window: it inherits the page's
  // Content-Security-Policy (no inline styles), which a constructed stylesheet is not
  // subject to; and a page loaded from a file cannot lend it its own stylesheets.
  const Sheet = (child as Window & typeof globalThis).CSSStyleSheet;
  doc.adoptedStyleSheets = [baseRules, editorRules, startRules, reviewRules, 'html, body { height: 100%; margin: 0; overflow: hidden; }'].map((rules) => {
    const sheet = new Sheet();
    sheet.replaceSync(rules);
    return sheet;
  });
  doc.body.className = document.body.className;
  const root = doc.createElement('div');
  root.className = 'rv rv-detached';
  root.setAttribute('data-ev', 'explanation-window');
  doc.body.appendChild(root);
  return { window: child, root };
}

/**
 * Move the panel's element to `target`, keeping where each of its scrolled parts was: a
 * moved element starts at the top again otherwise.
 */
export function movePanel(panel: HTMLElement, target: HTMLElement): void {
  if (panel.parentNode === target) {
    return;
  }
  const scrolled = [panel, ...panel.querySelectorAll<HTMLElement>('*')]
    .filter((element) => element.scrollTop > 0 || element.scrollLeft > 0)
    .map((element) => ({ element, top: element.scrollTop, left: element.scrollLeft }));
  target.appendChild(panel);
  const restore = (): void => {
    for (const entry of scrolled) {
      entry.element.scrollTop = entry.top;
      entry.element.scrollLeft = entry.left;
    }
  };
  restore();
  // Once more after the new window has laid it out.
  (target.ownerDocument.defaultView ?? window).requestAnimationFrame(restore);
}
