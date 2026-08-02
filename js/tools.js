// LittleA Editor — tool palette, stage gestures, vector authoring.
//
// Owns the active tool and its cursor, the colour well (fill/stroke), the
// stage zoom, and every pointer gesture on the stage: select/move, marquee
// rectangle, free-transform resize, hand-pan, and the vector tools (line /
// oval / pen / pencil / brush author real <mx:Path> geometry; lasso selects).
// The Text tool drops an <mx:Label> via placeLabel.

import { doc, player, state } from "./state.js";
import { $, normHex, ellipseD, stageXY } from "./util.js";
import { CURSORS, TOOL_TITLES, TOOL_LABELS, TOOL_KEYS, SNAP_GRID } from "./constants.js";
import { flash, freshId, refreshPreview, refreshSelection } from "./core.js";
import { recordUndo } from "./history.js";
import { syncAfterDocEdit, enterFromPick } from "./timeline.js";
import { refreshProps, selectNode } from "./inspector.js";

// ---- tool + authoring state (single-module: owned here) --------------
let tool = "select";          // active palette tool
let fillColor = "#0099FF";    // fill for new shapes + the paint bucket
let strokeColor = "#000000";  // stroke swatch (no stroke primitive yet)
let snapGrid = false;         // Options tray: snap moves / new shapes to a grid
const snap = (v) => (snapGrid ? Math.round(v / SNAP_GRID) * SNAP_GRID : v);
const toolButtons = {};       // tool name -> palette button
let fillChip = null;          // fill colour chip element (assigned in wireTools)
let strokeChip = null;        // stroke colour chip element (assigned in wireTools)

// gesture state (set in the stage mousedown, cleared on mouseup)
let drag = null;      // move gesture
let rectDraw = null;  // rectangle marquee
let shapeDraw = null; // line / oval bounding-box gesture
let freeDraw = null;  // freehand pen / pencil / brush / lasso trail
let resize = null;    // free-transform gesture
let pan = null;       // hand-tool pan

// ---- tool palette ----------------------------------------------------
// (TOOL_TITLES / CURSORS are imported from ./constants.js)
export function setTool(name) {
  tool = name;
  for (const [n, b] of Object.entries(toolButtons)) b.classList.toggle("active", n === name);
  // Show the tool's cursor across the whole stage work area (Flash-style),
  // not just the small canvas rect. Setting it on the pasteboard cascades to
  // #stageWrap and #stage, so the cursor is right everywhere you draw/click.
  const cur = CURSORS[name] ?? "default";
  $("stage").style.cursor = cur;
  $("pasteboard").style.cursor = cur;
  renderToolOptions();
}

// Pin a cursor to the whole document while a stage gesture is in flight (see
// the .gesture-active CSS). Defaults to the active tool's cursor so the same
// cursor shown on tool selection carries through the drag/draw, even when the
// pointer leaves the canvas (mousemove/up are bound to window).
function beginGesture(cursor) {
  document.documentElement.style.setProperty("--gesture-cursor", cursor ?? CURSORS[tool] ?? "default");
  document.documentElement.classList.add("gesture-active");
}
function endGesture() {
  document.documentElement.classList.remove("gesture-active");
}

// ---- context-sensitive Options tray (Flash's tool-options tray) ------
// (TOOL_LABELS — the per-tool display name — is imported from ./constants.js)
function renderToolOptions() {
  const box = $("toolOptions");
  box.innerHTML = "";
  const label = document.createElement("div");
  label.className = "optName uppercase tracking-widest font-panel-header";
  label.textContent = TOOL_LABELS[tool] ?? tool;
  box.appendChild(label);
  if (["select", "subselect", "rect", "transform"].includes(tool)) {
    const b = document.createElement("button");
    b.className = "mt-2 bg-surface-container hover:bg-surface-container-high border border-border-muted rounded px-2 py-1 transition-colors w-full" + (snapGrid ? " text-primary border-primary" : "");
    b.textContent = "Snap";
    b.title = `Snap moves, resizes and new shapes to a ${SNAP_GRID}px grid`;
    b.addEventListener("click", () => {
      snapGrid = !snapGrid;
      renderToolOptions();
      flash(`grid snap ${snapGrid ? "on" : "off"} (${SNAP_GRID}px)`);
    });
    box.appendChild(b);
  } else if (tool === "zoom") {
    const b = document.createElement("button");
    b.className = "mt-2 bg-surface-container hover:bg-surface-container-high border border-border-muted rounded px-2 py-1 transition-colors w-full";
    b.textContent = "Fit";
    b.title = "Zoom the stage to fit the view";
    b.addEventListener("click", zoomFit);
    box.appendChild(b);
  }
}

