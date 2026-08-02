// LittleA Editor — Label ▸ text -> vector graphic.
//
// The palette's Label tool. It is the Movie Editor's "Text → SVG graphic"
// feature brought into the scene editor: you type an outline (`# Title`,
// `- Point: detail`, `A -> B -> C`, `A vs B`) and ./textsvg.js lays it out as a
// diagram, hands back its GEOMETRY, and this module writes that geometry into
// the open document.
//
// Nothing is rasterized and nothing is imported. textsvg.js emits one list of
// primitives; `exportSvg` renders it for the dialog's preview and `mxmlParts`
// renders the SAME list as <mx:Path> / <mx:Label> nodes, so what you approve in
// the preview is what lands in the scene. Insert is therefore a plain
// `insert_child_in_layer` of one <mx:Sprite> — the document core does not know
// a generator exists, and the result is an ordinary node tree you can then
// select, nudge, restyle, re-time or hand-edit in the code pane.
//
// The layout is picked from a browsable, searchable list: the layouts that fit
// the text are pinned under "Suggested" and the rest are grouped by what they
// are FOR (Mindmap, Process, Comparison, Visual Metaphors, …). Choosing one
// RE-READS the text for it, because a layout implies a structure — "Comparison"
// splits a flow into two sides, "Cycle" chains a flat list and closes the loop —
// and the badge next to the text says which reading is on screen, with a reset
// back to the detected one. Plain sentences are normalized into the cheatsheet
// syntax before parsing; "Convert to cheatsheet" writes that inferred syntax
// back into the textarea so it can be seen and hand-tuned. Neither of those ever
// edits the text behind your back.
//
// The build animation comes along: `planBuild` turns the entrance / order /
// exit settings into per-part keyframe rows, so each card, connector and title
// is its own <mx:Sprite> with its own <mx:Timeline> and the graphic assembles
// itself PowerPoint-style. Those keyframes show up in the timeline panel like
// any hand-authored ones.
//
// The preview is DIRECTLY EDITABLE, exactly as the Movie Editor's is. Click a
// card or connector, drag it (snapping to its neighbours' edges and centres),
// resize it by a corner, recolour it, change its shape or its connector kind,
// retype any of its text, pick a different badge icon, or hide it — with undo.
// Those changes are kept apart from the text as a small patch that textsvg.js
// folds in AFTER the layout runs (applyEdits), never as a second copy of the
// drawing. So the typed outline stays the source of content, the graph stays
// the source of geometry, and retyping the text re-runs the layout with the
// edits riding along on top instead of being thrown away.

import { doc, state } from "./state.js";
import { $, download, esc } from "./util.js";
import { flash, freshId, refreshPreview } from "./core.js";
import { recordUndo } from "./history.js";
import { syncAfterDocEdit } from "./timeline.js";
import { refreshProps } from "./inspector.js";
import {
  textToSvg, slugify, PRESETS, graphicParts, mxmlParts, planBuild,
  unsupportedGlyphs, ENTRANCES, EXITS, SEQUENCES, DEFAULT_ANIM,
  hitTestParts, snapBox, editCount, cloneEdits, edgeKey, textHitAt, partText,
  EM_PER_CELL, ICONS, ICON_NAMES, nodeIcon,
  CATEGORIES, presetsByCategory, presetsForStructure, searchPresets,
  plainTextToCheatsheet, shouldConvertToCheatsheet,
} from "./textsvg.js";

const SAMPLE_TEXT = "# LittleA\n- Author: a scene in the browser\n- Preview: WebGL2, at the playhead\n- Export: deterministic MP4";

// Last successful generate, plus the direct-manipulation editor's state. Kept
// so Insert and "Download .svg" act on exactly what the preview showed rather
// than re-deriving it.
const lg = {
  svg: "", graph: null, view: null, presetId: "", ok: false,
  structure: "",                   // the text's own reading, for the suggestions
  edits: { nodes: {}, edges: {} }, // the direct-manipulation patch
  undo: [],                        // snapshots of `edits`, newest last
  sel: null,                       // id of the selected part
  drag: null,                      // in-flight pointer gesture
  guides: [],                      // snap lines to draw this frame
  edit: null,                      // in-flight inline text edit
  textSession: null,               // which field a run of keystrokes is going into
};

const num = (id, fallback) => {
  const v = Number($(id).value);
  return Number.isFinite(v) ? v : fallback;
};

// The scene's own frame rate; the build is planned in scene frames, so a
// 60fps document gets 60 keyframe steps per second and a 30fps one gets 30.
const sceneFps = () => Math.max(1, Math.round(state.irCache?.fps ?? 60));
const stageSize = () => ({
  w: Math.max(1, $("stage").width || 400),
  h: Math.max(1, $("stage").height || 200),
});

// The dialog's controls as textsvg.js understands them. The background is not
// among them on purpose: the generated graphic is always transparent, so the
// scene behind it shows through.
function opts() {
  const st = stageSize();
  const aspect = $("lgAspect").value;
  return {
    preset: $("lgPreset").value || undefined,
    aspect: aspect === "frame" ? `${st.w}:${st.h}` : aspect,
    connector: $("lgLine").value || "#94a3b8",
    edits: lg.edits,
  };
}

