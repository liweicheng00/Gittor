# Review with an AI coding agent: research and ranked ideas

Status: research, 2026-11-24. No app code changed. The wireframes are in [`review-ai/`](review-ai/).

## 1. The question

How can the Review feature of Gittor become the best place for a human and an AI coding agent
(Claude Code, Codex, Cursor, and others) to work together on one change?

## 2. What Gittor has now (read from the code)

| Part | Where | Facts that matter for an agent loop |
| --- | --- | --- |
| Review of a branch | `crates/git/src/review.rs`, `ui/src/review-view.ts` | The data is in `<common git dir>/gittor/reviews.json`. All worktrees share it. |
| Viewed marks | `Stored.viewed` (path → blob), `Stored.commit_viewed` (commit → paths) | A file mark keeps the blob, so a rebase that keeps the content keeps the mark. A commit mark keeps the commit oid, so a rebase loses it. |
| Notes | `ReviewComment` | A note has `path`, `line`, `end_line`, `text`, `blob`, `resolved`, `commit`. It has no author, no state other than `resolved`, and no replies. |
| Outdated | `review_detail` | A note is outdated when the blob of its file changed. Gittor does not move the note to the new line. |
| Notes on local changes | `crates/git/src/local_notes.rs` | In `<worktree git dir>/gittor/local-notes.json`. A note goes away when its file changes. |
| Clipboard text | `ui/src/note-format.ts` | `path:line` and the text. There is no code around the line, no commit, and no rules for the agent. |
| Copy for an Agent | `ui/src/rebase-agent-text.ts` | A full task: the repository, `HEAD must be`, the todo, the check, the rules, the undo. It is the model for a review task. |
| Store writes | `save_reviews`, `save_local_notes` | Read, change, then write a temporary file and rename it. There is no lock. Two writers at the same time lose a change. |
| Watcher | `crates/service/src/watch.rs` line 231 | It ignores changes under `gittor/` in the git dir. A note that another program writes does not show until the next load. |
| Local server | `crates/devserver` | Binds to 127.0.0.1 and checks no `Origin`. It is for tests, not for agents. |

## 3. The loops of today

### Loop A: the agent writes, the human reviews

1. The human starts an agent in a worktree (`claude --worktree`, Codex, Cursor).
2. The agent changes files and makes commits.
3. The human opens Review of the branch, reads the diff, writes notes.
4. Copy All Notes, then paste into the terminal of the agent.
5. The agent changes code and commits again.
6. The human opens the review again.

Where time and context go:

- **Step 4 loses context.** The text has `path:line` only. The agent must find the code again. It does
  not know which commit the human saw. When the lines moved, `path:line` points at the wrong code.
- **Step 4 loses the link back.** Nothing records that a note went to the agent. Nothing records the
  answer of the agent. The human compares the summary of the agent with the notes by memory.
- **Step 6 starts again from zero.** Each file that the agent changed is "not viewed". The human reads
  the whole file again, not only the new lines. Notes on changed files are "outdated", also when the
  agent fixed exactly that line.
- **Commit marks go away** after the agent rebases or amends: they keep the old commit oids.
- **Gittor does not know the agent.** It does not show which worktree has an agent, whether the agent
  works or waits, or when it finished.

### Loop B: the human writes, the agent reviews

1. The human changes code (local changes, or a branch).
2. The human runs `/review` (Claude Code), `codex review`, or a review tool, in a terminal.
3. The findings come back as text in the terminal.
4. The human reads them, opens each file in Gittor, and fixes or ignores each finding.

Where time and context go:

- The findings are not on the lines of the diff. The human goes from the terminal to the file by hand.
- There is no "accept" or "drop" per finding, and no record of what the human decided.
- The next run of the agent finds the same dropped items again.

### Loop C: the agent works on local changes, the human checks before a commit

1. The agent edits files and does not commit.
2. The human opens Compare or the Files tab, and writes local notes.
3. Copy All Notes, paste, the agent edits again.
4. **Each note goes away**, because its file changed. The human cannot see whether the agent did it.

## 4. What other tools do

Method: a subagent searched the web on 2026-11-24. The network of this session blocks
`docs.github.com` and `docs.gitlab.com`. So the facts below come from search result summaries that
quote these pages; nobody opened them in full. Marks: (3rd) is a page not from the vendor.

### GitHub pull requests and Copilot

- A file has a Viewed mark. When the file changes after the view, the mark goes away. A 2019 post adds
  a "Changed since last view" badge; we could not check that the badge is still there.
  <https://github.blog/2019-07-01-mark-files-as-viewed/>