// ---- selection / subselection: click-to-select, drag-to-move ---------
// ---- rectangle & text: drop a new node on the active layer -----------
// ---- bucket / eyedropper / eraser / hand / zoom / free-transform -----
function onStageMouseDown(ev) {
  const { x, y } = stageXY(ev);
  if (tool === "rect") { rectDraw = { x0: x, y0: y, x1: x, y1: y }; beginGesture(); return; }
  if (tool === "line" || tool === "oval") { shapeDraw = { tool, x0: x, y0: y, x1: x, y1: y }; beginGesture(); return; }
  if (tool === "pen" || tool === "pencil" || tool === "brush" || tool === "lasso") {
    freeDraw = { tool, pts: [[x, y]] };
    beginGesture();
    return;
  }
  if (tool === "text") { placeLabel(x, y); return; }
  if (tool === "hand") {
    const pb = $("pasteboard");
    pan = { sx: ev.clientX, sy: ev.clientY, l: pb.scrollLeft, t: pb.scrollTop };
    beginGesture("grabbing");
    return;
  }
  if (tool === "zoom") { zoomBy(ev.altKey || ev.shiftKey ? 0.8 : 1.25); return; }

  const id = player.pick_id(x, y) || boxPick(x, y);
  if (!id) return;
  const home = state.nodeLayer[id];
  if (home?.locked) {
    flash(home.layerLocked ? `layer "${home.layer}" is locked` : `"${id}" is locked`);
    return;
  }
  selectNode(id);

  if (tool === "eraser") {
    recordUndo();
    try { doc.delete_node(id); } catch (e) { flash(String(e), true); return; }
    $("nodeSel").value = "";
    syncAfterDocEdit();
    return;
  }
  if (tool === "bucket") {
    recordUndo();
    try { doc.set_attr(id, "fill", fillColor); } catch (e) { flash(String(e), true); return; }
    $("code").value = doc.source();
    refreshPreview();
    refreshProps();
    flash(`filled ${id} with ${fillColor}`);
    return;
  }
  if (tool === "eyedropper") {
    const c = doc.get_attr(id, "fill");
    if (c) { setFill(c); flash(`picked ${c} from ${id}`); }
    else flash(`${id} has no fill to pick`);
    return;
  }
  if (tool === "transform") {
    if (doc.get_attr(id, "width") == null || doc.get_attr(id, "height") == null) {
      flash(`${id} has no width/height to transform`);
      return;
    }
    resize = beginResize(id, "se");
    beginGesture();
    return;
  }
  // select / subselect: begin a move
  const nx = parseFloat(doc.get_attr(id, "x") ?? "0");
  const ny = parseFloat(doc.get_attr(id, "y") ?? "0");
  drag = { id, dx: x - nx, dy: y - ny, recorded: false };
  beginGesture();
}

