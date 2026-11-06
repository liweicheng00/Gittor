// The local changes of the repository of the active tab, by changelist.

export default function mount(root, g) {
  const { h } = g;
  const body = h("div", { class: "x-changes-body" });
  root.append(h("div", { class: "x-changes" }, h("div", { class: "x-changes-head" }, "Local Changes"), body));

  async function load() {
    if (!g.repo()) {
      body.replaceChildren(h("div", { class: "x-changes-empty" }, "No repository is open."));
      return;
    }
    try {
      const lc = await g.call("local_changes");
      const groups = lc.lists.filter((l) => l.changes.length);
      if (!groups.length && !lc.unversioned.length) {
        body.replaceChildren(h("div", { class: "x-changes-empty" }, "No local changes."));
        return;
      }
      const row = (status, path) => h("div", { class: "x-changes-row" }, h("span", { class: `x-changes-status x-changes-${status === "?" ? "new" : status}` }, status), h("span", { class: "x-changes-path", title: path }, path));
      body.replaceChildren(
        ...groups.map((l) => h("div", { class: "x-changes-group" }, h("div", { class: "x-changes-list" }, `${l.name} · ${l.changes.length}`), ...l.changes.map((c) => row(c.status, c.path)))),
        ...(lc.unversioned.length ? [h("div", { class: "x-changes-group" }, h("div", { class: "x-changes-list" }, `Unversioned · ${lc.unversioned.length}`), ...lc.unversioned.map((p) => row("?", p)))] : []),
      );
    } catch (e) {
      body.replaceChildren(h("div", { class: "x-changes-empty" }, String(e)));
    }
  }
  load();
  return g.on("repo", load);
}
