// LittleA Editor — files, library, menu bar, and misc menu actions.
//
// Owns the component Library palette, SVG import, the File menu operations
// (new / open / save .lax / export .lab / copy source), the small Debug/Help/
// Commands actions, and the menu-bar spec that binds every dropdown item to a
// function in the other concern modules (via the shared chrome.js engine).

import { doc, state } from "./state.js";
import { library_items, EditorDoc } from "../pkg/la_editor.js";
import { Player } from "../../crates/la-player/web/pkg/la_player.js";
import { $, download, esc, zipStore } from "./util.js";
import { BLANK_SRC, LIBRARY_ICONS, LIBRARY_ICON_FALLBACK } from "./constants.js";
import { mountMenus, wireCollapse } from "./chrome.js";
import { flash, safeIr, refreshPreview } from "./core.js";
import { recordUndo, applySource, undo, redo } from "./history.js";
import {
  syncAfterDocEdit, rebuildTimeline, insertKeyframe, togglePlay, gotoFrame, stepFrame,
  insertLayer,
} from "./timeline.js";
import {
  refreshNodeList, refreshProps, deleteSelected, duplicateSelected, insertItem, zorder,
  cutSelected, copySelected, pasteClipboard,
} from "./inspector.js";
import { zoomBy, setZoom, zoomFit } from "./tools.js";
import { openBackgroundTool } from "./bgtool.js";

const ICON_PICKER_URL = "../html/icon.html?picker=1";

let iconPickerSelection = null;

function importSvgText(text, sourceLabel) {
  if (!state.activeLayer) {
    $("status").textContent = "no active layer to import into";
    $("status").className = "err flex-1 overflow-hidden text-ellipsis whitespace-nowrap";
    return false;
  }
  recordUndo();
  try {
    const n = doc.import_svg(state.activeLayer, text);
    $("status").textContent = `imported ${n} node${n === 1 ? "" : "s"} from ${sourceLabel}`;
    $("status").className = "ok flex-1 overflow-hidden text-ellipsis whitespace-nowrap";
  } catch (e) {
    $("status").textContent = String(e);
    $("status").className = "err flex-1 overflow-hidden text-ellipsis whitespace-nowrap";
    return false;
  }
  syncAfterDocEdit();
  return true;
}

function iconPickerOpen() {
  return !$("iconDlg").classList.contains("hidden");
}

function iconPickerFrame() {
  return $("iconPickerFrame");
}

function iconPickerImportBtn() {
  return $("iconDlgImport");
}

function updateIconPickerStatus(msg, isError = false) {
  const status = $("iconDlgStatus");
  status.textContent = msg;
  status.classList.toggle("err", isError);
}

function setIconPickerSelection(icon) {
  iconPickerSelection = icon;
  iconPickerImportBtn().disabled = !icon || !state.activeLayer;
  updateIconPickerStatus(icon
    ? `Selected ${icon.name}`
    : "Pick an icon in the embedded browser, then import it here.");
}

function closeIconPicker() {
  $("iconDlg").classList.add("hidden");
  iconPickerSelection = null;
  updateIconPickerStatus("Pick an icon in the embedded browser, then import it here.");
  iconPickerImportBtn().disabled = true;
  iconPickerFrame().src = "about:blank";
}

function openIconPicker() {
  $("iconDlg").classList.remove("hidden");
  iconPickerSelection = null;
  iconPickerImportBtn().disabled = !state.activeLayer;
  updateIconPickerStatus(state.activeLayer
    ? "Pick an icon in the embedded browser, then import it here."
    : "Select a layer in the scene before importing.");
  iconPickerFrame().src = `${ICON_PICKER_URL}&t=${Date.now()}`;
}

function requestPickerImport() {
  if (!iconPickerSelection) {
    updateIconPickerStatus("Pick an icon before importing.", true);
    return;
  }
  const frame = iconPickerFrame().contentWindow;
  if (!frame) {
    updateIconPickerStatus("The picker is not ready yet.", true);
    return;
  }
  frame.postMessage({ type: "icon-picker-import-request" }, "*");
}

