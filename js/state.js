// LittleA Editor — shared editor state.
//
// The editor used to be one big module closure; it is now split into concern
// modules (core / history / timeline / inspector / tools / files, wired by
// boot.js). Those modules need a common place to read AND write the live
// editor state — and ES import bindings are read-only, so a shared object is
// the write seam.
//
// Two kinds of shared state live here:
//   * The wasm handles (`doc`, `player`). They are created once by boot.js and
//     never reassigned afterwards, so they are exported as LIVE BINDINGS: after
//     initWasm() runs, every importer's `doc` / `player` reflects the instance.
//     Consumers use them as plain identifiers, exactly as the old closure did.
//   * The `state` object holds the genuinely mutable, cross-module fields
//     (reassigned at runtime and read by more than one module). Single-module
//     state (the active tool, colours, gesture trackers, undo stacks, …) stays
//     local to the module that owns it.

// wasm handles — set once by boot.js after initEditor()/initPlayer() resolve.
// They are `null` until initWasm() runs, so only ever read them from inside a
// function or event handler — never at a module's top level (import time).
export let doc = null;    // EditorDoc — the CST-preserving document core
export let player = null; // Player — the WebGL2 live preview

// Bind the wasm instances. Called exactly once, before any handler can run.
export function initWasm(editorDoc, previewPlayer) {
  doc = editorDoc;
  player = previewPlayer;
}

// Mutable state shared across modules. (Every static config/data table lives
// in ./constants.js; single-module state lives in its owning module.)
export const state = {
  irCache: null,     // last good compiled IR (drives the timeline panel)
  nodeLayer: {},     // node id -> { layer, locked, layerLocked } (selection respects locks)
  activeLayer: null, // where drawing tools insert
  contextStack: [],  // drill-down path (node ids); empty = main timeline
  zoom: 1,           // stage view scale (View menu / Zoom tool)
  audioPeaks: {},    // sound src -> { peaks:[0..1], duration } (imported-audio waveform)
  // id -> [x, y, w, h] in stage coords: the box each node actually DRAWS
  // into, refreshed from the player on every render. Not the node's own
  // width/height — a <mx:Label> usually sets neither, so that box is empty.
  nodeBoxes: {},
  // Timeline-panel keyframe editing. `kfSel` is the clicked keyframe dot
  // ({ id, frame }) — it is what Delete/Copy act on. It points INTO the
  // document, so `validateKeyframeSelection` drops it on every rebuild that
  // no longer finds that key (pinned by the editor test's "a stale keyframe
  // selection lets Delete reach the node again"). `kfClipboard` holds a
  // copied keyframe's properties as the JSON object add_keyframe_props
  // takes, so a paste is the same call as an insert.
  kfSel: null,
  kfClipboard: null,
  // A copied node's SOURCE XML. Held as text, not an id, so it outlives the
  // node it came from (cut) and can be pasted more than once (each paste
  // re-mints the ids).
  nodeClipboard: null,
};
