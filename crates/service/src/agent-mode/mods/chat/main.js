// The chat with an agent: pick an agent of agents.json, start it, and talk. The log is in Gittor
// (g.agent.log()), so this mod can load again without losing the conversation.

export default function mount(root, g) {
  const { h } = g;
  const picker = h("select", { class: "x-chat-picker", title: "The agent program (agents.json)" });
  const startBtn = h("button", { class: "x-chat-btn", onclick: () => start() }, "Start");
  const state = h("span", { class: "x-chat-state" });
  const head = h("div", { class: "x-chat-head" }, picker, startBtn, state);
  const log = h("div", { class: "x-chat-log" });
  const input = h("textarea", { class: "x-chat-input", rows: 3, placeholder: "Ask the agent. Enter sends, Shift+Enter makes a new line." });
  const sendBtn = h("button", { class: "x-chat-btn x-chat-send", onclick: () => send() }, "Send");
  const stopBtn = h("button", { class: "x-chat-btn", onclick: () => g.agent.cancel() }, "Stop");
  const foot = h("div", { class: "x-chat-foot" }, input, h("div", { class: "x-chat-actions" }, sendBtn, stopBtn));
  root.append(h("div", { class: "x-chat" }, head, log, foot));

  g.agent.list().then(
    (list) => picker.replaceChildren(...list.map((a, i) => h("option", { value: String(i) }, a.name))),
    (e) => g.toast(String(e), "error"),
  );

  async function start() {
    try {
      await g.agent.start(Number(picker.value || 0));
    } catch (e) {
      g.toast(String(e), "error");
    }
  }

  async function send() {
    const text = input.value.trim();
    if (!text || g.agent.state() !== "ready") return;
    input.value = "";
    try {
      await g.agent.send(text);
    } catch (e) {
      g.toast(String(e), "error");
    }
  }

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      void send();
    }
  });

  function entry(e) {
    switch (e.kind) {
      case "user":
        return h("div", { class: "x-chat-msg x-chat-user" }, e.text);
      case "agent":
        return h("div", { class: "x-chat-msg x-chat-agent" }, e.text);
      case "thought":
        return h("div", { class: "x-chat-msg x-chat-thought" }, e.text);
      case "tool":
        return h("div", { class: `x-chat-tool x-chat-tool-${e.status}` }, h("span", { class: "x-chat-tool-dot" }), e.title || e.toolKind);
      case "plan":
        return h("div", { class: "x-chat-plan" }, ...e.entries.map((p) => h("div", { class: `x-chat-plan-${p.status}` }, p.content)));
      case "permission": {
        const box = h("div", { class: "x-chat-perm" }, h("div", { class: "x-chat-perm-title" }, e.title));
        if (e.answer === undefined) {
          box.append(
            h(
              "div",
              { class: "x-chat-perm-options" },
              ...e.options.map((o) => h("button", { class: `x-chat-btn x-chat-perm-${o.kind}`, onclick: () => g.agent.answer(e.token, o.optionId) }, o.name)),
            ),
          );
        } else {
          const picked = e.options.find((o) => o.optionId === e.answer);
          box.append(h("div", { class: "x-chat-perm-answer" }, picked ? picked.name : "Cancelled"));
        }
        return box;
      }
      case "error":
        return h("div", { class: "x-chat-msg x-chat-error" }, e.text);
      default:
        return h("div", { class: "x-chat-info" }, e.text);
    }
  }

  // Gittor gives a changed entry as a new object: draw only the new and the changed entries.
  let shown = [];
  function render() {
    const entries = g.agent.log();
    const atEnd = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    if (!shown.length || entries.length < shown.length) {
      log.replaceChildren();
      shown = [];
    }
    entries.forEach((e, i) => {
      if (shown[i] === e) return;
      if (i < shown.length) log.children[i].replaceWith(entry(e));
      else log.append(entry(e));
    });
    shown = entries.slice();
    if (atEnd) log.scrollTop = log.scrollHeight;
    const s = g.agent.state();
    state.textContent = s === "off" ? "" : `${g.agent.name() ?? ""} · ${s}`;
    state.dataset.state = s;
    sendBtn.disabled = s !== "ready";
    stopBtn.disabled = s !== "busy";
    startBtn.textContent = s === "off" || s === "error" ? "Start" : "Restart";
    if (!entries.length) log.replaceChildren(h("div", { class: "x-chat-empty" }, "Start an agent, then ask it to change this window. It edits the files in ", h("code", {}, g.dir), "."));
  }
  render();
  return g.on("agent", render);
}