function onWindowMouseMove(ev) {
  if (pan) {
    const pb = $("pasteboard");
    pb.scrollLeft = pan.l - (ev.clientX - pan.sx);
    pb.scrollTop = pan.t - (ev.clientY - pan.sy);
    return;
  }
  if (rectDraw) {
    const { x, y } = stageXY(ev);
    rectDraw.x1 = x; rectDraw.y1 = y;
    const m = $("marquee");
    m.style.display = "block";
    m.style.left = Math.min(rectDraw.x0, x) * state.zoom + "px";
    m.style.top = Math.min(rectDraw.y0, y) * state.zoom + "px";
    m.style.width = Math.abs(x - rectDraw.x0) * state.zoom + "px";
    m.style.height = Math.abs(y - rectDraw.y0) * state.zoom + "px";
    return;
  }
  if (shapeDraw) {
    const { x, y } = stageXY(ev);
    shapeDraw.x1 = x; shapeDraw.y1 = y;
    const g = shapeGeometry(shapeDraw);
    if (g) showPreview(g, toolPaint(shapeDraw.tool));
    else hidePreview();
    return;
  }
  if (freeDraw) {
    const { x, y } = stageXY(ev);
    const last = freeDraw.pts[freeDraw.pts.length - 1];
    if (Math.hypot(x - last[0], y - last[1]) >= 2) freeDraw.pts.push([x, y]);
    // The lasso closes back to where it started, because that is the loop it
    // will test against, not the trail drawn so far.
    const g = freehandGeometry(freeDraw.pts);
    if (g) showPreview(freeDraw.tool === "lasso" ? { ...g, d: g.d + " Z" } : g, toolPaint(freeDraw.tool));
    else hidePreview();
    return;
  }
  if (resize) {
    const { x, y } = stageXY(ev);
    if (!resize.recorded) { recordUndo(); resize.recorded = true; }
    applyResize(resize, x, y);
    $("code").value = doc.source();
    refreshProps();
    refreshPreview();
    return;
  }
  if (!drag) return;
  const { x, y } = stageXY(ev);
  if (!drag.recorded) { recordUndo(); drag.recorded = true; }
  doc.set_attr(drag.id, "x", String(snap(Math.round(x - drag.dx))));
  doc.set_attr(drag.id, "y", String(snap(Math.round(y - drag.dy))));
  $("code").value = doc.source();
  refreshProps();
  refreshPreview();
}

function onWindowMouseUp() {
  endGesture();
  if (pan) { pan = null; return; }
  if (resize) { resize = null; return; }
  if (rectDraw) {
    $("marquee").style.display = "none";
    const x = snap(Math.round(Math.min(rectDraw.x0, rectDraw.x1)));
    const y = snap(Math.round(Math.min(rectDraw.y0, rectDraw.y1)));
    const w = snap(Math.round(Math.abs(rectDraw.x1 - rectDraw.x0)));
    const h = snap(Math.round(Math.abs(rectDraw.y1 - rectDraw.y0)));
    rectDraw = null;
    if (w >= 2 && h >= 2 && state.activeLayer) {
      recordUndo();
      const id = freshId("rect");
      try {
        doc.insert_child_in_layer(state.activeLayer,
          `<mx:Rect id="${id}" x="${x}" y="${y}" width="${w}" height="${h}" fill="${fillColor}"/>`);
      } catch (e) { flash(String(e), true); return; }
      syncAfterDocEdit();
      $("nodeSel").value = id;
      refreshProps();
    } else if (!state.activeLayer) {
      flash("no active layer to draw on", true);
    }
    return;
  }
  if (shapeDraw) {
    hidePreview();
    const s = shapeDraw; shapeDraw = null;
    authorShape(s);
    return;
  }
  if (freeDraw) {
    hidePreview();
    const fd = freeDraw; freeDraw = null;
    if (fd.tool === "lasso") lassoSelect(fd.pts);
    else authorFreehand(fd);
    return;
  }
  drag = null;
}

// ---- in-place text editing -------------------------------------------
//
// Double-clicking a <mx:Label> opens a real <textarea> over it, so the caret,
// the selection and cut/copy/paste inside the text are the browser's — the
// editor's own Ctrl+X/C/V stand aside while a text field has focus.

let textEdit = null;