// ---- the layout picker -----------------------------------------------
//
// Layouts are browsable rather than a flat list of 38 names: the ones that
// already fit the text are pinned under "Suggested", the rest are grouped by
// what they are FOR (Mindmap, Process, Comparison, …) and the search box
// narrows across labels, descriptions and keywords. A layout can appear in more
// than one group, because a mind map is as useful for brainstorming as it is
// for hierarchy.
function fillPresetPicker(structure) {
  const sel = $("lgPreset");
  const keep = sel.value;
  const matches = searchPresets($("lgPresetSearch").value);
  const allowed = new Set(matches.map((p) => p.id));
  const opt = (p) => `<option value="${p.id}" title="${esc(p.description)}">${esc(p.label)}</option>`;

  const groups = [];
  const suggested = (structure ? presetsForStructure(structure) : []).filter((p) => allowed.has(p.id));
  if (suggested.length) groups.push(`<optgroup label="Suggested">${suggested.map(opt).join("")}</optgroup>`);
  for (const cat of CATEGORIES) {
    const list = presetsByCategory(cat.id).filter((p) => allowed.has(p.id));
    if (list.length) groups.push(`<optgroup label="${esc(cat.label)}">${list.map(opt).join("")}</optgroup>`);
  }

  sel.innerHTML = `<option value="">Auto</option>` + groups.join("");
  // A search that hides the current choice must not silently change the
  // drawing, so the chosen layout is always offered.
  if (keep && !allowed.has(keep)) {
    const p = PRESETS.find((q) => q.id === keep);
    if (p) sel.insertAdjacentHTML("beforeend", `<optgroup label="Chosen">${opt(p)}</optgroup>`);
  }
  sel.value = keep;
}

// "flow · detected" / "comparison · re-read for Comparison" — the one line that
// says which interpretation of the text is on screen.
function renderStructureBadge(out) {
  const forced = out && out.forced;
  $("lgStructure").textContent = out
    ? forced ? `${out.structure} · re-read from ${out.naturalStructure}` : `${out.structure} · detected`
    : "";
  $("lgStructReset").classList.toggle("hidden", !forced);
}

function anim() {
  return {
    ...DEFAULT_ANIM,
    effect: $("lgFx").value,
    direction: $("lgFxDir").value,
    sequence: $("lgSeq").value,
    duration: Math.max(0.05, num("lgFxDur", DEFAULT_ANIM.duration)),
    stagger: Math.max(0, num("lgFxStag", 0)),
    exit: $("lgExit").value,
    exitDirection: $("lgExitDir").value,
  };
}

// Where the graphic lands on the stage: `Size` percent of the stage width,
// scaled to keep the composition's aspect, centred. Exported for the suite.
export function placement(vw, vh, stage, pct) {
  const w = Math.max(1, Math.round(stage.w * pct / 100));
  const h = Math.max(1, Math.round(w * (vh / Math.max(1, vw))));
  return { x: Math.round((stage.w - w) / 2), y: Math.round((stage.h - h) / 2), w, h };
}

// Only some effects take a direction; repopulate (and hide) the picker to match.
function syncFxDirs() {
  for (const [fxId, dirId, defs] of [["lgFx", "lgFxDir", ENTRANCES], ["lgExit", "lgExitDir", EXITS]]) {
    const def = defs.find((d) => d.id === $(fxId).value) || defs[0];
    const sel = $(dirId), want = sel.value;
    sel.innerHTML = (def.dirs || []).map((d) => `<option value="${d}">from ${d}</option>`).join("");
    sel.style.display = def.dirs ? "" : "none";
    if (def.dirs) sel.value = def.dirs.includes(want) ? want : (def.defaultDir || def.dirs[0]);
    else sel.value = "";
  }
}

// "12 parts · 4 steps · build 2.6s of 3.0s" — the one number that says whether
// the animation actually fits the time you gave it.
function renderFxInfo() {
  const host = $("lgFxInfo");
  if (!lg.view || !lg.view.parts.length) { host.textContent = ""; return; }
  if ($("lgFx").value === "none" && $("lgExit").value === "none") {
    host.textContent = `${lg.view.parts.length} parts · no build — the graphic is there from frame 0`;
    host.classList.remove("err");
    return;
  }
  const fps = sceneFps();
  const endF = Math.max(1, Math.round(Math.max(0.1, num("lgDur", 3)) * fps));
  const plan = planBuild(lg.view.parts, anim(), {
    startFrame: 0, endFrame: endF, fps, totalFrames: endF, vw: lg.view.vw, vh: lg.view.vh,
  });
  const secs = (f) => (f / fps).toFixed(1) + "s";
  host.textContent = `${lg.view.parts.length} parts · ${plan.maxStep + 1} steps · `
    + `build ${secs(plan.buildFrames)} of ${secs(endF)} (${endF} frames @ ${fps}fps)`
    + (plan.overflow ? ` · ${secs(plan.overflow)} too long` : "");
  host.classList.toggle("err", plan.overflow > 0);
}

