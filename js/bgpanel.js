// LittleA Editor — the Background dialog.
//
// One background picker, shared by all three editors (Presentation, Movie,
// Scene). It is deliberately a browsable GALLERY rather than a form: you open
// it on twelve finished "looks", see every style rendered live in your own
// colours at your own aspect ratio, and only meet the generator's controls if
// you want to push one further. Choosing a background should cost one click;
// tuning one should cost no reload.
//
// The dialog owns no editor state. It is opened with the spec you have and
// resolves with the spec you chose:
//
//   const next = await openBgPanel({ spec, aspect: 16 / 9, title: "Slide background" });
//   //   { …spec }  chosen        null  cancelled        "none"  background removed
//
// It also calls `onPreview(spec)` as you browse, so a host that can show the
// change underneath (the Presentation editor paints the selected slide) does,
// and one that cannot simply leaves it out. Cancelling always calls
// `onPreview(originalSpec)` back, so a live preview can never survive an Escape.
//
// The DOM and the styles are injected once, scoped under `.bgp-root`, because
// the three pages have three different design-token setups and a picker that
// looked right in only one of them would be worse than no picker at all.

import {
  BG_CATEGORIES, BG_LOOKS, BG_PALETTES, BG_TOOLS,
  applyPalette, bgControls, bgDataUrl, bgSummary, bgTool,
  normalizeBg, randomBg, reseedBg, searchBgTools, withParam,
} from "./bgsvg.js";

const RECENT_KEY = "littlea.bg.recent";
const RECENT_MAX = 8;

// ---- styles --------------------------------------------------------------

