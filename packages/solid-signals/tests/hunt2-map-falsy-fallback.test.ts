import {
  createEffect,
  createRoot,
  createSignal,
  flush,
  mapArray,
  onCleanup,
  repeat
} from "../src/index.js";

/**
 * PROBE: mapArray/repeat decide whether the fallback already exists by
 * truthiness of the cached mapped value (`!this._mappings[0]`,
 * src/map.ts:152 and src/map.ts:334). A fallback that returns a falsy value
 * (null, 0, "", false) is re-created on EVERY update that keeps the list
 * empty, each time overwriting `_nodes[0]` with a fresh owner and leaking
 * the previous fallback owner (its onCleanup never runs until the whole
 * list is disposed).
 */

it("mapArray creates a falsy fallback only once while the list stays empty", () => {
  const [list, setList] = createSignal<number[]>([]);
  let created = 0;

  createRoot(() => {
    const mapped = mapArray(list, x => x, {
      fallback: () => {
        created++;
        return null;
      }
    });
    createEffect(mapped, () => {});
  });
  flush();
  expect(created).toBe(1);

  setList([]); // new empty array identity -> map re-runs, still empty
  flush();
  setList([]);
  flush();

  expect(created).toBe(1);
});

it("mapArray disposes every fallback owner it created when the list becomes non-empty", () => {
  const [list, setList] = createSignal<number[]>([]);
  let created = 0;
  const disposed: number[] = [];

  createRoot(() => {
    const mapped = mapArray(list, x => x, {
      fallback: () => {
        const id = created++;
        onCleanup(() => disposed.push(id));
        return "";
      }
    });
    createEffect(mapped, () => {});
  });
  flush();

  setList([]); // triggers the falsy re-create path while bug exists
  flush();

  setList([1]); // leaves empty state: all fallback owners must be disposed
  flush();

  expect(disposed.length).toBe(created);
});

it("repeat creates a falsy fallback only once while count stays 0", () => {
  const [count, setCount] = createSignal(0, { equals: false });
  let created = 0;

  createRoot(() => {
    const mapped = repeat(count, i => i, {
      fallback: () => {
        created++;
        return 0;
      }
    });
    createEffect(mapped, () => {});
  });
  flush();
  expect(created).toBe(1);

  setCount(0); // equals:false -> repeat re-runs, still empty
  flush();

  expect(created).toBe(1);
});

it("control: mapArray creates a truthy fallback only once while the list stays empty", () => {
  const [list, setList] = createSignal<number[]>([]);
  let created = 0;

  createRoot(() => {
    const mapped = mapArray(list, x => x, {
      fallback: () => {
        created++;
        return "empty";
      }
    });
    createEffect(mapped, () => {});
  });
  flush();

  setList([]);
  flush();

  expect(created).toBe(1);
});
