// LittleA Editor — generated backgrounds: the spec, and how it is drawn.
//
// A background is a SPEC, never a blob of markup:
//
//   { tool: "ffflux", seed: 41, opacity: 1, params: { colorA: "#0b1220", … } }
//
// …and the SVG is regenerated from it every time it is needed. That is what
// makes a background editable a week later, diffable in a saved deck, and
// identical in the canvas, the .svg export and the thumbnail strip: the same
// four numbers go in, the same drawing comes out. `params` holds only what
// differs from the generator's own defaults, so a spec stays small and picks up
// improvements to a generator instead of freezing a copy of it.
//
// The drawing itself comes from ./bg/, a port of the SVGTool generator library:
// 34 procedural generators over a seeded RNG, each one a `controls` list plus a
// `render(ctx)` that returns markup. This module is the editor-facing layer on
// top of them:
//
//   * defaults, clamping and validation for a spec,
//   * palettes and one-click "looks" so a background is a choice, not a form,
//   * id namespacing, so two backgrounds can be inlined into one exported .svg
//     without their <defs> colliding,
//   * a small raster cache, because the two canvas editors redraw at 60fps and
//     must not re-serialize an SVG per frame.
//
// Nothing here touches the DOM except the raster helpers, and nothing here
// knows which editor is calling — the Presentation editor, the Movie Editor and
// the Scene editor all speak this one vocabulary.

import { generators } from "./bg/generators/index.js";
import { tools as CATALOG } from "./bg/data/tools.js";
import { defaultParams } from "./bg/lib/controls.js";
import { createRenderContext } from "./bg/lib/svgDocument.js";

// ---- the catalog ---------------------------------------------------------

// Only catalog entries that actually have a generator behind them, so a
// half-added tool can never reach a menu.
export const BG_TOOLS = CATALOG.filter((t) => generators[t.id]);

export const BG_CATEGORIES = [...new Set(BG_TOOLS.map((t) => t.category))];

const BY_ID = new Map(BG_TOOLS.map((t) => [t.id, t]));

export const bgTool = (id) => BY_ID.get(id) || null;

// The generator's own control descriptors: what the panel builds its form from.
export function bgControls(id) {
  const gen = generators[id];
  return gen ? gen.controls : [];
}

export const bgDefaults = (id) => defaultParams(bgControls(id));

// Search across everything a tool is described by, so "blue", "grain" and
// "noise" all find something.
export function searchBgTools(query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return BG_TOOLS;
  return BG_TOOLS.filter((t) => `${t.name} ${t.category} ${t.description} ${t.renderer}`.toLowerCase().includes(q));
}

// ---- palettes ------------------------------------------------------------
//
// Every generator exposes its colours as `color` controls, in the order it
// wants them layered, so a palette can be applied to ANY of them without either
// side knowing about the other: the n-th swatch goes into the n-th colour
// control. `paper` is the flat colour to sit the artwork on when a page wants
// one (the Presentation editor's slide fill, say).

export const BG_PALETTES = [
  { id: "midnight", name: "Midnight", paper: "#050b18", colors: ["#0b1220", "#1e3a8a", "#38bdf8", "#a855f7"] },
  { id: "aurora", name: "Aurora", paper: "#04121a", colors: ["#042f2e", "#0ea5e9", "#34d399", "#a3e635"] },
  { id: "ember", name: "Ember", paper: "#180a06", colors: ["#450a0a", "#dc2626", "#f97316", "#fbbf24"] },
  { id: "dusk", name: "Dusk", paper: "#140a1e", colors: ["#312e81", "#7c3aed", "#db2777", "#fb7185"] },
  { id: "paper", name: "Paper", paper: "#fdfcf7", colors: ["#f5f1e6", "#d6cfbc", "#8ba888", "#2f4858"] },
  { id: "blueprint", name: "Blueprint", paper: "#0b2540", colors: ["#0b2540", "#134e7a", "#3b82f6", "#bfdbfe"] },
  { id: "mono", name: "Mono", paper: "#0f0f10", colors: ["#111113", "#3f3f46", "#a1a1aa", "#f4f4f5"] },
  { id: "sorbet", name: "Sorbet", paper: "#fff7f4", colors: ["#fde68a", "#fca5a5", "#a5b4fc", "#5eead4"] },
  { id: "forest", name: "Forest", paper: "#071410", colors: ["#052e16", "#166534", "#65a30d", "#d9f99d"] },
  { id: "slate", name: "Slate", paper: "#0f172a", colors: ["#0f172a", "#334155", "#64748b", "#e2e8f0"] },
];

