When `connect` reaches `settle`, it takes the callback registered earlier and schedules it with a zero-delay timer instead of calling it inline. Clearing the callback slot first means that registration can report only once; if no callback is registered, nothing is scheduled. This separates `connect` returning its outcome from the later report in the next step ([W1.6]). Unlike the base revision, `Link` now has this callback-based settlement path.

<!-- dspatch:details -->
Because the timer is queued before `connect` returns, JavaScript can resume `startSession` from its `await` before the timer callback runs. On a gave-up outcome, that lets `startSession` report “retrying later” before the deferred callback reports “offline mode.”

```dspatch-references
{"references":[{"label":"Settlement and deferred callback","path":"src/link.ts","side":"target","start":32,"end":38},{"label":"Link before settlement callbacks were added","path":"src/link.ts","side":"base","start":5,"end":10},{"label":"The later session report","step":"W1.6"}],"insufficient":false}
```