- A suggested change can be applied alone, or in a batch as one commit.
  <https://docs.github.com/en/pull-requests/how-tos/review-pull-requests/incorporating-feedback-in-your-pull-request>
- A pending review holds comments until submit. The docs say that this stops Copilot from starting on
  single comments before the review is complete. Only the author or a writer resolves a conversation.
  <https://docs.github.com/en/pull-requests/how-tos/review-pull-requests/commenting-on-a-pull-request>
- A comment on code that changed shows "outdated". <https://github.blog/changelog/2018-10-30-outdated-comments>
- Copilot code review leaves a "Comment" review, not an approval. "Fix with Copilot" on a comment gives
  the fix to the cloud agent. It reads `.github/copilot-instructions.md` and
  `.github/instructions/*.instructions.md`.
  <https://docs.github.com/en/copilot/how-tos/use-copilot-agents/request-a-code-review/use-code-review>
- The Copilot coding agent works on a draft pull request. New instructions go as comments on that pull
  request. It cannot approve or merge.
  <https://docs.github.com/en/enterprise-cloud@latest/copilot/concepts/agents/coding-agent/about-coding-agent>

### GitLab merge requests

- Each push makes a diff version. The user compares any two versions.
  <https://docs.gitlab.com/user/project/merge_requests/versions>
- A viewed file stays hidden until its content changes. A one-click "changes since last review" is
  still a request. <https://gitlab.com/gitlab-org/gitlab/-/issues/25559>
- A setting resolves a diff thread automatically when a push changes its lines.
  <https://archives.docs.gitlab.com/15.11/ee/user/discussions>
- Duo Code Review reads rules from `.gitlab/duo/mr-review-instructions.yaml`; each comment names its rule.
  <https://docs.gitlab.com/user/gitlab_duo/customize_duo/review_instructions/>

### CodeRabbit

- Each finding has a "Prompt for AI Agents" block, and "Fix all issues with AI agents" joins them into
  one prompt. <https://coderabbit.ai/ja/blog/fix-all-issues-with-ai-agents-a-quality-of-life-improvement-ja>
- `@coderabbitai review` reviews only the new changes; `full review` reviews all.
  <https://docs.coderabbit.ai/reference/review-commands>
- A CLI reviews local changes (`--uncommitted`), and a Claude Code plugin calls it.
  <https://docs.coderabbit.ai/cli>, <https://docs.coderabbit.ai/cli/claude-code-integration>

### Graphite

- Stacked branches with `gt create`, `gt submit`, `gt restack`. <https://graphite.dev/docs/create-submit-prs>
- Graphite Agent (it replaced Diamond) reviews pull requests and can address feedback.
  <https://graphite.com/blog/introducing-graphite-agent-and-pricing>
- We found no source on how its comments are resolved.

### Claude Code

- Hooks: `SessionStart`, `SessionEnd`, `UserPromptSubmit`, `Stop`, `StopFailure`, `PreToolUse`,
  `PostToolUse`. A `SessionStart` hook can give context to Claude. <https://code.claude.com/docs/en/hooks>
- Skills and slash commands are one thing now: `.claude/skills/x/SKILL.md` gives `/x`.
  <https://code.claude.com/docs/en/skills>
- MCP: stdio is the default transport (`claude mcp add <name> -- <cmd>`). A project `.mcp.json` needs
  approval after a clone. <https://code.claude.com/docs/en/mcp>
- `/review` (`/code-review`) reviews a branch, a pull request, a path or a range.
  <https://code.claude.com/docs/en/code-review-local>
- `claude --worktree <name>` works in `.claude/worktrees/<name>` on the branch `worktree-<name>`.
  <https://code.claude.com/docs/en/worktrees.md>
- The GitHub Action answers `@claude` in review comments, changes code and pushes.
  <https://code.claude.com/docs/en/github-actions>

### Cursor

- Bugbot reviews pull requests with rules from `.cursor/BUGBOT.md`; "Fix in Cursor" opens a finding in
  an agent. <https://cursor.com/docs/bugbot>
- After an agent edit, a review bar accepts or rejects the changes of each file, and single lines.
  <https://docs.cursor.com/agent/review>

### OpenAI Codex

- `codex review --uncommitted`, `--base main`, `--commit <sha>`; `/review` has the same scopes.
  <https://developers.openai.com/codex/app/review>, (3rd) <https://www.mintlify.com/openai/codex/cli/review>