export const bgPalette = (id) => BG_PALETTES.find((p) => p.id === id) || null;

// ---- specs ---------------------------------------------------------------

const isNum = (v) => typeof v === "number" && Number.isFinite(v);

// Clamp a value to what its control will accept, so a hand-edited deck or an
// older spec can never drive a generator outside its own range.
function coerce(control, value) {
  if (value === undefined || value === null) return control.value;
  switch (control.kind) {
    case "range": {
      const n = Number(value);
      if (!Number.isFinite(n)) return control.value;
      return Math.min(control.max, Math.max(control.min, n));
    }
    case "toggle":
      return value === true || value === "true";
    case "select":
      return control.options.some((o) => o.value === value) ? String(value) : control.value;
    case "color":
      return /^#[0-9a-fA-F]{3,8}$/.test(String(value)) ? String(value) : control.value;
    default:
      return value;
  }
}

// A spec that is safe to render: a known tool, an integer seed, an opacity in
// [0,1] and only parameters the tool has. Returns null for "no background",
// which is a legitimate value everywhere a spec is accepted.
export function normalizeBg(spec) {
  if (!spec || !generators[spec.tool]) return null;
  const controls = bgControls(spec.tool);
  const params = {};
  for (const control of controls) {
    const given = spec.params ? spec.params[control.key] : undefined;
    if (given === undefined) continue;
    const value = coerce(control, given);
    if (value !== control.value) params[control.key] = value;
  }
  const norm = {
    tool: spec.tool,
    seed: isNum(spec.seed) ? Math.floor(spec.seed) : 1,
    opacity: isNum(spec.opacity) ? Math.min(1, Math.max(0, spec.opacity)) : 1,
    params,
  };
  // Which palette was last applied is not part of the drawing — it is only the
  // panel remembering which swatch row to light up — so it rides along and is
  // ignored by everything that renders.
  if (bgPalette(spec.palette)) norm.palette = spec.palette;
  return norm;
}

// Full parameters (defaults + this spec's overrides) — what a generator reads.
export function bgParams(spec) {
  const controls = bgControls(spec.tool);
  const params = {};
  for (const control of controls) params[control.key] = coerce(control, spec.params ? spec.params[control.key] : undefined);
  return params;
}

// Set one parameter, dropping it again when it lands back on the default.
export function withParam(spec, key, value) {
  const next = { ...spec, params: { ...spec.params, [key]: value } };
  return normalizeBg(next);
}

// Recolour a spec: the palette's swatches fill the tool's colour controls in
// order, cycling if the tool wants more colours than the palette has.
export function applyPalette(spec, palette) {
  const pal = typeof palette === "string" ? bgPalette(palette) : palette;
  if (!pal) return spec;
  const colors = bgControls(spec.tool).filter((c) => c.kind === "color");
  const params = { ...spec.params };
  colors.forEach((control, i) => { params[control.key] = pal.colors[i % pal.colors.length]; });
  return normalizeBg({ ...spec, params, palette: pal.id });
}

export const reseedBg = (spec, seed) => normalizeBg({ ...spec, seed: isNum(seed) ? seed : Math.floor(Math.random() * 1e6) });

// ---- looks ---------------------------------------------------------------
//
// The panel opens on these rather than on a grid of 34 unfamiliar names. Each
// one is a tool + palette + a couple of parameters that were worth setting —
// picking one is a single click, and every control stays open afterwards.

