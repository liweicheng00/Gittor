// The text of a ref label in the log and in the commit details.

/** A detached HEAD shows as "detached": no branch is checked out. Other refs show their name. */
export const refLabel = (ref: { name: string; kind: string }) => (ref.kind === "head" ? "detached" : ref.name);

/** The remote that does not have this tag, or null: a branch, or a tag that the remote has, or no check. */
export function tagNotOn(ref: { name: string; kind: string }, remoteTags: { remote: string; names: Set<string> } | null): string | null {
  return ref.kind === "tag" && remoteTags && !remoteTags.names.has(ref.name) ? remoteTags.remote : null;
}