- `@codex review` on a pull request reports only P0 and P1 items, and follows the review rules in
  `AGENTS.md`. <https://developers.openai.com/codex/integrations/github>
- `AGENTS.md` is a shared convention; the nearest file wins. <https://www.agents.md>

### JetBrains IntelliJ

- AI Self-Review reviews uncommitted changes or a commit; results go to the Problems tool window, and a
  Markdown file gives the rules. <https://www.jetbrains.com/help/ai-assistant/ai-in-vcs-integration.html>
- The pull request review mode shows comments in the editor; they stay "Pending" until Submit.
  <https://www.jetbrains.com/help/idea/work-with-github-pull-requests.html>

### Gerrit

- A Change-Id links all patch sets of one change.
  (3rd) <https://nv-tegra.nvidia.com/r/Documentation/concept-patch-sets.html>
- Each file has a "reviewed" flag. Gerrit carries the flags forward from the newest earlier patch set
  that has them. <https://gerrit-review.googlesource.com/Documentation/user-review-ui.html>,
  <https://gerrit.googlesource.com/gerrit/+/f3cdd45e9e3bc2361e87ae2542079331e20c93cd>
- The user chooses a base patch set, and sees the diff between two patch sets.
  <https://groups.google.com/g/repo-discuss/c/-M-gjwm3TDA>
- The attention set shows whose turn it is. A reply moves the turn. Bots never get the turn.
  <https://gerrit-review.googlesource.com/Documentation/user-attention-set.html>

### MCP security for local servers

- With stdio, the client starts the server as a child process. No port is open.
  <https://modelcontextprotocol.io/docs/tutorials/security/local-server-security>
- An HTTP server must check `Origin` (DNS rebinding), bind to 127.0.0.1, and use authentication.
  <https://cheatsheetseries.owasp.org/cheatsheets/MCP%5FSecurity%5FCheat%5FSheet.html>
- The MCP SDKs had DNS rebinding protection off by default until TypeScript 1.24.0 and Python 1.23.0
  (CVE-2025-66416). stdio servers were safe.
  <https://github.com/modelcontextprotocol/typescript-sdk/security/advisories/GHSA-w48q-cv73-mx4w>

### Small local review tools for agents (community, maturity not checked)

- tuicr: a terminal review UI; comments by kind (issue, suggestion, note, praise); export as Markdown
  with `file:line`; a Claude Code skill opens it. <https://github.com/agavra/tuicr>
- difit: a local web diff; copies comments as a prompt with `path:L<n>`.
  <https://github.com/yoshiko-pg/difit>
- MCP loops where the agent reads queued comments and replies: wyrd-diff, local-pr-reviewer, Backloop,
  CodeChat, diffx, Parley. <https://github.com/lava/backloop>, <https://github.com/alexmx/codechat>,
  <https://github.com/wong2/diffx>
- We found no source for "Critique" or for review tools on git notes.

### What these sources teach

1. **The note is the unit of work.** GitHub, CodeRabbit, Cursor and the small tools all give one
   action per comment: fix it, accept it, drop it. A note needs a state, not only "resolved".
2. **The agent answers in the thread.** The Copilot coding agent and the `@claude` action take
   instructions from review comments and answer with commits. Gittor has no reply and no commit link.
3. **"Changes since my last review" is the main saving.** Gerrit and GitLab compare versions. GitHub
   only removes the mark. Gittor already keeps the blob of each viewed file.
4. **Batch, then send.** GitHub pending reviews exist so that an agent does not start on half a review.
5. **The agent must not approve or merge.** Copilot and the GitHub agents cannot. Gerrit keeps bots out
   of the attention set.
6. **Rules live in a file of the repository** (`AGENTS.md`, `BUGBOT.md`, `copilot-instructions.md`,
   `mr-review-instructions.yaml`). Gittor can point to `AGENTS.md` and need no file of its own.
7. **Local and stdio is the safe transport.** An HTTP server on localhost needs Origin checks and a
   token; a stdio child process needs neither.

## 5. Ideas, ranked

Value is for the owner, who works alone with agents in worktrees. Layers: Rust `Repo` (`crates/git`),
service (`crates/service`), UI flow module (`ui/src`).

### 1. The note loop: states, replies, author

- **What.** A note gets a state: Open, Sent, Answered, Resolved. It gets replies, each with an author
  (`human` or the name of the agent) and an optional commit. The UI filters "Needs my check"
  (Answered). Accept resolves. Reopen adds a reply and sets Open. Wireframe 1.
- **Value.** High. It removes the comparison of the agent summary with the notes by memory. Each other
  idea needs it.
