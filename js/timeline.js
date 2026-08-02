// LittleA Editor — the timeline panel, drill-down context, and playback.
//
// Owns the layer/keyframe grid (main + recursive/scoped views), the ruler and
// its on-demand growth, the drill-down breadcrumb navigation, the scrub /
// play transport, and `syncAfterDocEdit` — the one call every structural edit
// funnels through so the code pane, live preview, timeline panel and node list
// all agree again.

import { doc, player, state } from "./state.js";
import { $ } from "./util.js";
import { CELL, MIN_FRAMES, FRAME_CHUNK, GROW_LEAD, SWATCHES, KEYFRAME_PROPS, EASINGS } from "./constants.js";
import { findNodeById, irRootNodes, nodeIsContainer, containerAncestorOf } from "./ir.js";
import { flash, curFrame, refreshPreview, setPlayheadUI } from "./core.js";
import { recordUndo } from "./history.js";
import { refreshProps, refreshNodeList, selectNode } from "./inspector.js";

// Mutable timeline extent (grows on demand, never shrinks); seeded from the
// MIN_FRAMES constant. Every other config/data table lives in ./constants.js.
let timelineFrames = MIN_FRAMES;
let playing = false; // playback loop running

// one call after any document edit: code pane, preview, panel all agree
export function syncAfterDocEdit() {
  $("code").value = doc.source();
  refreshPreview();
  rebuildTimeline();
  refreshNodeList();
}

// The timeline grows on demand, so its length is effectively unbounded.
// rebuildRuler repaints the tick numbers and syncs the widths + slider max.
export function rebuildRuler() {
  const ruler = $("ruler");
  ruler.innerHTML = "";
  const width = timelineFrames * CELL;
  for (const el of [ruler, $("tlScroll"), $("timeline")]) el.style.width = width + "px";
  $("timeline").max = timelineFrames;
  for (let f = 5; f <= timelineFrames; f += 5) {
    const num = document.createElement("span");
    num.className = "rulNum";
    num.style.left = f * CELL - 6 + "px";
    num.textContent = f;
    ruler.appendChild(num);
  }
}

// Extend the timeline in screen-width chunks (never shrinking) so `frame`
// stays in range with a little lead. This is what makes the timeline infinite.
export function ensureFrames(frame) {
  const target = Math.max(MIN_FRAMES,
    Math.ceil((frame + GROW_LEAD) / FRAME_CHUNK) * FRAME_CHUNK);
  if (target <= timelineFrames) return false;
  timelineFrames = target;
  rebuildRuler();
  return true;
}

// Keep the playhead inside the scrollable timeline viewport as it advances.
export function followPlayhead(frame) {
  const view = $("tlRight");
  const x = frame * CELL, pad = CELL * 2;
  if (x < view.scrollLeft + pad) view.scrollLeft = x - pad;
  else if (x > view.scrollLeft + view.clientWidth - pad)
    view.scrollLeft = x - view.clientWidth + pad;
}

// ---- drill-down context: enter an object's own (nested) timeline ----
// (findNodeById / irRootNodes / nodeIsContainer / containerAncestorOf are
// pure IR-tree helpers imported from ./ir.js)
export function contextNode(ir) {
  if (!state.contextStack.length) return null;
  return findNodeById(irRootNodes(ir), state.contextStack[state.contextStack.length - 1]);
}

// double-click behaviour: enter the picked container, or — Flash-style —
// the symbol that contains the picked leaf.
export function enterFromPick(id) {
  if (!state.irCache) return;
  const node = findNodeById(irRootNodes(state.irCache), id);
  if (nodeIsContainer(node)) { enterContext(id); return; }
  const parentId = containerAncestorOf(state.irCache, id);
  if (parentId) enterContext(parentId);
  else flash(`"${id}" is not inside a container`);
}

export function enterContext(id) {
  if (!state.irCache) return;
  const node = findNodeById(irRootNodes(state.irCache), id);
  if (!nodeIsContainer(node)) { flash(`"${id}" has no children to enter`); return; }
  if (state.contextStack[state.contextStack.length - 1] === id) return;
  state.contextStack.push(id);
  $("nodeSel").value = id;
  $("timeline").value = 0;
  setPlayheadUI(0);
  rebuildTimeline();
  refreshProps();
  flash(`entered ${id}`);
}
export function exitToDepth(depth) {          // depth 0 = main timeline (Scene)
  state.contextStack = state.contextStack.slice(0, depth);
  $("timeline").value = 0;
  setPlayheadUI(0);
  rebuildTimeline();
}
export function exitContext() { if (state.contextStack.length) exitToDepth(state.contextStack.length - 1); }