// True when `id` is a text node and the editor took it, so the caller can
// fall through to the drill-down gesture for everything else.
function beginTextEdit(id) {
  let kind = "";
  try { kind = doc.node_kind(id); } catch { return false; }
  if (kind !== "Label") return false;
  const b = state.nodeBoxes[id];
  if (!b) return false;
  finishTextEdit(true);

  const z = state.zoom;
  // The renderer draws a label at its `height`, defaulting to 16, so the
  // overlay matches what is on the canvas rather than the panel's font.
  const size = Math.max(1, parseFloat(doc.get_attr(id, "height") ?? "") || 16);
  const box = document.createElement("textarea");
  box.id = "textEdit";
  box.spellcheck = false;
  box.value = doc.get_attr(id, "text") ?? "";
  box.style.left = b[0] * z + "px";
  box.style.top = b[1] * z + "px";
  box.style.width = Math.max(48, b[2] * z + 10) + "px";
  box.style.height = Math.max(size * z + 6, b[3] * z + 6) + "px";
  box.style.fontSize = size * z + "px";
  box.style.color = doc.get_attr(id, "color") || "#FFFFFF";
  $("stageWrap").appendChild(box);
  textEdit = { id, before: box.value };
  box.focus();
  box.select();

  box.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") { ev.preventDefault(); finishTextEdit(false); }
    // Enter commits; Shift+Enter is how a multi-line label gets its newline.
    else if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); finishTextEdit(true); }
  });
  box.addEventListener("blur", () => finishTextEdit(true));
  return true;
}

function finishTextEdit(commit) {
  const box = $("textEdit");
  if (!textEdit || !box) return;
  const { id, before } = textEdit;
  const value = box.value;
  // Cleared first: removing the box fires `blur`, which re-enters here.
  textEdit = null;
  box.remove();
  if (!commit || value === before) return;
  recordUndo();
  try { doc.set_attr(id, "text", value); }
  catch (e) { flash(String(e), true); return; }
  syncAfterDocEdit();
  flash(`edited ${id}`);
}

// ---- selection frame: resize from any of the eight handles -----------
//
// The gesture starts from the node's AUTHORED box where it has one and from
// its DRAWN box otherwise, so dragging a `<mx:Label>` (which normally sets
// neither width nor height) begins at the size on screen instead of at zero.

function attrNum(id, attr, fallback) {
  const v = parseFloat(doc.get_attr(id, attr) ?? "");
  return Number.isFinite(v) ? v : fallback;
}

function beginResize(id, dir) {
  const b = state.nodeBoxes[id] ?? [0, 0, 0, 0];
  let kind = "";
  try { kind = doc.node_kind(id); } catch { /* broken source */ }
  return {
    id,
    dir,
    nx: attrNum(id, "x", b[0]),
    ny: attrNum(id, "y", b[1]),
    nw: attrNum(id, "width", b[2]),
    nh: attrNum(id, "height", b[3]),
    // A path is resized by scaling its geometry, so the drag needs the `d`
    // it started from: scaling the CURRENT one on every mousemove would
    // compound the rounding of each step.
    d0: kind === "Path" ? (doc.get_attr(id, "d") ?? "") : null,
    recorded: false,
  };
}

// Only the edges the handle names move; the opposite ones stay put, which is
// what makes a north-west drag grow the box up and to the left instead of
// sliding it.
function applyResize(r, x, y) {
  let { nx, ny, nw, nh } = r;
  if (r.dir.includes("e")) nw = snap(Math.round(x)) - nx;
  if (r.dir.includes("s")) nh = snap(Math.round(y)) - ny;
  if (r.dir.includes("w")) { const rx = nx + nw; nx = Math.min(snap(Math.round(x)), rx - 2); nw = rx - nx; }
  if (r.dir.includes("n")) { const by = ny + nh; ny = Math.min(snap(Math.round(y)), by - 2); nh = by - ny; }
  nw = Math.max(2, nw);
  nh = Math.max(2, nh);
  if (r.dir.includes("w")) doc.set_attr(r.id, "x", String(nx));
  if (r.dir.includes("n")) doc.set_attr(r.id, "y", String(ny));
  if (r.dir.includes("e") || r.dir.includes("w")) doc.set_attr(r.id, "width", String(nw));
  if (r.dir.includes("n") || r.dir.includes("s")) doc.set_attr(r.id, "height", String(nh));
  // The box is only a box for a path once its geometry follows it.
  if (r.d0) {
    const sx = r.nw > 0 ? nw / r.nw : 1;
    const sy = r.nh > 0 ? nh / r.nh : 1;
    doc.set_attr(r.id, "d", doc.scale_path_data(r.d0, sx, sy));
  }
}

