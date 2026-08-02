// LittleA Editor — small DOM and math utilities.
//
// Pure/stateless helpers: they depend only on their arguments (and the live
// DOM for the geometry/download helpers), never on editor state.

// Shorthand for document.getElementById.
export const $ = (id) => document.getElementById(id);

// Short unique-ish id, matching the editors' `n`-prefixed node ids.
export const uid = () => "n" + Math.random().toString(36).slice(2, 8);

// Clamp `v` into the inclusive range [lo, hi].
export const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

// Round to 3 decimals (trims float noise from generated source).
export const r2 = (n) => Math.round(n * 1000) / 1000;

// Escape a string for interpolation into HTML text / XML attribute values.
// HTML-escape for the rare places that build markup as a string. Prefer
// `textContent`, which needs no escaping at all and is what the node list and
// the layer rows use; this exists for the one dialog that is a template.
//
// The apostrophe is escaped as well as the double quote. Nothing today
// interpolates into a single-quoted attribute, but an escaper that is correct
// only for the call sites that happen to exist is a trap for the next one.
export const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

// Seconds -> compact "M:SS.d" media duration (e.g. 83.4 -> "1:23.4").
export function fmtTime(s) { s = Math.max(0, s || 0); const m = Math.floor(s / 60), sec = s - m * 60; return m + ":" + (sec < 10 ? "0" : "") + sec.toFixed(1); }

// Normalise a user-supplied colour to a #rrggbb(aa) hex, expanding #rgb and
// falling back to the default fill for anything unparseable.
export function normHex(c) {
  c = (c || "").trim();
  if (/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(c)) return c;
  if (/^#([0-9a-fA-F]{3})$/.test(c)) return "#" + c.slice(1).split("").map((h) => h + h).join("");
  return "#0099FF";
}

// A flattened ellipse (48-gon) inscribed in a w×h box, local to its origin —
// the path `d` for an oval drawn with the Oval tool.
export function ellipseD(w, h) {
  const rx = w / 2, ry = h / 2, N = 48;
  let d = "";
  for (let i = 0; i < N; i++) {
    const t = (i / N) * Math.PI * 2;
    const px = Math.round((rx + rx * Math.cos(t)) * 100) / 100;
    const py = Math.round((ry + ry * Math.sin(t)) * 100) / 100;
    d += (i === 0 ? "M " : " L ") + px + " " + py;
  }
  return d + " Z";
}

// Trigger a browser download of `blob` under `name`.
export function download(name, blob) {
  const a = document.createElement("a");
  const url = URL.createObjectURL(blob);
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// Stage coordinates for a mouse event (handles CSS scaling of the canvas).
export function stageXY(ev) {
  const r = $("stage").getBoundingClientRect();
  const sx = $("stage").width / r.width;
  const sy = $("stage").height / r.height;
  return { x: (ev.clientX - r.left) * sx, y: (ev.clientY - r.top) * sy };
}

// CRC-32 (IEEE, reflected) over a byte array — the checksum the ZIP format
// records for each entry.
let CRC_TABLE;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; CRC_TABLE[n] = c >>> 0; }
  }
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xFF];
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// Build a store-only (uncompressed) ZIP Blob from `[{name, data:Uint8Array}]`.
// Enough to bundle a handful of small text files (a scene + its data rows +
// render scripts) for a single download — no dependency, deterministic byte
// layout. Mirrors the movie editor's in-page packer.
export function zipStore(entries) {
  const enc = new TextEncoder();
  const u16 = (n) => { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, n & 0xffff, true); return b; };
  const u32 = (n) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n >>> 0, true); return b; };
  const cat = (a) => { let len = 0; for (const x of a) len += x.length; const o = new Uint8Array(len); let p = 0; for (const x of a) { o.set(x, p); p += x.length; } return o; };
  const locals = [], centrals = []; let offset = 0;
  for (const e of entries) {
    const name = enc.encode(e.name), crc = crc32(e.data), size = e.data.length;
    const local = cat([u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(size), u32(size), u16(name.length), u16(0), name, e.data]);
    locals.push(local);
    centrals.push(cat([u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(size), u32(size), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name]));
    offset += local.length;
  }
  let cdSize = 0; for (const c of centrals) cdSize += c.length;
  const end = cat([u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length), u32(cdSize), u32(offset), u16(0)]);
  return new Blob([...locals, ...centrals, end], { type: "application/zip" });
}
