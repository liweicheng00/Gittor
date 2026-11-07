// The text of a ref label in the log and in the commit details.

/** A detached HEAD shows as "detached": no branch is checked out. Other refs show their name. */
export const refLabel = (ref: { name: string; kind: string }) => (ref.kind === "head" ? "detached" : ref.name);
