// Updates the rows of a list in place. A row that did not change keeps its element, so the mouse stays
// on it, a click on it still works, and the list does not flash. Only new and changed rows get new
// elements. No DOM types here: the unit tests use a small fake list.

/** The part of a DOM element that the update needs. */
export interface KeyedNode {
  readonly nextSibling: unknown;
  readonly parentNode: unknown;
}

/** The part of a DOM parent that the update needs. The DOM types its nodes more loosely than a list of one row type. */
export interface KeyedParent {
  readonly firstChild: unknown;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  insertBefore(node: any, before: any): unknown;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  removeChild(node: any): unknown;
}

export interface KeyedItem<E> {
  /** The identity of the row in its list. */
  key: string;
  /** All that the row shows and all that its handlers use. A row with a new signature gets a new element. */
  sig: string;
  build: () => E;
  /** Called for an element that stays, for what is not in the signature, for example its place. */
  update?: (el: E) => void;
}

/** What an update did, for tests and measurements. */
export interface KeyedResult {
  kept: number;
  built: number;
  removed: number;
}

const shown = new WeakMap<object, Map<string, { el: unknown; sig: string }>>();

/**
 * Makes the children of `parent` the rows of `items`, in their order. A child that this function did
 * not make, for example a message for an empty list, goes away.
 */
export function reconcile<E extends KeyedNode>(parent: KeyedParent, items: KeyedItem<E>[]): KeyedResult {
  const before = shown.get(parent) ?? new Map<string, { el: unknown; sig: string }>();
  const after = new Map<string, { el: unknown; sig: string }>();
  const result = { kept: 0, built: 0, removed: 0 };
  // The elements that stay. Each key counts once: a second row with the same key gets a new element.
  const keep = new Map<string, E>();
  for (const item of items) {
    const old = before.get(item.key);
    if (old && old.sig === item.sig && (old.el as E).parentNode === parent && !keep.has(item.key)) keep.set(item.key, old.el as E);
  }
  const staying = new Set<E>(keep.values());
  let cursor = parent.firstChild as E | null;
  const dropStale = () => {
    while (cursor && !staying.has(cursor)) {
      const next = cursor.nextSibling as E | null;
      parent.removeChild(cursor);
      result.removed++;
      cursor = next;
    }
  };
  for (const item of items) {
    dropStale();
    let el = after.has(item.key) ? undefined : keep.get(item.key);
    if (el) {
      result.kept++;
      item.update?.(el);
    } else {
      el = item.build();
      result.built++;
    }
    if (el === cursor) cursor = cursor.nextSibling as E | null;
    else parent.insertBefore(el, cursor);
    // An element that moved forward is now before the cursor; it must not go away as a stale one.
    after.set(item.key, { el, sig: item.sig });
  }
  // What is left after the last row: stale rows only, because each staying row was placed.
  while (cursor) {
    const next = cursor.nextSibling as E | null;
    if (![...after.values()].some((v) => v.el === cursor)) {
      parent.removeChild(cursor);
      result.removed++;
    }
    cursor = next;
  }
  shown.set(parent, after);
  return result;
}