function handleIconPickerMessage(ev) {
  if (iconPickerFrame().contentWindow && ev.source !== iconPickerFrame().contentWindow) return;
  const data = ev.data || {};
  if (data.type === "icon-picker-selected") {
    setIconPickerSelection(data.icon || null);
    return;
  }
  if (data.type === "icon-picker-close") {
    closeIconPicker();
    return;
  }
  if (data.type === "icon-picker-error") {
    updateIconPickerStatus(data.message || "Could not import the selected icon.", true);
    return;
  }
  if (data.type !== "icon-picker-import") return;
  const icon = data.icon || {};
  const svg = typeof icon.svg === "string" ? icon.svg : "";
  if (!svg) {
    updateIconPickerStatus("The picker did not send any SVG content.", true);
    return;
  }
  if (importSvgText(svg, icon.name || "icon")) closeIconPicker();
}

// ---- library panel: click a component to add it to the active layer -
export function buildLibrary() {
  const lib = $("library");
  lib.innerHTML = "";
  for (const name of library_items()) {
    const b = document.createElement("button");
    b.className = "flex items-center gap-2 px-3 py-1 text-left text-text-secondary hover:bg-surface-container hover:text-on-surface transition-colors";
    b.dataset.item = name;
    const icon = document.createElement("span");
    icon.className = "material-symbols-outlined text-[14px] text-primary shrink-0";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = LIBRARY_ICONS[name] || LIBRARY_ICON_FALLBACK;
    const label = document.createElement("span");
    label.className = "truncate";
    label.textContent = name;
    b.append(icon, label);
    b.title = `Add ${name} to the active layer`;
    b.addEventListener("click", () => {
      if (!state.activeLayer) { $("status").textContent = "no active layer to add to"; return; }
      recordUndo();
      try {
        doc.insert_library_item(state.activeLayer, name);
      } catch (e) {
        $("status").textContent = String(e);
        $("status").className = "err flex-1 overflow-hidden text-ellipsis whitespace-nowrap";
        return;
      }
      syncAfterDocEdit();
    });
    lib.appendChild(b);
  }
}

// ---- right-panel chrome: fold the Library / source editor away, and
// blow the source editor up over the whole window --------------------
export function wirePanels() {
  wireCollapse($("libToggle"), $("library"));
  wireCollapse($("codeToggle"), $("codeEditor"));
  $("codeFullBtn").addEventListener("click", () => {
    const full = $("codeEditor").classList.toggle("fullscreen");
    // A full-screen editor folded shut would leave a blank window.
    if (full) {
      $("codeEditor").classList.remove("collapsed");
      $("codeToggle").setAttribute("aria-expanded", "true");
      $("code").focus();
    }
    $("codeFullBtn").firstElementChild.textContent = full ? "close_fullscreen" : "open_in_full";
    $("codeFullBtn").title = full ? "Exit full screen" : "Full-screen the source editor";
  });
}

// ---- Import from Figma: read an exported .svg file, add its shapes,
// text, images, and groups as nodes on the active layer ---------------
export function wireImportSvg() {
  const btn = $("importSvgBtn");
  const file = $("svgFile");
  const picker = $("iconDlg");
  const pickerFileBtn = $("iconDlgFile");
  const pickerImportBtn = iconPickerImportBtn();
  const pickerCloseBtn = $("iconDlgClose");
  const pickerCancelBtn = $("iconDlgCancel");

  btn.addEventListener("click", () => {
    if (iconPickerOpen()) closeIconPicker();
    else openIconPicker();
  });
  file.addEventListener("change", async () => {
    const f = file.files && file.files[0];
    file.value = ""; // allow re-importing the same file
    if (!f) return;
    let text;
    try {
      text = await f.text();
    } catch (e) {
      $("status").textContent = "could not read file: " + e;
      $("status").className = "err flex-1 overflow-hidden text-ellipsis whitespace-nowrap";
      return;
    }
    if (importSvgText(text, f.name)) closeIconPicker();
  });

  pickerFileBtn.addEventListener("click", () => file.click());
  pickerImportBtn.addEventListener("click", requestPickerImport);
  pickerCloseBtn.addEventListener("click", closeIconPicker);
  pickerCancelBtn.addEventListener("click", closeIconPicker);

  window.addEventListener("message", handleIconPickerMessage);
  window.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && iconPickerOpen()) {
      ev.preventDefault();
      closeIconPicker();
    }
  });
}

