// A note on the canvas: what this side of the window is.

export default function mount(root, g) {
  const { h } = g;
  root.append(
    h(
      "div",
      { class: "x-intro" },
      h("div", { class: "x-intro-text" }, "Each card on this canvas is a file. Ask the agent at the bottom left to add a card, connect cards, or change the look, and the window changes as soon as the file does. Drag a card by its title; drag the background to move the canvas; Ctrl+wheel zooms."),
      h("div", { class: "x-intro-dir" }, h("code", { title: "The folder of this interface" }, g.dir)),
    ),
  );
}