// The topmost node whose DRAWN box contains a stage point, smallest first so
// a label wins over the panel behind it and a child over its container.
//
// This is the fallback for `pick_id`, which hit-tests a collider built from
// width/height and therefore cannot hit a node that sets neither — every
// `<mx:Label>` the Text tool authors, for one.
function boxPick(x, y) {
  let hit = "";
  let best = Infinity;
  for (const [id, b] of Object.entries(state.nodeBoxes)) {
    if (x < b[0] || x > b[0] + b[2] || y < b[1] || y > b[1] + b[3]) continue;
    const area = b[2] * b[3];
    if (area <= best) { best = area; hit = id; }
  }
  return hit;
}

// ---- vector authoring: line / oval / freehand paths (mx:Path) --------
// Each vector tool drops a real <mx:Path> — the engine's flattened
// polyline primitive (filled for closed shapes, stroked for open ones) —
// so the shapes render in the preview and round-trip through the source.
function showMarquee(ax, ay, bx, by) {
  const m = $("marquee");
  m.style.display = "block";
  m.style.left = Math.min(ax, bx) * state.zoom + "px";
  m.style.top = Math.min(ay, by) * state.zoom + "px";
  m.style.width = Math.abs(bx - ax) * state.zoom + "px";
  m.style.height = Math.abs(by - ay) * state.zoom + "px";
}

// ---- live shape preview ----------------------------------------------
//
// Every vector tool used to preview as the dashed RECTANGLE that belongs to
// the rectangle tool — a line, an ellipse and a freehand stroke all drew a
// box. The preview is now the shape itself, rendered from the SAME geometry
// the authoring code uses.

const SVG_NS = "http://www.w3.org/2000/svg";

function previewPath() {
  let path = $("drawPreviewPath");
  if (path) return path;
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.id = "drawPreview";
  path = document.createElementNS(SVG_NS, "path");
  path.id = "drawPreviewPath";
  svg.appendChild(path);
  $("stageWrap").appendChild(svg);
  return path;
}

// `g` is the geometry that will be authored, so `d` is in the node's own
// space and (g.x, g.y) places it. The viewBox carries the zoom, which is why
// nothing here multiplies by state.zoom.
function showPreview(g, paint) {
  const path = previewPath();
  const svg = path.parentNode;
  const stage = $("stage");
  svg.setAttribute("viewBox", `0 0 ${stage.width} ${stage.height}`);
  svg.style.width = stage.width * state.zoom + "px";
  svg.style.height = stage.height * state.zoom + "px";
  svg.style.display = "block";
  path.setAttribute("transform", `translate(${g.x} ${g.y})`);
  path.setAttribute("d", g.d);
  path.setAttribute("fill", paint.fill ?? "none");
  path.setAttribute("stroke", paint.stroke ?? "none");
  path.setAttribute("stroke-width", paint.width ?? 0);
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  if (paint.dash) path.setAttribute("stroke-dasharray", paint.dash);
  else path.removeAttribute("stroke-dasharray");
}

function hidePreview() {
  const svg = $("drawPreview");
  if (svg) svg.style.display = "none";
}

// What the finished shape will be painted with — except the lasso, which
// selects rather than draws and so shows as a dashed accent loop.
function toolPaint(tool) {
  if (tool === "lasso") {
    const accent = getComputedStyle(document.documentElement)
      .getPropertyValue("--color-primary").trim() || "#4A78C3";
    return { stroke: accent, width: 1, dash: "4 3" };
  }
  if (tool === "oval") return { fill: fillColor };
  return { stroke: strokeColor, width: tool === "line" ? 2 : (FREE_WIDTH[tool] ?? 1) };
}

function authorPath(base, x, y, w, h, d, attrs) {
  if (!state.activeLayer) { flash("no active layer to draw on", true); return; }
  recordUndo();
  const id = freshId(base);
  const extra = Object.entries(attrs).map(([k, v]) => ` ${k}="${v}"`).join("");
  try {
    doc.insert_child_in_layer(state.activeLayer,
      `<mx:Path id="${id}" x="${x}" y="${y}" width="${w}" height="${h}" d="${d}"${extra}/>`);
  } catch (e) { flash(String(e), true); return; }
  syncAfterDocEdit();
  $("nodeSel").value = id;
  refreshProps();
  flash(`drew ${id}`);
}
// (ellipseD — a flattened ellipse (48-gon) path — is imported from ./util.js)

