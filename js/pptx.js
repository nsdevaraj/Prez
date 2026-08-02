// LittleA Editor — deck -> PowerPoint (.pptx).
//
// One PPTX slide per frame, in path order: the zooming deck flattened into the
// linear flow PowerPoint understands. The camera cannot come along — a .pptx has
// no notion of one continuous canvas — so each frame is exported as the still it
// settles on, which is exactly what a slide is.
//
// Nothing is rasterized here either. Every path primitive becomes a DrawingML
// `<a:custGeom>` shape and every text run becomes a real PowerPoint text run, so
// the deck lands as NATIVE, EDITABLE PowerPoint objects: recolour a card, retype
// a label, drag a connector. That is the whole reason this is worth writing
// rather than pasting in an image — a picture of a diagram is not a diagram.
//
// The one thing that cannot be exact is text placement. textsvg.js positions
// every glyph with the RENDERER's own advance table; PowerPoint lays text out
// with whatever font it actually has. So a run is handed over as text plus the
// box we measured for it, vertically centred and (for centred runs) horizontally
// centred inside that box — which keeps it in the right place even when the font
// is substituted, at the cost of not being glyph-identical to the canvas. Text
// that stayed text is worth a fraction of a point of drift.
//
//   const blob = deckToPptx({ slides, projW, projH, paper, title });
//
// `slides` is `[{ name, view: { vw, vh, parts }, bg, bgOn }]` — the same
// `graphicParts()` output the canvas and the .lax export draw from.

import { esc, zipStore } from "./util.js";
import { BASELINE } from "./textsvg.js";

// English Metric Units: the unit every OOXML coordinate is in.
const EMU_PER_INCH = 914400;
const EMU_PER_POINT = 12700;
// 7.5in tall is the height of every standard PowerPoint slide, 4:3 and 16:9
// alike; only the width changes with the aspect.
const SLIDE_H = Math.round(7.5 * EMU_PER_INCH);

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS_P = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"'
  + ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
  + ' xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const NS_A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
const NS_REL = 'xmlns="http://schemas.openxmlformats.org/package/2006/relationships"';
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
// Core properties are the one relationship that hangs off the PACKAGE namespace
// rather than the officeDocument one; getting it wrong makes the file open with
// no title and, in stricter readers, not at all.
const REL_CORE = "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties";
const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

const enc = new TextEncoder();
const file = (name, text) => ({ name, data: enc.encode(text) });
const emu = (n) => Math.round(n);

/**
 * A colour as DrawingML wants it: six hex digits, plus an `<a:alpha>` child when
 * the source carried an eighth pair. Anything unparseable falls back to black,
 * because a shape with no fill colour is a shape PowerPoint will not open.
 */
function colorEl(css, tag) {
  const s = String(css || "").trim();
  const m = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(s);
  const rgb = m ? m[1].toUpperCase() : "000000";
  const a = m && m[2] ? Math.round((parseInt(m[2], 16) / 255) * 100000) : null;
  const inner = a === null ? "" : `<a:alpha val="${a}"/>`;
  return `<${tag}><a:srgbClr val="${rgb}">${inner}</a:srgbClr></${tag}>`;
}

/**
 * Parse the path grammar textsvg.js emits.
 *
 * It is deliberately tiny — absolute `M`/`L`/`C`/`Z` with plain numbers, no arcs
 * and no relative commands (see `translateD`'s note on why that stays true) — so
 * this needs no general SVG path engine, and anything outside that grammar is a
 * bug worth failing loudly on rather than guessing at.
 */
function parsePath(d) {
  const ops = [];
  const re = /([MLCZ])([^MLCZ]*)/gi;
  let m;
  while ((m = re.exec(String(d)))) {
    const cmd = m[1].toUpperCase();
    const nums = (m[2].match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) || []).map(Number);
    ops.push({ cmd, nums });
  }
  return ops;
}

// Every point a path visits, for its bounding box.
function pathPoints(ops) {
  const pts = [];
  for (const op of ops) {
    for (let i = 0; i + 1 < op.nums.length; i += 2) pts.push([op.nums[i], op.nums[i + 1]]);
  }
  return pts;
}

/**
 * One path primitive as a `<p:sp>` with a custom geometry.
 *
 * A custGeom's points live in the shape's OWN box, so the box is the primitive's
 * bounding box and every coordinate is written relative to it. Degenerate boxes
 * (a perfectly horizontal connector has zero height) are widened to a single EMU
 * — PowerPoint will not render a shape with a zero extent.
 */