// ---- Import video…: pick a video file and author an <mx:Video> clip that
// references it by name (the video analog of SVG import). The browser can't
// probe the file, so the clip gets a default box + trim window to adjust in
// the inspector; the real duration is stamped offline at bundle time. -----
export function wireImportVideo() {
  const btn = $("importVideoBtn");
  const file = $("videoFile");
  btn.addEventListener("click", () => file.click());
  file.addEventListener("change", () => {
    const f = file.files && file.files[0];
    file.value = ""; // allow re-importing the same file
    if (!f) return;
    if (!state.activeLayer) {
      $("status").textContent = "no active layer to import into";
      $("status").className = "err flex-1 overflow-hidden text-ellipsis whitespace-nowrap";
      return;
    }
    recordUndo();
    let id;
    try {
      id = doc.import_video(state.activeLayer, f.name);
    } catch (e) {
      $("status").textContent = String(e);
      $("status").className = "err flex-1 overflow-hidden text-ellipsis whitespace-nowrap";
      return;
    }
    syncAfterDocEdit();
    $("nodeSel").value = id; // select the new clip so its trim/mute show
    refreshProps();
    $("status").textContent = `imported ${f.name}`;
    $("status").className = "ok flex-1 overflow-hidden text-ellipsis whitespace-nowrap";
  });
}

// ---- Import audio…: pick a WAV and author a scene-level <mx:Sound> plus a
// frame-0 <mx:Cue> that plays it (the audio analog of Import video). Audio is
// scene-level, so there is no active-layer requirement. The core keeps only a
// src reference (`la bundle` packs the bytes offline); the browser decodes the
// file to draw its waveform on the timeline (the platform owns PCM decode, like
// the Web Player). -----------------------------------------------------------
export function wireImportAudio() {
  const btn = $("importAudioBtn");
  const file = $("audioFile");
  btn.addEventListener("click", () => file.click());
  file.addEventListener("change", () => {
    const f = file.files && file.files[0];
    file.value = ""; // allow re-importing the same file
    if (!f) return;
    recordUndo();
    let id;
    try {
      id = doc.import_audio(f.name);
    } catch (e) {
      $("status").textContent = String(e);
      $("status").className = "err flex-1 overflow-hidden text-ellipsis whitespace-nowrap";
      return;
    }
    syncAfterDocEdit();
    $("status").textContent = `imported ${f.name} (${id})`;
    $("status").className = "ok flex-1 overflow-hidden text-ellipsis whitespace-nowrap";
    // Best-effort waveform: decode off the main authoring path, then repaint.
    decodeWaveform(f, f.name);
  });
}

// Decode an imported audio file with the platform AudioContext and store a
// downsampled peak summary keyed by its src, then repaint the timeline so its
// cue lane shows a real waveform. Editor-only visualization — no effect on the
// deterministic schedule/IR; an undecodable file (or a loaded scene with no
// bytes) simply keeps the schematic cue marker.
async function decodeWaveform(file, src) {
  const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const Online = window.AudioContext || window.webkitAudioContext;
  if (!Offline && !Online) return;
  try {
    const bytes = await file.arrayBuffer();
    const ctx = Offline ? new Offline(1, 1, 44100) : new Online();
    const audio = await ctx.decodeAudioData(bytes);
    state.audioPeaks[src] = { peaks: peakSummary(audio, 400), duration: audio.duration };
    rebuildTimeline();
  } catch {
    /* undecodable or unsupported: keep the schematic cue lane */
  }
}

