// LittleA Editor — bootstrap / composition root.
//
// The editor's orchestration was one big module closure in index.html; it is
// now split into concern modules (state / core / history / timeline /
// inspector / tools / files). This file is the entry point that index.html
// loads: it initialises the two wasm modules, publishes the handles through
// state.js, wires the global listeners (code pane + keyboard) each concern
// module can't own alone, mounts the menus, restores the persisted session,
// and paints the first frame. Every module-crossing call happens here or
// inside a handler — never at import-evaluation time — so the (intentional)
// circular imports between concern modules resolve cleanly.

import initEditor, { EditorDoc } from "../pkg/la_editor.js";
import initPlayer, { Player } from "../../crates/la-player/web/pkg/la_player.js";
import { DEFAULT_SRC, TOOL_KEYS } from "./constants.js";
import { $ } from "./util.js";
import { initWasm, state } from "./state.js";
import { refreshPreview, setPlayheadUI } from "./core.js";
import { persistHistory, restoreHistory, undo, redo } from "./history.js";
import {
  rebuildTimeline, wireTimeline, exitContext, togglePlay, stepFrame,
  deleteKeyframe, copyKeyframe, pasteKeyframe, insertKeyframe, closeTimelineMenu,
} from "./timeline.js";
import { refreshNodeList, wireInspector, deleteSelected, duplicateSelected, cutSelected, copySelected, pasteClipboard } from "./inspector.js";
import { wireTools, setTool, setZoom, zoomBy } from "./tools.js";
import { buildLibrary, wirePanels, wireImportSvg, wireImportVideo, wireImportAudio, buildMenus, fileSave, fileOpen } from "./files.js";
import { wireLabelTool, openLabelTool, closeLabelTool, labelToolOpen } from "./labeltool.js";
import { wireBackgroundTool } from "./bgtool.js";
import { bgPanelOpen } from "./bgpanel.js";

await Promise.all([initEditor(), initPlayer()]);

const player = new Player($("stage"));
const doc = new EditorDoc(DEFAULT_SRC);
initWasm(doc, player);

// ---- code pane -> scene ---------------------------------------------
$("code").value = DEFAULT_SRC;
$("code").addEventListener("input", () => {
  try {
    doc.set_source($("code").value);
  } catch (e) {
    $("status").textContent = String(e);
    $("status").className = "err flex-1 overflow-hidden text-ellipsis whitespace-nowrap";
    return;
  }
  if (refreshPreview()) {
    rebuildTimeline();
    refreshNodeList();
  }
  persistHistory();
});

// ---- properties panel, tool palette + gestures, timeline transport --
wireInspector();
wireTools();
wireTimeline();
wireLabelTool();
wireBackgroundTool();

// Where the browser owns the keyboard: the code pane, the inspector fields,
// and the in-place text editor on the stage. Keyed on the ELEMENT rather than
// on `#code`, so a text field the editor grows later is covered by default —
// the stage editor is a <textarea> that is not the code pane.
const isTyping = (el) =>
  !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);

// Delete key removes the selected keyframe, else the selected node, unless a
// text field/menu is focused.
window.addEventListener("keydown", (ev) => {
  // The Background dialog is modal and runs its own keyboard (arrows walk the
  // gallery, Escape closes it), so the editor's shortcuts stand down entirely
  // while it is up — including Escape, which is the dialog's own.
  if (bgPanelOpen()) return;
  if (ev.key === "Escape") {
    closeTimelineMenu();
    // The Label dialog is modal, so it takes Escape before the drill-down
    // context does — otherwise closing it would also leave the symbol.
    if (labelToolOpen()) { ev.preventDefault(); closeLabelTool(); return; }
    if (state.contextStack.length) {
      if (isTyping(document.activeElement)) return;
      ev.preventDefault();
      exitContext();
    }
    return;
  }
  if (ev.key !== "Delete") return;
  if (labelToolOpen()) return;
  const el = document.activeElement;
  if (isTyping(el) || (el && el.tagName === "SELECT")) return;
  ev.preventDefault();
  // A picked keyframe wins: it is the more specific selection, and it is only
  // ever set by clicking a dot.
  if (!deleteKeyframe()) deleteSelected();
});