function renderCrumbs() {
  const bar = $("tlCrumbs");
  if (!bar) return;
  bar.innerHTML = "";
  const mk = (label, depth, cur) => {
    const s = document.createElement("span");
    s.className = "crumb hover:text-primary transition-colors cursor-pointer" + (cur ? " cur text-primary font-medium" : "");
    s.textContent = label;
    if (!cur) s.onclick = () => exitToDepth(depth);
    return s;
  };
  bar.appendChild(mk("Scene", 0, state.contextStack.length === 0));
  state.contextStack.forEach((id, i) => {
    const sep = document.createElement("span");
    sep.className = "sep mx-1 text-border-muted"; sep.textContent = "\u25B8";
    bar.appendChild(sep);
    bar.appendChild(mk(id, i + 1, i === state.contextStack.length - 1));
  });
}

// Build a node's show/hide eye dot for the recursive timeline, mirroring
// the layer eye in the main panel. Visibility persists as a `hidden`
// attribute and is applied to the live preview by applyHiddenNodes.
function nodeEyeDot(id) {
  const hidden = doc.get_attr(id, "hidden") === "true";
  const eye = document.createElement("span");
  eye.className = "dot eyeDot material-symbols-outlined text-[14px]" + (hidden ? " off text-error" : "");
  eye.dataset.node = id;
  eye.textContent = hidden ? "visibility_off" : "visibility";
  eye.title = hidden ? "Show" : "Hide";
  eye.onclick = () => {
    recordUndo();
    if (hidden) doc.remove_attr(id, "hidden");
    else doc.set_attr(id, "hidden", "true");
    syncAfterDocEdit();
  };
  return eye;
}

// Build a node's lock dot. A locked node (and its whole subtree) can't be
// picked or dragged on the stage — enforced via nodeLayer in the stage
// mousedown handler. Persists as a `locked` attribute.
function nodeLockDot(id) {
  const locked = doc.get_attr(id, "locked") === "true";
  const lock = document.createElement("span");
  lock.className = "dot lockDot material-symbols-outlined text-[14px]" + (locked ? " on text-error" : "");
  lock.dataset.node = id;
  lock.textContent = locked ? "lock" : "lock_open_right";
  lock.title = locked ? "Unlock" : "Lock";
  lock.onclick = () => {
    recordUndo();
    if (locked) doc.remove_attr(id, "locked");
    else doc.set_attr(id, "locked", "true");
    syncAfterDocEdit();
  };
  return lock;
}

// One keyframe marker on the cell grid.
//
// `owners` is every node id keying that frame on this row. In the MAIN view a
// row is a LAYER, so one dot can stand for several nodes' keys at once; in the
// drill-down view a row is a node and the set has one member. Editing gestures
// act on the node in the picker, so a dot is draggable/deletable only when
// that node is among its owners (`.own`) — every other dot stays a read-only
// marker of somebody else's key, since nothing on the grid could say which of
// several nodes a shared dot would edit.
function keyframeDot(frame, owners) {
  const sel = $("nodeSel").value;
  const mine = owners.has(sel);
  const chosen = mine && state.kfSel?.id === sel && state.kfSel?.frame === frame;
  const dot = document.createElement("span");
  dot.className = "kf text-[10px]" + (mine ? " own" : "") + (chosen ? " sel" : "");
  dot.dataset.frame = frame;
  if (mine) dot.dataset.node = sel;
  dot.style.left = frame * CELL + "px";
  dot.innerHTML = "&#9679;";
  const who = [...owners].join(", ");
  dot.title = mine
    ? `keyframe @ ${frame} on ${sel} \u2014 drag to move, Del to remove`
    : `keyframe @ ${frame}${who ? ` on ${who}` : ""} \u2014 select that node to edit it`;
  return dot;
}