const CSS = `
.bgp-root { position: fixed; inset: 0; z-index: 4000; display: flex; align-items: center; justify-content: center;
            background: rgba(2, 6, 14, .72); font: 12px/1.45 ui-sans-serif, system-ui, "Segoe UI", sans-serif;
            color: #e6edf6; -webkit-font-smoothing: antialiased; }
.bgp-root[hidden] { display: none; }
.bgp-shell { width: min(1180px, 94vw); height: min(760px, 92vh); display: flex; flex-direction: column;
             background: #0e141d; border: 1px solid #2b3a4d; border-radius: 12px; overflow: hidden;
             box-shadow: 0 30px 90px rgba(0, 0, 0, .6); }
.bgp-head { display: flex; align-items: center; gap: 12px; padding: 10px 14px; border-bottom: 1px solid #22303f;
            background: #111a25; }
.bgp-title { font-size: 13px; font-weight: 600; letter-spacing: .01em; }
.bgp-sub { color: #7f93a9; font-size: 11px; }
.bgp-search { margin-left: auto; display: flex; align-items: center; gap: 6px; }
.bgp-search input { width: 220px; background: #0a0f16; border: 1px solid #2b3a4d; border-radius: 999px;
                    padding: 5px 10px; color: #e6edf6; font: inherit; }
.bgp-search input:focus { outline: none; border-color: #4cc2ff; }
.bgp-x { background: transparent; border: 0; color: #7f93a9; font-size: 18px; line-height: 1; cursor: pointer; padding: 4px 6px; }
.bgp-x:hover { color: #e6edf6; }
.bgp-body { flex: 1; min-height: 0; display: flex; }
.bgp-rail { width: 168px; flex: none; border-right: 1px solid #22303f; padding: 10px 8px; overflow: auto; background: #0c121a; }
.bgp-rail button { display: block; width: 100%; text-align: left; padding: 6px 9px; margin-bottom: 2px; border: 0;
                   border-radius: 6px; background: transparent; color: #a8b9cc; font: inherit; cursor: pointer; }
.bgp-rail button:hover { background: #17222f; color: #e6edf6; }
.bgp-rail button.on { background: #17293a; color: #8fd3ff; font-weight: 600; }
.bgp-rail .bgp-railhead { padding: 10px 9px 4px; color: #5f7285; font-size: 10px; letter-spacing: .09em; text-transform: uppercase; }
.bgp-grid { flex: 1; min-width: 0; overflow: auto; padding: 12px; display: grid; gap: 10px;
            grid-template-columns: repeat(auto-fill, minmax(168px, 1fr)); align-content: start; }
.bgp-card { padding: 0; border: 1px solid #22303f; border-radius: 9px; background: #0a0f16; overflow: hidden;
            cursor: pointer; text-align: left; color: inherit; font: inherit; }
.bgp-card:hover { border-color: #3d5670; }
.bgp-card.on { border-color: #4cc2ff; box-shadow: 0 0 0 1px #4cc2ff inset; }
.bgp-card:focus-visible { outline: 2px solid #4cc2ff; outline-offset: 2px; }
.bgp-thumb { display: block; width: 100%; aspect-ratio: 16 / 10; object-fit: cover; background:
             repeating-conic-gradient(#131a23 0% 25%, #0d131b 0% 50%) 0 0 / 14px 14px; }
.bgp-cap { display: flex; align-items: center; gap: 6px; padding: 6px 8px; border-top: 1px solid #16202b; }
.bgp-cap b { font-weight: 600; font-size: 11px; }
.bgp-cap span { color: #6f8298; font-size: 10px; margin-left: auto; }
.bgp-side { width: 306px; flex: none; border-left: 1px solid #22303f; background: #0c121a; display: flex; flex-direction: column; }
.bgp-preview { padding: 12px 12px 0; }
.bgp-preview img { display: block; width: 100%; border: 1px solid #22303f; border-radius: 8px; background: #05090f; }
.bgp-empty { display: flex; align-items: center; justify-content: center; height: 150px; border: 1px dashed #2b3a4d;
             border-radius: 8px; color: #6f8298; }
.bgp-ctrls { flex: 1; min-height: 0; overflow: auto; padding: 12px; display: flex; flex-direction: column; gap: 10px; }
.bgp-sec { display: flex; flex-direction: column; gap: 6px; }
.bgp-sec > label { color: #5f7285; font-size: 10px; letter-spacing: .09em; text-transform: uppercase; }
.bgp-pals { display: flex; flex-wrap: wrap; gap: 5px; }
.bgp-pal { display: flex; width: 46px; height: 20px; border: 1px solid #2b3a4d; border-radius: 5px; overflow: hidden;
           padding: 0; cursor: pointer; background: none; }
.bgp-pal i { flex: 1; }
.bgp-pal.on { border-color: #4cc2ff; box-shadow: 0 0 0 1px #4cc2ff; }
.bgp-pal[disabled] { opacity: .3; cursor: not-allowed; }
.bgp-row { display: flex; align-items: center; gap: 8px; }
.bgp-row > label { flex: 1; color: #a8b9cc; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bgp-row output { width: 44px; text-align: right; color: #6f8298; font-variant-numeric: tabular-nums; font-size: 11px; }
.bgp-row input[type=range] { flex: 1.2; accent-color: #4cc2ff; }
.bgp-row input[type=color] { width: 30px; height: 22px; padding: 0; background: none; border: 1px solid #2b3a4d; border-radius: 4px; }
.bgp-row select, .bgp-row input[type=number] { background: #0a0f16; border: 1px solid #2b3a4d; border-radius: 5px;
                                               color: #e6edf6; font: inherit; padding: 3px 6px; }
.bgp-btn { background: #16202b; border: 1px solid #2b3a4d; border-radius: 6px; color: #cfe0f2; font: inherit;
           padding: 5px 10px; cursor: pointer; }
.bgp-btn:hover { background: #1d2a38; color: #fff; }
.bgp-btn.primary { background: #2f81f7; border-color: #2f81f7; color: #fff; font-weight: 600; }
.bgp-btn.primary:hover { background: #4b93fb; }
.bgp-btn.ghost { background: transparent; }
.bgp-foot { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-top: 1px solid #22303f; background: #111a25; }
.bgp-foot .bgp-sum { color: #7f93a9; margin-right: auto; font-size: 11px; }
.bgp-kbd { color: #52657a; font-size: 10px; margin-right: 10px; }
`;