// Max-abs sample per bucket over channel 0, as n values in 0..1 — the peak
// summary the timeline draws as a waveform.
function peakSummary(audioBuffer, n) {
  const data = audioBuffer.getChannelData(0);
  const bucket = Math.max(1, Math.floor(data.length / n));
  const peaks = [];
  for (let i = 0; i < n; i++) {
    let max = 0;
    const start = i * bucket;
    for (let j = 0; j < bucket && start + j < data.length; j++) {
      const v = Math.abs(data[start + j]);
      if (v > max) max = v;
    }
    peaks.push(max);
  }
  return peaks;
}

// ---- files -----------------------------------------------------------
// (BLANK_SRC is imported from ./constants.js; download() from ./util.js)
function fileNew() {
  if (!confirm("Start a new scene? Unsaved changes to the current source will be lost.")) return;
  recordUndo();
  applySource(BLANK_SRC);
  flash("new scene");
}
export function fileOpen() {
  const inp = document.createElement("input");
  inp.type = "file";
  inp.accept = ".lax,.mxml,.xml,text/xml,text/plain";
  inp.addEventListener("change", () => {
    const f = inp.files && inp.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => { recordUndo(); applySource(String(r.result)); flash(`opened ${f.name}`); };
    r.readAsText(f);
  });
  inp.click();
}
export function fileSave() {
  download("main.lax", new Blob([doc.source()], { type: "text/plain" }));
  flash("saved main.lax");
}
function fileExportLab() {
  try {
    download("main.lab", new Blob([doc.lab_bytes()], { type: "application/octet-stream" }));
    flash("exported main.lab");
  } catch (e) { flash(String(e), true); }
}
function copySource() {
  if (!navigator.clipboard) return flash("clipboard unavailable", true);
  navigator.clipboard.writeText(doc.source()).then(() => flash("source copied"), () => flash("clipboard blocked", true));
}

// ---- bulk video export ----------------------------------------------
// Mass-produce one video per data row from the current scene, entirely in the
// browser: for each row the scene's `{binding}` slots are resolved (the same
// flattening the CLI's `--props` performs), the filled scene is compiled and
// played on an offscreen player, and a MediaRecorder captures the canvas to a
// clip (MP4 where the browser can record it, else WebM). Every clip is packed
// into one downloadable `.zip`. These are real-time recordings — for byte-
// deterministic renders, `la export --props` / batch-render.mjs stay the
// reference path.

// Unique `{binding}` expressions authored in the scene text (`{name}`,
// `{stats.count}`) — used to pre-fill the data-row template so the author
// sees exactly which slots to supply.
function detectBindings(src) {
  const found = new Set();
  const re = /\{\s*([^{}]+?)\s*\}/g;
  let m;
  while ((m = re.exec(src))) found.add(m[1].trim());
  return [...found];
}

// Output basename for a row — mirrors tools/examples/batch-render.mjs so the
// bundle and the maintained batch tool name files identically.
function bulkSlug(row, i) {
  const base = row && typeof row.name === "string" ? row.name : `row-${i}`;
  return base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || `row-${i}`;
}

// Flatten a data row's JSON to dotted binding keys exactly as the CLI's
// `--props` does (`{stats:{count:3}}` -> `stats.count` = "3"; arrays index by
// position), so an in-editor render resolves the same slots as `la export`.
function flattenRow(value, prefix = "", out = {}) {
  if (value === null || typeof value !== "object") { out[prefix] = String(value); return out; }
  if (Array.isArray(value)) {
    value.forEach((v, i) => flattenRow(v, prefix ? `${prefix}.${i}` : String(i), out));
    return out;
  }
  for (const [k, v] of Object.entries(value)) flattenRow(v, prefix ? `${prefix}.${k}` : k, out);
  return out;
}

