// The Worktrees tab: the star of a row adds the worktree to the favorites of the repository.

import { toggleWorktreeFavorite } from "./repo";
import { worktreePanel } from "./shell";

worktreePanel.onToggleFavorite = (w) => toggleWorktreeFavorite(w.path);
