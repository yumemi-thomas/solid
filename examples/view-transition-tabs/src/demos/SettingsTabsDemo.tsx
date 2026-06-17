import { Activity, addTransitionType, ViewTransition } from "@solidjs/web";
import { createSignal, For, startTransition } from "solid-js";
import { chip, cx, desc, kicker, panelBox, Panel } from "../ui";

type PaneId = "profile" | "appearance" | "alerts";

const panes: Array<{ id: PaneId; label: string }> = [
  { id: "profile", label: "Profile" },
  { id: "appearance", label: "Appearance" },
  { id: "alerts", label: "Notifications" }
];

const accents = ["#4f88c6", "#335d92", "#76b3e1", "#1f3a5f"];

function Toggle(props: { label: string; on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={props.onToggle}
      class={cx(
        "flex items-center justify-between rounded-lg border px-3 py-2.5 text-[0.9rem] transition-[background,border-color]",
        props.on
          ? "border-[rgba(79,136,198,0.5)] bg-[rgba(79,136,198,0.1)] text-ink"
          : "border-line bg-white text-muted"
      )}
    >
      <span class="font-medium">{props.label}</span>
      <span
        class={cx(
          "relative h-5 w-9 flex-none rounded-full transition-colors",
          props.on ? "bg-solid" : "bg-[rgba(15,29,51,0.2)]"
        )}
        aria-hidden="true"
      >
        <span
          class={cx(
            "absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition-transform",
            props.on && "translate-x-4"
          )}
        />
      </span>
    </button>
  );
}

const fieldLabel = "grid gap-1.5 text-[0.8rem] font-semibold text-ink";
const fieldInput =
  "rounded-md border border-line-strong bg-white px-3 py-2 text-[0.9rem] font-normal text-ink outline-none transition-[border-color,box-shadow] focus:border-[rgba(44,79,124,0.6)] focus:shadow-[0_0_0_3px_rgba(79,136,198,0.18)]";
const paneCard =
  "settings-card grid content-start gap-4 rounded-xl border border-line bg-white p-5";

export function SettingsTabsDemo() {
  const [tab, setTab] = createSignal<PaneId>("profile");

  // Each pane owns its state. Because every pane stays mounted (Activity only
  // hides it), these survive switching away and back — no lifting required.
  const [name, setName] = createSignal("");
  const [bio, setBio] = createSignal("");
  const [theme, setTheme] = createSignal("Dim");
  const [accent, setAccent] = createSignal(accents[0]);
  const [compact, setCompact] = createSignal(false);
  const [email, setEmail] = createSignal(true);
  const [push, setPush] = createSignal(false);
  const [digest, setDigest] = createSignal(true);

  const select = (id: PaneId) => {
    if (id === tab()) return;
    // A plain tap → one cross-fade. The `settings` type drives the pane group.
    startTransition(() => {
      addTransitionType("settings");
      setTab(id);
    });
  };

  return (
    <div class="grid items-stretch gap-3 grid-cols-[minmax(280px,0.9fr)_minmax(360px,1.2fr)] max-[860px]:grid-cols-1">
      <Panel>
        <span class={kicker}>ViewTransition + Activity</span>
        <h2>Tabbed forms keep their state</h2>
        <p class={desc}>
          Type in one tab, switch to another (it cross-fades), then come back — your half-filled
          form is exactly as you left it. Each pane stays mounted under{" "}
          <code>Activity mode="hidden"</code>, and the switch is wrapped in{" "}
          <code>startViewTransition</code>.
        </p>
        <div class="flex flex-col gap-2" role="tablist">
          <For each={panes}>
            {pane => (
              <button
                type="button"
                role="tab"
                aria-selected={tab() === pane.id ? "true" : "false"}
                class={cx(chip(tab() === pane.id), "text-left")}
                onClick={() => select(pane.id)}
              >
                {pane.label}
              </button>
            )}
          </For>
        </div>
      </Panel>

      <section class={cx(panelBox, "activity-stack min-h-[340px]")}>
        <Activity mode={tab() === "profile" ? "visible" : "hidden"}>
          <ViewTransition name="settings-profile" default={{ settings: "settings-transition" }}>
            <form class={paneCard} onSubmit={e => e.preventDefault()}>
              <span class="text-[0.72rem] font-bold uppercase tracking-[0.12em] text-solid">
                Profile
              </span>
              <label class={fieldLabel}>
                Display name
                <input
                  class={fieldInput}
                  value={name()}
                  onInput={e => setName(e.currentTarget.value)}
                  placeholder="Ada Lovelace"
                />
              </label>
              <label class={fieldLabel}>
                Bio
                <textarea
                  class={cx(fieldInput, "resize-none")}
                  rows={3}
                  value={bio()}
                  onInput={e => setBio(e.currentTarget.value)}
                  placeholder="A short bio…"
                />
              </label>
            </form>
          </ViewTransition>
        </Activity>

        <Activity mode={tab() === "appearance" ? "visible" : "hidden"}>
          <ViewTransition name="settings-appearance" default={{ settings: "settings-transition" }}>
            <form class={paneCard} onSubmit={e => e.preventDefault()}>
              <span class="text-[0.72rem] font-bold uppercase tracking-[0.12em] text-solid">
                Appearance
              </span>
              <div class={fieldLabel}>
                Theme
                <div class="flex gap-1.5">
                  <For each={["Light", "Dim", "Dark"]}>
                    {opt => (
                      <button
                        type="button"
                        class={chip(theme() === opt)}
                        onClick={() => setTheme(opt)}
                      >
                        {opt}
                      </button>
                    )}
                  </For>
                </div>
              </div>
              <div class={fieldLabel}>
                Accent
                <div class="flex gap-2">
                  <For each={accents}>
                    {c => (
                      <button
                        type="button"
                        aria-label={`Accent ${c}`}
                        style={{ background: c }}
                        class={cx(
                          "h-7 w-7 rounded-full border-2 transition-transform",
                          accent() === c ? "scale-110 border-ink" : "border-transparent"
                        )}
                        onClick={() => setAccent(c)}
                      />
                    )}
                  </For>
                </div>
              </div>
              <Toggle label="Compact mode" on={compact()} onToggle={() => setCompact(v => !v)} />
            </form>
          </ViewTransition>
        </Activity>

        <Activity mode={tab() === "alerts" ? "visible" : "hidden"}>
          <ViewTransition name="settings-alerts" default={{ settings: "settings-transition" }}>
            <form class={paneCard} onSubmit={e => e.preventDefault()}>
              <span class="text-[0.72rem] font-bold uppercase tracking-[0.12em] text-solid">
                Notifications
              </span>
              <Toggle label="Email notifications" on={email()} onToggle={() => setEmail(v => !v)} />
              <Toggle label="Push notifications" on={push()} onToggle={() => setPush(v => !v)} />
              <Toggle label="Weekly digest" on={digest()} onToggle={() => setDigest(v => !v)} />
            </form>
          </ViewTransition>
        </Activity>
      </section>
    </div>
  );
}
