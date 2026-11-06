// The local branches: the current branch first, with the commits ahead of and behind its upstream.

export default function mount(root, g) {
  const { h } = g;
  const list = h("div", { class: "x-branches" });
  root.append(list);

  async function load() {
    if (!g.repo()) return void list.replaceChildren(h("div", { class: "x-branches-empty" }, "No repository is open."));
    try {
      const refs = await g.call("refs");
      const local = refs.filter((b) => b.kind === "local").sort((a, b) => Number(b.current) - Number(a.current));
      list.replaceChildren(
        ...local.map((b) =>
          h(
            "div",
            { class: `x-branches-row${b.current ? " x-branches-current" : ""}`, title: b.subject },
            h("span", { class: "x-branches-name" }, b.name),
            b.ahead ? h("span", { class: "x-branches-ahead" }, `↑${b.ahead}`) : null,
            b.behind ? h("span", { class: "x-branches-behind" }, `↓${b.behind}`) : null,
          ),
        ),
      );
    } catch (e) {
      list.replaceChildren(h("div", { class: "x-branches-empty" }, String(e)));
    }
  }
  load();
  return g.on("repo", load);
}
