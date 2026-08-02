// LittleA Editor — scene-graph (compiled IR) tree helpers.
//
// Pure module: every function operates on the parsed IR passed in, holding no
// editor state and touching no DOM. Shared by the timeline panel, the
// drill-down context navigation and the stage pick handlers.

// Depth-first search for a node by id across a node list (and their children).
export function findNodeById(nodes, id) {
  for (const n of nodes ?? []) {
    if (n.id === id) return n;
    const hit = findNodeById(n.children, id);
    if (hit) return hit;
  }
  return null;
}

// Flatten every layer's top-level nodes into a single root-node list.
export function irRootNodes(ir) {
  const out = [];
  for (const l of ir.layers ?? []) for (const n of l.nodes ?? []) out.push(n);
  return out;
}

// A container is any node that has children (an enterable symbol).
export function nodeIsContainer(node) {
  return !!(node && (node.children ?? []).length);
}

// The id of the nearest container ancestor of `id` (the symbol that contains
// it), or null when it has no enterable parent.
export function containerAncestorOf(ir, id) {
  let found = null;
  const walk = (node, parent) => {
    if (node.id === id) {
      found = parent;
      return true;
    }
    for (const c of node.children ?? []) if (walk(c, node)) return true;
    return false;
  };
  for (const n of irRootNodes(ir)) if (walk(n, null)) break;
  return found && nodeIsContainer(found) ? found.id : null;
}
