// LittleA Editor — properties inspector and structural node ops.
//
// Owns the Node dropdown, the geometry + type-specific property fields (each
// edit a CST-preserving doc.set_attr), and the structural operations reachable
// from the props panel and menus: delete, duplicate, z-order reorder, and the
// layer/library insert helpers.

import { doc, state } from "./state.js";
import { $ } from "./util.js";
import { KIND_FIELDS, COMMON_FIELDS, CONTAINER_FIELDS, BOOL_DEFAULT } from "./constants.js";
import { flash, safeIds, refreshPreview, refreshSelection } from "./core.js";
import { recordUndo } from "./history.js";
import { syncAfterDocEdit, rebuildTimeline } from "./timeline.js";
import { wireCollapse } from "./chrome.js";

export function refreshNodeList() {
  const sel = $("nodeSel");
  const prev = sel.value;
  sel.innerHTML = "";
  let ids = [];
  try { ids = doc.node_ids(); } catch { /* broken source: keep empty */ }
  for (const id of ids) {
    const opt = document.createElement("option");
    opt.value = opt.textContent = id;
    sel.appendChild(opt);
  }
  if ([...sel.options].some((o) => o.value === prev)) sel.value = prev;
  refreshProps();
}

// Change which node is selected. The picker, the properties pane and the
// timeline grid all read the selection — the grid marks the picked node's
// keyframe dots as the editable ones — so they move together.
export function selectNode(id) {
  $("nodeSel").value = id ?? "";
  refreshProps();
  refreshSelection();
  rebuildTimeline();
}

// (KIND_FIELDS + BOOL_DEFAULT — the per-kind inspector field spec — are
// imported from ./constants.js)

function safeGetAttr(id, attr) {
  try { return doc.get_attr(id, attr) ?? ""; } catch { return ""; }
}

// One CST-preserving attribute edit + live-preview refresh, shared by every
// inspector field (static and type-specific).
//
// `clearable` fields remove the attribute when emptied instead of writing
// "": the compiler parses an empty numeric attribute as a hard error, and
// absent is how the IR spells "use the default". Text fields keep writing
// their value verbatim, which is what they have always done.
function commitAttr(id, attr, value, clearable = false) {
  recordUndo();
  try {
    if (clearable && value === "") doc.remove_attr(id, attr);
    else doc.set_attr(id, attr, value);
  } catch (e) {
    $("status").textContent = String(e);
    $("status").className = "err flex-1 overflow-hidden text-ellipsis whitespace-nowrap";
    return;
  }
  $("code").value = doc.source(); // reflect the surgical edit
  refreshPreview();
}

// A number the compiler will accept. Refusing here keeps a typo from
// reaching the document at all, where it would compile-error the whole
// scene and blank the preview until it was found and undone.
const VALID = {
  num: (v) => Number.isFinite(Number(v)) && v.trim() !== "",
  int: (v) => /^\d+$/.test(v),
};

function makeField(id, attr, label, type, options) {
  const wrap = document.createElement("label");
  wrap.className = "flex items-center justify-between";
  const labelSpan = document.createElement("span");
  labelSpan.className = "text-text-secondary text-[11px] capitalize";
  labelSpan.textContent = label;
  wrap.appendChild(labelSpan);

  const boxClass = "bg-surface-container border border-border-muted rounded px-1.5 py-0.5 w-32 text-right font-code-md focus:border-primary focus:ring-1 focus:ring-primary outline-none";
  let input;
  if (type === "select") {
    input = document.createElement("select");
    input.className = boxClass;
    const cur = safeGetAttr(id, attr);
    // A legal value the list does not name (`align="centre"`, an SVG
    // spelling) still has to show, or the field would claim the attribute
    // was unset and quietly invite overwriting it.
    const opts = (options || []).includes(cur) ? options : [...(options || []), cur];
    for (const opt of opts) {
      const o = document.createElement("option");
      o.value = opt;
      o.textContent = opt === "" ? "(default)" : opt;
      input.appendChild(o);
    }
    input.value = cur;
    input.addEventListener("change", () => commitAttr(id, attr, input.value, true));
  } else if (type === "bool") {
    input = document.createElement("input");
    input.type = "checkbox";
    input.className = "rounded border-border-muted text-primary focus:ring-primary bg-surface-container";
    const cur = safeGetAttr(id, attr);
    input.checked = cur ? cur === "true" : !!BOOL_DEFAULT[attr];
    input.addEventListener("change", () => commitAttr(id, attr, input.checked ? "true" : "false"));
  } else {
    input = document.createElement("input");
    input.className = boxClass;
    input.value = safeGetAttr(id, attr);
    input.addEventListener("change", () => {
      const v = input.value.trim();
      if (v !== "" && VALID[type] && !VALID[type](v)) {
        flash(`${attr} must be a ${type === "int" ? "whole number" : "number"}`, true);
        input.value = safeGetAttr(id, attr); // put the old value back
        return;
      }
      commitAttr(id, attr, v, type in VALID);
    });
  }
  input.dataset.attr = attr;
  wrap.appendChild(input);
  return wrap;
}

export function refreshProps() {
  const extra = $("propsExtra");
  extra.innerHTML = "";
  const id = $("nodeSel").value;
  if (!id) return;
  for (const [input, attr] of [["propX", "x"], ["propY", "y"], ["propW", "width"], ["propH", "height"]]) {
    $(input).value = safeGetAttr(id, attr);
  }
  // Append the fields specific to this node's kind (a Video's trim/mute, a
  // Button's label, a slider's value/min/max, …). A broken source has no
  // kind — leave just the geometry fields.
  let kind;
  try { kind = doc.node_kind(id); } catch { return; }
  const spec = [...(KIND_FIELDS[kind] || []), ...COMMON_FIELDS];
  // `solo` selects among a node's children, so it is only meaningful — and
  // only offered — on a node that has some.
  let children = [];
  try { children = doc.child_node_ids(id); } catch { /* broken source */ }
  if (children.length) spec.push(...CONTAINER_FIELDS);
  for (const [attr, label, type, options] of spec) {
    extra.appendChild(makeField(id, attr, label, type, options));
  }
}