- **Risk.** Low. The old `reviews.json` reads with defaults (`#[serde(default)]`). The note card gets
  bigger; keep the resolved chip as now.
- **Layers.** `ReviewComment` gets `state`, `author`, `replies: Vec<Reply>`. `ReviewEdit` gets `Reply`
  and `SetState`. `note-layer.ts` draws the replies; `review-view.ts` gets the counts and the filter.
  The same for `LocalNote`.
- **From outside.** Nothing.

### 2. Changes since my last review

- **What.** A file that was viewed and then changed is "changed since viewed", not "not viewed". Its
  diff compares the viewed blob with the new blob. A note moves to its new line through that diff
  instead of "outdated" (GitLab moves and resolves; Gittor only moves). Commit marks follow a rebase
  through `git patch-id`. Wireframe 2.
- **Value.** High. After the first pass, the human reads only what the agent changed.
- **Risk.** Medium. The line map can be wrong when a hunk changes much; then keep "outdated". Patch-ids
  differ when the agent changes a commit; then the mark goes away, as now.
- **Layers.** `Stored` keeps `viewed_history: path → [(blob, time)]` or one `last_pass` time per
  review. `Repo` gets a line map (from `git diff` of two blobs; `hunks.rs` has hunk code). The diff
  view already compares two sides; `DiffView` gets the two blobs.
- **From outside.** Nothing.

### 3. A review task for the agent ("Send to Agent")

- **What.** One Markdown task from the open notes, as `rebase-agent-text.ts` makes for a rebase: the
  repository and worktree path, `HEAD must be <oid>`, each note with `path:line`, three lines of code
  around it and its id, the rules (commit each fix, do not push, do not resolve), and how to reply.
  The notes become Sent. The task goes to the clipboard, and optionally to a file
  `.git/gittor/tasks/<branch>.md` that a hook or a skill reads. Wireframe 1 (button) and 3 (text).
- **Value.** High, and small. It fixes the lost context of step 4 today, with no new transport.
- **Risk.** Low. A long task for many notes; cut the code context to a limit.
- **Layers.** A pure module `review-agent-text.ts` with unit tests (as `rebase-agent-text.ts`); a
  button in `review-view.ts`; `ReviewEdit::SetState` for Sent.
- **From outside.** Nothing. `AGENTS.md` of the repository can hold the rules.

### 4. The agent bridge: a CLI, then a stdio MCP server

- **What.** A program `gittor-bridge` with subcommands: `review list`, `review get`, `review task`,
  `review reply <branch> <id> --commit <oid> <text>`, `review suggest`, `local-notes get`. Later,
  `gittor-bridge mcp` serves the same as MCP tools over stdio. Wireframe 3.
- **Value.** High. The agent reads the notes itself and writes its answer into the right note. The
  loop has no copy and no paste.
- **Risk.** Medium, security first:
  - stdio only. No port, so no other program and no web page can reach it. Do not reuse the dev
    server for this: it has no `Origin` check and serves all commands.
  - The bridge has no command that moves a ref, merges, rebases, pushes, deletes a review, changes a
    viewed mark or resolves (resolve can be a setting, off by default). Read and reply only.
  - The agent runs as the same user and can edit `reviews.json` by hand anyway. The bridge protects
    against mistakes, not against a hostile agent. Each write goes to `.git/gittor/bridge.log`.
  - Text from the agent is data. The UI shows it as text or through the Markdown sanitizer of
    `markdown-preview.ts`.
- **Layers.** A new binary crate that uses `gittor-git` (`Repo` already has all reads). Two fixes in
  `Repo` first: a lock file around read-change-write of `reviews.json` and `local-notes.json`, and the
  watcher must not ignore these two files (`watch.rs` ignores all of `gittor*`), so the window shows
  a reply at once. The MCP part needs an MCP crate or a small JSON-RPC loop.
- **From outside.** The MCP convention of the agents (`.mcp.json` for Claude Code; Codex and Cursor
  have their own config files). A skill or `AGENTS.md` line tells the agent to use it.

### 5. Agent sessions on the Worktrees tab

- **What.** The Worktrees tab shows which agent works in which worktree, and its state: working,
  waits for you, stopped. Also the counts of Sent and Answered notes. Wireframe 3, left.
- **Value.** Medium. The owner runs several agents; this shows whose turn it is (Gerrit attention set).
- **Risk.** Medium. Each agent tells its state in another way. Without a signal, Gittor can only guess
  from file changes.
