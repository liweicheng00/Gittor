// A short summary of the work in progress. Open the card to see the details inside.

export default function mount(root, g) {
  const { h } = g;
  const body = h("div", { class: "x-work" });
  root.append(body);

  async function load() {
    if (!g.repo()) return void body.replaceChildren(h("div", { class: "x-work-empty" }, "No repository is open."));
    try {
      const [lc, stashes] = await Promise.all([g.call("local_changes"), g.call("stashes")]);
      const changed = lc.lists.reduce((n, l) => n + l.changes.length, 0);
      const stat = (n, label) => h("div", { class: "x-work-stat" }, h("b", {}, String(n)), h("span", {}, label));
      body.replaceChildren(
        h("div", { class: "x-work-stats" }, stat(changed, "changed"), stat(lc.unversioned.length, "new"), stat(stashes.length, "stashed")),
        h("div", { class: "x-work-hint" }, "Open the card to see the files and the stashes."),
      );
    } catch (e) {
      body.replaceChildren(h("div", { class: "x-work-empty" }, String(e)));
    }
  }
  load();
  return g.on("repo", load);
}