// Ctrl/Cmd+D duplicates the selected node, unless a text field is focused.
window.addEventListener("keydown", (ev) => {
  if (bgPanelOpen()) return;
  if ((ev.key === "d" || ev.key === "D") && (ev.ctrlKey || ev.metaKey)) {
    if (labelToolOpen()) return;
    const el = document.activeElement;
    if (isTyping(el) || (el && el.tagName === "SELECT")) return;
    ev.preventDefault();
    duplicateSelected();
  }
});

// ---- keyboard shortcuts ---------------------------------------------
window.addEventListener("keydown", (ev) => {
  if (bgPanelOpen()) return;
  const el = document.activeElement;
  // A <select> holds no text of its own, so hijacking the clipboard there
  // takes nothing away — but typing a letter into one still jumps to a
  // matching option, so it counts as "in text" for the tool keys below.
  // A modal dialog owns the keyboard while it is up, apart from the Escape
  // that closes it (handled above).
  if (labelToolOpen()) return;
  const typing = isTyping(el);
  const inText = typing || (el && el.tagName === "SELECT");
  if (ev.metaKey || ev.ctrlKey) {
    const k = ev.key.toLowerCase();
    if (k === "s") { ev.preventDefault(); fileSave(); return; }
    if (k === "o") { ev.preventDefault(); fileOpen(); return; }
    if (typing) return;
    // A picked keyframe wins, because it is the more specific selection —
    // exactly as it does for Delete. Otherwise these act on the node.
    if (k === "c" && state.kfSel) { ev.preventDefault(); copyKeyframe(); return; }
    if (k === "v" && state.kfClipboard) { ev.preventDefault(); pasteKeyframe(); return; }
    if (k === "c" && $("nodeSel").value) { ev.preventDefault(); copySelected(); return; }
    if (k === "x" && $("nodeSel").value) { ev.preventDefault(); cutSelected(); return; }
    if (k === "v" && state.nodeClipboard) { ev.preventDefault(); pasteClipboard(); return; }
    if (inText) return;
    if (k === "z" && !ev.shiftKey) { ev.preventDefault(); undo(); }
    else if ((k === "z" && ev.shiftKey) || k === "y") { ev.preventDefault(); redo(); }
    else if (k === "=" || k === "+") { ev.preventDefault(); zoomBy(1.25); }
    else if (k === "-" || k === "_") { ev.preventDefault(); zoomBy(0.8); }
    else if (k === "0") { ev.preventDefault(); setZoom(1); }
    return;
  }
  if (inText || (el && el.tagName === "BUTTON")) return;
  // Not in TOOL_KEYS: the Label tool is a command (it opens a dialog), not one
  // of the mutually-exclusive stage modes setTool() switches between.
  if (ev.key.toLowerCase() === "g") { ev.preventDefault(); openLabelTool(); return; }
  // Background deliberately has NO letter key: every free one is a stage mode
  // (b is Brush), and stealing one to open a dialog would be a worse trade than
  // reaching for the palette button.
  const toolKey = TOOL_KEYS[ev.key.toLowerCase()];
  if (toolKey) { setTool(toolKey); return; }
  if (ev.key === "F6") { ev.preventDefault(); insertKeyframe(); }
  else if (ev.key === "Enter") { ev.preventDefault(); togglePlay(); }
  else if (ev.key === ".") stepFrame(1);
  else if (ev.key === ",") stepFrame(-1);
});

buildMenus();
// Resume a persisted session before the first render so a refresh restores
// the working document and its undo history (#9); a fresh visit keeps the
// default scene loaded above.
await restoreHistory();
$("code").value = doc.source();
rebuildTimeline();
buildLibrary();
wirePanels();
wireImportSvg();
wireImportVideo();
wireImportAudio();
refreshPreview();
refreshNodeList();
setPlayheadUI(0);
window.editorReady = true;
window.__doc = doc;      // test hooks
window.__player = player;
window.__undo = undo;
window.__state = state;