// scoped timeline: rows = the context node itself + its direct children,
// each showing that node's own keyframes; containers are drillable.
function rebuildTimelineScoped(ir) {
  const ctx = contextNode(ir);
  const left = $("layersCol");
  const right = $("cellRows");
  left.innerHTML = right.innerHTML = "";
  if (!ctx) { exitToDepth(0); return; }

  const rows = [{ node: ctx, self: true }];
  for (const child of ctx.children ?? []) rows.push({ node: child, self: false });

  rows.forEach(({ node, self }, i) => {
    const row = document.createElement("div");
    row.className = "layerRow nodeRow";
    const swatch = document.createElement("span");
    swatch.className = "swatch";
    swatch.style.background = SWATCHES[i % SWATCHES.length];
    const name = document.createElement("span");
    const drillable = !self && nodeIsContainer(node);
    name.className = "layerName" + (drillable ? " container font-medium" : "");
    name.textContent = (self ? "\u25C9 " : "") + (node.id ?? "(anon)");
    if (node.timeline && node.timeline.mode === "flat") {
      const b = document.createElement("span");
      b.className = "flatBadge text-[9px] bg-surface-variant px-1 rounded ml-1 text-text-secondary"; b.textContent = "flat";
      name.appendChild(document.createTextNode(" "));
      name.appendChild(b);
    }
    if (node.id) name.onclick = () => { $("nodeSel").value = node.id; refreshProps(); };
    if (drillable) {
      name.title = "Double-click to enter this object's timeline";
      name.ondblclick = () => enterContext(node.id);
    } else if (self) {
      name.title = "This object's own timeline";
    }
    row.append(swatch, name);
    // Per-row visibility / lock toggles, mirroring the main timeline's
    // layer dots. Child rows get both (hide + lock); the self row — the
    // parent clip you've entered — gets a hide toggle only ("hide parent
    // timeline"), since locking it would just lock its own children.
    if (node.id) {
      row.appendChild(nodeEyeDot(node.id));
      if (self) {
        const spacer = document.createElement("span");
        spacer.style.width = "16px";
        row.appendChild(spacer);
      } else {
        row.appendChild(nodeLockDot(node.id));
      }
    }
    left.appendChild(row);

    const cells = document.createElement("div");
    cells.className = "cellRow";
    if (node.id) cells.dataset.node = node.id;
    cells.style.width = timelineFrames * CELL + "px";
    const frames = new Set((node.timeline?.keyframes ?? []).map((k) => k.frame));
    const owners = new Set(node.id ? [node.id] : []);
    for (const f of [...frames].sort((a, b) => a - b)) cells.appendChild(keyframeDot(f, owners));
    right.appendChild(cells);
  });
}

