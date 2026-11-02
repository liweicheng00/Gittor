// Open in Terminal: the Terminal button opens a terminal app in the folder of the repository.

import { api } from "./api";
import { toast } from "./notify";
import { terminalBtn } from "./shell";

export function openInTerminal() {
  api.openInTerminal().catch((e) => toast(String(e).replace(/^Error: /, ""), "error"));
}

terminalBtn.dataset.keyAction = "openInTerminal";
terminalBtn.addEventListener("click", openInTerminal);
