// LittleA Editor — undo / redo history and session persistence.
//
// History is a stack of full .lax source snapshots. It is persisted to
// IndexedDB so a page refresh resumes the session — the working source plus
// the full undo/redo stacks — instead of dropping it (issues.md #9).
// Persistence is best-effort: if IndexedDB is unavailable (private mode,
// quota) the editor silently keeps history in memory only.

import { doc, state } from "./state.js";
import { $ } from "./util.js";
import { flash, refreshPreview } from "./core.js";
import { rebuildTimeline } from "./timeline.js";
import { refreshNodeList } from "./inspector.js";
import { setZoom } from "./tools.js";

const UNDO_LIMIT = 200;
const HISTORY_DB = "littlea-editor";
const HISTORY_STORE = "session";
const HISTORY_KEY = "history";
const undoStack = [];
const redoStack = [];
let historyDb = null;
let persistTimer = 0;

function openHistoryDb() {
  return new Promise((resolve, reject) => {
    let req;
    try { req = indexedDB.open(HISTORY_DB, 1); } catch (e) { return reject(e); }
    req.onupgradeneeded = () => req.result.createObjectStore(HISTORY_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Debounced write of the whole session so a burst of edits doesn't thrash
// the store; the trailing edit always lands.
export function persistHistory() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    if (!historyDb) return;
    try {
      const rec = { source: doc.source(), undo: undoStack.slice(), redo: redoStack.slice() };
      historyDb.transaction(HISTORY_STORE, "readwrite").objectStore(HISTORY_STORE).put(rec, HISTORY_KEY);
    } catch { /* best-effort */ }
  }, 250);
}

// Reopen the persisted session at boot. Returns true when a working source
// was restored; a stale/invalid snapshot is ignored so boot never breaks.
export async function restoreHistory() {
  try {
    historyDb = await openHistoryDb();
    const rec = await new Promise((res) => {
      const r = historyDb.transaction(HISTORY_STORE, "readonly").objectStore(HISTORY_STORE).get(HISTORY_KEY);
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
    });
    if (!rec || typeof rec.source !== "string") return false;
    try { doc.set_source(rec.source); } catch { return false; }
    undoStack.length = 0;
    redoStack.length = 0;
    if (Array.isArray(rec.undo)) undoStack.push(...rec.undo);
    if (Array.isArray(rec.redo)) redoStack.push(...rec.redo);
    return true;
  } catch { return false; }
}

export function recordUndo() {
  undoStack.push(doc.source());
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
  redoStack.length = 0;
  persistHistory();
}

export function applySource(src) {
  try { doc.set_source(src); } catch (e) { flash(String(e), true); return; }
  $("code").value = doc.source();
  refreshPreview();
  rebuildTimeline();
  refreshNodeList();
  setZoom(state.zoom);
}

export function undo() {
  if (!undoStack.length) return flash("nothing to undo");
  redoStack.push(doc.source());
  applySource(undoStack.pop());
  persistHistory();
  flash("undo");
}

export function redo() {
  if (!redoStack.length) return flash("nothing to redo");
  undoStack.push(doc.source());
  applySource(redoStack.pop());
  persistHistory();
  flash("redo");
}