// Stroke weight each freehand tool authors, shared with the live preview so
// a stroke previews at the weight it will actually land at.
const FREE_WIDTH = { brush: 6, pencil: 2, pen: 1 };

// The geometry a vector tool will author: the node's origin, its box, and the
// `d` in the node's OWN space. The live preview renders these very values, so
// what is on screen mid-drag cannot drift from what lands in the document.
// `null` means the drag is still too small to be a shape.
function shapeGeometry(s) {
  const x0 = Math.round(s.x0), y0 = Math.round(s.y0);
  const x1 = Math.round(s.x1), y1 = Math.round(s.y1);
  const x = Math.min(x0, x1), y = Math.min(y0, y1);
  const w = Math.abs(x1 - x0), h = Math.abs(y1 - y0);
  if (s.tool === "line") {
    if (w < 2 && h < 2) return null;
    return { x, y, w: Math.max(1, w), h: Math.max(1, h), d: `M ${x0 - x} ${y0 - y} L ${x1 - x} ${y1 - y}` };
  }
  if (w < 2 || h < 2) return null;
  return { x, y, w, h, d: ellipseD(w, h) };
}

function freehandGeometry(pts) {
  if (pts.length < 2) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [px, py] of pts) {
    minX = Math.min(minX, px); minY = Math.min(minY, py);
    maxX = Math.max(maxX, px); maxY = Math.max(maxY, py);
  }
  minX = Math.round(minX); minY = Math.round(minY);
  const w = Math.max(1, Math.round(maxX) - minX), h = Math.max(1, Math.round(maxY) - minY);
  const d = pts
    .map(([px, py], i) => (i === 0 ? "M " : "L ") + (Math.round(px) - minX) + " " + (Math.round(py) - minY))
    .join(" ");
  return { x: minX, y: minY, w, h, d };
}

function authorShape(s) {
  const g = shapeGeometry(s);
  if (!g) { flash(`${s.tool}: drag to draw one`); return; }
  if (s.tool === "line") {
    authorPath("line", snap(g.x), snap(g.y), g.w, g.h, g.d, { stroke: strokeColor, strokeWidth: 2 });
  } else {
    authorPath("oval", snap(g.x), snap(g.y), g.w, g.h, g.d, { fill: fillColor });
  }
}
function authorFreehand(fd) {
  const g = freehandGeometry(fd.pts);
  if (!g) { flash(`${fd.tool}: drag to draw`); return; }
  authorPath(fd.tool, snap(g.x), snap(g.y), g.w, g.h, g.d,
    { stroke: strokeColor, strokeWidth: FREE_WIDTH[fd.tool] ?? 1 });
}
// Lasso is a selection gesture: pick the shape under the loop's centroid.
function lassoSelect(pts) {
  if (pts.length < 3) { flash("lasso: circle a shape to select it"); return; }
  let cx = 0, cy = 0;
  for (const [px, py] of pts) { cx += px; cy += py; }
  const id = player.pick_id(cx / pts.length, cy / pts.length);
  if (id) { selectNode(id); flash(`lasso selected ${id}`); }
  else flash("lasso: nothing enclosed");
}

// ---- insert helper (Text tool) --------------------------------------
function placeLabel(x, y) {
  if (!state.activeLayer) return flash("no active layer to draw on", true);
  recordUndo();
  const id = freshId("label");
  try {
    doc.insert_child_in_layer(state.activeLayer,
      `<mx:Label id="${id}" x="${Math.round(x)}" y="${Math.round(y)}" text="Text" color="${fillColor}"/>`);
  } catch (e) { flash(String(e), true); return; }
  syncAfterDocEdit();
  $("nodeSel").value = id;
  refreshProps();
  flash("added label");
}

// ---- color state -----------------------------------------------------
// (normHex — the colour normaliser — is imported from ./util.js)
function setFill(c) { fillColor = normHex(c); fillChip.style.background = fillColor; }
function setStroke(c) { strokeColor = normHex(c); strokeChip.style.background = strokeColor; }
function pickColor(cur, apply) {
  const inp = document.createElement("input");
  inp.type = "color";
  inp.value = cur.slice(0, 7);
  inp.style.cssText = "position:fixed;left:-9999px";
  document.body.appendChild(inp);
  inp.addEventListener("input", () => apply(inp.value));
  inp.addEventListener("change", () => { apply(inp.value); inp.remove(); });
  inp.click();
}

