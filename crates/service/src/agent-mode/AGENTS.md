# Gittor Agent mode

<!-- Gittor writes this file again at each start. Edits here are lost. -->

This folder is **the whole interface of the Agent mode of Gittor, as files**. Gittor is a desktop git
client. Agent mode is the back side of its window: the user turns the window around, and Gittor draws
this side from the files here. When a file changes, the window changes within a second.

When the user asks for something ("a card with the last commits", "connect the changes to the
branches", "make it warmer"), do it by editing these files or by writing a mod. Nothing in this side is
special: the chat with you, the list of changes and the branch lists are mods, made from the same parts
as yours.

## The files

| File | What it decides |
| --- | --- |
| `layout.json` | The cards on the canvas, the edges between them, and the agent window. |
| `style.css` | The look of all cards. It loads after the styles of Gittor. |
| `mods/<name>/main.js` | The code of one card (a "mod"). |
| `agents.json` | The agent programs that the chat can start. |
| `gittor.d.ts` | The API that a mod gets. Read it before you write a mod. |

`AGENTS.md` and `gittor.d.ts` are written again at each start. Do not edit them.

## layout.json

The default layout is a canvas, like a flow chart: cards at free places, and arrows between them.

```json
{
  "type": "canvas",
  "nodes": [
    { "id": "changes", "mod": "changes", "title": "Local Changes", "x": 40, "y": 240, "w": 300, "h": 280 },
    { "id": "branches", "mod": "branches", "title": "Local Branches", "x": 440, "y": 240, "w": 300 }
  ],
  "edges": [{ "from": "changes", "to": "branches", "label": "commit" }],
  "dock": { "mod": "chat", "title": "Agent", "width": 440, "height": 560 }
}
```

- `nodes`: the cards. `id` is unique. `mod` is the name of a folder in `mods/`; the mod draws the body of
  the card. `x` and `y` are the place of the top left corner, in pixels of the canvas. `w` and `h` are
  the size; without `h`, the card is as high as its content. `title` is the text of the title bar.
  `class` adds CSS classes. `props` is an object that the mod gets as `g.props`.
- `edges`: arrows from the card `from` to the card `to`, with an optional `label`.
- `dock`: the window at the bottom left, over the canvas. The user can fold it to a small button. The
  chat with you is in it.
- When the user drags a card, Gittor writes the new `x` and `y` into this file. Read the file again
  before you change it, so that you keep the places of the user.
- Put a new card where there is free space, for example to the right of the last card.

A layout can also be a tree of rows and columns, without a canvas:

```json
{ "type": "row", "children": [{ "mod": "changes", "size": 280 }, { "mod": "branches", "grow": 1 }], "dock": { "mod": "chat" } }
```

`size` is a fixed width (in a row) or height (in a column), and `grow` is a share of the free space.

The canvas has these classes for `style.css`: `.am-canvas` (the grid; its color is `--grid`), `.am-card`,
`.am-card-head`, `.am-card-body`, `.am-edge` (an SVG path), `.am-edge-label`, and `.am-dock`.

## Mods

A mod is one ES module, `mods/<name>/main.js`, with a default function. Gittor calls it with the empty
element of the card body and the API `g`:

```js
export default function mount(root, g) {
  const list = g.h("ul", { class: "x-branches-list" });
  root.append(g.h("h3", { class: "x-branches-title" }, "Branches"), list);
  async function load() {
    const refs = await g.call("refs");
    const local = refs.filter((b) => b.kind === "local");
    list.replaceChildren(...local.map((b) => g.h("li", {}, b.current ? `* ${b.name}` : b.name)));
  }
  const off = g.on("repo", load);
  load();
  return off; // Gittor calls it before it loads the mod again
}
```

- A mod is one file. It cannot import other files or packages. Use the DOM, CSS and `g`.
- Use the CSS variables of Gittor for colors: `--bg`, `--fg`, `--muted`, `--border`, `--panel`,
  `--hover`, `--select`, `--accent`, `--added`, `--deleted`. They follow the light and dark theme.
- Start each class of a mod with `x-` and the name of the mod, for example `x-branches-row`. Gittor
  uses many short class names (`changes`, `welcome`, `panel`); a class without the prefix can get their styles.
- `g.call(command, args)` runs a command of the Gittor backend. To learn the shape of a result, call it
  once and look at it, for example in a small mod that shows `JSON.stringify(result, null, 2)`.
- The conversation with the agent is in `g.agent.log()`. Gittor keeps it, so a chat mod that loads again
  shows the same conversation.

## When a file is wrong

Gittor keeps the last version that worked and writes the reason to a file:

- `layout.error` for `layout.json`
- `mods/<name>/main.error` for a mod

The file goes away when the next version works. **Check for these files after each edit.**

The bar at the top of the window is not a mod. Its Reset button moves this folder to
`agent-mode.bak-<time>` and writes the default files again. Its turn button goes back to the Git side.

## agents.json

A list of agent programs that speak the Agent Client Protocol (ACP) over stdin and stdout:

```json
[{ "name": "Claude Code", "command": "npx", "args": ["-y", "@agentclientprotocol/claude-agent-acp"], "env": {} }]
```

`env` adds environment variables, for example `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` or `GEMINI_API_KEY`.
The values are plain text in this file.