let styleEl = null;
function ensureStyles() {
  if (styleEl) return;
  styleEl = document.createElement("style");
  styleEl.id = "bgPanelStyles";
  styleEl.textContent = CSS;
  document.head.appendChild(styleEl);
}

// ---- recents -------------------------------------------------------------
//
// The three or four backgrounds someone actually uses in a session are worth
// more than any curated list, so they get their own tab. Stored as specs, and
// read defensively: a corrupt or stale entry must not break the dialog.

function readRecents() {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
    return Array.isArray(raw) ? raw.map(normalizeBg).filter(Boolean) : [];
  } catch { return []; }
}

function pushRecent(spec) {
  const norm = normalizeBg(spec);
  if (!norm) return;
  const key = JSON.stringify([norm.tool, norm.params, norm.seed]);
  const kept = readRecents().filter((s) => JSON.stringify([s.tool, s.params, s.seed]) !== key);
  kept.unshift(norm);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(kept.slice(0, RECENT_MAX))); } catch { /* private mode */ }
}

// ---- the dialog ----------------------------------------------------------

let ui = null;      // the built DOM, reused across opens
let live = null;    // the open session: { spec, tab, query, aspect, resolve, … }

const el = (tag, cls, html) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (html !== undefined) node.innerHTML = html;
  return node;
};

function build() {
  ensureStyles();
  const root = el("div", "bgp-root");
  root.hidden = true;
  root.innerHTML = `
    <div class="bgp-shell" role="dialog" aria-modal="true" aria-label="Background">
      <div class="bgp-head">
        <div>
          <div class="bgp-title" data-t></div>
          <div class="bgp-sub">Pick a look, recolour it, shuffle the seed. Everything is vector — it scales and exports with the deck.</div>
        </div>
        <div class="bgp-search">
          <input type="search" placeholder="Search styles…  ( / )" data-q aria-label="Search background styles" />
        </div>
        <button class="bgp-x" title="Close (Esc)" data-close>&times;</button>
      </div>
      <div class="bgp-body">
        <div class="bgp-rail" data-rail></div>
        <div class="bgp-grid" data-grid></div>
        <div class="bgp-side">
          <div class="bgp-preview" data-preview></div>
          <div class="bgp-ctrls" data-ctrls></div>
        </div>
      </div>
      <div class="bgp-foot">
        <span class="bgp-sum" data-sum></span>
        <span class="bgp-kbd">Esc cancel · Ctrl+Enter apply</span>
        <button class="bgp-btn ghost" data-none>No background</button>
        <button class="bgp-btn" data-cancel>Cancel</button>
        <button class="bgp-btn primary" data-apply>Apply</button>
      </div>
    </div>`;
  document.body.appendChild(root);

  ui = {
    root,
    title: root.querySelector("[data-t]"),
    sub: root.querySelector(".bgp-sub"),
    query: root.querySelector("[data-q]"),
    rail: root.querySelector("[data-rail]"),
    grid: root.querySelector("[data-grid]"),
    preview: root.querySelector("[data-preview]"),
    ctrls: root.querySelector("[data-ctrls]"),
    sum: root.querySelector("[data-sum]"),
    none: root.querySelector("[data-none]"),
  };

  root.querySelector("[data-close]").addEventListener("click", () => finish(null));
  root.querySelector("[data-cancel]").addEventListener("click", () => finish(null));
  root.querySelector("[data-apply]").addEventListener("click", () => finish(live.spec));
  ui.none.addEventListener("click", () => finish("none"));
  // A click on the scrim is a cancel, the same as Escape; a click inside is not.
  root.addEventListener("mousedown", (ev) => { if (ev.target === root) finish(null); });
  ui.query.addEventListener("input", () => { live.query = ui.query.value; live.gridKey = null; renderRail(); refresh(); });
  root.addEventListener("keydown", onKey);
  return ui;
}