// ---- timeline panel: layer rows + keyframe cells from the IR -------
export function rebuildTimeline() {
  let ir;
  try { ir = JSON.parse(doc.ir_json()); } catch { return; } // keep last good panel
  state.irCache = ir;
  validateKeyframeSelection(ir);
  state.nodeLayer = {};
  const layers = ir.layers ?? [];
  if (!layers.some((l) => l.name === state.activeLayer)) state.activeLayer = layers[0]?.name ?? null;
  $("fpsLabel").textContent = (ir.fps ?? 60).toFixed(1) + " fps";

  const left = $("layersCol");
  const right = $("cellRows");
  left.innerHTML = right.innerHTML = "";

  // grow the panel to fit the furthest keyframe (the extent is unbounded)
  let maxKeyframe = 0;
  const scanKeyframes = (node) => {
    for (const kf of node.timeline?.keyframes ?? [])
      if (kf.frame > maxKeyframe) maxKeyframe = kf.frame;
    for (const child of node.children ?? []) scanKeyframes(child);
  };
  layers.forEach((layer) => (layer.nodes ?? []).forEach(scanKeyframes));
  for (const cue of ir.audio ?? [])
    if ((cue.frame ?? 0) > maxKeyframe) maxKeyframe = cue.frame ?? 0;
  ensureFrames(maxKeyframe);

  // populate nodeLayer for the whole tree so selection/lock checks work in
  // any drill-down context, then render the breadcrumb trail. A node is
  // locked when its layer is locked, it carries locked="true", or any
  // ancestor node does (a locked container locks its whole subtree).
  layers.forEach((layer) => {
    const mark = (node, ancestorLocked) => {
      const locked = ancestorLocked || (!!node.id && doc.get_attr(node.id, "locked") === "true");
      if (node.id) state.nodeLayer[node.id] = { layer: layer.name, locked: !!layer.locked || locked, layerLocked: !!layer.locked };
      for (const child of node.children ?? []) mark(child, locked);
    };
    (layer.nodes ?? []).forEach((n) => mark(n, false));
  });
  renderCrumbs();
  if (state.contextStack.length) { rebuildTimelineScoped(ir); return; }

  layers.forEach((layer, i) => {
    // frame -> the nodes on this layer keying it (nodeLayer is already
    // populated above). A row is a layer, so a frame can have several.
    const owners = new Map();
    const walk = (node) => {
      for (const kf of node.timeline?.keyframes ?? []) {
        if (!owners.has(kf.frame)) owners.set(kf.frame, new Set());
        if (node.id) owners.get(kf.frame).add(node.id);
      }
      for (const child of node.children ?? []) walk(child);
    };
    (layer.nodes ?? []).forEach(walk);

    const row = document.createElement("div");
    row.className = "layerRow hover:bg-surface-container-highest transition-colors" + (layer.name === state.activeLayer ? " active bg-surface-container-high" : "");
    row.dataset.layer = layer.name;
    row.draggable = true;
    row.ondragstart = (ev) => {
      ev.dataTransfer.effectAllowed = "move";
      ev.dataTransfer.setData("text/plain", layer.name);
    };
    row.ondragover = (ev) => { ev.preventDefault(); ev.dataTransfer.dropEffect = "move"; };
    row.ondrop = (ev) => {
      ev.preventDefault();
      const dragged = ev.dataTransfer.getData("text/plain");
      if (dragged && dragged !== layer.name) moveLayerTo(dragged, i);
    };
    row.oncontextmenu = (ev) => openTimelineMenu(ev, layerMenuItems(layer.name));
    const swatch = document.createElement("span");
    swatch.className = "swatch";
    swatch.style.background = SWATCHES[i % SWATCHES.length];
    const name = document.createElement("span");
    name.className = "layerName";
    name.textContent = layer.name;
    name.title = "Click to make this the active layer (drawing tools target it)";
    name.onclick = () => { state.activeLayer = layer.name; rebuildTimeline(); };
    const eye = document.createElement("span");
    eye.className = "dot eyeDot material-symbols-outlined text-[14px]" + (layer.hidden ? " off text-error" : "");
    eye.dataset.layer = layer.name;
    eye.textContent = layer.hidden ? "visibility_off" : "visibility";
    eye.title = layer.hidden ? "Show layer" : "Hide layer";
    eye.onclick = () => {
      recordUndo();
      if (layer.hidden) doc.remove_layer_attr(layer.name, "hidden");
      else doc.set_layer_attr(layer.name, "hidden", "true");
      syncAfterDocEdit();
    };
    const lock = document.createElement("span");
    lock.className = "dot lockDot material-symbols-outlined text-[14px]" + (layer.locked ? " on text-error" : "");
    lock.dataset.layer = layer.name;
    lock.textContent = layer.locked ? "lock" : "lock_open_right";
    lock.title = layer.locked ? "Unlock layer" : "Lock layer";
    lock.onclick = () => {
      recordUndo();
      if (layer.locked) doc.remove_layer_attr(layer.name, "locked");
      else doc.set_layer_attr(layer.name, "locked", "true");
      syncAfterDocEdit();
    };
    row.append(swatch, name, eye, lock);
    left.appendChild(row);

    const cells = document.createElement("div");
    cells.className = "cellRow";
    cells.dataset.layer = layer.name;
    cells.style.width = timelineFrames * CELL + "px";
    for (const f of [...owners.keys()].sort((a, b) => a - b))
      cells.appendChild(keyframeDot(f, owners.get(f)));
    right.appendChild(cells);
  });

  renderAudioTrack(ir);
}

// Audio track: one lane per declared <mx:Sound>, each showing its scene-level
// <mx:Cue>s on the same frame grid as the keyframe dots. Audio is scene-level,
// so this is the main timeline only (never a drilled clip). When the clip's WAV
// was imported this session, the browser-decoded peak summary
// (state.audioPeaks[src]) draws a real waveform spanning the clip's duration;
// otherwise (a loaded scene with only a src reference) the cue shows as a
// schematic marker. Editor-only visualization — the IR/schedule is unaffected.
function renderAudioTrack(ir) {
  const sounds = ir.sounds ?? [];
  if (!sounds.length) return;
  const cues = ir.audio ?? [];
  const fps = ir.fps ?? 60;
  const left = $("layersCol");
  const right = $("cellRows");
  const accent = getComputedStyle(document.documentElement).getPropertyValue("--color-primary").trim() || "#4A78C3";
  for (const snd of sounds) {
    const row = document.createElement("div");
    row.className = "layerRow audioRow";
    row.dataset.sound = snd.id;
    const icon = document.createElement("span");
    icon.className = "material-symbols-outlined text-[13px] text-primary";
    icon.style.marginRight = "6px";
    icon.textContent = "graphic_eq";
    const name = document.createElement("span");
    name.className = "layerName";
    name.textContent = snd.id;
    name.title = `audio clip "${snd.id}" \u2014 ${snd.src}`;
    row.append(icon, name);
    left.appendChild(row);

    const cells = document.createElement("div");
    cells.className = "cellRow";
    cells.dataset.sound = snd.id;
    cells.style.width = timelineFrames * CELL + "px";
    const wave = state.audioPeaks[snd.src];
    for (const cue of cues.filter((c) => c.sound === snd.id)) {
      const frame = cue.frame ?? 0;
      const kind = cue.kind ?? "sfx";
      const tip = `cue: ${snd.id} @ ${frame} \u00B7 ${kind}${cue.looping ? " \u00B7 loop" : ""}`;
      if (wave) {
        const w = Math.max(CELL, Math.round(wave.duration * fps * CELL));
        const canvas = document.createElement("canvas");
        canvas.className = "waveform";
        canvas.width = w;
        canvas.height = 20;
        canvas.style.left = frame * CELL + "px";
        canvas.style.width = w + "px";
        canvas.dataset.frame = frame;
        canvas.title = tip;
        drawWaveform(canvas, wave.peaks, accent);
        cells.appendChild(canvas);
      } else {
        const m = document.createElement("span");
        m.className = "cue" + (kind === "bgm" ? " bgm" : "") + (cue.looping ? " loop" : "");
        m.dataset.frame = frame;
        m.style.left = frame * CELL + "px";
        m.title = tip;
        cells.appendChild(m);
      }
    }
    right.appendChild(cells);
  }
}