- **Layers.** A small status file per worktree, `<worktree git dir>/gittor/agent.json` (name, state,
  time). The bridge writes it, or a Claude Code hook (`SessionStart`, `Stop`, `Notification`) runs
  `gittor-bridge status <state>`. The watcher sees it; `worktree-panel.ts` draws it.
- **From outside.** Hooks of each agent. Claude Code has them; for others, check before building.

### 6. AI first pass as suggestions

- **What.** The agent reviews the branch and writes suggestions through `note_suggest`. A suggestion
  shows in another color with Accept (it becomes a human note, Open) and Drop (it is kept as dropped,
  so the next pass does not raise it again).
- **Value.** Medium. Loop B gets findings on the lines, and a record of what the human decided.
- **Risk.** Medium. Noise: many weak findings. Keep a severity, and fold low ones.
- **Layers.** A note kind `suggestion` with `author`; the rest is idea 1 and 4.
- **From outside.** The review prompt of the agent (`/review`, `codex review`). Gittor does not call a
  model itself.

### 7. Local notes that survive the change

- **What.** Today a local note goes away when its file changes, so the human cannot see whether the
  agent did it. Keep the note with the old hash, mark it "changed", and give it the same states and
  replies as a review note.
- **Value.** Medium for Loop C.
- **Risk.** Low. It changes a rule that the owner chose; ask first.
- **Layers.** `local_notes.rs` and `local-notes.ts`; line map from idea 2.

### 8. One loop for both: "review the worktree" from uncommitted to merged

- **What.** A review that also shows the uncommitted changes of the worktree of its branch, so the
  notes on local changes and on commits are in one window.
- **Value.** Medium. **Risk.** High: the line of a note on the working tree moves with each save.
  Do it after ideas 2 and 7.

### Dropped ideas

- **Gittor calls a model itself.** It needs keys, cost control and prompts. The agents already do it.
- **A local HTTP server for agents.** stdio does the same with no port and no token.
- **Push notes to GitHub as a pull request review.** It is outside the local loop, and the owner keeps
  reviews off the remote.
- **Notes in `git notes` or in a file in the working tree.** `git notes` attach to commits, which
  change at each rebase. A file in the working tree goes into commits by mistake. `.git/gittor` is the
  right place.

## 6. Recommended first step

Ideas 3 and 1, the smallest part of each, with no external dependency:

1. `review-agent-text.ts`: the task text of idea 3 (path and line, code around it, note id,
   `HEAD must be`, rules), with unit tests.
2. `ReviewComment.state` with Open and Sent, and a "Send to Agent" button that copies the task and
   sets Sent.
3. The two fixes that each later step needs: a lock around writes of `reviews.json` and
   `local-notes.json`, and a watcher that sees these files.

The agent answers in its terminal as today. The human then sees which notes went out.

### Later step

1. Replies and Answered (idea 1), written by `gittor-bridge review reply` (idea 4, CLI only).
2. Changes since my last review (idea 2).
3. `gittor-bridge mcp` over stdio, a Claude Code skill that uses it, and agent states on the Worktrees
   tab (idea 5).

## 7. Open questions for the owner

1. Which agents do you use most? The bridge and the hooks start with one (Claude Code is likely).
2. May the agent resolve a note, or only answer it? The proposal: only answer; you resolve.
3. Must notes on local changes stay after the file changes (idea 7)? Today they go away by design.
4. Is a second program (`gittor-bridge`) acceptable, or must the bridge be in the app binary (for
   example `Gittor --bridge`)? A second program is easier to ship to the `PATH` of a terminal.
5. Where does the task file go: only the clipboard, or also `.git/gittor/tasks/` for a hook to read?
6. Should Gittor add a line to `AGENTS.md` or a skill to `.claude/skills` of a repository, or only
   show the text for the user to copy?

## 8. Wireframes

| File | Idea |
| --- | --- |
| [`review-ai/1-note-loop.png`](review-ai/1-note-loop.png) ([HTML](review-ai/1-note-loop.html)) | 1 and 3: note states, the reply of the agent with its commit, Send to Agent |
| [`review-ai/2-since-last-review.png`](review-ai/2-since-last-review.png) ([HTML](review-ai/2-since-last-review.html)) | 2: the diff from the viewed blob, the note that follows its line |
| [`review-ai/3-agent-bridge.png`](review-ai/3-agent-bridge.png) ([HTML](review-ai/3-agent-bridge.html)) | 4 and 5: the tools of the bridge, what the agent cannot do, agents on the Worktrees tab |