function onKey(ev) {
  if (!live) return;
  if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); finish(null); return; }
  if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); finish(live.spec); return; }
  if (ev.key === "/" && ev.target !== ui.query) { ev.preventDefault(); ui.query.focus(); ui.query.select(); return; }
  // Arrow keys walk the gallery, so a background can be chosen without ever
  // moving the mouse — and each step previews, exactly like clicking would.
  if (["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"].includes(ev.key) && ui.grid.contains(ev.target)) {
    const cards = [...ui.grid.querySelectorAll(".bgp-card")];
    const at = cards.indexOf(ev.target.closest(".bgp-card"));
    if (at < 0) return;
    const cols = Math.max(1, Math.round(ui.grid.clientWidth / (cards[0].offsetWidth + 10)));
    const step = ev.key === "ArrowRight" ? 1 : ev.key === "ArrowLeft" ? -1 : ev.key === "ArrowDown" ? cols : -cols;
    const next = cards[Math.min(cards.length - 1, Math.max(0, at + step))];
    if (next) { ev.preventDefault(); next.focus(); next.click(); }
  }
}

// ---- rendering the three columns ----------------------------------------

function tabs() {
  const list = [{ id: "looks", label: "Looks" }];
  if (readRecents().length) list.push({ id: "recent", label: "Recent" });
  const total = BG_TOOLS.filter((t) => !live.filter || live.filter(t)).length;
  list.push({ id: "all", label: `All styles (${total})` });
  return list;
}

function renderRail() {
  ui.rail.textContent = "";
  const add = (id, label) => {
    const b = el("button", live.tab === id ? "on" : "");
    b.textContent = label;
    b.addEventListener("click", () => { live.tab = id; live.gridKey = null; renderRail(); refresh(); });
    ui.rail.appendChild(b);
    return b;
  };
  for (const t of tabs()) add(t.id, t.label);
  const head = el("div", "bgp-railhead");
  head.textContent = "Families";
  ui.rail.appendChild(head);
  // A filtered host (the Scene editor) can empty a whole family; a heading that
  // leads to an empty grid is worse than no heading.
  const families = BG_CATEGORIES.filter((cat) => BG_TOOLS.some((t) => t.category === cat && (!live.filter || live.filter(t))));
  for (const cat of families) add(cat, cat);
}

// What the middle column shows for the current tab and search box: a list of
// { key, label, note, spec }. Looks and recents are whole specs; a family or a
// search result is a tool shown in the CURRENT spec's colours, so browsing
// never means guessing what a style would look like in your deck.
function entries() {
  const q = live.query.trim();
  const inQuery = (tool) => !q || searchBgTools(q).some((t) => t.id === tool);
  // A host can narrow the catalog (the Scene editor's importer only understands
  // flat vector paint, so it asks for the vector generators only). Filtering
  // here rather than in bgsvg.js keeps the catalog itself universal.
  const allowed = (toolId) => !live.filter || live.filter(bgTool(toolId));

  if (live.tab === "looks" && !q) {
    return BG_LOOKS.filter((look) => allowed(look.tool))
      .map((look) => ({ key: `look:${look.id}`, label: look.label, note: bgTool(look.tool).name, spec: look.spec }));
  }
  if (live.tab === "recent" && !q) {
    return readRecents().filter((spec) => allowed(spec.tool))
      .map((spec, i) => ({ key: `recent:${i}`, label: bgTool(spec.tool).name, note: `seed ${spec.seed}`, spec }));
  }
  const pool = BG_TOOLS.filter((t) => (live.tab === "all" || live.tab === "looks" || live.tab === "recent" || t.category === live.tab)
    && inQuery(t.id) && allowed(t.id));
  return pool.map((t) => ({
    key: `tool:${t.id}`,
    label: t.name,
    note: t.renderer,
    title: t.description,
    // Carry the current colours and seed across, so switching style keeps the
    // deck's palette instead of snapping back to the generator's demo colours.
    spec: recolourLike(live.spec, t.id),
  }));
}

