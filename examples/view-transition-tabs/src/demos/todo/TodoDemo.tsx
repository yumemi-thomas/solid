import { Loading, Reveal, startViewTransition, ViewTransition } from "@solidjs/web";
import {
  action,
  createOptimisticStore,
  createSignal,
  flush,
  For,
  isPending,
  latest,
  refresh,
  Show
} from "solid-js";
import { cx, Shimmer } from "../../ui";
import {
  fetchTodos,
  matchesFilter,
  serverToggleTodo,
  setTodoDelay,
  todoFilters,
  type Todo,
  type TodoFilter
} from "./server";
import { NetworkDebugger, TodoEmpty, TodoListSkeleton } from "./parts";

export function TodoDemo() {
  const [filter, setFilter] = createSignal<TodoFilter>("all");
  const [search, setSearch] = createSignal("");
  const [network, setNetwork] = createSignal("3g");

  // The search box keeps the input responsive before the debounced commit.
  const [searchDraft, setSearchDraft] = createSignal<string | null>(null);

  const searchValue = () => searchDraft() ?? search();
  const searchPending = () => searchDraft() !== null && searchDraft() !== search();

  // Suspends to the <Loading> below on first read; tracks filter()/search() so
  // either change revalidates. The optimistic overlay lets toggles show
  // immediately and auto-reconcile when the action's transition settles.
  const [todos, setTodos] = createOptimisticStore<Todo[]>(() => fetchTodos(filter(), search()), []);

  // filter()/search() are the source of truth; the store derives from them, so a
  // change is just a write — the Solid way. The store holds the current list while
  // it revalidates (no skeleton flash) and that async revalidation auto-wraps into
  // a single View Transition, so appearing/disappearing rows animate together. The
  // committed filter drives the tab highlight directly, so there's no pending-state
  // bookkeeping. (KNOWN LIMITATION: rapid back-to-back filter clicks race at the
  // data layer — createOptimisticStore doesn't supersede an in-flight derivation
  // when its source changes again — so the final list can settle on an earlier
  // click. A single change is always correct. This is a store-level concern, not
  // the call site: plain setFilter, startTransition, and action all exhibit it.)
  const chooseFilter = (next: TodoFilter) => {
    setFilter(next);
  };

  // The draft updates the input instantly (and drives the pending shimmer); the
  // revalidation is debounced so we don't refetch on every keystroke.
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  const runSearch = (next: string) => {
    setSearchDraft(next);
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      setSearch(next);
      if (searchDraft() === next) setSearchDraft(null);
    }, 220);
  };

  const chooseNetwork = (id: string, ms: number) => {
    setNetwork(id);
    setTodoDelay(ms);
  };

  // Optimistic toggle: the flip shows via the optimistic store, the round-trip
  // runs inside the action (per-row pending shimmer), then it reconciles — and
  // the row animates out of a filtered view because the call is transitioned.
  const toggleAction = action(function* (id: string) {
    setTodos(rows => {
      const index = rows.findIndex(todo => todo.id === id);
      if (index === -1) return;
      rows[index].done = !rows[index].done;
      // Drop the row from the optimistic snapshot when it no longer belongs in
      // the active view. This mutation runs inside the toggle's
      // startViewTransition, so the row animates out (todo-row-out) immediately
      // instead of snapping when the async revalidation below settles.
      if (!matchesFilter(rows[index], filter())) rows.splice(index, 1);
    });
    yield serverToggleTodo(id);
    // Re-derive the list from the freshly mutated server.
    refresh(todos);
    yield fetchTodos(filter(), search());
  });
  const toggle = (id: string) => {
    // Skip if this row's optimistic write is still in flight. isPending() reads
    // the row's pending lane without subscribing — fine for a one-shot guard.
    if (isPending(() => latest(() => todos.find(todo => todo.id === id)?.done))) return;
    // The thing we want to animate is the *optimistic* flip (the row leaving a
    // filtered view immediately). That shows through the incomplete-transition
    // path, which the auto seam doesn't wrap (auto-wrap fires on a transition's
    // commit, and an action commits only when it settles). So drive the optimistic
    // snapshot explicitly with startViewTransition — the escape hatch for an
    // immediate change. (The action's later reconciliation usually changes nothing
    // visible, so its auto-wrapped commit is a harmless no-op.)
    startViewTransition(() => {
      void toggleAction(id);
      flush();
    });
  };

  return (
    <div class="flex flex-col gap-3">
      <header class="flex flex-wrap items-center justify-between gap-4">
        <div class="flex min-w-0 items-center gap-3">
          <span class="ar-logo" aria-hidden="true" />
          <span class="grid min-w-0 gap-0.5">
            <strong class="font-display text-[1.18rem] font-extrabold tracking-[-0.02em] text-ink">
              Async lessons
            </strong>
            <small class="text-[0.76rem] text-muted">
              <code>createOptimisticStore</code> · <code>Reveal</code> · View Transitions
            </small>
          </span>
        </div>
        <label class="relative flex max-w-[340px] flex-[1_1_240px] items-center gap-2 overflow-hidden rounded-[10px] border border-line-strong bg-white px-3 transition-[border-color,box-shadow] duration-[160ms] focus-within:border-[rgba(44,79,124,0.6)] focus-within:shadow-[0_0_0_3px_rgba(79,136,198,0.18)]">
          <span class="text-[1.05rem] text-muted" aria-hidden="true">
            ⌕
          </span>
          <input
            type="search"
            id="todo-search"
            name="todo-search"
            class="min-h-[42px] min-w-0 flex-1 border-0 bg-transparent outline-none"
            placeholder="Search lessons…"
            value={searchValue()}
            onInput={event => runSearch(event.currentTarget.value)}
          />
          <span class={{ "ar-spinner": true, on: searchPending() }} aria-hidden="true" />
          <Shimmer active={searchPending()} />
        </label>
      </header>

      {/* One shared indicator slides under the labels (async-react style).
          --active-tab is the index of the selected filter; the slider's
          view-transition-name makes the browser morph it from the old position
          to the new one inside startViewTransition. Each label gets its OWN
          view-transition-name too, so the labels are promoted ABOVE the sliding
          pill in the transition overlay and stay crisp and readable as it
          passes — instead of the pill painting over (hiding) them. */}
      <div
        class="relative flex rounded-xl border border-line bg-[#e3edf7]"
        role="tablist"
        style={{ "--active-tab": String(todoFilters.findIndex(o => o.id === filter())) }}
      >
        <span class="ar-tab-slider" aria-hidden="true" />
        <For each={todoFilters}>
          {option => (
            <button
              type="button"
              role="tab"
              aria-selected={filter() === option.id ? "true" : "false"}
              class={cx(
                "relative z-[1] min-h-[40px] min-w-0 flex-1 cursor-pointer rounded-lg border-0 bg-transparent text-[0.9rem] font-bold transition-colors duration-200",
                filter() === option.id ? "text-solid" : "text-muted hover:text-solid"
              )}
              onClick={() => chooseFilter(option.id)}
            >
              <span
                class="relative z-[1]"
                style={{ "view-transition-name": `vt-tab-${option.id}` }}
              >
                {option.label}
              </span>
            </button>
          )}
        </For>
      </div>

      <section class="flex flex-col gap-2.5">
        <Reveal order="together">
          <ViewTransition name="todo-list" default={{ reveal: "todo-reveal" }}>
            <Loading fallback={<TodoListSkeleton />}>
              <Show
                when={todos.length > 0}
                fallback={<TodoEmpty filter={filter()} search={search()} />}
              >
                <ul class="m-0 grid max-h-[420px] list-none gap-2 overflow-y-auto overflow-x-hidden p-px [scrollbar-color:rgba(15,29,51,0.22)_transparent] [scrollbar-width:thin]">
                  <For each={todos}>
                    {item => (
                      <li
                        class={cx(
                          "todo-row flex h-[56px] items-center gap-[13px] rounded-[11px] border border-line px-[14px] py-3 shadow-[0_1px_2px_rgba(15,29,51,0.04)] transition-[border-color,box-shadow] duration-[140ms] hover:border-[rgba(44,79,124,0.3)] hover:shadow-[0_6px_16px_-10px_rgba(44,79,124,0.6)]",
                          item.done ? "bg-[#f5f9fd]" : "bg-white"
                        )}
                        style={{
                          "view-transition-name": `todo-${item.id}`,
                          "view-transition-class": "todo-row"
                        }}
                      >
                        <button
                          type="button"
                          class={cx(
                            "relative grid h-[28px] w-[28px] flex-none cursor-pointer place-items-center overflow-hidden rounded-lg border-2 font-extrabold text-white transition-[background,border-color,transform] duration-[140ms]",
                            item.done
                              ? "border-[#2c4f7c] bg-solid"
                              : "border-[rgba(15,29,51,0.26)] bg-white hover:border-solid-mid"
                          )}
                          aria-pressed={item.done ? "true" : "false"}
                          aria-label={item.done ? "Mark in progress" : "Mark complete"}
                          onClick={() => void toggle(item.id)}
                        >
                          <span aria-hidden="true">{item.done ? "✓" : ""}</span>
                          <Shimmer active={isPending(() => latest(() => item.done))} />
                        </button>
                        <span class="grid min-w-0 flex-1 gap-px">
                          <strong
                            class={cx(
                              "truncate text-[0.98rem] font-bold",
                              item.done && "text-muted line-through"
                            )}
                          >
                            {item.title}
                          </strong>
                          <small class="truncate text-[0.78rem] text-muted">{item.note}</small>
                        </span>
                        <span
                          class={cx(
                            "flex-none whitespace-nowrap rounded-full px-[9px] py-1 text-[0.68rem] font-bold tracking-[0.02em]",
                            item.done
                              ? "bg-[rgba(34,134,58,0.14)] text-[#1f7a3c]"
                              : "bg-[rgba(79,136,198,0.14)] text-solid"
                          )}
                        >
                          {item.done ? "complete" : "in progress"}
                        </span>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
            </Loading>
          </ViewTransition>
        </Reveal>
      </section>

      <NetworkDebugger network={network()} onNetwork={chooseNetwork} />
    </div>
  );
}