// ---- stage zoom (View menu / Zoom tool / editbar readout) -----------
export function setZoom(z) {
  state.zoom = Math.min(8, Math.max(0.25, z));
  const s = $("stage");
  s.style.width = s.width * state.zoom + "px";
  s.style.height = s.height * state.zoom + "px";
  document.querySelector("#editbar .zoom").textContent = Math.round(state.zoom * 100) + "%";
  refreshSelection();
}
export function zoomBy(f) { setZoom(state.zoom * f); }
export function zoomFit() {
  const pb = $("pasteboard"), s = $("stage");
  if (!s.width || !s.height) return;
  setZoom(Math.min(pb.clientWidth / s.width, pb.clientHeight / s.height) * 0.95);
}

// Wire the palette buttons, colour well, stage gestures, and options tray.
export function wireTools() {
  for (const b of document.querySelectorAll("#tools .tool")) {
    const name = TOOL_TITLES[b.title.split(/[\s(]/)[0]];
    if (!name) continue;
    toolButtons[name] = b;
    b.classList.remove("soon");
    // The hint is DERIVED from the keymap that actually switches tools, so
    // rebinding a key cannot leave the tooltip advertising the old one.
    // Rewriting keeps the first word, which is what resolved `name` above.
    const key = Object.keys(TOOL_KEYS).find((k) => TOOL_KEYS[k] === name);
    b.title = b.title.replace(/\s*\([^)]*\)\s*$/, "") + (key ? ` (${key.toUpperCase()})` : "");
    b.addEventListener("click", () => { setTool(name); b.blur(); });
  }

  // color chips: click to pick the fill / stroke color
  fillChip = [...document.querySelectorAll("#tools .chip")].find((c) => /Fill/.test(c.title));
  strokeChip = [...document.querySelectorAll("#tools .chip")].find((c) => /Stroke/.test(c.title));
  fillChip.addEventListener("click", () => pickColor(fillColor, setFill));
  strokeChip.addEventListener("click", () => pickColor(strokeColor, (c) => {
    setStroke(c);
    flash("stroke color set (this build has no stroke primitive yet)");
  }));

  // color well controls: swap the two swatches, or reset them to defaults
  $("colorSwap").addEventListener("click", () => {
    const f = fillColor;
    setFill(strokeColor);
    setStroke(f);
    flash("swapped fill / stroke");
  });
  $("colorDefault").addEventListener("click", () => {
    setStroke("#000000");
    setFill("#0099FF");
    flash("default colors restored");
  });
  renderToolOptions();

  // editbar zoom readout doubles as a reset-to-100% button
  document.querySelector("#editbar .zoom").addEventListener("click", () => setZoom(1));

  // ---- stage pointer gestures --------------------------------------
  // (stageXY — stage coords for a mouse event, handling CSS scaling — is
  // imported from ./util.js)
  $("stage").addEventListener("mousedown", onStageMouseDown);
  // A handle grab is a resize, whatever the active tool: the frame is the
  // affordance, so it must not depend on having picked the Free Transform
  // tool first. Delegated because the handles outlive any one selection.
  $("stageWrap").addEventListener("mousedown", (ev) => {
    const dir = ev.target.dataset?.dir;
    if (!dir) return;
    const id = $("selbox").dataset.node;
    if (!id) return;
    ev.stopPropagation();
    ev.preventDefault();
    resize = beginResize(id, dir);
    beginGesture();
  }, true);
  // double-click a container on stage to enter its (nested) timeline context
  $("stage").addEventListener("dblclick", (ev) => {
    const { x, y } = stageXY(ev);
    const id = player.pick_id(x, y) || boxPick(x, y);
    if (!id) return;
    // A text node edits in place instead; it has no children to enter.
    if (beginTextEdit(id)) return;
    enterFromPick(id);
  });
  window.addEventListener("mousemove", onWindowMouseMove);
  window.addEventListener("mouseup", onWindowMouseUp);
}