// A spec for `toolId` that keeps whatever the current spec's palette and seed
// are. Colour controls are positional (see bgsvg.js), so this is just "same
// palette, new machine".
function recolourLike(spec, toolId) {
  const base = normalizeBg({ tool: toolId, seed: spec ? spec.seed : 1, opacity: spec ? spec.opacity : 1, params: {} });
  if (!spec || !spec.palette) {
    // No palette on record: lift the colours off the current spec in order.
    const from = spec ? bgControls(spec.tool).filter((c) => c.kind === "color") : [];
    if (!from.length) return base;
    const colors = from.map((c) => (spec.params[c.key] !== undefined ? spec.params[c.key] : c.value));
    return applyPalette(base, { id: "", name: "", colors });
  }
  return applyPalette(base, spec.palette);
}

const THUMB_W = 260;

function renderGrid() {
  ui.grid.textContent = "";
  const list = entries();
  if (!list.length) {
    ui.grid.appendChild(el("div", "bgp-empty", "Nothing matches that search."));
    return;
  }
  const thumbH = Math.round(THUMB_W / live.aspect);
  for (const entry of list) {
    const card = el("button", "bgp-card");
    card.type = "button";
    if (entry.title) card.title = entry.title;
    const img = el("img", "bgp-thumb");
    img.alt = entry.label;
    img.loading = "lazy";
    img.style.aspectRatio = `${live.aspect}`;
    img.dataset.src = bgDataUrl(entry.spec, THUMB_W, thumbH);
    const cap = el("div", "bgp-cap");
    const name = el("b");
    name.textContent = entry.label;
    const note = el("span");
    note.textContent = entry.note || "";
    cap.append(name, note);
    card.append(img, cap);
    if (live.spec && entry.spec.tool === live.spec.tool) card.classList.add("on");
    card.addEventListener("click", () => choose(entry.spec));
    ui.grid.appendChild(card);
    observer.observe(img);
  }
}

// Thumbnails are a few dozen filter-heavy SVGs; decoding them all on open makes
// the dialog stutter, so each one is only given its data URL when it scrolls
// into view.
const observer = new IntersectionObserver((records) => {
  for (const rec of records) {
    if (!rec.isIntersecting) continue;
    const img = rec.target;
    if (img.dataset.src) { img.src = img.dataset.src; delete img.dataset.src; }
    observer.unobserve(img);
  }
}, { rootMargin: "220px" });

function choose(spec) {
  live.spec = normalizeBg(spec);
  refresh();
}

// The whole right-hand column plus the footer summary. Cheap enough to rebuild
// wholesale on every change — the expensive part (the preview image) is one
// data URL, and the controls are a dozen inputs.
function refresh() {
  renderPreview();
  renderControls();
  ui.sum.textContent = live.spec ? bgSummary(live.spec) : "No background chosen yet.";
  // Recolouring repaints the whole gallery: the grid shows every style in the
  // colours you are working in, so a palette change that left 34 thumbnails in
  // the old scheme would be lying about all of them.
  const key = `${live.tab}|${live.query}|${live.spec ? live.spec.palette || "" : ""}|${live.spec ? JSON.stringify(live.spec.params) : ""}`;
  if (key !== live.gridKey) { live.gridKey = key; renderGrid(); }
  else markSelectedCard();
  if (live.onPreview) live.onPreview(live.spec);
}

// The gallery's selection is by STYLE, not by exact settings: after nudging a
// slider you are still on that style, and the card should keep saying so.
function markSelectedCard() {
  const list = entries();
  [...ui.grid.querySelectorAll(".bgp-card")].forEach((card, i) => {
    card.classList.toggle("on", !!(live.spec && list[i] && list[i].spec.tool === live.spec.tool));
  });
}

