import { createSignal } from "solid-js";

export type TodoFilter = "all" | "active" | "done";
export type Todo = { id: string; title: string; note: string; done: boolean };

export const todoSeed: Todo[] = [
  { id: "intro", title: "Introduction to Async React", note: "Intro", done: true },
  { id: "transitions", title: "Coordinating async", note: "Transitions", done: false },
  { id: "actions", title: "Coordinating changes", note: "Actions", done: false },
  { id: "suspense", title: "Deferred loading", note: "Suspense", done: false },
  { id: "optimistic", title: "Pretending async is sync", note: "Optimistic updates", done: true },
  { id: "together", title: "The vision for Async React", note: "Putting it together", done: false }
];

export const todoFilters: Array<{ id: TodoFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "active", label: "In Progress" },
  { id: "done", label: "Complete" }
];

// The async-react "network debugger", trimmed to three presets. On a fast
// network the app feels synchronous; on a slow one the <Loading> fallbacks and
// pending shimmers become visible. Changing it just retimes future requests.
export const todoNetworks: Array<{ id: string; label: string; ms: number }> = [
  { id: "fast", label: "Fast", ms: 150 },
  { id: "3g", label: "3G", ms: 600 },
  { id: "slow", label: "Slow", ms: 1500 }
];

// Module-level "server": a map the fake endpoints read and mutate, plus caches
// keyed by filter+search so a read during render is stable (suspense reads the
// same promise). Toggling clears the caches, so the next read revalidates.
const todoDb = new Map<string, Todo>(todoSeed.map(todo => [todo.id, { ...todo }]));
let todoCache = new Map<string, Promise<Todo[]>>();
let todoDelay = 600;

// --------------------------------------------------------------------------
// Network log — async-react.dev's signature "network debugger". Each fake
// endpoint opens a request here; the panel renders them with a method badge, a
// live-growing timing bar, and the elapsed ms. `netNow` ticks while anything is
// in flight so pending rows count up in real time.
// --------------------------------------------------------------------------
export type NetMethod = "GET" | "POST";
export type NetEntry = { id: number; method: NetMethod; path: string; start: number; end?: number };

export const [netLog, setNetLog] = createSignal<NetEntry[]>([]);
export const [netNow, setNetNow] = createSignal(0);
let netSeq = 0;
let netTimer: ReturnType<typeof setInterval> | undefined;

function pumpNetClock() {
  if (netTimer) return;
  netTimer = setInterval(() => {
    setNetNow(performance.now());
    if (!netLog().some(entry => entry.end === undefined)) {
      clearInterval(netTimer);
      netTimer = undefined;
    }
  }, 55);
}

export function getTodoDelay() {
  return todoDelay;
}

function openRequest(method: NetMethod, path: string) {
  const id = ++netSeq;
  const start = performance.now();
  // fetchTodos/fetchStats are called synchronously from reactive scopes (a
  // createMemo, the optimistic-store source), so logging the request inline
  // would write signals inside an owned computation
  // (REACTIVE_WRITE_IN_OWNED_SCOPE). The HUD log is a pure side-effect of
  // "a request started", not derived state — defer it out of the caller's
  // scope so the write lands at the top level.
  queueMicrotask(() => {
    setNetNow(start);
    setNetLog(log => [{ id, method, path, start }, ...log].slice(0, 8));
    pumpNetClock();
  });
  return () => {
    const end = performance.now();
    setNetLog(log => log.map(entry => (entry.id === id ? { ...entry, end } : entry)));
  };
}

export function setTodoDelay(ms: number) {
  todoDelay = ms;
  invalidateTodos();
}

function invalidateTodos() {
  todoCache = new Map();
}

export function matchesFilter(todo: Todo, filter: TodoFilter) {
  return filter === "all" || (filter === "active" ? !todo.done : todo.done);
}

function matchesSearch(todo: Todo, search: string) {
  if (!search) return true;
  const needle = search.trim().toLowerCase();
  return `${todo.title} ${todo.note}`.toLowerCase().includes(needle);
}

function todoPath(filter: TodoFilter, search: string) {
  const query = [
    filter !== "all" && `status=${filter === "active" ? "in-progress" : "complete"}`,
    search && `q=${encodeURIComponent(search)}`
  ]
    .filter(Boolean)
    .join("&");
  return `/lessons${query ? `?${query}` : ""}`;
}

export function fetchTodos(filter: TodoFilter, search: string): Promise<Todo[]> {
  const key = `${filter}|${search}`;
  const cached = todoCache.get(key);
  if (cached) return cached;
  const done = openRequest("GET", todoPath(filter, search));
  const promise = new Promise<Todo[]>(resolve => {
    setTimeout(() => {
      done();
      resolve(
        [...todoDb.values()]
          .filter(todo => matchesFilter(todo, filter) && matchesSearch(todo, search))
          .map(todo => ({ ...todo }))
      );
    }, todoDelay);
  });
  todoCache.set(key, promise);
  return promise;
}

export function serverToggleTodo(id: string): Promise<void> {
  const done = openRequest("POST", `/lessons/${id}`);
  return new Promise(resolve => {
    setTimeout(() => {
      done();
      const todo = todoDb.get(id);
      if (todo) todo.done = !todo.done;
      invalidateTodos();
      resolve();
    }, todoDelay);
  });
}
