import assert from "node:assert/strict";
import { test } from "node:test";
import { type RefreshKind, RefreshScheduler } from "../src/refresh-scheduler.ts";

/** A fake clock and a fake load. `finish()` ends the load that runs. */
function setup() {
  let now = 0;
  const timers: { at: number; fn: () => void }[] = [];
  const runs: RefreshKind[] = [];
  let end: (() => void) | null = null;
  const state = { held: false, visible: true };
  const s = new RefreshScheduler(
    {
      now: () => now,
      setTimer: (fn, ms) => {
        const t = { at: now + ms, fn };
        timers.push(t);
        return t;
      },
      clearTimer: (t) => void timers.splice(timers.indexOf(t as (typeof timers)[0]), 1),
      held: () => state.held,
      visible: () => state.visible,
      run: (kind) => {
        runs.push(kind);
        return new Promise<void>((r) => (end = r));
      },
    },
    { holdPoll: 100, maxHold: 1000 },
  );
  const tick = () => new Promise((r) => setImmediate(r));
  return {
    s,
    runs,
    state,
    async finish() {
      end?.();
      end = null;
      await tick();
    },
    /** Moves the clock and runs the timers that are due. */
    async advance(ms: number) {
      const to = now + ms;
      for (;;) {
        const next = timers.filter((t) => t.at <= to).sort((a, b) => a.at - b.at)[0];
        if (!next) break;
        timers.splice(timers.indexOf(next), 1);
        now = next.at;
        next.fn();
        await tick();
      }
      now = to;
    },
  };
}

test("a request runs at once when nothing holds it", () => {
  const { s, runs } = setup();
  s.request("files");
  assert.deepEqual(runs, ["files"]);
});

test("requests during a load give one more load, of the larger kind", async () => {
  const { s, runs, finish } = setup();
  s.request("files");
  for (let i = 0; i < 20; i++) s.request("files");
  s.request("repo");
  s.request("files");
  assert.deepEqual(runs, ["files"], "one load runs at a time");
  await finish();
  assert.deepEqual(runs, ["files", "repo"]);
  await finish();
  assert.deepEqual(runs, ["files", "repo"], "nothing waits after it");
  assert.equal(s.busy, false);
  assert.deepEqual(s.stats, { requests: 23, runs: 2, holds: 0 });
});

test("a load waits while the user holds the mouse, and runs after", async () => {
  const { s, runs, state, advance } = setup();
  state.held = true;
  s.request("files");
  await advance(450);
  assert.deepEqual(runs, []);
  assert.equal(s.busy, true);
  state.held = false;
  await advance(100);
  assert.deepEqual(runs, ["files"]);
});

test("a held load runs after the longest hold anyway", async () => {
  const { s, runs, state, advance } = setup();
  state.held = true;
  s.request("repo");
  await advance(900);
  assert.deepEqual(runs, []);
  await advance(100);
  assert.deepEqual(runs, ["repo"], "the data does not stay old");
});

test("a hidden window loads when it shows again", async () => {
  const { s, runs, state, advance } = setup();
  state.visible = false;
  s.request("files");
  s.request("repo");
  await advance(60000);
  assert.deepEqual(runs, []);
  state.visible = true;
  s.poke();
  assert.deepEqual(runs, ["repo"]);
});

test("a load that fails does not stop the next one", async () => {
  let fail = true;
  const runs: string[] = [];
  const s = new RefreshScheduler({
    now: () => 0,
    setTimer: () => 0,
    clearTimer: () => {},
    held: () => false,
    visible: () => true,
    run: async (k) => {
      runs.push(k);
      if (fail) throw new Error("no");
    },
  });
  s.request("files");
  await new Promise((r) => setImmediate(r));
  fail = false;
  s.request("files");
  assert.deepEqual(runs, ["files", "files"]);
});
