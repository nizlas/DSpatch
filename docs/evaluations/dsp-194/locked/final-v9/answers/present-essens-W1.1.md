Here `startSession` adds a status notification alongside the connection attempt: it registers a handler before calling `connect`, mapping `connected` to “session ready” and `gave-up` to “offline mode.” The awaited result is separate; on `gave-up`, `startSession` also reports “retrying later.” Unlike the base revision, which only awaited `connect`, this version can report the outcome. The next step shows how `Link` stores the handler.

<!-- dspatch:details -->
The notification only has a settled outcome to report. If `transport.open` rejects, `connect` rejects instead of settling, so this handler does not report an outcome; that path is covered in W3.2.

```dspatch-references
{"references":[{"label":"Callback registration and separate result handling","path":"src/session.ts","side":"target","start":3,"end":8},{"label":"Previous startSession behavior","path":"src/session.ts","side":"base","start":3,"end":4},{"label":"Link stores the callback","step":"W1.2"},{"label":"Rejection path","step":"W3.2"}],"insufficient":false}
```