const LOOKS = [
  { id: "soft-flux", label: "Soft flux", tool: "ffflux", palette: "midnight", seed: 12, params: { layers: 5, warp: 90, opacity: 0.55 } },
  { id: "deep-field", label: "Deep field", tool: "aaabstract", palette: "dusk", seed: 4, params: { fields: 5, softness: 110 } },
  { id: "wave-deck", label: "Wave deck", tool: "sssurf", palette: "aurora", seed: 9, params: {} },
  { id: "quiet-grid", label: "Quiet grid", tool: "qqquad", palette: "slate", seed: 3, params: { columns: 14, rows: 8, strokeWidth: 0.6 } },
  { id: "dot-field", label: "Dot field", tool: "ssspot", palette: "blueprint", seed: 21, params: {} },
  { id: "paper-grain", label: "Paper grain", tool: "gggrain", palette: "paper", seed: 5, params: {} },
  { id: "aurora-blur", label: "Aurora blur", tool: "bbblurry", palette: "aurora", seed: 17, params: {} },
  { id: "ember-rays", label: "Ember rays", tool: "bbburst", palette: "ember", seed: 8, params: {} },
  { id: "topo-lines", label: "Topo lines", tool: "uuundulate", palette: "forest", seed: 14, params: {} },
  { id: "scale-wall", label: "Scale wall", tool: "ssscales", palette: "sorbet", seed: 2, params: {} },
  { id: "hologram", label: "Hologram", tool: "hhholographic", palette: "dusk", seed: 30, params: {} },
  { id: "ink-coil", label: "Ink coil", tool: "cccoil", palette: "mono", seed: 6, params: {} },
];

// Looks are stored as specs so everything downstream sees one shape.
export const BG_LOOKS = LOOKS.map((look) => ({
  id: look.id,
  label: look.label,
  tool: look.tool,
  spec: applyPalette(normalizeBg({ tool: look.tool, seed: look.seed, opacity: 1, params: look.params }), look.palette),
}));

// A background nobody has to design: a look, a palette and a seed drawn at
// random. Deliberately picked from the LOOKS rather than from all 34 tools —
// "Surprise me" should surprise you with something usable.
export function randomBg(rng = Math.random) {
  const look = BG_LOOKS[Math.floor(rng() * BG_LOOKS.length) % BG_LOOKS.length];
  const pal = BG_PALETTES[Math.floor(rng() * BG_PALETTES.length) % BG_PALETTES.length];
  return applyPalette(reseedBg(look.spec, Math.floor(rng() * 1e6)), pal);
}

// A one-line description for a status bar or a button's label.
export function bgSummary(spec) {
  const norm = normalizeBg(spec);
  if (!norm) return "None";
  const tool = bgTool(norm.tool);
  return `${tool ? tool.name : norm.tool} · seed ${norm.seed}`;
}

// ---- rendering -----------------------------------------------------------

// Generators name their gradients and filters after themselves ("ffflux-warp"),
// which is fine for one drawing per document and wrong the moment a deck
// exports twelve slides into one .svg: the first #ffflux-warp would win for all
// of them. Every id and every url(#…) is rewritten with a per-render prefix, so
// inlined backgrounds stay independent.
function namespaceIds(markup, prefix) {
  const ids = new Set();
  for (const m of markup.matchAll(/id="([^"]+)"/g)) ids.add(m[1]);
  let out = markup;
  for (const id of ids) {
    const esc = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out
      .replace(new RegExp(`id="${esc}"`, "g"), `id="${prefix}${id}"`)
      .replace(new RegExp(`url\\(#${esc}\\)`, "g"), `url(#${prefix}${id})`);
  }
  return out;
}

let renderTick = 0;

/**
 * The background as markup to place INSIDE an <svg> of `width` × `height`.
 *
 * `idPrefix` is only worth passing when several backgrounds land in one
 * document and the caller wants stable, readable ids (an export naming them
 * after the slide, say); left out, each call gets a fresh unique prefix.
 */