// ---- clipboard: cut / copy / paste of whole nodes --------------------
//
// The clipboard is the node's SOURCE XML, not its id, so it outlives the
// node — that is what makes cut-then-paste work, and what lets the same
// clipboard be pasted more than once (ids are re-minted per paste).

export function copySelected() {
  const id = $("nodeSel").value;
  if (!id) return flash("select something to copy");
  try { state.nodeClipboard = doc.node_xml(id); }
  catch (e) { return flash(String(e), true); }
  flash(`copied ${id}`);
}

export function cutSelected() {
  const id = $("nodeSel").value;
  if (!id) return flash("select something to cut");
  let xml;
  try { xml = doc.node_xml(id); }
  catch (e) { return flash(String(e), true); }
  recordUndo();
  try { doc.delete_node(id); }
  catch (e) { return flash(String(e), true); }
  // Only adopt the clipboard once the delete succeeded, so a refused cut
  // leaves the previous clipboard intact.
  state.nodeClipboard = xml;
  $("nodeSel").value = "";
  syncAfterDocEdit();
  flash(`cut ${id}`);
}

// Paste onto the ACTIVE layer, which is where every other insert lands.
export function pasteClipboard() {
  if (!state.nodeClipboard) return flash("nothing to paste");
  if (!state.activeLayer) return flash("no active layer to paste onto", true);
  recordUndo();
  let newId;
  try { newId = doc.paste_into_layer(state.activeLayer, state.nodeClipboard); }
  catch (e) { return flash(String(e), true); }
  syncAfterDocEdit();
  if (newId) selectNode(newId);
  flash(newId ? `pasted ${newId}` : "pasted");
}

// ---- structural node ops: delete + z-order reorder ------------------
export function deleteSelected() {
  const id = $("nodeSel").value;
  if (!id) return;
  recordUndo();
  try {
    doc.delete_node(id);
  } catch (e) {
    $("status").textContent = String(e);
    $("status").className = "err flex-1 overflow-hidden text-ellipsis whitespace-nowrap";
    return;
  }
  $("nodeSel").value = "";
  syncAfterDocEdit();
}
// Duplicate the selected node + subtree as a fresh sibling, then select
// the copy (its re-minted id comes back from the document core).
export function duplicateSelected() {
  const id = $("nodeSel").value;
  if (!id) return;
  recordUndo();
  let newId;
  try {
    newId = doc.duplicate_node(id);
  } catch (e) {
    $("status").textContent = String(e);
    $("status").className = "err flex-1 overflow-hidden text-ellipsis whitespace-nowrap";
    return;
  }
  syncAfterDocEdit();
  $("nodeSel").value = newId;
  refreshProps();
}
const reorder = (op) => () => {
  const id = $("nodeSel").value;
  if (!id) return;
  recordUndo();
  try {
    doc[op](id);
  } catch (e) {
    $("status").textContent = String(e);
    $("status").className = "err flex-1 overflow-hidden text-ellipsis whitespace-nowrap";
    return;
  }
  syncAfterDocEdit();
  $("nodeSel").value = id; // keep the moved node selected
  refreshProps();
};

// ---- insert helpers --------------------------------------------------
export function insertItem(name) {
  if (!state.activeLayer) return flash("no active layer to add to", true);
  recordUndo();
  try { doc.insert_library_item(state.activeLayer, name); }
  catch (e) { flash(String(e), true); return; }
  syncAfterDocEdit();
  flash(`inserted ${name}`);
}

// ---- z-order (Modify menu) ------------------------------------------
export function zorder(dir) {
  const id = $("nodeSel").value;
  if (!id) return flash("select a node first");
  recordUndo();
  const step = dir === "front" || dir === "forward" ? "raise_node" : "lower_node";
  try {
    if (dir === "forward" || dir === "backward") {
      doc[step](id);
    } else {
      let prev = safeIds().join(",");
      for (let i = 0; i < 1000; i++) {
        doc[step](id);
        const now = safeIds().join(",");
        if (now === prev) break;
        prev = now;
      }
    }
  } catch (e) { flash(String(e), true); return; }
  syncAfterDocEdit();
  $("nodeSel").value = id;
  refreshProps();
}

// Wire the properties panel: node picker, geometry fields, and the
// delete / duplicate / raise / lower buttons.
export function wireInspector() {
  // ---- properties panel -> code (CST-preserving) --------------------
  $("nodeSel").addEventListener("change", () => selectNode($("nodeSel").value));
  for (const [input, attr] of [["propX", "x"], ["propY", "y"], ["propW", "width"], ["propH", "height"]]) {
    $(input).addEventListener("change", () => {
      const id = $("nodeSel").value;
      if (!id) return;
      recordUndo();
      doc.set_attr(id, attr, $(input).value);
      $("code").value = doc.source(); // reflect the surgical edit
      refreshPreview();
    });
  }

  // The panel header folds the inspector away; the code panel below it grows
  // into the freed height.
  wireCollapse($("propsToggle"), $("props"));

  $("delBtn").addEventListener("click", deleteSelected);
  $("dupBtn").addEventListener("click", duplicateSelected);
  $("raiseBtn").addEventListener("click", reorder("raise_node"));
  $("lowerBtn").addEventListener("click", reorder("lower_node"));
}