// Draw a normalized (0..1) peak summary as centered vertical bars into a
// waveform canvas, in `accent` — the imported clip's shape on the cue lane.
function drawWaveform(canvas, peaks, accent) {
  const g = canvas.getContext("2d");
  if (!g || !peaks.length) return;
  const w = canvas.width, h = canvas.height, mid = h / 2;
  g.fillStyle = accent;
  const bw = w / peaks.length;
  for (let i = 0; i < peaks.length; i++) {
    const bh = Math.max(1, peaks[i] * (h - 2));
    g.fillRect(i * bw, mid - bh / 2, Math.max(1, bw - 0.5), bh);
  }
}

// "insert keyframe at playhead": capture the selected node's current pose as
// a keyframe at the scrubbed frame (structural CST insert).
//
// The pose is every animatable property the node actually carries, not just
// x/y — so draw order, trim and feather can be animated from the UI once the
// inspector has set them. `rotation`, `scaleX`, `scaleY` and `alpha` are NOT
// captured: they exist only on `<mx:Keyframe>`, so a node has no value of
// them to read. A property the node does not carry is left out rather than
// keyed at a guessed default, because writing e.g. feather="0" onto the first
// keyframe would pin a value the author never set.
export function insertKeyframe() {
  const id = $("nodeSel").value;
  if (!id) return flash("select a node first");
  // x/y come from the geometry inputs (which mirror the node and are what the
  // stage drag writes), and are always keyed: a keyframe with no property at
  // all would animate nothing.
  const props = { x: $("propX").value || "0", y: $("propY").value || "0" };
  for (const p of KEYFRAME_PROPS) {
    if (p === "x" || p === "y") continue;
    let v = "";
    try { v = doc.get_attr(id, p) ?? ""; } catch { /* broken source */ }
    if (v !== "") props[p] = v;
  }
  const ease = $("keyEase")?.value;
  if (ease) props.ease = ease;
  recordUndo();
  try { doc.add_keyframe_props(id, curFrame(), JSON.stringify(props)); }
  catch (e) { flash(String(e), true); return; }
  state.kfSel = { id, frame: curFrame() };
  syncAfterDocEdit();
}

// ---- keyframe editing: select, drag, delete, copy/paste --------------
//
// Every gesture below addresses a keyframe as (node id, frame) — the same pair
// the Rust CST ops take — and funnels through recordUndo + syncAfterDocEdit,
// so the code pane, preview and panel never disagree about what was edited.

// Make (id, frame) the keyframe the Delete/Copy commands act on, and park the
// playhead there so "insert" and "paste" land where the eye is.
function selectKeyframe(id, frame) {
  state.kfSel = { id, frame };
  gotoFrame(frame);
  selectNode(id);
}

// The frame under a pointer event, measured against the row's own box (the
// grid scrolls horizontally, so offsetX/pageX would both be wrong). A cell
// spans [frame*CELL, (frame+1)*CELL), so anywhere inside cell N reads as N —
// rounding instead would send the right half of every cell to N+1.
function frameAt(ev, row) {
  return Math.max(0, Math.floor((ev.clientX - row.getBoundingClientRect().left) / CELL));
}

// A keyframe selection is a pair of coordinates INTO THE DOCUMENT, so any
// edit can invalidate it — an undo, a code-pane rewrite, or deleting the node
// out from under it. Dropping it the moment it stops pointing at a real key
// is what lets the Delete key fall back to deleting the node.
function validateKeyframeSelection(ir) {
  const sel = state.kfSel;
  if (!sel) return;
  const node = findNodeById(irRootNodes(ir), sel.id);
  const keyed = (node?.timeline?.keyframes ?? []).some((k) => k.frame === sel.frame);
  if (!keyed) state.kfSel = null;
}

