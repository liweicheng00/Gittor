// The stashes of the repository, the newest first.

export default function mount(root, g) {
  const { h } = g;
  const list = h("div", { class: "x-stashes" });
  root.append(list);

  async function load() {
    if (!g.repo()) return void list.replaceChildren(h("div", { class: "x-stashes-empty" }, "No repository is open."));
    try {
      const stashes = await g.call("stashes");
      if (!stashes.length) return void list.replaceChildren(h("div", { class: "x-stashes-empty" }, "No stashes."));
      list.replaceChildren(
        ...stashes.map((s) =>
          h("div", { class: "x-stashes-row" }, h("span", { class: "x-stashes-index" }, `{${s.index}}`), h("span", { class: "x-stashes-message" }, s.message), s.branch ? h("span", { class: "x-stashes-branch" }, s.branch) : null),
        ),
      );
    } catch (e) {
      list.replaceChildren(h("div", { class: "x-stashes-empty" }, String(e)));
    }
  }
  load();
  return g.on("repo", load);
}