function renderPreview() {
  ui.preview.textContent = "";
  if (!live.spec) {
    ui.preview.appendChild(el("div", "bgp-empty", "No background"));
    return;
  }
  const w = 560, h = Math.round(560 / live.aspect);
  const img = el("img");
  img.alt = "Background preview";
  img.src = bgDataUrl(live.spec, w, h);
  ui.preview.appendChild(img);
}

function section(label) {
  const box = el("div", "bgp-sec");
  const cap = el("label");
  cap.textContent = label;
  box.appendChild(cap);
  return box;
}

function renderControls() {
  ui.ctrls.textContent = "";
  if (!live.spec) {
    const hint = el("div", "bgp-sub");
    hint.textContent = "Pick a style on the left to start.";
    ui.ctrls.appendChild(hint);
    return;
  }

  // Palettes first: recolouring is the edit people actually make.
  const hasColors = bgControls(live.spec.tool).some((c) => c.kind === "color");
  const pals = section(hasColors ? "Palette" : "Palette (this style sets its own hues)");
  const palRow = el("div", "bgp-pals");
  for (const pal of BG_PALETTES) {
    const b = el("button", live.spec.palette === pal.id ? "bgp-pal on" : "bgp-pal");
    b.type = "button";
    b.title = pal.name;
    b.disabled = !hasColors;
    for (const c of pal.colors) { const i = el("i"); i.style.background = c; b.appendChild(i); }
    b.addEventListener("click", () => choose(applyPalette(live.spec, pal)));
    palRow.appendChild(b);
  }
  pals.appendChild(palRow);
  ui.ctrls.appendChild(pals);

  // Seed + opacity: the two knobs that belong to the background rather than to
  // the generator, so they sit above the generated form.
  const shape = section("Variation");
  const seedRow = el("div", "bgp-row");
  const shuffle = el("button", "bgp-btn");
  shuffle.type = "button";
  shuffle.textContent = "Shuffle seed";
  shuffle.title = "Same style, different draw";
  shuffle.addEventListener("click", () => choose(reseedBg(live.spec)));
  const surprise = el("button", "bgp-btn");
  surprise.type = "button";
  surprise.textContent = "Surprise me";
  surprise.addEventListener("click", () => {
    // Random, but only from what this host can actually use, and always in a
    // fresh draw — "Surprise me" that repeats itself is not a surprise.
    const pool = live.filter ? entries() : null;
    if (!pool) { choose(randomBg()); return; }
    const pick = pool[Math.floor(Math.random() * pool.length)];
    if (pick) choose(reseedBg(pick.spec, Math.floor(Math.random() * 1e6)));
  });
  seedRow.append(shuffle, surprise);
  shape.appendChild(seedRow);
  shape.appendChild(rangeRow("Opacity", live.spec.opacity, 0.05, 1, 0.05, (v) => choose({ ...live.spec, opacity: v }), (v) => `${Math.round(v * 100)}%`));
  ui.ctrls.appendChild(shape);

  // …then the generator's own controls, exactly as it declared them.
  const form = section(`${bgTool(live.spec.tool).name} settings`);
  for (const control of bgControls(live.spec.tool)) form.appendChild(controlRow(control));
  const reset = el("button", "bgp-btn ghost");
  reset.type = "button";
  reset.textContent = "Reset settings";
  reset.addEventListener("click", () => choose({ ...live.spec, params: {} }));
  form.appendChild(reset);
  ui.ctrls.appendChild(form);
}

function rangeRow(label, value, min, max, step, onInput, fmt) {
  const row = el("div", "bgp-row");
  const cap = el("label");
  cap.textContent = label;
  const input = el("input");
  input.type = "range";
  input.min = min; input.max = max; input.step = step; input.value = value;
  const out = el("output");
  out.textContent = fmt ? fmt(value) : String(value);
  // `input` updates the readout only; the (re-rendering) commit waits for
  // `change`, so dragging a slider stays smooth on a filter-heavy generator.
  input.addEventListener("input", () => { out.textContent = fmt ? fmt(Number(input.value)) : input.value; });
  input.addEventListener("change", () => onInput(Number(input.value)));
  row.append(cap, input, out);
  return row;
}

