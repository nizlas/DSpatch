`startSession` is where the change begins for its caller. In the earlier revision it took a `Link` and an address and did one thing: `await link.connect(address)`, discarding the boolean that `connect` returned, so a `false` from the transport was never seen by anyone. Here it gains a third parameter, `report`, and one line of preparation before any connection is attempted.

`report` is a function supplied by the caller. Its type, `(text: string) => void`, reads: a function that takes one string and gives nothing back (`void`). `startSession` never decides what a message means or where it goes; it only hands text to `report`. Who calls `startSession`, and what `report` does with the text, is not visible in this code.

The second line is the heart of this step. `link.whenSettled(...)` receives an arrow function, a function written in place without a name, which takes an `outcome` and calls `report` with one of two texts. Two things about this line carry the rest of the walk:

1. **Passing the function to `whenSettled` calls nothing.** The arrow function is created and handed over as a value, as a string or a number would be; its body, `report(...)`, runs only when some other code later invokes the function. Giving someone your phone number is not a phone call. Which code makes that call, and when, belongs to the `Link`, and the coming steps follow it; the next step shows that `whenSettled` only stores the function. When this line is done, the transport has not been touched.

2. The arrow function uses `report`, which is not one of its own parameters. A function in TypeScript (as in JavaScript) keeps access to the variables of the place where it was written, even when it is run later from somewhere else; this is called a closure. The function therefore carries this call's `report` with it into the `Link`, and whenever the `Link` invokes it, the message reaches the caller that started this session.

The `outcome` the function receives has the type `Outcome`, declared beside `Link` as exactly two strings, `'connected'` and `'gave-up'`. The ternary covers both: `'connected'` becomes `'session ready'`, and the only other value, `'gave-up'`, becomes `'offline mode'`.

The registration stands before `await link.connect(address)`, so the `Link` already holds the function when the first attempt starts. `async` on `startSession` is what allows that `await`; its caller receives a `Promise<void>`, a promise of completion that carries no value (step W1.6). From here the walk follows `whenSettled` into the `Link`.

<!-- dspatch:details -->

Why the registration must come first: the `Link` keeps the registered function in one field and reads that field at the moment a connection settles (step W1.5). A function registered after `connect` had returned would arrive too late for that outcome and would never be invoked for it. The placement is what makes the callback cover the attempt `connect` is about to make.

The text `'session ready'` occurs in `startSession` only inside this arrow function. The value `connect` returns, which the lines after this step use, never produces it; it produces only `'retrying later'`, on `'gave-up'`. The caller therefore hears of a success through the registered function alone, so what the `Link` does with that function, whether it keeps it, when it invokes it and how often, is what decides whether the message arrives.

Two consequences of the closure follow. Each call to `startSession` creates a fresh arrow function bound to that call's `report`, so sessions started with different `report` functions do not cross; the next step shows that one `Link` keeps only one such function, so a second `startSession` on the same `Link` replaces the first registration. And because the `Link` invokes the function from a timer (step W1.7), it can run after `startSession` has already returned; the closure is what keeps `report` reachable then.

`Outcome` exists for the type checker only; it is imported with the `type` modifier and is erased when the code is compiled. At run time `outcome` is a plain string, and `outcome === 'connected'` is an ordinary string comparison. The guarantee that no third value reaches the ternary is a compile-time one from the type checker; nothing at run time checks it.