function pathShape(prim, id, k) {
  const ops = parsePath(prim.d);
  const pts = pathPoints(ops);
  if (!pts.length) return "";

  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs), minY = Math.min(...ys);
  const x0 = emu(minX * k), y0 = emu(minY * k);
  const w = Math.max(1, emu((Math.max(...xs) - minX) * k));
  const h = Math.max(1, emu((Math.max(...ys) - minY) * k));

  const pt = (px, py) => `<a:pt x="${emu(px * k) - x0}" y="${emu(py * k) - y0}"/>`;
  let body = "";
  for (const op of ops) {
    const n = op.nums;
    if (op.cmd === "M") body += `<a:moveTo>${pt(n[0], n[1])}</a:moveTo>`;
    else if (op.cmd === "L") {
      for (let i = 0; i + 1 < n.length; i += 2) body += `<a:lnTo>${pt(n[i], n[i + 1])}</a:lnTo>`;
    } else if (op.cmd === "C") {
      for (let i = 0; i + 5 < n.length; i += 6) {
        body += `<a:cubicBezTo>${pt(n[i], n[i + 1])}${pt(n[i + 2], n[i + 3])}${pt(n[i + 4], n[i + 5])}</a:cubicBezTo>`;
      }
    } else if (op.cmd === "Z") body += "<a:close/>";
  }

  const fill = prim.fill ? colorEl(prim.fill, "a:solidFill") : "<a:noFill/>";
  let ln = "<a:ln><a:noFill/></a:ln>";
  if (prim.stroke && prim.strokeWidth) {
    const cap = prim.cap === "round" ? ' cap="rnd"' : "";
    const dash = prim.dash ? '<a:prstDash val="dash"/>' : "";
    ln = `<a:ln w="${Math.max(0, emu(prim.strokeWidth * k))}"${cap}>`
      + `${colorEl(prim.stroke, "a:solidFill")}${dash}</a:ln>`;
  }

  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Path ${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>`
    + `<p:spPr><a:xfrm><a:off x="${x0}" y="${y0}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm>`
    + `<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="${w}" b="${h}"/>`
    + `<a:pathLst><a:path w="${w}" h="${h}">${body}</a:path></a:pathLst></a:custGeom>`
    + `${fill}${ln}</p:spPr>`
    + `<p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody></p:sp>`;
}

/**
 * One text primitive as a real PowerPoint run.
 *
 * The box is the run's measured advance by its own em box, and the text is
 * anchored to the box's CENTRE rather than its top-left. Centring both ways is
 * what keeps a label in place when PowerPoint substitutes a font whose metrics
 * differ from the renderer's: the box is ours, the glyphs inside it are theirs.
 */
function textShape(prim, id, k, ptPerUnit) {
  const text = String(prim.text ?? "");
  if (!text.trim()) return "";

  const size = prim.size || 15;
  const wUnits = prim.w || size * text.length * 0.5;
  // The em box we drew into: its top is the baseline less the ascent.
  const emTop = prim.y - size * BASELINE;
  const boxH = size * 1.6;
  const cy = emTop + size / 2;

  const x0 = emu(prim.x * k);
  const y0 = emu((cy - boxH / 2) * k);
  const cx = Math.max(1, emu(wUnits * k));
  const h = Math.max(1, emu(boxH * k));
  const sz = Math.max(100, Math.round(size * ptPerUnit * 100));
  const algn = prim.align === "center" ? "ctr" : "l";

  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Text ${id}"/>`
    + `<p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>`
    + `<p:spPr><a:xfrm><a:off x="${x0}" y="${y0}"/><a:ext cx="${cx}" cy="${h}"/></a:xfrm>`
    + `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>`
    + `<p:txBody>`
    + `<a:bodyPr wrap="none" lIns="0" tIns="0" rIns="0" bIns="0" anchor="ctr"><a:spAutoFit/></a:bodyPr>`
    + `<a:lstStyle/>`
    + `<a:p><a:pPr algn="${algn}"/>`
    + `<a:r><a:rPr lang="en-US" sz="${sz}" dirty="0">${colorEl(prim.color, "a:solidFill")}`
    + `<a:latin typeface="Inter"/><a:cs typeface="Inter"/></a:rPr>`
    + `<a:t>${esc(text)}</a:t></a:r></a:p>`
    + `</p:txBody></p:sp>`;
}

// The empty group every spTree opens with.
const SP_TREE_HEAD = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>'
  + '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/>'
  + '<a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';