function controlRow(control) {
  const current = live.spec.params[control.key] !== undefined ? live.spec.params[control.key] : control.value;
  const set = (v) => choose(withParam(live.spec, control.key, v));

  if (control.kind === "range") {
    const decimals = control.step < 1 ? (String(control.step).split(".")[1] || "").length : 0;
    return rangeRow(control.label, Number(current), control.min, control.max, control.step, set, (v) => v.toFixed(decimals));
  }
  const row = el("div", "bgp-row");
  const cap = el("label");
  cap.textContent = control.label;
  row.appendChild(cap);

  if (control.kind === "color") {
    const input = el("input");
    input.type = "color";
    input.value = String(current);
    // A colour input fires `input` per pixel of the OS picker; commit on
    // `change` (picker closed / value settled) for the same reason as ranges.
    input.addEventListener("change", () => set(input.value));
    row.appendChild(input);
  } else if (control.kind === "toggle") {
    const input = el("input");
    input.type = "checkbox";
    input.checked = current === true;
    input.addEventListener("change", () => set(input.checked));
    row.appendChild(input);
  } else if (control.kind === "select") {
    const sel = el("select");
    for (const opt of control.options) {
      const o = el("option");
      o.value = opt.value;
      o.textContent = opt.label;
      sel.appendChild(o);
    }
    sel.value = String(current);
    sel.addEventListener("change", () => set(sel.value));
    row.appendChild(sel);
  }
  return row;
}

// ---- open / close --------------------------------------------------------

function finish(result) {
  if (!live) return;
  const session = live;
  live = null;
  ui.root.hidden = true;
  if (session.onPreview) session.onPreview(result === null ? session.original : (result === "none" ? null : result));
  if (result && result !== "none") pushRecent(result);
  if (session.restoreFocus && session.restoreFocus.focus) session.restoreFocus.focus();
  session.resolve(result === "none" ? null : result);
}

/**
 * Open the background dialog.
 *
 * @param {object}   options
 * @param {object=}  options.spec      the background to open on (null for none)
 * @param {number=}  options.aspect    width / height of the surface it will fill
 * @param {string=}  options.title     dialog heading
 * @param {boolean=} options.allowNone offer "No background" (default true)
 * @param {function=} options.onPreview called with each browsed spec, and with
 *                    the original again if the dialog is cancelled
 * @returns {Promise<object|null>} the chosen spec, or null for
 *          cancelled/removed. Callers that need to tell those apart should
 *          compare against the spec they passed in.
 */
export function openBgPanel({ spec = null, aspect = 16 / 9, title = "Background", allowNone = true, onPreview = null, filter = null, note = "" } = {}) {
  if (!ui) build();
  if (live) finish(null);
  const original = normalizeBg(spec);
  return new Promise((resolve) => {
    live = {
      spec: original,
      original,
      tab: original ? "all" : "looks",
      query: "",
      aspect: aspect > 0 ? aspect : 16 / 9,
      onPreview,
      filter,
      resolve,
      restoreFocus: document.activeElement,
    };
    ui.title.textContent = title;
    ui.sub.textContent = note
      || "Pick a look, recolour it, shuffle the seed. Everything is vector — it scales and exports with the deck.";
    ui.query.value = "";
    ui.none.hidden = !allowNone;
    ui.root.hidden = false;
    renderRail();
    live.gridKey = null;
    refresh();
    // Focus lands on the search box: typing is the fastest way in, and Escape
    // still reaches the dialog's own handler from there.
    ui.query.focus();
  });
}

/** Is the dialog on screen? (Hosts use it to stand down their own shortcuts.) */
export const bgPanelOpen = () => !!live;