// Resolve `{binding}` slots in the scene source against a flattened row,
// mirroring the runtime (an unbound slot renders empty). Values are XML-
// escaped so they stay valid inside the attribute they land in — which makes
// the recompiled text identical to what `la export --props` resolves.
function resolveBindings(src, flat) {
  return src.replace(/\{\s*([^{}]+?)\s*\}/g, (_, expr) => esc(String(flat[expr.trim()] ?? "")));
}

// The best-supported MediaRecorder container/codec, preferring MP4 (H.264)
// where the browser can record it, else WebM. `null` = no recording support.
function pickVideoMime() {
  if (typeof MediaRecorder === "undefined") return null;
  const candidates = [
    { mime: "video/mp4;codecs=avc1.42E01E", ext: "mp4", label: "MP4 (H.264)" },
    { mime: "video/mp4", ext: "mp4", label: "MP4" },
    { mime: "video/webm;codecs=vp9", ext: "webm", label: "WebM (VP9)" },
    { mime: "video/webm;codecs=vp8", ext: "webm", label: "WebM (VP8)" },
    { mime: "video/webm", ext: "webm", label: "WebM" },
  ];
  for (const c of candidates) if (MediaRecorder.isTypeSupported(c.mime)) return c;
  return { mime: "", ext: "webm", label: "WebM" };
}

// Record one clip: load the row's compiled bundle onto the offscreen player,
// then play `frames` frames in real time at `fps` while a MediaRecorder
// captures the canvas. Resolves to the encoded video Blob.
function recordSceneVideo(canvas, player, labBytes, fps, frames, mime) {
  player.load_lab(labBytes); // resets the instance + sizes the canvas
  player.render(); // paint frame 0 before the stream opens
  const stream = canvas.captureStream ? canvas.captureStream(fps) : canvas.mozCaptureStream(fps);
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  const stopped = new Promise((res) => { rec.onstop = res; });
  rec.start();
  return new Promise((resolve, reject) => {
    rec.onerror = (e) => reject(e.error || new Error("recording failed"));
    const startedAt = performance.now();
    const durMs = (frames / fps) * 1000;
    let advanced = 0;
    const loop = (now) => {
      // Advance the scene by wall-clock time so playback speed is correct.
      const target = Math.min(frames, Math.floor(((now - startedAt) / 1000) * fps));
      while (advanced < target) { player.tick(1 / fps); advanced++; }
      player.render();
      if (now - startedAt < durMs) { requestAnimationFrame(loop); return; }
      // One more frame so the compositor samples the last state, then finish.
      requestAnimationFrame(async () => {
        rec.stop();
        await stopped;
        resolve(new Blob(chunks, { type: mime || "video/webm" }));
      });
    };
    requestAnimationFrame(loop);
  });
}

