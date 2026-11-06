# Gittor Agent mode

<!-- Gittor writes this file again at each start. Edits here are lost. -->

This folder is **one workflow of the Agent mode of Gittor, as files**. Gittor is a desktop git client.
Agent mode is the back side of its window: the user turns the window around and sees the workflows in
tabs at the top. A workflow is the unit of work: one work flow, with its projects (repositories), its
knowledge folders, its own panels, canvas and agent. Gittor draws the workflow from the files here. When
a file changes, the window changes within a second.

When the user asks for something ("a card with the last commits", "connect the changes to the
branches", "make it warmer"), do it by editing these files or by writing a mod. Nothing in this side is
special: the chat with you, the branch panel and the cards are mods, made from the same parts
as yours.

## The files

| File | What it decides |
| --- | --- |
| `workflow.json` | The name of the workflow, its `projects` (repository folders) and its `knowledge` folders. |
| `layout.json` | The panels of the window, the canvas, its cards and the edges between them. |
| `style.css` | The look of all panels and cards. It loads after the styles of Gittor. |
| `mods/<name>/main.js` | The code of one panel or card (a "mod"). |
| `agents.json` | The agent programs that the chat can start. |
| `gittor.d.ts` | The API that a mod gets. Read it before you write a mod. |

`AGENTS.md` and `gittor.d.ts` are written again at each start. Do not edit them.

The folders of the other workflows are next to this one (`../<id>/`), and `../agents.json` lists the
agent programs of all workflows.

## workflow.json

```json
{ "name": "Release", "projects": ["/Users/me/code/app", "/Users/me/code/api"], "knowledge": ["/Users/me/notes/release"] }
```

- `projects`: the repositories of the workflow. Gittor opens them when the workflow opens. The mods
  get their roots from `g.projects()`, and `g.call` works on the first one unless the arguments name
  another `root`. Without projects, the mods work on the repository of the active tab of the Git side.
- `knowledge`: folders with documents, notes or code that the work needs. Gittor shows them; read them
  when the user asks about the work.

## layout.json

The window is a tree of rows and columns. Its leaves are panels (fixed windows, as the tool windows of an
IDE) and one canvas (cards at free places, with arrows between them, as a flow chart).

```json
{
  "type": "row",
  "children": [
    { "type": "column", "size": 280, "children": [
      { "mod": "branches", "title": "Branches", "collapsible": true, "grow": 1 }
    ] },
    { "type": "canvas", "title": "Flow", "grow": 1,
      "nodes": [
        { "id": "work", "mod": "work", "title": "Work in progress", "x": 40, "y": 40, "w": 300,
          "children": [
            { "id": "changes", "mod": "changes", "title": "Local Changes", "x": 40, "y": 40, "w": 320, "h": 320 },
            { "id": "stashes", "mod": "stashes", "title": "Stashes", "x": 460, "y": 40, "w": 300 }
          ],
          "edges": [{ "from": "changes", "to": "stashes", "label": "stash" }] },
        { "id": "remotes", "mod": "remotes", "title": "Remote Branches", "x": 460, "y": 40, "w": 300 }
      ],
      "edges": [{ "from": "work", "to": "remotes", "label": "commit, push" }] }
  ],
  "dock": { "mod": "chat", "title": "Agent", "width": 420, "height": 540 }
}
```

Rows, columns and panels:

- `type`: `"row"` (children side by side), `"column"` (children on top of each other) or `"canvas"`.
- `mod`: the name of a folder in `mods/`. A node with `mod` is a block that shows that mod.
- `size`: a fixed width (in a row) or height (in a column), in pixels. `grow`: a share of the free space.
  A node without `size` and `grow` gets `grow: 1`.
- `title`: a title bar over the block; then the block is a panel. `collapsible: true` lets the user fold
  the panel to its title bar. `badge: "agent"` shows the state of the agent in the title bar.
- `class` adds CSS classes. `props` is an object that the mod gets as `g.props`.
- `dock` (on the top node only, optional): a window that floats over the layout at the bottom left. A
  small round button at the bottom left opens and closes it, and shows the state of the agent. The
  chat with you is in it. Keep the dock for the chat, unless the user asks for another place; the chat
  can also be a panel (`{ "mod": "chat", "title": "Agent", "badge": "agent", "collapsible": true }`).

The canvas:

- `nodes`: the cards. `id` is unique on its level. `mod` draws the body of the card. `x` and `y` are the
  place of the top left corner, in pixels of the canvas. `w` and `h` are the size; without `h`, the card
  is as high as its content. `title` is the text of the title bar of the card.
- `edges`: arrows from the card `from` to the card `to` of the same level, with an optional `label`.
- **Nested cards.** A card can hold its own canvas: `children` (cards) and `edges`. Then the card looks
  like a stack. The user opens it (a double click on its title, its open button, or a zoom in past
  200%); the view flies into the card and shows the cards inside. A trail at the top left and Esc go
  back. Use this for details: keep the outer card short (a summary), and put the details inside.
- **Detail view.** A card without `children` opens to a large view of one mod: `detail` names that mod,
  or the card mod shows again. The mod gets `g.props.detail === true` there, so one mod can draw a short
  version in the card and a full version in the detail view.
- **Workflow cards.** A card with `"workflow": "<id>"` and no `mod` is a link to another workflow: it
  shows the projects of that workflow, and a click on it opens that workflow in a tab. The id is the
  name of the folder of the workflow. Example: `{ "id": "to-release", "workflow": "release", "x": 900,
  "y": 40, "w": 260 }`.
- **Note cards.** A card with `"note": "<text>"` and no `mod` shows the text. The user writes notes on
  the canvas; read them, they often say what the user wants.
- The user also edits the canvas in the window: a double click on the empty canvas adds a note, the
  context menu and the + button add cards, a drag from the dot on the side of a card to another card
  adds an edge, and a double click on an edge changes its label. Gittor writes all of it into this file.
- When the user drags a card, Gittor writes the new `x` and `y` into this file. Read the file again
  before you change it, so that you keep the places of the user.
- Put a new card where there is free space, for example to the right of the last card.

The classes for `style.css`: `.am-panel`, `.am-panel-head`, `.am-canvas` (the grid; its color is
`--grid`), `.am-card`, `.am-stack` (a card with cards inside), `.am-card-head`, `.am-card-body`,
`.am-edge` (an SVG path), `.am-edge-label`, `.am-detail-body`, `.am-crumbs`, and `.am-dock`.

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

`agents.json` is in the folder of all workflows (`../agents.json`):

```json
[{ "name": "Claude Code", "command": "npx", "args": ["-y", "@agentclientprotocol/claude-agent-acp"], "env": {} }]
```

`env` adds environment variables, for example `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` or `GEMINI_API_KEY`.
The values are plain text in this file.
