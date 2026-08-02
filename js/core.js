// LittleA Editor — core runtime primitives.
//
// The low-level operations the rest of the editor builds on: the transient
// status line, the live-preview render at the playhead, the playhead readout,
// and the safe id / IR accessors. These touch only the wasm handles and the
// DOM, so every other concern module depends on this one (and never the other
// way around).

import { doc, player, state } from "./state.js";
import { $ } from "./util.js";
import { CELL, UNSIZED_KINDS } from "./constants.js";

// ---- transient status line ------------------------------------------
export function flash(msg, isErr) {
  $("status").textContent = msg;
  $("status").className = (isErr ? "err flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-error" : "flex-1 overflow-hidden text-ellipsis whitespace-nowrap");
}

// ---- rendering: always re-render at the playhead frame --------------
export function curFrame() { return parseInt($("timeline").value, 10) || 0; }

export function refreshPreview() {
  const err = doc.compile_error();
  if (err) {
    $("status").textContent = err;
    $("status").className = "err flex-1 overflow-hidden text-ellipsis whitespace-nowrap";
    return false;
  }
  player.load_lab(doc.lab_bytes());
  applyHiddenNodes();
  for (let f = 0, n = curFrame(); f < n; f++) player.tick(1 / 60);
  player.render();
  try { state.nodeBoxes = player.node_boxes(); } catch { state.nodeBoxes = {}; }
  refreshSelection();
  $("status").textContent = "ok";
  $("status").className = "ok flex-1 overflow-hidden text-ellipsis whitespace-nowrap";
  return true;
}

// The selection overlay: a rectangle around what is selected plus its eight
// resize handles. Built once, then moved — tools.js binds the drag.
function selectionOverlay() {
  let box = $("selbox");
  if (box) return box;
  box = document.createElement("div");
  box.id = "selbox";
  for (const dir of ["nw", "n", "ne", "w", "e", "sw", "s", "se"]) {
    const grip = document.createElement("span");
    grip.className = "selHandle " + dir;
    grip.dataset.dir = dir;
    box.appendChild(grip);
  }
  $("stageWrap").appendChild(box);
  return box;
}

// Frame the selected node with the box it actually DRAWS into, which is why
// this reads the player rather than the node's width/height: those two are
// empty on a plain <mx:Label> and meaningless on a container.
export function refreshSelection() {
  const box = selectionOverlay();
  const id = $("nodeSel").value;
  const b = id ? state.nodeBoxes[id] : null;
  if (!b) { box.style.display = "none"; box.dataset.node = ""; return; }
  const z = state.zoom;
  box.style.display = "block";
  box.style.left = b[0] * z + "px";
  box.style.top = b[1] * z + "px";
  box.style.width = b[2] * z + "px";
  box.style.height = b[3] * z + "px";
  box.dataset.node = id;
  let kind = "";
  try { kind = doc.node_kind(id); } catch { /* broken source */ }
  box.classList.toggle("noResize", UNSIZED_KINDS.has(kind));
}

// Editor authoring aid: nodes toggled hidden in the (recursive) timeline
// carry a `hidden="true"` attribute — invisible to the compiler/IR, since
// unknown node attributes are ignored. load_lab resets every node to
// visible, so re-hide the flagged ones on the live preview through the
// runtime visibility flag; a hidden container takes its whole subtree.
export function applyHiddenNodes() {
  for (const id of doc.node_ids()) {
    if (doc.get_attr(id, "hidden") === "true") {
      const h = player.handle_of(id);
      if (h !== 0xffffffff) player.set_visible(h, false);
    }
  }
}

export function setPlayheadUI(frame) {
  const fps = state.irCache?.fps ?? 60;
  $("frameNo").textContent = frame;
  $("timeLabel").textContent = (frame / fps).toFixed(1) + "s";
  $("playhead").style.left = frame * CELL + "px";
}

// ---- id / IR helpers -------------------------------------------------
export function safeIds() { try { return doc.node_ids(); } catch { return []; } }
export function safeIr() { try { return JSON.parse(doc.ir_json()); } catch { return null; } }
export function freshId(base) {
  const used = new Set(safeIds());
  let n = 1;
  while (used.has(base + n)) n++;
  return base + n;
}
