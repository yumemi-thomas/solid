import { createRoot, flush, onSettled } from "../src/index.js";

afterEach(() => flush());

// KNOWN BUG (2.0 audit): an onSettled nested inside another owner-backed onSettled falls
// into the ownerless branch (the tracked-effect owner forbids children), so the returned
// cleanup runs immediately after flush instead of being deferred until the surrounding
// root is disposed. src/signals.ts:746-758. Remove .fails when fixed.
it.fails("should defer cleanup returned from a nested onSettled until owner disposal", () => {
  let cleaned = false;

  const dispose = createRoot(d => {
    onSettled(() => {
      onSettled(() => () => {
        cleaned = true;
      });
    });
    return d;
  });

  flush();
  expect(cleaned).toBe(false);

  dispose();
  expect(cleaned).toBe(true);
});