export function bgMarkup(spec, width, height, { idPrefix } = {}) {
  const norm = normalizeBg(spec);
  if (!norm) return "";
  const gen = generators[norm.tool];
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const ctx = createRenderContext(bgParams(norm), { width: w, height: h, seed: norm.seed });
  let body;
  // A generator that throws must cost the caller a background, not a render.
  try {
    body = gen.render(ctx);
  } catch (err) {
    console.warn(`background "${norm.tool}" failed to render`, err);
    return "";
  }
  const prefix = idPrefix ? `${idPrefix}-` : `bg${(renderTick = (renderTick + 1) % 1e6).toString(36)}-`;
  const inner = namespaceIds(body, prefix);
  const alpha = norm.opacity < 1 ? ` opacity="${Math.round(norm.opacity * 1000) / 1000}"` : "";
  // Clipped, because several generators deliberately overdraw the frame. The
  // <clipPath> is a SIBLING of the group it clips, never a child of it: a clip
  // that lives inside its own target is a circular reference, and a browser
  // answers that by drawing nothing at all.
  return `<defs><clipPath id="${prefix}clip"><rect width="${w}" height="${h}" /></clipPath></defs>\n`
    + `<g${alpha} clip-path="url(#${prefix}clip)">\n${inner}\n</g>`;
}

/** The same drawing as a standalone SVG document (thumbnails, downloads). */
export function bgDocument(spec, width, height, { background = "" } = {}) {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const paper = background ? `<rect width="${w}" height="${h}" fill="${background}" />` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" fill="none">${paper}${bgMarkup(spec, w, h)}</svg>`;
}

export const bgDataUrl = (spec, width, height, opts) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(bgDocument(spec, width, height, opts))}`;

// ---- raster cache --------------------------------------------------------
//
// The two canvas editors redraw on every pointer move and every animation
// frame. Serializing an SVG and decoding it that often would make the stage
// crawl, so a spec+size is rasterized once into an <img> and kept. The cache is
// keyed on exactly what the drawing depends on, which means a seed shuffle or a
// colour change misses it (and so re-renders) by construction.

const RASTER_LIMIT = 24;
const rasters = new Map();

export function bgKey(spec, width, height) {
  const norm = normalizeBg(spec);
  if (!norm) return "";
  return JSON.stringify([norm.tool, norm.seed, norm.opacity, norm.params, Math.round(width), Math.round(height)]);
}

/**
 * An <img> of the background, or null while it is still decoding.
 *
 * Deliberately synchronous-with-a-callback rather than a promise: a canvas
 * redraw cannot await, so it draws what is ready and asks to be run again when
 * the image arrives. `onReady` fires at most once per cache miss.
 */
export function bgRaster(spec, width, height, onReady) {
  const key = bgKey(spec, width, height);
  if (!key) return null;
  const hit = rasters.get(key);
  if (hit) {
    // Refresh the entry's recency so a background in active use is not the one
    // that gets evicted.
    rasters.delete(key);
    rasters.set(key, hit);
    return hit.ready ? hit.img : null;
  }
  const img = new Image();
  const entry = { img, ready: false };
  rasters.set(key, entry);
  if (rasters.size > RASTER_LIMIT) rasters.delete(rasters.keys().next().value);
  img.onload = () => { entry.ready = true; if (onReady) onReady(img); };
  img.onerror = () => { rasters.delete(key); };
  img.src = bgDataUrl(spec, width, height);
  return null;
}

/** Drop every cached raster (a project close, or a memory-shy export path). */
export const clearBgRasters = () => rasters.clear();

/**
 * Draw a background into a 2D canvas context, in the box (x, y, w, h).
 *
 * Returns true when it drew. A miss returns false and schedules `onReady`, so
 * the caller can redraw once rather than poll. Rasterized at a fixed sample
 * size instead of at the on-screen size, so panning and zooming reuse one image
 * rather than thrashing the cache.
 */
export function drawBg(ctx, spec, x, y, w, h, onReady) {
  if (!normalizeBg(spec) || w <= 0 || h <= 0) return false;
  const sample = 1280;
  const sw = Math.round(sample);
  const sh = Math.max(1, Math.round((sample * h) / w));
  const img = bgRaster(spec, sw, sh, onReady);
  if (!img) return false;
  ctx.drawImage(img, x, y, w, h);
  return true;
}