// Regenerate from the dialog's text and repaint the preview.
export function renderLabelPreview() {
  const info = $("lgInfo");
  let out;
  try { out = textToSvg($("lgText").value, opts()); }
  catch (err) {
    info.textContent = "could not build a diagram: " + err;
    info.classList.add("err");
    lg.ok = false; $("lgInsert").disabled = true; $("lgSvg").disabled = true;
    return;
  }
  lg.svg = out.svg; lg.graph = out.graph; lg.presetId = out.presetId;
  lg.structure = out.naturalStructure || out.structure;
  // Retyping the text is how an element disappears; textToSvg hands the patch
  // back with any entry that no longer has anything to point at removed.
  lg.edits = out.edits;
  try { lg.view = graphicParts(out.graph, opts()); } catch { lg.view = null; }
  // A selection survives a re-render only if the thing it named still exists.
  if (lg.sel && !(lg.view || { parts: [] }).parts.some((p) => p.id === lg.sel)) lg.sel = null;

  $("lgPreview").innerHTML = out.svg;
  const el = $("lgPreview").firstElementChild;
  if (el) { el.removeAttribute("width"); el.removeAttribute("height"); }
  drawEditOverlay();

  const fit = PRESETS.find((p) => p.id === out.presetId);
  $("lgPreset").options[0].textContent = `Auto — ${fit ? fit.label : out.presetId}`;
  // The suggestions follow the text's OWN reading, not the layout chosen by
  // hand, so picking one never narrows what can be picked next.
  fillPresetPicker(out.naturalStructure || out.structure);
  renderStructureBadge(out);
  $("lgConvert").disabled = !shouldConvertToCheatsheet($("lgText").value);

  const empty = !out.graph.nodes.length;
  lg.ok = !empty;
  $("lgInsert").disabled = empty;
  $("lgSvg").disabled = empty;
  // The renderer's glyph atlas is printable ASCII only, so a character it
  // cannot draw is worth saying out loud BEFORE the graphic is in the scene.
  const bad = unsupportedGlyphs($("lgText").value);
  info.classList.toggle("err", !!bad.length);
  info.textContent = empty
    ? "type something above to generate a graphic"
    : bad.length
      ? `${out.graph.nodes.length} nodes · ${out.structure} · the export font cannot draw ${bad.join(" ")}`
      : `${out.graph.nodes.length} nodes · ${out.graph.edges.length} links · ${out.structure} · transparent background`;
  renderFxInfo();
  renderEditBar();
}

// ---- the SVG editor: direct manipulation of the preview ---------------
//
// Everything here is chrome drawn *on top of* the generated SVG, never into
// it: selection, handles and snap guides all live in one <g> appended after
// the artwork and thrown away on the next render. The downloadable .svg and
// the inserted MXML therefore contain the drawing and nothing else.

const SVG_NS = "http://www.w3.org/2000/svg";
const HANDLES = [["nw", 0, 0], ["ne", 1, 0], ["sw", 0, 1], ["se", 1, 1]];
const previewSvg = () => $("lgPreview").querySelector("svg");
const selectedPart = () => (lg.view && lg.sel
  ? lg.view.parts.find((p) => p.id === lg.sel) : null) || null;

// A node part's box is its content box padded by 3 for the card stroke
// (textsvg.js: nodeBbox). Undo that so drags and snapping talk about the card
// the user sees rather than its halo.
const partBox = (p) => ({ x: p.x + 3, y: p.y + 3, width: p.w - 6, height: p.h - 6 });

// Map a pointer event into SVG user units.
//
// The SVG's own screen CTM does this, and nothing else should try: it already
// accounts for the viewBox, for preserveAspectRatio's letterboxing, for the
// container's scroll offset and for any CSS scaling on the way down.
// Reconstructing that by hand from a bounding rect looks right and is quietly
// wrong the moment the element's box stops matching its aspect ratio — which,
// in a centred flex container, it does.
function previewPoint(ev) {
  const el = previewSvg();
  const ctm = el && el.getScreenCTM();
  if (!ctm || !ctm.a) return null;
  const p = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(ctm.inverse());
  // `k` is user units per screen pixel, which keeps handles and hit tolerances
  // a constant size on screen however the preview is scaled.
  return { x: p.x, y: p.y, k: 1 / ctm.a };
}

// The screen-pixel -> user-unit scale when there is no event to hand.
function previewScale() {
  const el = previewSvg();
  const ctm = el && el.getScreenCTM();
  return ctm && ctm.a ? 1 / ctm.a : 1;
}

// The forward map: user units -> pixels inside #lgStage, which is the
// coordinate space the floating text editor is positioned in.
function previewMap() {
  const el = previewSvg();
  const ctm = el && el.getScreenCTM();
  if (!ctm || !ctm.a) return null;
  const stage = $("lgStage").getBoundingClientRect();
  const at = (x, y) => {
    const p = new DOMPoint(x, y).matrixTransform(ctm);
    return { x: p.x - stage.left, y: p.y - stage.top };
  };
  return { s: ctm.a, at };
}

// ---- inline text editing ---------------------------------------------
//
// Double-clicking a glyph run opens a real <input> over it. The run is a
// *picture* of something in the graph — a node's label or detail, or the
// heading — so the field is seeded from that source (partText), never from the
// drawn run, which may have been truncated to fit its card. Committing writes
// the source, not the picture.
//
// The input floats in #lgStage rather than in #lgPreview because the preview's
// contents are replaced wholesale on every render, and typing re-renders on
// every keystroke. For the same reason it is positioned once, when it opens:
// re-anchoring it to a run that moves as the text grows would make it hop
// around under the cursor.
function openTextEditor(part, field) {
  const map = previewMap();
  if (!map || !part || !field) return;
  const run = part.prims.find((q) => q.t === "text" && q.field === field);
  const box = run
    ? { x: run.x, y: run.y - run.size * 0.7536698, w: Math.max(run.w, 40), h: run.size }
    // A detail line that does not exist yet has no run to sit on, so the field
    // opens just under the card's label instead.
    : { x: part.x + 6, y: part.y + part.h - 26, w: part.w - 12, h: 14 };
  const el = $("lgTextEdit");
  lg.edit = { partId: part.id, field, node: part.node || "", took: false };
  el.value = partText(part, lg.graph, field);
  const at = map.at(box.x, box.y);
  el.style.left = `${at.x - 3}px`;
  el.style.top = `${at.y - 3}px`;
  el.style.width = `${Math.max(70, box.w * map.s + 24)}px`;
  el.style.fontSize = `${Math.max(9, box.h * map.s * EM_PER_CELL)}px`;
  el.style.lineHeight = "1.4";
  el.classList.remove("hidden");
  el.focus();
  el.select();
  drawEditOverlay();
}

