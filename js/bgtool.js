// LittleA Editor — Insert ▸ Background.
//
// The palette's Background command. It is the Presentation editor's backdrop
// picker pointed at a SCENE: you browse the same generators, in the same
// dialog, and what you approve is imported into the open document as ordinary
// authored geometry — one <mx:Sprite> of paths on the active layer, sent to the
// back so it sits under everything already there.
//
// Nothing is rasterized and nothing is referenced: the background becomes
// <mx:Path> nodes the rest of the editor can select, move, restyle, re-time and
// undo, exactly like the Label tool's diagrams. That is also why the picker is
// FILTERED here to the `vector` generators: the document core's SVG importer
// understands flat paint, not gradients and filters, so a filter-warped colour
// field would arrive as a black rectangle. Better to offer the styles that
// survive the trip than to offer all of them and import a lie.

import { doc, state } from "./state.js";
import { $ } from "./util.js";
import { flash } from "./core.js";
import { recordUndo } from "./history.js";
import { syncAfterDocEdit } from "./timeline.js";
import { refreshProps } from "./inspector.js";
import { openBgPanel } from "./bgpanel.js";
import { bgDocument, bgSummary } from "./bgsvg.js";

const stageSize = () => ({
  w: Math.max(1, $("stage").width || 800),
  h: Math.max(1, $("stage").height || 450),
});

/**
 * Open the picker, and import the chosen background into the active layer.
 *
 * The import goes through the same `import_svg` path a hand-drawn .svg file
 * takes, so there is one importer to trust rather than two.
 */
export async function openBackgroundTool() {
  if (!state.activeLayer) { flash("select a layer to insert the background into", true); return; }
  const { w, h } = stageSize();
  const chosen = await openBgPanel({
    spec: null,
    aspect: w / h,
    title: "Background",
    allowNone: false,
    note: "Imported as vector nodes on the active layer — selectable, animatable, undoable.",
    // Only what the document core's importer can actually paint.
    filter: (tool) => tool && tool.renderer === "vector",
  });
  if (!chosen) return;

  recordUndo();
  let added = 0;
  try {
    added = doc.import_svg(state.activeLayer, bgDocument(chosen, w, h));
  } catch (e) {
    flash(String(e), true);
    return;
  }
  // A background is only a background if it is behind the scene. The importer
  // appends, so the freshly added nodes are lowered as a block, in order, which
  // leaves their own stacking intact.
  for (const id of imported(added)) sendToBack(id);
  syncAfterDocEdit();
  // The selection is deliberately left where it was: a background is a hundred
  // paths, and silently selecting one of them would be a worse answer than
  // leaving the node you were working on selected.
  refreshProps();
  flash(`inserted a background — ${added} node${added === 1 ? "" : "s"} · ${bgSummary(chosen)}`);
}

// The ids the import just added: they are the last `count` nodes in document
// order, which is what `import_svg` guarantees by appending them.
function imported(count) {
  let ids = [];
  try { ids = doc.node_ids(); } catch { return []; }
  return count > 0 ? ids.slice(-count) : [];
}

function sendToBack(id) {
  try {
    let prev = doc.node_ids().join(",");
    for (let i = 0; i < 1000; i++) {
      doc.lower_node(id);
      const now = doc.node_ids().join(",");
      if (now === prev) break;
      prev = now;
    }
  } catch { /* a node the importer nested is already as low as it goes */ }
}

/** Bind the palette button (and let the menu call the command directly). */
export function wireBackgroundTool() {
  const btn = $("toolBackground");
  if (btn) btn.addEventListener("click", () => openBackgroundTool());
}
