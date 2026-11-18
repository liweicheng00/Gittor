// Decides when the view loads again after a change outside the app. Many changes give few loads: one
// load runs at a time, and the changes that come during it give one more load after it. A load waits
// while the user does something that a new draw would disturb, and while the window does not show.
// No DOM here: the unit tests give a fake clock.

/** What changed: files of the working tree, or refs and commits (which includes the files). */
export type RefreshKind = "files" | "repo";

export interface SchedulerEnv {
  now(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(timer: unknown): void;
  /** True while a new draw would disturb the user: the mouse is down, a drag or a menu is open, the user scrolls. */
  held(): boolean;
  /** False while the window does not show. */
  visible(): boolean;
  run(kind: RefreshKind): Promise<void>;
}

export interface SchedulerOptions {
  /** How often a held load looks again, in ms. */
  holdPoll: number;
  /** A held load runs after this time anyway, so the data does not stay old. */
  maxHold: number;
}

export class RefreshScheduler {
  private pending: RefreshKind | null = null;
  private running = false;
  private heldSince: number | null = null;
  private timer: unknown = null;
  /** Counters for tests and measurements. */
  readonly stats = { requests: 0, runs: 0, holds: 0 };

  private env: SchedulerEnv;
  private options: SchedulerOptions;

  constructor(env: SchedulerEnv, options: SchedulerOptions = { holdPoll: 150, maxHold: 5000 }) {
    this.env = env;
    this.options = options;
  }

  /** Asks for a load. Requests that wait become one load of the larger kind. */
  request(kind: RefreshKind) {
    this.stats.requests++;
    if (this.pending !== "repo") this.pending = kind;
    this.pump();
  }

  /** Looks again now, for example when the window shows again. */
  poke() {
    this.pump();
  }

  /** True while a load runs or waits. */
  get busy(): boolean {
    return this.running || this.pending !== null;
  }

  private pump() {
    if (this.running || !this.pending) return;
    if (this.timer !== null) {
      this.env.clearTimer(this.timer);
      this.timer = null;
    }
    // No timer while the window is hidden: the owner calls poke() when it shows.
    if (!this.env.visible()) return;
    const now = this.env.now();
    if (this.env.held()) {
      if (this.heldSince === null) {
        this.heldSince = now;
        this.stats.holds++;
      }
      if (now - this.heldSince < this.options.maxHold) {
        this.timer = this.env.setTimer(() => {
          this.timer = null;
          this.pump();
        }, this.options.holdPoll);
        return;
      }
    }
    const kind = this.pending;
    this.pending = null;
    this.heldSince = null;
    this.running = true;
    this.stats.runs++;
    void this.env
      .run(kind)
      .catch(() => {})
      .then(() => {
        this.running = false;
        this.pump();
      });
  }
}