// `keep` false throws the edit away; the value has already been written on
// every keystroke, so cancelling means restoring the snapshot taken when the
// first one landed.
function closeTextEditor(keep = true) {
  const ed = lg.edit;
  if (!ed) return;
  lg.edit = null;
  lg.textSession = null;
  $("lgTextEdit").classList.add("hidden");
  if (!keep && ed.took) { lg.edits = lg.undo.pop(); commitEdit(); return; }
  if (ed.took) flash(`retyped the ${ed.field === "description" ? "detail" : ed.field}`);
  drawEditOverlay();
}

// Write one text field of the selection into the patch.
//
// A run of keystrokes into the same field is ONE undoable change: typing a
// word and then undoing should give back the word you started from, not walk
// backwards a letter at a time. `textSession` is what makes a run a run; any
// other action clears it (pushUndo does), so an unrelated edit never gets
// swallowed into it.
//
// Empty is a real value — it is how a detail line is taken away — so it is
// stored rather than skipped.
function setText(part, field, value) {
  const key = `${part.id}:${field}`;
  if (lg.textSession !== key) {
    pushUndo();
    lg.textSession = key;
    if (lg.edit) lg.edit.took = true;
  }
  if (part.kind === "title") lg.edits.title = value;
  else nodeEdit(part.node)[field] = value;
  commitEdit();
}

function drawEditOverlay() {
  const svg = previewSvg();
  if (!svg) return;
  const old = svg.querySelector("#lgOverlay");
  if (old) old.remove();
  const part = selectedPart();
  if (!part && !lg.guides.length) return;
  const k = previewScale();
  const g = document.createElementNS(SVG_NS, "g");
  g.setAttribute("id", "lgOverlay");
  g.setAttribute("pointer-events", "none");
  const add = (tag, attrs) => {
    const n = document.createElementNS(SVG_NS, tag);
    for (const [a, v] of Object.entries(attrs)) n.setAttribute(a, v);
    g.appendChild(n);
    return n;
  };
  for (const gd of lg.guides) {
    add("line", {
      x1: gd.axis === "x" ? gd.at : gd.from, y1: gd.axis === "x" ? gd.from : gd.at,
      x2: gd.axis === "x" ? gd.at : gd.to, y2: gd.axis === "x" ? gd.to : gd.at,
      stroke: "#f43f5e", "stroke-width": k, "stroke-dasharray": `${k * 4} ${k * 3}`,
    });
  }
  if (part) {
    if (part.kind === "edge") {
      // A connector has no meaningful box, so echo its own line instead of
      // boxing the empty diagonal rectangle around it.
      for (const q of part.prims) if (q.t === "path") add("path", { d: q.d, fill: "none", stroke: "#6366f1", "stroke-width": k * 4, opacity: 0.5 });
    } else {
      const b = partBox(part);
      add("rect", {
        x: b.x, y: b.y, width: b.width, height: b.height, fill: "none",
        stroke: "#6366f1", "stroke-width": k * 1.5, "stroke-dasharray": `${k * 5} ${k * 3}`,
      });
      if (part.kind === "node") {
        const s = k * 8;
        for (const [, fx, fy] of HANDLES) {
          add("rect", {
            x: b.x + b.width * fx - s / 2, y: b.y + b.height * fy - s / 2, width: s, height: s,
            fill: "#ffffff", stroke: "#6366f1", "stroke-width": k * 1.5,
          });
        }
      }
    }
  }
  svg.appendChild(g);
}

// Which resize handle (if any) sits under a point, for the current selection.
function handleAt(part, p) {
  if (!part || part.kind !== "node") return "";
  const b = partBox(part), grab = p.k * 7;
  for (const [name, fx, fy] of HANDLES) {
    if (Math.abs(p.x - (b.x + b.width * fx)) <= grab && Math.abs(p.y - (b.y + b.height * fy)) <= grab) return name;
  }
  return "";
}

// Snapshot the patch so the change about to be made can be taken back. Only
// called at the *start* of a gesture, so a whole drag — or a whole run of
// typing — undoes as one step.
function pushUndo() {
  lg.textSession = null;
  lg.undo.push(cloneEdits(lg.edits));
  if (lg.undo.length > 50) lg.undo.shift();
}
const nodeEdit = (id) => (lg.edits.nodes[id] = lg.edits.nodes[id] || {});
const edgeEdit = (key) => (lg.edits.edges[key] = lg.edits.edges[key] || {});

// Applying an edit means re-running the pipeline, not patching the DOM: there
// is one path from text to picture and it is this one.
function commitEdit() { renderLabelPreview(); }

function selectPart(id) {
  if (lg.sel !== id) { closeTextEditor(true); closeIconPop(); }
  lg.sel = id;
  drawEditOverlay();
  renderEditBar();
}

