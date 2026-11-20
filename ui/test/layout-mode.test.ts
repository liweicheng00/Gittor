import assert from "node:assert/strict";
import { test } from "node:test";
import { layoutModeFor, topGrid, type TopGridInput } from "../src/layout-mode.ts";

test("the mode follows the width", () => {
  assert.equal(layoutModeFor(320), "narrow");
  assert.equal(layoutModeFor(639), "narrow");
  assert.equal(layoutModeFor(640), "medium");
  assert.equal(layoutModeFor(947), "medium");
  assert.equal(layoutModeFor(948), "wide");
  assert.equal(layoutModeFor(1600), "wide");
});

const base: TopGridInput = { mode: "wide", showSidebar: true, sidebarWidth: 280, rightWidth: 360, detailsHeight: 200, logTab: false };

test("wide: three columns, and the left pane can hide", () => {
  const g = topGrid(base);
  assert.equal(g.columns, "280px 4px minmax(300px, 1fr) 4px 360px");
  assert.deepEqual(g.places.center, ["3", "1"]);
  assert.deepEqual(g.places.right, ["5", "1"]);
  // Without the left pane the center keeps a column of its own: it does not fall into a 0 px column.
  const off = topGrid({ ...base, showSidebar: false });
  assert.equal(off.columns, "minmax(300px, 1fr) 4px 360px");
  assert.equal(off.places.left, null);
  assert.deepEqual(off.places.center, ["1", "1"]);
  assert.deepEqual(off.places.right, ["3", "1"]);
});

test("medium: no right column, the details under the log", () => {
  const g = topGrid({ ...base, mode: "medium" });
  assert.equal(g.columns, "280px 4px minmax(0, 1fr)");
  assert.equal(g.rows, "minmax(0, 1fr) 5px 200px");
  assert.deepEqual(g.places.left, ["1", "1 / -1"]);
  assert.deepEqual(g.places.center, ["3", "1"]);
  assert.deepEqual(g.places.right, ["3", "3"]);
  assert.equal(g.places.rightGrip, null);
});

test("narrow: one column with the left tab or the log", () => {
  const tab = topGrid({ ...base, mode: "narrow" });
  assert.equal(tab.columns, "minmax(0, 1fr)");
  assert.deepEqual(tab.places.left, ["1", "1"]);
  assert.equal(tab.places.center, null);
  assert.equal(tab.places.right, null);
  const logTab = topGrid({ ...base, mode: "narrow", logTab: true });
  assert.equal(logTab.places.left, null);
  assert.deepEqual(logTab.places.center, ["1", "1"]);
  assert.deepEqual(logTab.places.right, ["1", "3"]);
});