// Open the modal that collects data rows, renders one clip per row in the
// browser, and downloads them zipped. A `function` declaration (hoisted) so
// the MENUS spec below can bind it.
export function bulkExportVideo() {
  if ($("bulkOverlay")) return; // already open
  const codec = pickVideoMime();
  const bindings = detectBindings(doc.source());
  const starter = JSON.stringify(
    [bindings.length ? Object.fromEntries(bindings.map((b) => [b, ""])) : {}],
    null,
    2,
  );
  const overlay = document.createElement("div");
  overlay.id = "bulkOverlay";
  overlay.className = "fixed inset-0 z-[2000] bg-black/60 flex items-center justify-center";
  overlay.innerHTML = `
    <div class="bg-surface-panel border border-border-strong rounded-lg w-[560px] max-w-[92vw] max-h-[88vh] flex flex-col shadow-2xl" role="dialog" aria-modal="true">
      <div class="px-4 py-3 border-b border-border-muted flex items-center justify-between">
        <span class="font-panel-header text-primary tracking-widest uppercase">Bulk export video</span>
        <button id="bulkClose" class="text-text-secondary hover:text-on-surface" title="Close">&#10005;</button>
      </div>
      <div class="p-4 flex flex-col gap-3 overflow-y-auto text-[12px] text-on-surface">
        <p class="text-text-secondary leading-relaxed">Render one video per data row from <span class="font-code-md text-on-surface">main.lax</span>, in the browser, and download them all as a <span class="font-code-md text-on-surface">.zip</span>. Each row fills the scene's <span class="font-code-md text-on-surface">{binding}</span> slots below. (Real-time recordings; for byte-deterministic renders use <span class="font-code-md text-on-surface">la export</span>.)</p>
        <div class="flex gap-4 items-center">
          <span>Output: <span class="text-on-surface">${codec ? esc(codec.label) : "not supported in this browser"}</span></span>
          <label class="flex items-center gap-2">Frames
            <input id="bulkFrames" type="number" min="1" value="90" class="bg-surface-container border border-border-muted rounded px-1.5 py-0.5 w-20 text-right font-code-md focus:border-primary focus:ring-1 focus:ring-primary outline-none" />
          </label>
        </div>
        <div class="text-text-secondary">${bindings.length
      ? "Bindings in scene: " + bindings.map((b) => `<span class="font-code-md text-primary">{${esc(b)}}</span>`).join(" ")
      : `No <span class="font-code-md">{bindings}</span> found &mdash; every video would be identical.`}</div>
        <label class="flex flex-col gap-1">Data rows &mdash; a JSON array, one object per video
          <textarea id="bulkRows" spellcheck="false" class="bg-surface text-on-surface font-code-md text-[12px] border border-border-muted rounded p-2 h-48 resize-y focus:outline-none focus:border-primary leading-snug">${esc(starter)}</textarea>
        </label>
        <div class="flex items-center gap-2">
          <button id="bulkLoad" class="bg-surface-container hover:bg-surface-container-high border border-border-muted rounded px-2 py-1 text-text-secondary hover:text-on-surface">Load .json&hellip;</button>
          <input id="bulkFile" type="file" accept=".json,application/json" hidden />
          <span id="bulkErr" class="text-error text-[11px] empty:hidden"></span>
        </div>
      </div>
      <div class="px-4 py-3 border-t border-border-muted flex justify-end gap-2">
        <button id="bulkCancel" class="bg-surface-container hover:bg-surface-container-high border border-border-muted rounded px-3 py-1.5 text-on-surface disabled:opacity-50">Cancel</button>
        <button id="bulkGo" class="bg-primary-container hover:opacity-90 text-on-primary-container rounded px-3 py-1.5 font-medium disabled:opacity-50">Render &amp; download videos</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  const showErr = (m) => { $("bulkErr").textContent = m || ""; };
  const busy = () => $("bulkCancel").disabled;
  const setBusy = (on, label) => {
    $("bulkGo").disabled = on;
    $("bulkCancel").disabled = on;
    $("bulkGo").textContent = label || "Render & download videos";
  };

  $("bulkClose").onclick = () => { if (!busy()) close(); };
  $("bulkCancel").onclick = () => { if (!busy()) close(); };
  overlay.addEventListener("mousedown", (ev) => { if (ev.target === overlay && !busy()) close(); });

  $("bulkLoad").onclick = () => $("bulkFile").click();
  $("bulkFile").addEventListener("change", async () => {
    const f = $("bulkFile").files && $("bulkFile").files[0];
    $("bulkFile").value = "";
    if (!f) return;
    try {
      const text = await f.text();
      JSON.parse(text); // validate before adopting
      $("bulkRows").value = text;
      showErr("");
    } catch (e) {
      showErr("not valid JSON: " + e.message);
    }
  });

  $("bulkGo").onclick = async () => {
    if (busy()) return;
    if (!codec) return showErr("this browser can't record video (no MediaRecorder) — try Chrome/Edge, or use `la export`");
    const frames = parseInt($("bulkFrames").value, 10) || 0;
    if (frames < 1) return showErr("frames must be a positive number");
    let rows;
    try {
      rows = JSON.parse($("bulkRows").value);
    } catch (e) {
      return showErr("data rows are not valid JSON: " + e.message);
    }
    if (!Array.isArray(rows) || rows.length === 0) return showErr("data must be a non-empty JSON array of row objects");
    if (!rows.every((r) => r && typeof r === "object" && !Array.isArray(r))) return showErr("every row must be a JSON object");

    const src = doc.source(); // re-read fresh in case the scene changed
    const fps = Math.max(1, Math.round(safeIr()?.fps ?? 30));

    // Offscreen render surface + a throwaway document/player, so the live
    // preview (and the user's working document) are never disturbed. The
    // canvas is kept off-screen but in the render tree so it composites.
    const canvas = document.createElement("canvas");
    canvas.style.cssText = "position:fixed;left:-10000px;top:0;pointer-events:none";
    document.body.appendChild(canvas);
    let renderPlayer, renderDoc;
    try {
      renderPlayer = new Player(canvas);
      renderDoc = new EditorDoc(src);
    } catch (e) {
      canvas.remove();
      return showErr("could not start the renderer: " + e);
    }

    showErr("");
    setBusy(true, "Preparing\u2026");
    const used = new Set();
    const videos = [];
    try {
      for (let i = 0; i < rows.length; i++) {
        setBusy(true, `Rendering ${i + 1}/${rows.length}\u2026`);
        const resolved = resolveBindings(src, flattenRow(rows[i]));
        let labBytes;
        try {
          renderDoc.set_source(resolved);
          labBytes = renderDoc.lab_bytes();
        } catch (e) {
          throw new Error(`row ${i + 1} does not compile: ${e}`);
        }
        const blob = await recordSceneVideo(canvas, renderPlayer, labBytes, fps, frames, codec.mime);
        const base = bulkSlug(rows[i], i);
        let name = `${base}.${codec.ext}`;
        for (let k = 2; used.has(name); k++) name = `${base}-${k}.${codec.ext}`;
        used.add(name);
        videos.push({ name, data: new Uint8Array(await blob.arrayBuffer()) });
      }
      download("littlea-bulk-videos.zip", zipStore(videos));
    } catch (e) {
      canvas.remove();
      setBusy(false);
      return showErr(String(e.message || e));
    }
    canvas.remove();
    close();
    flash(`bulk videos: ${videos.length} ${codec.ext.toUpperCase()} clip(s) \u2192 littlea-bulk-videos.zip`);
  };
}

// ---- misc menu actions ----------------------------------------------
function reloadPreview() { if (refreshPreview()) { rebuildTimeline(); refreshNodeList(); flash("preview reloaded"); } }
function logIr() { const ir = safeIr(); if (ir) { console.log(ir); flash("IR logged to console"); } else flash("scene does not compile", true); }
function showCompile() { const e = doc.compile_error(); flash(e || "scene compiles cleanly", !!e); }
function togglePanel(id) { $(id).classList.toggle("hidden"); }
function showAbout() { flash("LittleA Editor \u2014 browser alpha: code-first MXML authoring with a live WebGL preview."); }
function showShortcuts() { flash("V select \u00B7 R rect \u00B7 Ctrl+X/C/V cut/copy/paste \u00B7 Ctrl+Z / Ctrl+Shift+Z undo/redo \u00B7 Ctrl+S save \u00B7 Ctrl+O open \u00B7 Ctrl +/- / 0 zoom \u00B7 F6 keyframe \u00B7 Enter play \u00B7 , . step"); }

// ---- menu bar: build working dropdowns from a spec ------------------
// INVARIANT: every `run:` here that references a function from another module
// (undo, zoomBy, deleteSelected, …) captures that function BY VALUE as this
// object literal evaluates. That is safe only because those exports are all
// hoisted `function` declarations, which ESM initialises at instantiation —
// before any module body runs — so they hold their value even under the
// (intentional) circular imports between concern modules. Do NOT convert a
// menu-bound export to a `const` arrow: it would be in the temporal dead zone
// here and throw at load. Locally-defined actions may be either form.
const MENUS = {
  File: [
    { label: "New", run: fileNew },
    { label: "Open\u2026", sc: "Ctrl+O", run: fileOpen },
    "sep",
    { label: "Save .lax", sc: "Ctrl+S", run: fileSave },
    { label: "Export .lab", run: fileExportLab },
    { label: "Bulk Export Video\u2026", run: bulkExportVideo },
  ],
  Edit: [
    { label: "Undo", sc: "Ctrl+Z", run: undo },
    { label: "Redo", sc: "Ctrl+Shift+Z", run: redo },
    "sep",
    { label: "Cut", sc: "Ctrl+X", run: cutSelected },
    { label: "Copy", sc: "Ctrl+C", run: copySelected },
    { label: "Paste", sc: "Ctrl+V", run: pasteClipboard },
    "sep",
    { label: "Delete", sc: "Del", run: deleteSelected },
    { label: "Duplicate", sc: "Ctrl+D", run: duplicateSelected },
    { label: "Copy Source", run: copySource },
  ],
  View: [
    { label: "Zoom In", sc: "Ctrl+=", run: () => zoomBy(1.25) },
    { label: "Zoom Out", sc: "Ctrl+-", run: () => zoomBy(0.8) },
    { label: "Actual Size", sc: "Ctrl+0", run: () => setZoom(1) },
    { label: "Fit in Window", run: zoomFit },
  ],
  Insert: [
    { label: "New Layer", run: insertLayer },
    { label: "Keyframe", sc: "F6", run: insertKeyframe },
    "sep",
    { label: "Background\u2026", run: openBackgroundTool },
    { label: "Rectangle", run: () => insertItem("Rectangle") },
    { label: "Label", run: () => insertItem("Label") },
    { label: "Button", run: () => insertItem("Button") },
  ],
  Modify: [
    { label: "Bring to Front", run: () => zorder("front") },
    { label: "Bring Forward", run: () => zorder("forward") },
    { label: "Send Backward", run: () => zorder("backward") },
    { label: "Send to Back", run: () => zorder("back") },
  ],
  Text: [
    { label: "Insert Label", run: () => insertItem("Label") },
  ],
  Commands: [
    { label: "Reload Preview", run: reloadPreview },
    { label: "Copy Source", run: copySource },
  ],
  Control: [
    { label: "Play / Stop", sc: "Enter", run: togglePlay },
    { label: "Rewind", run: () => gotoFrame(0) },
    { label: "Step Forward", sc: ".", run: () => stepFrame(1) },
    { label: "Step Back", sc: ",", run: () => stepFrame(-1) },
  ],
  Debug: [
    { label: "Log IR to Console", run: logIr },
    { label: "Compile Status", run: showCompile },
  ],
  Window: [
    { label: "Toggle Right Panel", run: () => togglePanel("rightPanel") },
  ],
  Help: [
    { label: "Keyboard Shortcuts", run: showShortcuts },
    { label: "About LittleA", run: showAbout },
  ],
};

export function buildMenus() {
  // Delegate the open/close/outside-click state machine to the shared engine
  // (editor/chrome.js); each `.mi` trigger's text keys into the MENUS spec.
  const triggers = [...document.querySelectorAll("#menubar .mi")]
    .map((el) => ({ el, items: MENUS[el.textContent.trim()] }))
    .filter((t) => t.items);
  mountMenus({
    triggers,
    panelClass: "menuPop",
    hoverSwitch: true,
    renderItem: (it) => {
      if (it === "sep") { const s = document.createElement("div"); s.className = "sep"; return s; }
      const row = document.createElement("div");
      row.className = "item";
      const l = document.createElement("span");
      l.textContent = it.label;
      row.appendChild(l);
      if (it.sc) { const k = document.createElement("span"); k.className = "sc"; k.textContent = it.sc; row.appendChild(k); }
      return row;
    },
  });
}