// The contextual inspector under the preview, driven entirely by what is
// selected. The controls are static markup that is shown and hidden rather
// than rebuilt, so a colour picker keeps its focus while it is being dragged.
function renderEditBar() {
  const part = selectedPart();
  const isNode = !!(part && part.kind === "node");
  const isEdge = !!(part && part.kind === "edge");
  const isTitle = !!(part && part.kind === "title");
  $("lgSelNode").classList.toggle("hidden", !isNode);
  $("lgSelEdge").classList.toggle("hidden", !isEdge);
  // Text fields for anything that carries text. They are the only way to ADD a
  // detail line to a card that has none: there is no run to double-click when
  // the line does not exist yet.
  $("lgSelText").classList.toggle("hidden", !(isNode || isTitle));
  $("lgSelLabelName").textContent = isTitle ? "Title" : "Label";
  $("lgSelDetailWrap").classList.toggle("hidden", !isNode);
  $("lgSelHide").classList.toggle("hidden", !part || isTitle);
  $("lgSelReset").classList.toggle("hidden", !part);
  if (isNode || isTitle) {
    // Not while it is being typed into, or the caret would jump to the end on
    // every keystroke.
    if (document.activeElement !== $("lgSelLabel")) $("lgSelLabel").value = partText(part, lg.graph, "label");
    if (document.activeElement !== $("lgSelDetail")) $("lgSelDetail").value = partText(part, lg.graph, "description");
  }
  if (isNode) {
    const n = (lg.graph.nodes || []).find((x) => x.id === part.node);
    if (n) { $("lgSelColor").value = n.color || "#6366f1"; $("lgSelShape").value = n.variant || "card"; }
    // The button carries the badge the node is actually drawing, so the
    // inspector answers "what icon is this?" without opening anything.
    const ic = n ? nodeIcon(n) : "";
    $("lgSelIconNow").innerHTML = ic ? iconSvg(ic, 13, "#a9bacd")
      : esc(((n && n.label.trim()[0]) || "*").toUpperCase());
    $("lgSelInfo").textContent = `${n ? n.label : part.node} · ${Math.round(part.w - 6)}×${Math.round(part.h - 6)}`;
  } else if (isEdge) {
    const e = (lg.graph.edges || []).find((x) => x.source === part.source && x.target === part.target);
    $("lgSelKind").value = (e && e.kind) || "line";
    $("lgSelInfo").textContent = `${part.source} → ${part.target}`;
  } else {
    $("lgSelInfo").textContent = isTitle ? "title" : "nothing selected";
  }
  const n = editCount(lg.edits);
  $("lgEditCount").textContent = n ? `${n} direct edit${n === 1 ? "" : "s"}` : "";
  $("lgEditUndo").disabled = lg.undo.length === 0;
  $("lgEditClear").disabled = n === 0;
}

// ---- the icon picker --------------------------------------------------
//
// A node's badge draws either an icon or the label's first letter. Which one
// is normally decided by the node's own words (textsvg.js: pickIcon), and this
// is where that guess can be overruled.
//
// Three states, and the difference between them matters:
//   - no entry in the patch  -> AUTO: re-guessed from the label on every
//     retype, so renaming a card renames its icon with it
//   - icon: "some-name"      -> pinned to that icon, and a retype leaves it
//   - icon: ""               -> pinned to the LETTER, which is not the same as
//     auto: it is how you tell the guesser to stop guessing
// That is why the patch is read with `!== undefined` and never for truth.