/** One slide: its background, then every part's primitives in paint order. */
function slideXml(slide, slideW) {
  const view = slide.view;
  const vw = Math.max(1, view.vw);
  // The frame is laid out at the presentation's own aspect, so one scale serves
  // both axes and nothing is stretched on the way into PowerPoint.
  const k = slideW / vw;
  const ptPerUnit = slideW / EMU_PER_POINT / vw;

  let id = 2, shapes = "";
  for (const part of view.parts || []) {
    for (const prim of part.prims || []) {
      const xml = prim.t === "text" ? textShape(prim, id, k, ptPerUnit) : pathShape(prim, id, k);
      if (xml) { shapes += xml; id += 1; }
    }
  }

  // A slide IS the frame, so the card the canvas draws behind the diagram is
  // simply this slide's background.
  const bg = `<p:bg><p:bgPr>${colorEl(slide.bg, "a:solidFill")}<a:effectLst/></p:bgPr></p:bg>`;

  return XML_HEAD
    + `<p:sld ${NS_P}><p:cSld>${bg}<p:spTree>${SP_TREE_HEAD}${shapes}</p:spTree></p:cSld>`
    + `<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
}

// A theme is not optional: the slide master refers to one, and PowerPoint
// refuses a package whose master has nothing to resolve its styles against.
function themeXml() {
  const accents = ["6366F1", "0EA5E9", "10B981", "F59E0B", "EF4444", "8B5CF6"];
  const fill = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>';
  const line = `<a:ln w="9525" cap="flat" cmpd="sng" algn="ctr">${fill}<a:prstDash val="solid"/></a:ln>`;
  return XML_HEAD
    + `<a:theme ${NS_A} name="LittleA"><a:themeElements>`
    + `<a:clrScheme name="LittleA">`
    + `<a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>`
    + `<a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>`
    + `<a:dk2><a:srgbClr val="0F172A"/></a:dk2><a:lt2><a:srgbClr val="E2E8F0"/></a:lt2>`
    + accents.map((c, i) => `<a:accent${i + 1}><a:srgbClr val="${c}"/></a:accent${i + 1}>`).join("")
    + `<a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink>`
    + `</a:clrScheme>`
    + `<a:fontScheme name="LittleA">`
    + `<a:majorFont><a:latin typeface="Inter"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>`
    + `<a:minorFont><a:latin typeface="Inter"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont>`
    + `</a:fontScheme>`
    // Each of these lists must carry exactly three entries; PowerPoint indexes
    // into them by position rather than by name.
    + `<a:fmtScheme name="LittleA">`
    + `<a:fillStyleLst>${fill}${fill}${fill}</a:fillStyleLst>`
    + `<a:lnStyleLst>${line}${line}${line}</a:lnStyleLst>`
    + `<a:effectStyleLst>`
    + `<a:effectStyle><a:effectLst/></a:effectStyle>`
    + `<a:effectStyle><a:effectLst/></a:effectStyle>`
    + `<a:effectStyle><a:effectLst/></a:effectStyle>`
    + `</a:effectStyleLst>`
    + `<a:bgFillStyleLst>${fill}${fill}${fill}</a:bgFillStyleLst>`
    + `</a:fmtScheme></a:themeElements></a:theme>`;
}

function masterXml() {
  return XML_HEAD
    + `<p:sldMaster ${NS_P}><p:cSld><p:spTree>${SP_TREE_HEAD}</p:spTree></p:cSld>`
    + `<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2"`
    + ` accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6"`
    + ` hlink="hlink" folHlink="folHlink"/>`
    + `<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>`
    + `</p:sldMaster>`;
}