export function deleteKeyframe() {
  const sel = state.kfSel;
  if (!sel) return false;
  recordUndo();
  try { doc.remove_keyframe(sel.id, sel.frame); }
  catch (e) {
    // The selection was stale after all: drop it and report the key press as
    // unhandled, so Delete still reaches the node.
    state.kfSel = null;
    flash(String(e), true);
    return false;
  }
  state.kfSel = null;
  syncAfterDocEdit();
  flash(`deleted ${sel.id} keyframe @ ${sel.frame}`);
  return true;
}

export function copyKeyframe() {
  const sel = state.kfSel;
  if (!sel) return flash("select a keyframe first");
  try { state.kfClipboard = doc.keyframe_attrs(sel.id, sel.frame); }
  catch (e) { return flash(String(e), true); }
  flash(`copied ${sel.id} keyframe @ ${sel.frame}`);
}

// Paste onto the SELECTED node at the playhead — not back onto the node it was
// copied from, so copying a pose between nodes is the same two keystrokes as
// repeating one. Landing on a frame the node already keys merges (the Rust
// add_keyframe rule), which is what re-pasting a corrected pose should do.
export function pasteKeyframe() {
  if (!state.kfClipboard) return flash("no keyframe copied");
  const id = $("nodeSel").value;
  if (!id) return flash("select a node first");
  const frame = curFrame();
  recordUndo();
  try { doc.add_keyframe_props(id, frame, state.kfClipboard); }
  catch (e) { flash(String(e), true); return; }
  state.kfSel = { id, frame };
  syncAfterDocEdit();
  flash(`pasted keyframe @ ${frame}`);
}

function moveKeyframe(id, from, to) {
  ensureFrames(to);
  recordUndo();
  try { doc.move_keyframe(id, from, to); }
  catch (e) { flash(String(e), true); rebuildTimeline(); return; }
  state.kfSel = { id, frame: to };
  syncAfterDocEdit();
  flash(`moved ${id} keyframe ${from} \u2192 ${to}`);
}

// Drag an owned dot to another frame. The dot itself is the drag preview (it
// is absolutely positioned, so moving `left` is the whole animation); the
// document is only touched on release, and a drag that ends where it started
// is a plain click.
function beginKeyframeDrag(ev, dot, row) {
  const id = dot.dataset.node;
  const from = Number(dot.dataset.frame);
  let to = from;
  dot.setPointerCapture(ev.pointerId);
  dot.classList.add("ghost");
  const move = (e) => {
    to = frameAt(e, row);
    dot.style.left = to * CELL + "px";
  };
  const done = () => {
    dot.removeEventListener("pointermove", move);
    dot.removeEventListener("pointerup", done);
    dot.removeEventListener("pointercancel", done);
    dot.classList.remove("ghost");
    if (to === from) { selectKeyframe(id, from); return; }
    moveKeyframe(id, from, to);
  };
  dot.addEventListener("pointermove", move);
  dot.addEventListener("pointerup", done);
  dot.addEventListener("pointercancel", done);
  ev.preventDefault();
}

// One pointerdown handler for the whole grid: start a keyframe drag, or scrub
// to the clicked frame and adopt that row (its layer in the main view, its
// node in the drill-down view) the way clicking the row's name does.
function onGridPointerDown(ev) {
  if (ev.button !== 0) return;
  const row = ev.target.closest(".cellRow");
  if (!row) return;
  const dot = ev.target.closest(".kf.own");
  if (dot) { beginKeyframeDrag(ev, dot, row); return; }
  state.kfSel = null;
  if (row.dataset.layer && row.dataset.layer !== state.activeLayer) {
    state.activeLayer = row.dataset.layer;
  } else if (row.dataset.node && row.dataset.node !== $("nodeSel").value) {
    $("nodeSel").value = row.dataset.node;
    refreshProps();
  }
  gotoFrame(frameAt(ev, row));
  rebuildTimeline();
}

// ---- layer editing: add, rename, delete, reorder ---------------------
//
// Layers are the timeline's rows, so the panel owns these. They are addressed
// by `name=`, which is why insert refuses a duplicate and rename is just a
// CST attribute write.

function layerNames() { return (state.irCache?.layers ?? []).map((l) => l.name); }