// One icon as an inline SVG, at whatever pixel size the chrome needs.
function iconSvg(name, px, color) {
  const d = ICONS[name];
  if (!d) return "";
  return `<svg viewBox="0 0 24 24" width="${px}" height="${px}" fill="none" stroke="${color}"`
    + ` stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;
}

// The patch entry for the selected node, or undefined when it is on auto.
function selectedIconEdit() {
  const part = selectedPart();
  if (!part || part.kind !== "node") return null;
  const e = lg.edits.nodes[part.node];
  return { part, pinned: e ? e.icon : undefined };
}

function setIcon(value) {
  const sel = selectedIconEdit();
  if (!sel) return;
  pushUndo();
  const e = nodeEdit(sel.part.node);
  // `undefined` is "hand back to auto", and the key has to actually leave the
  // patch or editCount would keep counting an edit that is not there.
  if (value === undefined) delete e.icon; else e.icon = value;
  if (!Object.keys(e).length) delete lg.edits.nodes[sel.part.node];
  commitEdit();
  flash(value === undefined ? "icon back to automatic"
    : value === "" ? "badge shows the label's initial"
    : `icon set to ${value}`);
}

// What the selected node is drawing right now, whether pinned or guessed.
function nodeIconOf(part) {
  const n = (lg.graph.nodes || []).find((x) => x.id === part.node);
  return n ? nodeIcon(n) : "";
}

function renderIconGrid() {
  const sel = selectedIconEdit();
  const now = sel ? nodeIconOf(sel.part) : "";
  const q = $("lgIconSearch").value.trim().toLowerCase();
  const names = q ? ICON_NAMES.filter((n) => n.includes(q)) : ICON_NAMES;
  $("lgIconGrid").innerHTML = names.map((n) => {
    const on = n === now;
    return `<button data-icon="${n}" title="${n}"${on ? ' class="on"' : ""}>`
      + iconSvg(n, 18, on ? "#8ab4ff" : "#a9bacd") + "</button>";
  }).join("") || `<span class="lgNoIcon">no icon matches "${esc(q)}"</span>`;
}

function openIconPop() {
  if (!selectedIconEdit()) return;
  closeTextEditor(true);
  $("lgIconPop").classList.remove("hidden");
  $("lgIconSearch").value = "";
  renderIconGrid();
  $("lgIconSearch").focus();
}
function closeIconPop() { $("lgIconPop").classList.add("hidden"); }
export const iconPopOpen = () => !$("lgIconPop").classList.contains("hidden");

// Everything above, bound to the dialog's controls. Called once, from
// wireLabelTool.
function wireSvgEditor() {
  $("lgTextEdit").addEventListener("input", () => {
    const part = selectedPart(), ed = lg.edit;
    if (!part || !ed) return;
    setText(part, ed.field, $("lgTextEdit").value);
  });
  $("lgTextEdit").addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") { e.preventDefault(); closeTextEditor(true); }
    else if (e.key === "Escape") { e.preventDefault(); closeTextEditor(false); }
  });
  $("lgTextEdit").addEventListener("blur", () => closeTextEditor(true));

  // Double-click a run to type into it. Anywhere else on a card opens its
  // label, so "double-click the thing and type" always does something.
  $("lgPreview").addEventListener("dblclick", (ev) => {
    const p = previewPoint(ev);
    if (!p || !lg.view) return;
    const part = hitTestParts(lg.view.parts, p.x, p.y, p.k * 5);
    if (!part || part.kind === "edge") return;
    if (part.id !== lg.sel) selectPart(part.id);
    const hit = textHitAt(part, p.x, p.y, p.k * 5);
    openTextEditor(part, hit ? hit.field : part.kind === "title" ? "title" : "label");
  });

  // The same edit from the inspector, which is also the only way to ADD a
  // detail line to a card that has none — there is no run to double-click.
  const textFieldInput = (id, field) => ($(id).oninput = () => {
    const part = selectedPart();
    if (!part) return;
    setText(part, part.kind === "title" ? "title" : field, $(id).value);
  });
  textFieldInput("lgSelLabel", "label");
  textFieldInput("lgSelDetail", "description");

  $("lgPreview").addEventListener("pointerdown", (ev) => {
    const p = previewPoint(ev);
    if (!p || !lg.view) return;
    closeTextEditor(true);
    closeIconPop();
    const sel = selectedPart();
    // A handle belongs to the current selection, so it is tested before the
    // artwork: grabbing a corner must not re-select whatever is behind it.
    const handle = handleAt(sel, p);
    const part = handle ? sel : hitTestParts(lg.view.parts, p.x, p.y, p.k * 5);
    if (!part) { selectPart(null); return; }
    if (part.id !== lg.sel) selectPart(part.id);
    if (part.kind !== "node") return;
    const e = lg.edits.nodes[part.node] || {};
    const b = partBox(part);
    lg.drag = {
      node: part.node, handle, moved: false,
      ox: p.x, oy: p.y, box: b,
      dx: e.dx || 0, dy: e.dy || 0, w: b.width, h: b.height,
    };
    ev.preventDefault();
    $("lgPreview").setPointerCapture(ev.pointerId);
  });

  $("lgPreview").addEventListener("pointermove", (ev) => {
    const d = lg.drag;
    if (!d) {
      // Idle: the cursor advertises what a press would do.
      const p = previewPoint(ev);
      const hit = p && lg.view ? hitTestParts(lg.view.parts, p.x, p.y, p.k * 5) : null;
      const h = p ? handleAt(selectedPart(), p) : "";
      $("lgPreview").style.cursor = h ? (h === "nw" || h === "se" ? "nwse-resize" : "nesw-resize")
        : hit ? (hit.kind === "node" ? "move" : "pointer") : "default";
      return;
    }
    const p = previewPoint(ev);
    if (!p) return;
    const mdx = p.x - d.ox, mdy = p.y - d.oy;
    if (!d.moved) {
      if (Math.abs(mdx) < p.k * 3 && Math.abs(mdy) < p.k * 3) return; // ignore a click's jitter
      d.moved = true;
      pushUndo();
    }
    const ed = nodeEdit(d.node);
    if (d.handle) {
      // Resize. Clamp the size first, then derive how far the moving corner
      // actually travelled, so a clamped edge stops instead of drifting.
      const grows = d.handle;
      const wNew = Math.max(60, grows.includes("w") ? d.w - mdx : d.w + mdx);
      const hNew = Math.max(40, grows.startsWith("n") ? d.h - mdy : d.h + mdy);
      ed.w = Math.round(wNew); ed.h = Math.round(hNew);
      ed.dx = d.dx + (d.handle.includes("w") ? d.w - wNew : 0);
      ed.dy = d.dy + (d.handle.startsWith("n") ? d.h - hNew : 0);
      lg.guides = [];
    } else {
      // Move, snapped to the other cards' edges and centres.
      const others = lg.view.parts
        .filter((q) => q.kind === "node" && q.node !== d.node).map(partBox);
      const snapped = snapBox({ ...d.box, x: d.box.x + mdx, y: d.box.y + mdy }, others, p.k * 6);
      ed.dx = Math.round(d.dx + snapped.x - d.box.x);
      ed.dy = Math.round(d.dy + snapped.y - d.box.y);
      lg.guides = snapped.guides;
    }
    commitEdit();
  });

  const endDrag = (ev) => {
    const d = lg.drag;
    if (!d) return;
    lg.drag = null;
    lg.guides = [];
    if (ev && $("lgPreview").hasPointerCapture(ev.pointerId)) $("lgPreview").releasePointerCapture(ev.pointerId);
    if (d.moved) { commitEdit(); flash(d.handle ? "resized an element" : "moved an element"); }
    else drawEditOverlay();
  };
  $("lgPreview").addEventListener("pointerup", endDrag);
  $("lgPreview").addEventListener("pointercancel", endDrag);

  $("lgSelIcon").onclick = () => (iconPopOpen() ? closeIconPop() : openIconPop());
  $("lgIconClose").onclick = closeIconPop;
  $("lgIconSearch").oninput = renderIconGrid;
  $("lgIconSearch").onkeydown = (ev) => {
    ev.stopPropagation();
    if (ev.key === "Escape") { ev.preventDefault(); closeIconPop(); }
    // Enter takes the first match, so a search can be finished without
    // reaching for the mouse.
    if (ev.key === "Enter") {
      const first = $("lgIconGrid").querySelector("[data-icon]");
      if (first) { setIcon(first.dataset.icon); closeIconPop(); }
    }
  };
  $("lgIconLetter").onclick = () => { setIcon(""); closeIconPop(); };
  $("lgIconAuto").onclick = () => { setIcon(undefined); closeIconPop(); };
  $("lgIconGrid").onclick = (ev) => {
    const b = ev.target.closest("[data-icon]");
    if (!b) return;
    setIcon(b.dataset.icon);
    renderIconGrid();
  };

  $("lgSelColor").oninput = () => {
    const part = selectedPart();
    if (!part || part.kind !== "node") return;
    pushUndo();
    nodeEdit(part.node).color = $("lgSelColor").value;
    commitEdit();
  };
  $("lgSelShape").onchange = () => {
    const part = selectedPart();
    if (!part || part.kind !== "node") return;
    pushUndo();
    const e = nodeEdit(part.node);
    e.variant = $("lgSelShape").value;
    // A new shape brings its own proportions; a size pinned to the old one
    // would stretch it into something the layout never meant.
    delete e.w; delete e.h;
    commitEdit();
  };
  $("lgSelKind").onchange = () => {
    const part = selectedPart();
    if (!part || part.kind !== "edge") return;
    pushUndo();
    edgeEdit(edgeKey(part.source, part.target)).kind = $("lgSelKind").value;
    commitEdit();
  };
  $("lgSelHide").onclick = () => {
    const part = selectedPart();
    if (!part || part.kind === "title") return;
    pushUndo();
    if (part.kind === "node") nodeEdit(part.node).hidden = true;
    else edgeEdit(edgeKey(part.source, part.target)).hidden = true;
    lg.sel = null;
    commitEdit();
    flash("hid an element — Undo brings it back");
  };
  $("lgSelReset").onclick = () => {
    const part = selectedPart();
    if (!part) return;
    pushUndo();
    if (part.kind === "node") delete lg.edits.nodes[part.node];
    else if (part.kind === "edge") delete lg.edits.edges[edgeKey(part.source, part.target)];
    commitEdit();
  };
  $("lgEditUndo").onclick = () => {
    if (!lg.undo.length) return;
    lg.edits = lg.undo.pop();
    commitEdit();
  };
  $("lgEditClear").onclick = () => {
    if (!editCount(lg.edits)) return;
    pushUndo();
    lg.edits = { nodes: {}, edges: {} };
    commitEdit();
    flash("reset the graphic to its generated layout");
  };

  // The editor's own keyboard, in CAPTURE phase: boot.js listens on window too
  // and would otherwise see Delete as "delete the selected scene node" while
  // the modal is up. Only claims keys while the dialog is open and the focus is
  // not in one of its own fields.
  window.addEventListener("keydown", (ev) => {
    if (!labelToolOpen() || lg.edit) return;
    const t = ev.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
    if (ev.key === "Escape" && iconPopOpen()) { ev.preventDefault(); ev.stopPropagation(); closeIconPop(); return; }
    // Escape gives up the selection before it gives up the dialog.
    if (ev.key === "Escape" && lg.sel) { ev.preventDefault(); ev.stopPropagation(); selectPart(null); return; }
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "z") {
      ev.preventDefault(); ev.stopPropagation();
      $("lgEditUndo").onclick();
      return;
    }
    const part = selectedPart();
    if (!part) return;
    if (ev.key === "Enter" || ev.key === "F2") {
      if (part.kind === "edge") return;
      ev.preventDefault(); ev.stopPropagation();
      openTextEditor(part, part.kind === "title" ? "title" : "label");
      return;
    }
    if (ev.key === "Delete" || ev.key === "Backspace") {
      ev.preventDefault(); ev.stopPropagation();
      $("lgSelHide").onclick();
      return;
    }
    const step = ev.shiftKey ? 10 : 1;
    const nudge = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[ev.key];
    if (!nudge || part.kind !== "node") return;
    ev.preventDefault(); ev.stopPropagation();
    pushUndo();
    const e = nodeEdit(part.node);
    e.dx = (e.dx || 0) + nudge[0];
    e.dy = (e.dy || 0) + nudge[1];
    commitEdit();
  }, true);
}

// ---- insertion -------------------------------------------------------
//
// One <mx:Sprite> per graphic, holding one <mx:Sprite> per part, holding the
// part's primitives. The ids are minted from the document so a second insert
// of the same text cannot collide with the first.
export function insertLabelGraphic() {
  if (!lg.ok || !lg.view) { flash("nothing to insert", true); return null; }
  if (!state.activeLayer) { flash("no active layer to draw on", true); return null; }

  const fps = sceneFps();
  const endF = Math.max(1, Math.round(Math.max(0.1, num("lgDur", 3)) * fps));
  const plan = planBuild(lg.view.parts, anim(), {
    startFrame: 0, endFrame: endF, fps, totalFrames: endF, vw: lg.view.vw, vh: lg.view.vh,
  });
  const title = (lg.graph.title || lg.graph.nodes[0]?.label || "graphic");
  const id = freshId((slugify(title) || "graphic").replace(/-/g, "") + "-");
  const box = placement(lg.view.vw, lg.view.vh, stageSize(), num("lgSize", 80));
  const xml = mxmlParts({ id, view: lg.view, parts: lg.view.parts, plan, box, indent: "" });

  recordUndo();
  try { doc.insert_child_in_layer(state.activeLayer, xml); }
  catch (e) { flash(String(e), true); return null; }
  syncAfterDocEdit();
  $("nodeSel").value = id;
  refreshProps();
  refreshPreview();
  flash(`inserted ${id} — ${lg.view.parts.length} parts`);
  return id;
}

// ---- dialog open/close -----------------------------------------------
export function openLabelTool() {
  const dlg = $("labelDlg");
  if (!dlg.classList.contains("hidden")) return;
  if (!$("lgText").value) $("lgText").value = SAMPLE_TEXT;
  // A fresh session: the direct edits belonged to the graphic that was already
  // inserted, and carrying them onto a new one would move cards the user never
  // touched.
  lg.edits = { nodes: {}, edges: {} };
  lg.undo = []; lg.sel = null; lg.guides = []; lg.drag = null;
  closeTextEditor(false);
  closeIconPop();
  dlg.classList.remove("hidden");
  renderLabelPreview();
  $("lgText").focus();
}

export function closeLabelTool() {
  closeTextEditor(true);
  closeIconPop();
  $("labelDlg").classList.add("hidden");
}

export const labelToolOpen = () => !$("labelDlg").classList.contains("hidden");

// ---- wiring ----------------------------------------------------------
export function wireLabelTool() {
  fillPresetPicker(null);
  $("lgFx").innerHTML = ENTRANCES.map((e) => `<option value="${e.id}">${e.label}</option>`).join("");
  $("lgExit").innerHTML = EXITS.map((e) => `<option value="${e.id}">${e.label}</option>`).join("");
  $("lgSeq").innerHTML = SEQUENCES.map((s) => `<option value="${s.id}">${s.label}</option>`).join("");
  // A build is the point of generating the graphic rather than drawing it, so
  // the dialog opens on one — a gentle staggered float-in, by outline level.
  $("lgFx").value = "float";
  $("lgExit").value = DEFAULT_ANIM.exit;
  $("lgSeq").value = "level";
  syncFxDirs();

  // Typing regenerates on a short idle so a long outline does not re-lay out
  // on every keystroke; every other control is immediate.
  let timer = 0;
  $("lgText").addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(renderLabelPreview, 160);
  });
  for (const id of ["lgPreset", "lgAspect", "lgLine"]) {
    $(id).addEventListener("change", renderLabelPreview);
  }
  $("lgPresetSearch").addEventListener("input", () => fillPresetPicker(lg.structure));
  // Going back to the detected reading is just "no layout chosen by hand".
  $("lgStructReset").addEventListener("click", () => {
    $("lgPreset").value = "";
    renderLabelPreview();
  });
  // Rewriting the textarea with document.execCommand keeps the browser's own
  // undo stack, so Ctrl+Z takes the typed text back.
  $("lgConvert").addEventListener("click", () => {
    const field = $("lgText"), text = field.value;
    if (!shouldConvertToCheatsheet(text)) return;
    const converted = plainTextToCheatsheet(text);
    field.focus();
    field.setSelectionRange(0, text.length);
    if (!document.execCommand || !document.execCommand("insertText", false, converted)) {
      field.value = converted;
    }
    renderLabelPreview();
  });
  for (const id of ["lgFx", "lgExit"]) {
    $(id).addEventListener("change", () => { syncFxDirs(); renderFxInfo(); });
  }
  for (const id of ["lgFxDir", "lgExitDir", "lgSeq", "lgFxDur", "lgFxStag", "lgDur"]) {
    $(id).addEventListener("input", renderFxInfo);
  }
  $("lgSize").addEventListener("input", () => { $("lgSizeOut").textContent = $("lgSize").value + "%"; });
  wireSvgEditor();

  $("toolLabelGraphic").addEventListener("click", () => { openLabelTool(); $("toolLabelGraphic").blur(); });
  $("lgClose").addEventListener("click", closeLabelTool);
  $("lgCancel").addEventListener("click", closeLabelTool);
  $("lgInsert").addEventListener("click", () => { if (insertLabelGraphic()) closeLabelTool(); });
  $("lgSvg").addEventListener("click", () => {
    if (!lg.svg) return;
    const name = slugify(lg.graph?.title || lg.graph?.nodes[0]?.label || "graphic") || "graphic";
    download(name + ".svg", new Blob([lg.svg], { type: "image/svg+xml" }));
  });
  // Clicking the scrim closes; clicking the panel must not.
  $("labelDlg").addEventListener("mousedown", (ev) => { if (ev.target === $("labelDlg")) closeLabelTool(); });
}
