// @ts-nocheck: a trial script over untyped DevTools answers.
/**
 * One DSpatch window in a trial, driven over DevTools: what the packaged trials share.
 */

import fs from 'node:fs';
import path from 'node:path';

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const q = (name) => `document.querySelector('[data-ev="${name}"]')`;

export class Win {
  constructor(port, label, evidence) {
    this.port = port;
    this.label = label;
    this.evidence = evidence;
    this.id = 0;
    this.pending = new Map();
  }

  async attach() {
    for (let i = 0; i < 80; i += 1) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${String(this.port)}/json/list`)).json();
        const page = list.find((target) => target.type === 'page' && !target.url.includes('window='));
        if (page !== undefined) {
          this.ws = new WebSocket(page.webSocketDebuggerUrl);
          await new Promise((resolve, reject) => {
            this.ws.onopen = resolve;
            this.ws.onerror = reject;
          });
          this.ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            this.pending.get(data.id)?.(data);
            this.pending.delete(data.id);
          };
          return;
        }
      } catch {
        // Not up yet.
      }
      await sleep(500);
    }
    throw new Error(`no window on ${this.label}`);
  }

  cmd(method, params = {}) {
    return new Promise((resolve) => {
      this.id += 1;
      this.pending.set(this.id, resolve);
      this.ws.send(JSON.stringify({ id: this.id, method, params }));
    });
  }

  async ev(expression) {
    return (await this.cmd('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;
  }

  async shot(name) {
    const data = await this.cmd('Page.captureScreenshot', { format: 'png' });
    if (data.result?.data !== undefined) {
      fs.writeFileSync(path.join(this.evidence, `${name}.png`), Buffer.from(data.result.data, 'base64'));
    }
  }

  async until(what, expression, ms = 30_000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      try {
        const value = await this.ev(expression);
        if (value) {
          return value;
        }
      } catch {
        await sleep(300);
        await this.attach().catch(() => undefined);
      }
      await sleep(150);
    }
    await this.shot(`timeout-${this.label}-${what.replace(/\W+/g, '-')}`);
    throw new Error(`timeout on ${this.label}: ${what}; window says: ${String(await this.ev('document.body.innerText')).slice(0, 400)}`);
  }

  async click(name) {
    await this.until(`the ${name} control`, `${q(name)}!==null && !${q(name)}.disabled`);
    const box = JSON.parse(await this.ev(`(${q(name)}.scrollIntoView({block:'center'}),JSON.stringify(${q(name)}.getBoundingClientRect()))`));
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
      await this.cmd('Input.dispatchMouseEvent', { type, x: box.x + box.width / 2, y: box.y + box.height / 2, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: 1 });
    }
  }

  async type(name, text) {
    await this.click(name);
    await this.ev(`${q(name)}.select?.()`);
    await this.cmd('Input.insertText', { text });
  }

  async enter() {
    await this.cmd('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
    await this.cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  }

  line() {
    return this.ev(`${q('host-link')}?.textContent ?? ''`).catch(() => '');
  }

  text() {
    return this.ev('document.body.innerText').catch(() => '');
  }

  /** Connect to a target, answering every question yes unless `answers` says otherwise. */
  async connect(target, { answers = () => 'yes', ms = 180_000 } = {}) {
    await this.ev(`${q('remote-form')}===null && ${q('remote-session')}?.click()`);
    await this.until('the form', `${q('ssh-target')}!==null`);
    await this.type('ssh-target', target);
    await this.click('ssh-connect');
    const seen = [];
    const asked = [];
    const end = Date.now() + ms;
    while (Date.now() < end) {
      let state;
      try {
        state = JSON.parse(
          await this.ev(`JSON.stringify({ status: ${q('ssh-status')}?.textContent ?? null, kind: ${q('ssh-question')}?.dataset.kind ?? null, text: document.querySelector('.ssh-question__text')?.textContent ?? '', on: ${q('host-link')}?.textContent ?? '', busy: ${q('ssh-connect')}?.disabled ?? null })`),
        );
      } catch {
        await sleep(300);
        await this.attach().catch(() => undefined);
        continue;
      }
      if (state.status !== null && seen.at(-1) !== state.status) {
        seen.push(state.status);
      }
      if (state.kind !== null) {
        asked.push(state.text);
        await this.click(answers(state.text) === 'yes' ? 'ssh-yes' : 'ssh-no');
        await sleep(300);
        continue;
      }
      if (/^On /.test(state.on)) {
        return { connected: true, seen, asked };
      }
      if (state.busy === false && seen.length > 1) {
        return { connected: false, seen, asked };
      }
      await sleep(120);
    }
    return { connected: false, seen, asked, timedOut: true };
  }

  async chooseAgent(agent) {
    await this.ev(`(()=>{const s=${q('open-agent-select')};Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(s,'${agent}');s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
    await sleep(800);
  }

  async openProject() {
    await this.click('open-project-0');
    await this.until('the chat', `${q('prompt')}!==null`);
  }

  async send(text) {
    await this.type('prompt', text);
    await this.enter();
  }
}