// Add an empty layer after `after` (the row you asked from), or as the
// scene's last layer. Also used by the Insert menu, which passes nothing.
export function insertLayer(after) {
  const used = new Set(layerNames());
  let n = 1;
  while (used.has("layer" + n)) n++;
  const name = "layer" + n;
  recordUndo();
  try { doc.insert_layer(name, typeof after === "string" ? after : null); }
  catch (e) { flash(String(e), true); return; }
  state.activeLayer = name;
  syncAfterDocEdit();
  flash(`added ${name}`);
}

export function renameLayer(name) {
  const next = (window.prompt(`Rename layer "${name}" to:`, name) ?? "").trim();
  if (!next || next === name) return;
  if (layerNames().includes(next)) return flash(`a layer named "${next}" already exists`, true);
  recordUndo();
  try { doc.set_layer_attr(name, "name", next); }
  catch (e) { flash(String(e), true); return; }
  // The active layer is tracked by name, so it has to follow the rename or
  // the drawing tools would target a layer that no longer exists.
  if (state.activeLayer === name) state.activeLayer = next;
  syncAfterDocEdit();
  flash(`renamed ${name} \u2192 ${next}`);
}

export function deleteLayer(name) {
  const layer = (state.irCache?.layers ?? []).find((l) => l.name === name);
  if (!layer) return flash(`no layer named "${name}"`, true);
  if (layerNames().length < 2) return flash("a scene needs at least one layer", true);
  const count = (layer.nodes ?? []).length;
  if (count && !window.confirm(`Delete layer "${name}" and the ${count} object(s) on it?`)) return;
  recordUndo();
  try { doc.delete_layer(name); }
  catch (e) { flash(String(e), true); return; }
  if (state.activeLayer === name) state.activeLayer = null; // rebuild re-seeds it
  syncAfterDocEdit();
  flash(`deleted layer ${name}`);
}

// Move a layer to another position in the row list. The Rust ops are single
// steps, so a multi-row drag is that many swaps — layer counts are small and
// each step is a CST-preserving sibling swap.
function moveLayerTo(name, to) {
  const names = layerNames();
  const from = names.indexOf(name);
  if (from < 0 || to < 0 || to >= names.length || to === from) return;
  recordUndo();
  const step = to > from ? "raise_layer" : "lower_layer";
  try { for (let i = 0; i < Math.abs(to - from); i++) doc[step](name); }
  catch (e) { flash(String(e), true); return; }
  syncAfterDocEdit();
  flash(`moved ${name}`);
}

// Rows list layers in DOCUMENT order, so a later row is painted later — in
// front. The menu names the paint effect rather than the direction, because
// "up"/"down" mean the opposite in a panel ordered the other way round.
function layerMenuItems(name) {
  const names = layerNames();
  const i = names.indexOf(name);
  return [
    { label: "Add Layer", run: () => insertLayer(name) },
    { label: "Rename Layer\u2026", run: () => renameLayer(name) },
    { label: "Delete Layer", disabled: names.length < 2, run: () => deleteLayer(name) },
    { sep: true },
    { label: "Bring Forward", disabled: i >= names.length - 1, run: () => moveLayerTo(name, i + 1) },
    { label: "Send Backward", disabled: i <= 0, run: () => moveLayerTo(name, i - 1) },
  ];
}

function gridMenuItems(ev, row) {
  const frame = frameAt(ev, row);
  const dot = ev.target.closest(".kf.own");
  const here = dot ? { id: dot.dataset.node, frame: Number(dot.dataset.frame) } : null;
  return [
    { label: "Insert Keyframe", run: () => { gotoFrame(frame); insertKeyframe(); } },
    {
      label: "Delete Keyframe",
      disabled: !here,
      run: () => { state.kfSel = here; deleteKeyframe(); },
    },
    { sep: true },
    {
      label: "Copy Keyframe",
      disabled: !here,
      run: () => { state.kfSel = here; copyKeyframe(); },
    },
    {
      label: "Paste Keyframe",
      disabled: !state.kfClipboard,
      run: () => { gotoFrame(frame); pasteKeyframe(); },
    },
  ];
}

// ---- transient context menu -----------------------------------------
// Appended to <body> (the timeline panel clips its overflow) and torn down on
// the next pointerdown outside it, scroll, or Escape. Single-instance by
// construction: opening one closes the last.
let menuDismiss = null;

export function closeTimelineMenu() {
  if (menuDismiss) {
    window.removeEventListener("pointerdown", menuDismiss, true);
    window.removeEventListener("wheel", menuDismiss, true);
    menuDismiss = null;
  }
  $("tlMenu")?.remove();
}

