import assert from "node:assert/strict";
import { test } from "node:test";
import { reconcile } from "../src/keyed.ts";

// A small list in place of the DOM.
class FakeNode {
  parentNode: FakeList | null = null;
  readonly text: string;
  constructor(text: string) {
    this.text = text;
  }
  get nextSibling(): FakeNode | null {
    const all = this.parentNode?.children ?? [];
    return all[all.indexOf(this) + 1] ?? null;
  }
}
class FakeList {
  children: FakeNode[] = [];
  moves = 0;
  get firstChild(): FakeNode | null {
    return this.children[0] ?? null;
  }
  insertBefore(node: FakeNode, before: FakeNode | null) {
    if (node.parentNode === this) {
      this.children.splice(this.children.indexOf(node), 1);
      this.moves++;
    }
    node.parentNode = this;
    this.children.splice(before ? this.children.indexOf(before) : this.children.length, 0, node);
  }
  removeChild(node: FakeNode) {
    this.children.splice(this.children.indexOf(node), 1);
    node.parentNode = null;
  }
}
const rows = (...specs: string[]) =>
  specs.map((s) => {
    const [key, sig = ""] = s.split(":");
    return { key, sig, build: () => new FakeNode(`${key}:${sig}`) };
  });
const texts = (l: FakeList) => l.children.map((c) => c.text);

test("the first update builds each row", () => {
  const list = new FakeList();
  assert.deepEqual(reconcile(list, rows("a", "b", "c")), { kept: 0, built: 3, removed: 0 });
  assert.deepEqual(texts(list), ["a:", "b:", "c:"]);
});

test("the same rows again keep their elements", () => {
  const list = new FakeList();
  reconcile(list, rows("a", "b", "c"));
  const before = [...list.children];
  assert.deepEqual(reconcile(list, rows("a", "b", "c")), { kept: 3, built: 0, removed: 0 });
  assert.deepEqual(list.children, before);
  assert.equal(list.moves, 0);
});

test("a new row and a removed row leave the others", () => {
  const list = new FakeList();
  reconcile(list, rows("a", "b", "c", "d"));
  const [a, , c, d] = list.children;
  assert.deepEqual(reconcile(list, rows("a", "x", "c", "d")), { kept: 3, built: 1, removed: 1 });
  assert.deepEqual(texts(list), ["a:", "x:", "c:", "d:"]);
  assert.ok(list.children[0] === a && list.children[2] === c && list.children[3] === d);
  assert.equal(list.moves, 0, "no kept row moves");
});

test("a changed signature gives a new element at the same place", () => {
  const list = new FakeList();
  reconcile(list, rows("a:1", "b:1", "c:1"));
  const [a, b, c] = list.children;
  assert.deepEqual(reconcile(list, rows("a:1", "b:2", "c:1")), { kept: 2, built: 1, removed: 1 });
  assert.deepEqual(texts(list), ["a:1", "b:2", "c:1"]);
  assert.ok(list.children[0] === a && list.children[1] !== b && list.children[2] === c);
});

test("a new order keeps the elements", () => {
  const list = new FakeList();
  reconcile(list, rows("a", "b", "c"));
  const [a, b, c] = list.children;
  assert.deepEqual(reconcile(list, rows("c", "a", "b")), { kept: 3, built: 0, removed: 0 });
  assert.deepEqual(list.children, [c, a, b]);
});

test("a child from elsewhere goes away, and an empty list removes all", () => {
  const list = new FakeList();
  list.insertBefore(new FakeNode("There are no rows."), null);
  reconcile(list, rows("a"));
  assert.deepEqual(texts(list), ["a:"]);
  assert.deepEqual(reconcile(list, []), { kept: 0, built: 0, removed: 1 });
  assert.deepEqual(texts(list), []);
});

test("an element that left the list is not used again", () => {
  const list = new FakeList();
  reconcile(list, rows("a", "b"));
  list.removeChild(list.children[0]);
  assert.deepEqual(reconcile(list, rows("a", "b")), { kept: 1, built: 1, removed: 0 });
  assert.deepEqual(texts(list), ["a:", "b:"]);
});

test("two rows with the same key both show", () => {
  const list = new FakeList();
  reconcile(list, rows("a", "a", "b"));
  assert.deepEqual(texts(list), ["a:", "a:", "b:"]);
  reconcile(list, rows("a", "a", "b"));
  assert.deepEqual(texts(list), ["a:", "a:", "b:"]);
});