function layoutXml() {
  return XML_HEAD
    + `<p:sldLayout ${NS_P} type="blank" preserve="1">`
    + `<p:cSld name="Blank"><p:spTree>${SP_TREE_HEAD}</p:spTree></p:cSld>`
    + `<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;
}

const rels = (list) => XML_HEAD + `<Relationships ${NS_REL}>`
  + list.map((r) => {
    const type = r.absType || `${REL}/${r.type}`;
    return `<Relationship Id="${r.id}" Type="${type}" Target="${r.target}"/>`;
  }).join("")
  + `</Relationships>`;

/**
 * Build the .pptx for a deck.
 *
 *   deckToPptx({ slides, projW, projH, paper, title }) -> Blob
 *
 * Slides are emitted in the order given — the deck's path order, which is the
 * order the camera would have flown. Slides that failed to generate are the
 * caller's to filter out; anything here without a `view` is skipped rather than
 * producing an empty slide nobody asked for.
 */
export function deckToPptx({ slides, projW = 1920, projH = 1080, paper = "#FFFFFF", title = "deck" }) {
  const usable = (slides || []).filter((s) => s && s.view && (s.view.parts || []).length >= 0 && s.view.vw > 0);
  const slideW = Math.max(1, Math.round(SLIDE_H * (projW / Math.max(1, projH))));

  const parts = [];
  const slideOverrides = [];
  const presRels = [{ id: "rId1", type: "slideMaster", target: "slideMasters/slideMaster1.xml" }];
  const sldIds = [];

  usable.forEach((s, i) => {
    const n = i + 1;
    // A transparent card means the deck's paper shows through; on a slide, that
    // paper is the slide itself.
    const bg = s.bgOn === false ? paper : (s.bg || "#FFFFFF");
    parts.push(file(`ppt/slides/slide${n}.xml`, slideXml({ ...s, bg }, slideW)));
    parts.push(file(`ppt/slides/_rels/slide${n}.xml.rels`,
      rels([{ id: "rId1", type: "slideLayout", target: "../slideLayouts/slideLayout1.xml" }])));
    slideOverrides.push(`<Override PartName="/ppt/slides/slide${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`);
    presRels.push({ id: `rId${n + 1}`, type: "slide", target: `slides/slide${n}.xml` });
    sldIds.push(`<p:sldId id="${255 + n}" r:id="rId${n + 1}"/>`);
  });

  const presentation = XML_HEAD
    + `<p:presentation ${NS_P} saveSubsetFonts="1">`
    + `<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>`
    + `<p:sldIdLst>${sldIds.join("")}</p:sldIdLst>`
    + `<p:sldSz cx="${slideW}" cy="${SLIDE_H}"/>`
    + `<p:notesSz cx="${SLIDE_H}" cy="${slideW}"/>`
    + `</p:presentation>`;

  const contentTypes = XML_HEAD
    + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
    + `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`
    + `<Default Extension="xml" ContentType="application/xml"/>`
    + `<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>`
    + `<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>`
    + `<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>`
    + `<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>`
    + `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>`
    + `<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>`
    + slideOverrides.join("")
    + `</Types>`;

  const core = XML_HEAD
    + `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"`
    + ` xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/"`
    + ` xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">`
    + `<dc:title>${esc(title)}</dc:title>`
    + `<dc:creator>LittleA Presentation</dc:creator>`
    + `<cp:lastModifiedBy>LittleA Presentation</cp:lastModifiedBy>`
    + `</cp:coreProperties>`;

  const app = XML_HEAD
    + `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"`
    + ` xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">`
    + `<Application>LittleA Presentation</Application>`
    + `<Slides>${usable.length}</Slides>`
    + `</Properties>`;

  const zip = zipStore([
    file("[Content_Types].xml", contentTypes),
    file("_rels/.rels", rels([
      { id: "rId1", type: "officeDocument", target: "ppt/presentation.xml" },
      { id: "rId2", absType: REL_CORE, target: "docProps/core.xml" },
      { id: "rId3", type: "extended-properties", target: "docProps/app.xml" },
    ])),
    file("docProps/core.xml", core),
    file("docProps/app.xml", app),
    file("ppt/presentation.xml", presentation),
    file("ppt/_rels/presentation.xml.rels", rels(presRels.concat([
      { id: `rId${presRels.length + 1}`, type: "theme", target: "theme/theme1.xml" },
    ]))),
    file("ppt/slideMasters/slideMaster1.xml", masterXml()),
    file("ppt/slideMasters/_rels/slideMaster1.xml.rels", rels([
      { id: "rId1", type: "slideLayout", target: "../slideLayouts/slideLayout1.xml" },
      { id: "rId2", type: "theme", target: "../theme/theme1.xml" },
    ])),
    file("ppt/slideLayouts/slideLayout1.xml", layoutXml()),
    file("ppt/slideLayouts/_rels/slideLayout1.xml.rels", rels([
      { id: "rId1", type: "slideMaster", target: "../slideMasters/slideMaster1.xml" },
    ])),
    file("ppt/theme/theme1.xml", themeXml()),
    ...parts,
  ]);
  // zipStore hands back a generic archive; a .pptx is that archive under its own
  // media type, which is what makes the browser (and the OS) hand it to
  // PowerPoint rather than to an unzipper.
  return new Blob([zip], { type: PPTX_MIME });
}