function openTimelineMenu(ev, items) {
  closeTimelineMenu();
  const menu = document.createElement("div");
  menu.id = "tlMenu";
  menu.className =
    "fixed z-[300] min-w-44 py-1 bg-surface-container border border-border-strong rounded shadow-xl text-[12px] text-on-surface";
  for (const item of items) {
    if (item.sep) {
      const hr = document.createElement("div");
      hr.className = "my-1 h-px bg-border-muted";
      menu.appendChild(hr);
      continue;
    }
    const el = document.createElement("div");
    el.className = "px-3 py-1 " + (item.disabled
      ? "opacity-40"
      : "cursor-pointer hover:bg-surface-container-highest hover:text-primary transition-colors");
    el.textContent = item.label;
    if (!item.disabled) el.onclick = () => { closeTimelineMenu(); item.run(); };
    menu.appendChild(el);
  }
  document.body.appendChild(menu);
  // Placed after mounting so the measured size can keep it on screen.
  const box = menu.getBoundingClientRect();
  menu.style.left = Math.min(ev.clientX, window.innerWidth - box.width - 4) + "px";
  menu.style.top = Math.min(ev.clientY, window.innerHeight - box.height - 4) + "px";
  // A pointerdown INSIDE the menu must be left alone: detaching the item
  // before its click fires would close the menu and run nothing.
  const dismiss = (e) => { if (!menu.contains(e.target)) closeTimelineMenu(); };
  menuDismiss = dismiss;
  setTimeout(() => {
    if (menuDismiss !== dismiss) return; // a newer menu already took over
    window.addEventListener("pointerdown", dismiss, true);
    window.addEventListener("wheel", dismiss, true);
  }, 0);
  ev.preventDefault();
}

// playback loop (per-sprite timelines advance on tick)
export function togglePlay() {
  playing = !playing;
  $("playBtn").innerHTML = playing ? '<span class="material-symbols-outlined text-[16px]">pause</span>' : '<span class="material-symbols-outlined text-[16px]">play_arrow</span>';
  let frame = curFrame();
  const step = () => {
    if (!playing) return;
    player.tick(1 / 60);
    player.render();
    frame += 1;              // no upper bound -> the timeline runs indefinitely
    ensureFrames(frame);
    $("timeline").value = frame;
    setPlayheadUI(frame);
    followPlayhead(frame);
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ---- playhead helpers (Control menu) --------------------------------
export function gotoFrame(f) {
  f = Math.max(0, f | 0);
  ensureFrames(f);
  $("timeline").value = f;
  setPlayheadUI(f);
  followPlayhead(f);
  refreshPreview();
}
export function stepFrame(d) { gotoFrame(curFrame() + d); }

// Attach the timeline transport listeners and paint the initial ruler.
export function wireTimeline() {
  // The ease presets come from one list shared with la-tween's table, so a
  // preset the runtime knows is always offered and one it does not is
  // unspellable from the dropdown.
  const easeSel = $("keyEase");
  if (easeSel) {
    for (const name of EASINGS) {
      const o = document.createElement("option");
      o.value = name;
      o.textContent = name === "" ? "ease" : name;
      easeSel.appendChild(o);
    }
  }
  // ---- timeline: ruler, scrub, keyframes, playback -----------------
  rebuildRuler();

  // The cell grid is delegated (its rows are rebuilt on every edit): click to
  // scrub or to grab a keyframe, right-click for the keyframe menu.
  $("cellRows").addEventListener("pointerdown", onGridPointerDown);
  $("cellRows").addEventListener("contextmenu", (ev) => {
    const row = ev.target.closest(".cellRow");
    if (row) openTimelineMenu(ev, gridMenuItems(ev, row));
  });
  // The ruler scrubs on click too: the hidden range input that overlays it
  // only reaches its top 10px.
  $("ruler").addEventListener("pointerdown", (ev) => {
    if (ev.button === 0) gotoFrame(frameAt(ev, $("ruler")));
  });

  // scrubbing: deterministic reload + fixed-dt ticks to the playhead
  $("timeline").addEventListener("input", () => {
    const frame = curFrame();
    ensureFrames(frame);
    setPlayheadUI(frame);
    followPlayhead(frame);
    refreshPreview();
    // when editing inside a nested context, drive that clip's own playhead so
    // it scrubs correctly even if a stopped ancestor would otherwise gate it.
    if (state.contextStack.length) {
      const id = state.contextStack[state.contextStack.length - 1];
      try { if (player.seek_clip(id, frame)) player.render(); } catch { /* clip may have no timeline */ }
    }
  });

  $("keyBtn").addEventListener("click", insertKeyframe);
  $("playBtn").addEventListener("click", togglePlay);
}
