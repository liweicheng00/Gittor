# Gittor Agent mode

<!-- Gittor writes this file again at each start. Edits here are lost. -->

This folder is **the whole interface of the Agent mode of Gittor, as files**. Gittor is a desktop git
client. Agent mode is the back side of its window: the user turns the window around, and Gittor draws
this side from the files here. When a file changes, the window changes within a second.

When the user asks for something ("show my branches on the left", "make it warmer", "a panel with the
last commits"), do it by editing these files or by writing a mod. Nothing in this side is special: the
chat with you, the list of changes and the text at the top are mods, made from the same parts as yours.

## The files

| File | What it decides |
| --- | --- |
| `layout.json` | The blocks of the window and their sizes. |
| `style.css` | The look of all blocks. It loads after the styles of Gittor. |
| `mods/<name>/main.js` | The code of one block (a "mod"). |
| `agents.json` | The agent programs that the chat can start. |
| `gittor.d.ts` | The API that a mod gets. Read it before you write a mod. |

`AGENTS.md` and `gittor.d.ts` are written again at each start. Do not edit them.

## layout.json

A tree of nodes. A node is a row, a column or a block:

```json
{
  "type": "row",
  "children": [
    { "mod": "changes", "size": 280 },
    { "type": "column", "grow": 1, "children": [
      { "mod": "intro", "size": 120 },
      { "mod": "chat", "grow": 1, "props": { "title": "Agent" } }
    ] }
  ]
}
```

- `type`: `"row"` (children side by side) or `"column"` (children on top of each other).
- `mod`: the name of a folder in `mods/`. The block shows that mod.
- `size`: a fixed width (in a row) or height (in a column), in pixels.
- `grow`: the share of the free space. A node without `size` and `grow` gets `grow: 1`.
- `class`: extra CSS classes of the element. `props`: an object that the mod gets as `g.props`.

## Mods

A mod is one ES module, `mods/<name>/main.js`, with a default function. Gittor calls it with the empty
element of the block and the API `g`:

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
