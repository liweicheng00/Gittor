// The branches of the remotes. In the open card (g.props.detail) each row also shows the last commit.

export default function mount(root, g) {
  const { h } = g;
  const list = h("div", { class: `x-remotes${g.props.detail ? " x-remotes-detail" : ""}` });
  root.append(list);

  async function load() {
    if (!g.repo()) return void list.replaceChildren(h("div", { class: "x-remotes-empty" }, "No repository is open."));
    try {
      const refs = await g.call("refs");
      const remote = refs.filter((b) => b.kind === "remote" && !b.name.endsWith("/HEAD"));
      if (!remote.length) return void list.replaceChildren(h("div", { class: "x-remotes-empty" }, "No remote branches."));
      list.replaceChildren(
        ...remote.map((b) =>
          h(
            "div",
            { class: "x-remotes-row", title: `${b.subject} · ${b.author}` },
            h("span", { class: "x-remotes-name" }, b.name),
            g.props.detail ? h("span", { class: "x-remotes-subject" }, b.subject) : null,
            h("span", { class: "x-remotes-author" }, b.author),
            g.props.detail ? h("code", { class: "x-remotes-oid" }, b.oid.slice(0, 8)) : null,
          ),
        ),
      );
    } catch (e) {
      list.replaceChildren(h("div", { class: "x-remotes-empty" }, String(e)));
    }
  }
  load();
  return g.on("repo", load);
}
