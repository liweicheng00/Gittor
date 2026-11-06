// The text at the top: what this side of the window is.

export default function mount(root, g) {
  const { h } = g;
  root.append(
    h(
      "div",
      { class: "x-intro" },
      h("div", { class: "x-intro-title" }, "Agent mode"),
      h("div", { class: "x-intro-text" }, "Each block on this side is a file. Ask the agent to change the layout, the look or the code of a block, and the window changes as soon as the file does."),
      h("div", { class: "x-intro-dir" }, h("code", { title: "The folder of this interface" }, g.dir)),
    ),
  );
}
