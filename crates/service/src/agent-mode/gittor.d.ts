// The API of Gittor for the mods of Agent mode. Gittor writes this file again at each start; do not
// edit it. A mod is `mods/<name>/main.js`, an ES module:
//
//   export default function mount(root, g) {
//     root.append(g.h("div", { class: "hello" }, "Hello"));
//     return () => {}; // optional: runs before Gittor loads the mod again
//   }

/** A change of a file in the working tree. status: A, M, D, R, C, T, U or ?. */
export interface Change {
  status: string;
  path: string;
  old_path: string | null;
}

/** The result of `g.call("local_changes")`. */
export interface LocalChanges {
  lists: { id: string; name: string; comment: string; fixed: boolean; changes: Change[] }[];
  unversioned: string[];
  conflicts: string[];
  head: string | null;
}

/** One agent program of agents.json. */
export interface AgentConfig {
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
}

/** An entry of the conversation with the agent. Gittor keeps the log, so a mod that loads again keeps it. */
export type LogEntry =
  | { kind: "user"; text: string }
  | { kind: "agent"; text: string }
  | { kind: "thought"; text: string }
  | { kind: "tool"; id: string; title: string; status: string; toolKind: string }
  | { kind: "plan"; entries: { content: string; status: string }[] }
  | {
      kind: "permission";
      token: number;
      title: string;
      options: { optionId: string; name: string; kind: string }[];
      /** The optionId that the user picked; null when cancelled; undefined while open. */
      answer?: string | null;
    }
  | { kind: "info"; text: string }
  | { kind: "error"; text: string };

export type AgentState = "off" | "starting" | "ready" | "busy" | "error";

export interface Gittor {
  /** Makes an element: g.h("button", { class: "x", onclick: () => {} }, "text", child). */
  h<K extends keyof HTMLElementTagNameMap>(tag: K, props?: Record<string, unknown>, ...children: (Node | string | null | undefined | false)[]): HTMLElementTagNameMap[K];
  /** The props of the block in layout.json. */
  props: Record<string, unknown>;
  /** The agent-mode folder. */
  dir: string;
  /** The repository of the active tab, or null. */
  repo(): string | null;
  /** Runs a command of the Gittor backend on the active repository, for example "local_changes",
   * "refs", "stashes", "worktrees", "reviews", "head_message", "repo_state". It returns parsed JSON. */
  call<T = unknown>(command: string, args?: Record<string, unknown>): Promise<T>;
  /** Calls fn on an event. "repo": the repository or its files changed. "agent": the log or the state
   * of the agent changed. Returns a function that stops the calls. */
  on(event: "repo" | "agent", fn: () => void): () => void;
  /** Shows a short message at the bottom right. */
  toast(message: string, kind?: "info" | "success" | "error"): void;
  /** Turns the window back to the Git side. */
  flip(): void;
  agent: {
    /** The agents of agents.json. */
    list(): Promise<AgentConfig[]>;
    /** Starts an agent; cwd is its folder, the agent-mode folder by default. */
    start(index: number, cwd?: string): Promise<void>;
    send(text: string): Promise<void>;
    cancel(): Promise<void>;
    stop(): Promise<void>;
    /** Answers a permission entry of the log: an optionId, or null to cancel. */
    answer(token: number, optionId: string | null): Promise<void>;
    log(): readonly LogEntry[];
    state(): AgentState;
    /** The name of the agent that runs, or null. */
    name(): string | null;
  };
}
