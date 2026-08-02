// LittleA Editor — text -> SVG diagram generation.
//
// A dependency-free, deterministic pipeline that turns a few lines of typed
// text into a laid-out vector diagram:
//
//   raw text
//     -> plainTextToCheatsheet()      (normalizer)         -> DSL text
//     -> tokenize()      (lexer)                           -> Token[]
//     -> parse()         (indent/arrow DSL)                -> ParseTree
//        or proseParse() (sentence heuristic)              -> ParseTree
//     -> reshapeForStructure()  (for a hand-picked layout) -> ParseTree
//     -> buildGraph()    (classifier)                      -> Graph (nodes + edges)
//     -> applyLayout()   (layered/radial/matrix/...)       -> Graph with x/y/w/h
//     -> exportSvg()                                       -> standalone SVG string
//
// Plain prose is not handed to a second, weaker parser: it is rewritten as the
// cheatsheet syntax and fed to the SAME one, which is why the editor can show
// that rewrite ("Convert to cheatsheet") and never disagree with it.
//
// Choosing a layout by hand re-reads the text for it. A layout implies a
// structure, so reshapeForStructure() synthesises exactly the relationships the
// target needs — comparison sides, a cycle chain, weights, a centre, nesting —
// and nothing more; existing arrows, `vs` pairs and indentation always survive.
//
// Everything here is pure: same text + same preset => byte-identical SVG, which
// is what lets the movie editor rasterize a title card once and hand the
// deterministic exporter a stable PNG.

// ---------------------------------------------------------------------------
// tokenizer
// ---------------------------------------------------------------------------

const ARROW_RE = /\s*(?:->|→|=>|-->)\s*/;
const VS_RE = /\s+(?:vs\.?|versus)\s+/i;
const BULLET_RE = /^(\s*)(?:[-*•]|\d+[.)])\s+(.*)$/;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;

// A run of leading whitespace in "levels" (2 spaces or 1 tab = 1 level).
function indentLevels(ws) {
  let cols = 0;
  for (const ch of ws) cols += ch === "\t" ? 2 : 1;
  return Math.floor(cols / 2);
}

// Classify each line: heading, bullet/plain item, "A -> B" flow or "A vs B".
export function tokenize(input) {
  const lines = String(input ?? "").replace(/\r\n?/g, "\n").split("\n");
  const tokens = [];
  lines.forEach((raw, i) => {
    const lineNo = i + 1;
    if (raw.trim() === "") { tokens.push({ type: "blank", indent: 0, text: "", lineNo }); return; }

    const leadingWs = (raw.match(/^(\s*)/) || ["", ""])[1];
    let indent = indentLevels(leadingWs);

    const heading = raw.match(HEADING_RE);
    if (heading) { tokens.push({ type: "root", indent: 0, text: heading[2].trim(), lineNo }); return; }

    let body = raw.trim(), ordered = false;
    const bullet = raw.match(BULLET_RE);
    if (bullet) { indent = indentLevels(bullet[1]); body = bullet[2].trim(); ordered = /\d+[.)]/.test(raw.trim().slice(0, 3)); }

    if (ARROW_RE.test(body)) {
      const operands = body.split(ARROW_RE).map((s) => s.trim()).filter(Boolean);
      if (operands.length >= 2) { tokens.push({ type: "arrow", indent, text: body, operands, lineNo }); return; }
    }
    if (VS_RE.test(body)) {
      const operands = body.split(VS_RE).map((s) => s.trim()).filter(Boolean);
      if (operands.length === 2) { tokens.push({ type: "vs", indent, text: body, operands, lineNo }); return; }
    }
    tokens.push({ type: "item", indent, text: body, ordered, lineNo });
  });
  return tokens;
}

// ---------------------------------------------------------------------------
// parser
// ---------------------------------------------------------------------------

// A human label as a stable id fragment.
export function slugify(label) {
  const base = String(label).toLowerCase().trim()
    .replace(/['"`]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return base || "node";
}

// Unique ids within one parse run (collisions get a numeric suffix).
function idFactory() {
  const seen = new Map();
  return (label) => {
    const base = slugify(label), n = seen.get(base) || 0;
    seen.set(base, n + 1);
    return n === 0 ? base : `${base}-${n + 1}`;
  };
}

// "Label: detail" -> [label, detail?]; leaves URLs and clock times alone.
export function splitDetail(text) {
  const s = String(text);
  const idx = s.indexOf(":");
  if (idx > 0 && idx < s.length - 1) {
    const label = s.slice(0, idx).trim(), detail = s.slice(idx + 1).trim();
    if (label && !/^\d+$/.test(label) && !/^https?$/i.test(label)) return [label, detail || undefined];
  }
  return [s.trim(), undefined];
}

/**
 * Structured ("DSL") parse. Every marker is optional:
 *   # Title            diagram title
 *   - item             a concept (bullet, number or a bare line)
 *   1. item            an ordered concept (implies steps / sequence)
 *     - child          nesting by indentation (2 spaces / 1 tab)
 *   Label: detail      concept with a supporting description
 *   A -> B -> C        a directed flow chain
 *   A vs B             a comparison
 */
export function parse(input) {
  const tokens = tokenize(input);
  const makeId = idFactory();
  const registry = {};
  const byName = new Map();
  const roots = [], flows = [], comparisons = [], stack = [];
  let title, hasExplicitStructure = false, sawOrdered = false;

  const createNode = (label, detail, level, ordered) => {
    const id = makeId(label);
    const node = { id, label, description: detail, children: [], level, ordered };
    registry[id] = node;
    const slug = slugify(label);
    if (!byName.has(slug)) byName.set(slug, id);
    return node;
  };
  const getOrCreate = (label) => {
    const existing = byName.get(slugify(label));
    return existing ? registry[existing] : createNode(label, undefined, 0);
  };
  const attachByIndent = (node, indent) => {
    while (stack.length > indent) stack.pop();
    const parent = stack[indent - 1];
    if (parent && indent > 0) { node.level = parent.level + 1; parent.children.push(node); }
    else { node.level = 0; roots.push(node); }
    stack[indent] = node;
    stack.length = indent + 1;
  };

  for (const tok of tokens) {
    if (tok.type === "root") {
      if (!title) title = tok.text;
      else {
        const [label, detail] = splitDetail(tok.text);
        const node = createNode(label, detail, 0);
        roots.push(node); stack.length = 0; stack[0] = node;
      }
    } else if (tok.type === "item") {
      const [label, detail] = splitDetail(tok.text);
      if (tok.ordered) sawOrdered = true;
      attachByIndent(createNode(label, detail, tok.indent, tok.ordered), tok.indent);
    } else if (tok.type === "arrow") {
      hasExplicitStructure = true;
      const chain = (tok.operands || []).map((op) => getOrCreate(splitDetail(op)[0]).id);
      if (chain.length >= 2) flows.push(chain);
    } else if (tok.type === "vs") {
      hasExplicitStructure = true;
      const [a, b] = tok.operands || [];
      if (a && b) {
        const na = getOrCreate(splitDetail(a)[0]), nb = getOrCreate(splitDetail(b)[0]);
        na.description = na.description ?? splitDetail(a)[1];
        nb.description = nb.description ?? splitDetail(b)[1];
        comparisons.push([na.id, nb.id]);
      }
    }
  }
  if (roots.some((r) => r.children.length > 0)) hasExplicitStructure = true;
  return { title, roots, flows, comparisons, registry, hasExplicitStructure: hasExplicitStructure || sawOrdered };
}

// ---- prose ---------------------------------------------------------------

// Sentence openers that signal an ordered sequence.
const SEQ_START = /^(first(ly)?|second(ly)?|third(ly)?|fourth(ly)?|then|next|after that|afterwards?|finally|lastly|subsequently|initially|to start|to begin)\b[,:]?\s*/i;
// Connectors that split one sentence into a cause -> effect flow.
const CAUSAL = /\s+(?:leads?\s+to|results?\s+in|causes?|drives?|enables?|triggers?|produces?|feeds?\s+into|therefore|thus|hence|and then|which then|so)\s+/i;
// Words signalling a comparison between two things.
const COMPARE = /\s+(?:vs\.?|versus|compared\s+(?:to|with)|whereas|unlike|as\s+opposed\s+to)\s+/i;
// Leading filler dropped when a clause becomes a node label.
const LEAD_FILLER = /^(?:the|a|an|this|that|these|those|we|it|they|our|your|its|their|is|are|was|were)\s+/i;

const capitalize = (s) => (s.length ? s[0].toUpperCase() + s.slice(1) : s);

// A short, clean label for a clause: drop filler and punctuation, keep <= 5 words.
function phraseOf(clause) {
  let cleaned = String(clause).replace(/[.,;:!?]+$/g, "").trim();
  while (LEAD_FILLER.test(cleaned)) cleaned = cleaned.replace(LEAD_FILLER, "");
  const words = cleaned.split(/\s+/).filter(Boolean).slice(0, 5).join(" ");
  return capitalize(words || String(clause).trim());
}

/**
 * Freeform-prose parse. Splits on sentence boundaries and reads the same three
 * cues the DSL spells out explicitly: comparison, cause -> effect and ordered
 * steps. Heuristic but deterministic — no NLP model, no network.
 */
export function proseParse(input) {
  const makeId = idFactory();
  const registry = {}, roots = [], flows = [], comparisons = [];
  const make = (label, description) => {
    const id = makeId(label);
    registry[id] = { id, label, description, children: [], level: 0 };
    return registry[id];
  };

  const sentences = String(input ?? "")
    .split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
  const sequence = [];
  let orderedCount = 0;

  for (const sentence of sentences) {
    if (COMPARE.test(sentence)) {
      const [left, right] = sentence.split(COMPARE);
      if (left && right) { comparisons.push([make(phraseOf(left)).id, make(phraseOf(right)).id]); continue; }
    }
    if (CAUSAL.test(sentence)) {
      const segs = sentence.split(CAUSAL).map((s) => s.trim()).filter(Boolean);
      if (segs.length >= 2) { flows.push(segs.map((seg) => make(phraseOf(seg)).id)); continue; }
    }
    if (SEQ_START.test(sentence)) orderedCount += 1;
    const body = sentence.replace(SEQ_START, "");
    const label = phraseOf(body);
    const description = body.length > label.length + 4 ? capitalize(body.replace(/[.,;:!?]+$/g, "")) : undefined;
    sequence.push(make(label, description).id);
  }

  const hasSequence = orderedCount >= 2 && sequence.length >= 2;
  for (const id of sequence) { if (hasSequence) registry[id].ordered = true; roots.push(registry[id]); }
  return {
    title: undefined, roots, flows, comparisons, registry,
    hasExplicitStructure: flows.length > 0 || comparisons.length > 0 || hasSequence,
  };
}

// True when the text reads as sentences rather than the bullet/arrow DSL.
export function looksLikeProse(input) {
  const lines = String(input ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return false;
  const structured = lines.filter((l) => /^(#{1,6}\s|[-*•]\s|\d+[.)]\s)/.test(l) || /->|→|=>|\bvs\b/i.test(l)).length;
  const prose = lines.filter((l) => /\s\w+\s\w+\s\w+/.test(l)).length;
  return structured / lines.length < 0.3 && prose > 0;
}

// ---------------------------------------------------------------------------
// prose -> a themed mind-map outline
// ---------------------------------------------------------------------------
//
// The "explain a paragraph as a diagram" path. Fully offline and deterministic:
// every branch name and every leaf is EXTRACTED from words that actually occur
// in the text (a keyword lexicon plus noun-phrase heuristics). Nothing is
// invented and nothing is summarised abstractively, because a generator that
// paraphrases is a generator you cannot trust with someone else's slide.
//
//   paragraph
//     -> sentences -> clauses
//     -> clause theme     (keyword lexicon, else the head noun phrase)
//     -> clause concepts  (the list after "such as" / "including" / ...)
//     -> "# Center" + "- Theme" + "  - Concept"

/** Keyword -> branch name. First match wins, so order matters. */
const THEME_LEXICON = [
  [/\brank(ing|ed|s)?\b|\bnirf\b|evaluation|assessment|\bscore/i, "National Rankings"],
  [/infrastructur|laborator|librar|campus facilit|building|hostel/i, "Infrastructure"],
  [/\bprogram|\bdegree|curricul|\bcourse|\bph\.?d\b|\bbs-?ms\b|admission/i, "Academic Programs"],
  [/placement|recruit|\bjob\b|career|salary|package/i, "Placements"],
  [/research|higher stud|scientific|publication|innovation lab/i, "Research Focus"],
  [/campus (activit|life|event)|festival|fest\b|club|community engagement|cultural/i, "Campus Activities"],
  [/faculty|professor|teaching staff|mentor/i, "Faculty"],
  [/student|alumni|peer/i, "Student Life"],
  [/fee|cost|scholarship|funding|budget/i, "Fees & Funding"],
  [/location|city|situated|campus is|acres/i, "Location"],
];

// Sentences that talk about the document rather than the subject.
const META_RE = /\b(the )?(provided |these |those )?(sources?|documents?|articles?|text|passage|excerpts?)\b|^overall\b|^in summary\b|^to summari[sz]e\b/i;
// Words that introduce a list of concrete concepts.
const ENUM_TRIGGER = /\b(such as|including|includes|include|like|offering|offers|offer|featuring|features|provides|providing|prioriti[sz]es|prioriti[sz]ing|comprises|comprising|consists of|namely|highlighting|emphasi[sz]ing|with)\b/i;
// Words that end an enumeration, because a new prepositional idea starts.
const ENUM_STOP = /\b(across|over|through|throughout|while|whereas|rather than|instead of|due to|because|so that|in order to|within|under|among)\b/i;
// Clause separators inside one sentence.
const CLAUSE_SPLIT = /,\s*(?:while\s+\w+ing|while|whereas|and also|but also|although|though)\s+|;\s*/i;
// Text after a contrast marker names what is being DE-prioritised, so it must
// not drive the branch name.
const CONTRAST_TAIL = /\b(?:over|rather than|instead of|as opposed to)\b[\s\S]*$/i;
// An ordinal fact worth keeping as its own concept ("70th overall" -> a rank).
const ORDINAL_FACT = /\b(\d+(?:st|nd|rd|th))\s+(overall|rank\w*|position|place)\b/i;

const STOP_LEAD = /^(?:the|a|an|its|their|his|her|our|this|that|these|those|some|many|several|various|other|such|more|most|strong|traditional|highlighting|emphasi[sz]ing|noting|showing|demonstrating|featuring|including)\s+/i;
const TRAIL_PREP = /\s+(?:of|in|at|to|for|with|on|by|from|and|or|as|the|a|an)$/i;
const REL_CLAUSE_LEAD = /^(?:which|that|who|whom|whose)\s+\S+\s+/i;
// Words a head phrase must not start with — verbs and function words carry no
// subject, and a branch named "Has" helps nobody.
const NOT_A_HEAD = new Set([
  "is", "are", "was", "were", "be", "been", "being", "has", "have", "had", "do", "does", "did",
  "can", "could", "will", "would", "shall", "should", "may", "might", "must",
  "it", "its", "they", "them", "their", "we", "our", "you", "your", "he", "she", "his", "her",
  "and", "or", "but", "so", "then", "also", "very", "much", "well", "just", "there", "here",
  "in", "on", "at", "to", "for", "with", "by", "from", "as", "of", "into", "about", "over",
  "the", "a", "an", "this", "that", "these", "those", "each", "every", "both", "many", "most",
  "some", "such", "which", "who", "what", "when", "where", "while", "after", "before", "during",
  "although", "though", "because", "since", "unlike", "whereas", "instead", "however", "overall",
  "first", "firstly", "second", "third", "next", "finally", "lastly", "additionally", "moreover",
  "furthermore", "meanwhile", "together",
]);

const cleanPhrase = (text) => String(text)
  .replace(/\s+/g, " ")
  .replace(/^[\s,;:]+/, "")
  .replace(/[\s,;:]+$/, "")
  // Keep the final dot of an abbreviation ("Ph.D."), drop real sentence stops.
  .replace(/(?<![A-Z])[.!?]+$/, "")
  .trim();

// Strip leading determiners / adjectival filler and dangling prepositions.
function tidyPhrase(text) {
  let out = cleanPhrase(text).replace(REL_CLAUSE_LEAD, "");
  let prev = "";
  while (out !== prev) {
    prev = out;
    out = out.replace(STOP_LEAD, "").replace(TRAIL_PREP, "");
  }
  return cleanPhrase(out);
}

/** Title Case a short phrase, preserving acronyms and forms like "Ph.D.". */
function titleCase(text) {
  const minor = new Set(["and", "or", "of", "in", "at", "to", "for", "with", "on", "the", "a", "an"]);
  return String(text).split(/\s+/).map((w, i) => {
    // Anything already carrying internal capitals ("BS-MS", "Ph.D.") is left be.
    if (/[A-Z]/.test(w.slice(1)) || /[A-Z]{2,}/.test(w)) return w;
    const lower = w.toLowerCase();
    if (i > 0 && minor.has(lower)) return lower;
    return lower.replace(/(^|-)([a-z])/g, (_, sep, ch) => sep + ch.toUpperCase());
  }).join(" ");
}

/** Split a list on commas / "and", ignoring separators inside parentheses. */
function splitList(text) {
  const parts = [];
  let depth = 0, buf = "";
  const push = () => { const p = tidyPhrase(buf); if (p) parts.push(p); buf = ""; };
  for (const tok of String(text).split(/(\(|\)|,|\band\b|&)/i)) {
    if (tok === "(") depth += 1;
    if (tok === ")") depth = Math.max(0, depth - 1);
    if (depth === 0 && (tok === "," || tok === "&" || /^and$/i.test(tok))) push();
    else buf += tok;
  }
  push();
  return parts;
}

/**
 * The most descriptive noun-ish phrase in a clause — the fallback branch name
 * when no lexicon keyword matched. Proper nouns win; otherwise the longest run
 * of content words that does not start with a verb or a function word.
 */
function headPhrase(clause) {
  const words = tidyPhrase(clause).split(/\s+/).filter(Boolean);
  if (!words.length) return "";

  const runs = [];
  let run = [];
  for (const w of words) {
    const bare = w.replace(/[^A-Za-z0-9.\-]/g, "");
    if (!bare || NOT_A_HEAD.has(bare.toLowerCase())) { if (run.length) runs.push(run); run = []; continue; }
    run.push(bare);
    if (run.length === 4) { runs.push(run); run = []; }
  }
  if (run.length) runs.push(run);
  if (!runs.length) return titleCase(words.slice(0, 3).join(" "));

  const proper = runs.filter((r) => r.every((w) => /^[A-Z]/.test(w)));
  const pool = proper.length ? proper : runs;
  pool.sort((a, b) => b.length - a.length || b.join(" ").length - a.join(" ").length);
  return titleCase(tidyPhrase(pool[0].slice(0, 3).join(" ")));
}

function themeOf(clause) {
  const primary = String(clause).replace(CONTRAST_TAIL, "");
  for (const [re, name] of THEME_LEXICON) if (re.test(primary)) return name;
  return null;
}

/** Pull the concrete concepts a clause enumerates. */
function conceptsOf(clause) {
  const out = [];
  const ordinal = String(clause).match(ORDINAL_FACT);
  if (ordinal) out.push(titleCase(`${ordinal[1]} ${ordinal[2]} rank`.replace(/rank\w*\s+rank/i, "rank")));

  let rest = String(clause), guard = 0;
  while (guard < 5) {
    guard += 1;
    const m = rest.match(ENUM_TRIGGER);
    if (!m || m.index === undefined) break;
    let tail = rest.slice(m.index + m[0].length);

    // "offering programs like the BS-MS dual degree" — when a second trigger
    // follows almost immediately, the real list starts after THAT one.
    for (let hop = 0; hop < 2; hop++) {
      const inner = tail.match(ENUM_TRIGGER);
      if (!inner || inner.index === undefined) break;
      if (tail.slice(0, inner.index).trim().split(/\s+/).filter(Boolean).length > 2) break;
      tail = tail.slice(inner.index + inner[0].length);
    }

    const stop = tail.match(ENUM_STOP);
    if (stop && stop.index !== undefined && stop.index > 0) tail = tail.slice(0, stop.index);
    for (const item of splitList(tail)) if (item.split(/\s+/).length <= 6) out.push(titleCase(item));
    rest = rest.slice(m.index + m[0].length + tail.length);
  }

  const seen = new Set();
  return out.filter((c) => {
    const key = c.toLowerCase();
    if (c.length < 3 || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * The subject the paragraph is about: the "Full Name (ACRONYM) Place"
 * construction if there is one, else the most repeated proper-noun phrase.
 *
 * A capital at the start of a sentence is not evidence of a proper noun, so
 * those occurrences are counted at a quarter weight — otherwise "The" wins
 * every paragraph.
 */
export function dominantEntity(text) {
  const src = String(text);
  const acronym = src.match(/\(([A-Z][A-Z0-9]{1,})\)\s+([A-Z][a-zA-Z]+)/);
  if (acronym) return `${acronym[1]} ${acronym[2]}`;

  const score = new Map();
  const firstSentence = sentencesOf(src)[0] || "";
  for (const m of src.matchAll(/\b[A-Z][a-zA-Z0-9.\-]*(?:\s+[A-Z][a-zA-Z0-9.\-]*)*/g)) {
    const phrase = tidyPhrase(m[0].replace(/[(),.]/g, " "));
    if (!phrase || phrase.length <= 2 || NOT_A_HEAD.has(phrase.toLowerCase())) continue;
    const words = phrase.split(/\s+/);
    // Abbreviations lose their dots above ("Ph.D." -> "Ph D"), leaving a stray
    // single letter — never a subject.
    if (words.length > 5 || words.some((w) => w.length < 2)) continue;
    const before = src.slice(0, m.index).replace(/\s+$/, "");
    const atSentenceStart = before === "" || /[.!?:]$/.test(before);
    // A capital opening a sentence is weak evidence; a repeated multi-word
    // proper phrase introduced in the first sentence is strong evidence.
    const hit = (atSentenceStart ? 0.25 : 1) * (words.length > 1 ? 2 : 1);
    score.set(phrase, (score.get(phrase) || 0) + hit);
  }
  for (const phrase of [...score.keys()]) {
    if (firstSentence.includes(phrase)) score.set(phrase, score.get(phrase) + 0.6);
  }
  if (!score.size) return null;
  const best = [...score.entries()].sort(
    (a, b) => b[1] - a[1] || b[0].split(/\s+/).length - a[0].split(/\s+/).length,
  )[0];
  return best && best[1] >= 0.5 ? titleCase(best[0]) : null;
}

function sentencesOf(text) {
  return String(text).split(/(?<=[.!?])\s+/).map(cleanPhrase).filter(Boolean);
}

/**
 * Descriptive prose -> a themed mind-map outline in the cheatsheet syntax.
 * Returns "" when the text does not read as descriptive prose (too short, or
 * no theme/concept could be extracted), so the caller falls back to the simpler
 * line-by-line conversion.
 */
export function proseToOutline(input) {
  const text = cleanPhrase(String(input ?? "").replace(/\r\n?/g, " "));
  if (!text) return "";

  const sentences = sentencesOf(text);
  if (sentences.length < 3) return "";

  const branches = new Map();
  for (const sentence of sentences) {
    if (META_RE.test(sentence)) continue;
    for (const clause of sentence.split(CLAUSE_SPLIT).map(cleanPhrase).filter(Boolean)) {
      const theme = themeOf(clause) || headPhrase(clause);
      if (!theme) continue;
      const list = branches.get(theme) || [];
      for (const c of conceptsOf(clause)) if (!list.includes(c)) list.push(c);
      branches.set(theme, list);
    }
  }

  // Drop branches that yielded nothing concrete — unless that leaves too few.
  let entries = [...branches.entries()].filter(([, c]) => c.length > 0);
  if (entries.length < 2) entries = [...branches.entries()];
  if (entries.length < 2) return "";

  const center = dominantEntity(text);
  const lines = [];
  if (center) { lines.push(`# ${center}`); lines.push(`- ${center}`); }
  const indent = center ? "  " : "";
  for (const [theme, concepts] of entries) {
    lines.push(`${indent}- ${theme}`);
    for (const c of concepts) lines.push(`${indent}  - ${c}`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// plain text -> the cheatsheet syntax
// ---------------------------------------------------------------------------
//
// Plain text is normalized into the DSL before it is parsed, so "auto" mode is
// not a second, weaker parser: it is the SAME parser fed syntax derived from
// the sentences. Because the conversion is a pure string -> string function,
// the editor can also show it — that is what the "Convert to cheatsheet" button
// writes back into the textarea, and it can never disagree with what the parser
// really did.

const STRUCTURED_LINE_RE = /^(#{1,6}\s|[-*•]\s|\d+[.)]\s)|(?:->|→|=>|-->)|\b(?:vs\.?|versus)\b/i;
const ORDERED_CUE_RE = /^(first(ly)?|second(ly)?|third(ly)?|fourth(ly)?|fifth(ly)?|then|next|after that|afterwards?|finally|lastly|subsequently|initially|to start|to begin)\b[,:]?\s*/i;
const FLOW_CUE_RE = /\s+(?:->|→|=>|-->|leads?\s+to|results?\s+in|causes?|drives?|enables?|triggers?|produces?|feeds?\s+into|and then|which then|therefore|thus|hence|so)\s+/i;
const COMPARE_CUE_RE = /\s+(?:vs\.?|versus|compared\s+(?:to|with)|whereas|unlike|as\s+opposed\s+to)\s+/i;

function isTitleCandidate(text) {
  const trimmed = cleanPhrase(text);
  if (!trimmed) return false;
  return trimmed.split(/\s+/).length <= 8 && trimmed.length <= 60
    && !/[.:;!?]$/.test(String(text).trim())
    && !FLOW_CUE_RE.test(trimmed) && !COMPARE_CUE_RE.test(trimmed);
}

/**
 * Descriptive prose = several sentences explaining a subject, as opposed to
 * text carrying explicit sequence / flow / comparison cues (which already map
 * cleanly onto ordered steps, arrows and `vs` lines).
 */
function isDescriptiveProse(text) {
  const sentences = sentencesOf(text);
  if (sentences.length < 3) return false;
  const cued = sentences.filter((s) => ORDERED_CUE_RE.test(s) || FLOW_CUE_RE.test(s) || COMPARE_CUE_RE.test(s)).length;
  return cued / sentences.length < 0.5;
}

function convertStandaloneUnit(unit, indent, orderedRef) {
  const trimmed = cleanPhrase(unit);
  if (!trimmed) return "";

  if (ORDERED_CUE_RE.test(trimmed)) {
    const body = cleanPhrase(trimmed.replace(ORDERED_CUE_RE, ""));
    if (body) { const item = `${indent}${orderedRef.value}. ${body}`; orderedRef.value += 1; return item; }
  }
  if (COMPARE_CUE_RE.test(trimmed)) {
    const operands = trimmed.split(COMPARE_CUE_RE).map(cleanPhrase).filter(Boolean);
    if (operands.length === 2) return `${indent}${operands[0]} vs ${operands[1]}`;
  }
  if (FLOW_CUE_RE.test(trimmed)) {
    const parts = trimmed.split(FLOW_CUE_RE).map(cleanPhrase).filter(Boolean);
    if (parts.length >= 2) return `${indent}${parts.join(" -> ")}`;
  }
  const colon = trimmed.indexOf(":");
  if (colon > 0 && colon < trimmed.length - 1) {
    const label = cleanPhrase(trimmed.slice(0, colon)), detail = cleanPhrase(trimmed.slice(colon + 1));
    if (label && detail && !/^\d+$/.test(label)) return `${indent}${label}: ${detail}`;
  }
  return `${indent}- ${trimmed}`;
}

/** Rewrite plain sentences as the bullet / arrow / `vs` cheatsheet syntax. */
export function plainTextToCheatsheet(input) {
  const normalized = String(input ?? "").replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  const firstNonEmpty = lines.findIndex((line) => line.trim().length > 0);
  if (firstNonEmpty < 0) return normalized;

  // Multi-sentence description with no sequence/flow cues reads best as a
  // themed mind map, not as one bullet per sentence.
  if (!lines.some((line) => STRUCTURED_LINE_RE.test(line.trim())) && isDescriptiveProse(normalized)) {
    const outline = proseToOutline(normalized);
    if (outline) return outline;
  }

  const converted = [];
  let orderedIndex = 1, startAt = firstNonEmpty;
  const firstLine = lines[firstNonEmpty].trim();
  if (!STRUCTURED_LINE_RE.test(firstLine)
    && lines.slice(firstNonEmpty + 1).some((line) => line.trim())
    && isTitleCandidate(firstLine)) {
    converted.push(`# ${cleanPhrase(firstLine)}`);
    startAt += 1;
  }

  for (let i = startAt; i < lines.length; i++) {
    const raw = lines[i], trimmed = raw.trim();
    if (!trimmed) {
      if (converted.length && converted[converted.length - 1] !== "") converted.push("");
      continue;
    }
    if (STRUCTURED_LINE_RE.test(trimmed)) { converted.push(raw); continue; }

    const indent = (raw.match(/^\s*/) || [""])[0];
    const units = sentencesOf(trimmed);
    const orderedUnits = units.filter((unit) => ORDERED_CUE_RE.test(unit));
    if (units.length > 1 && orderedUnits.length >= Math.ceil(units.length / 2)) {
      for (const unit of units) {
        const body = cleanPhrase(unit.replace(ORDERED_CUE_RE, ""));
        if (!body) continue;
        converted.push(`${indent}${orderedIndex}. ${body}`);
        orderedIndex += 1;
      }
      continue;
    }
    if (units.length > 1) {
      const ref = { value: orderedIndex };
      for (const unit of units) {
        const line = convertStandaloneUnit(unit, indent, ref);
        if (line) converted.push(line);
      }
      orderedIndex = ref.value;
      continue;
    }
    const line = convertStandaloneUnit(trimmed, indent, { value: orderedIndex });
    if (line) {
      if (ORDERED_CUE_RE.test(trimmed)) orderedIndex += 1;
      converted.push(line);
    }
  }

  return converted.join("\n").replace(/\n{3,}/g, "\n\n");
}

/**
 * True when `input` is plain text the converter would actually change. Shared
 * by textToGraph() and the dialogs' "Convert to cheatsheet" button, so the UI
 * can never claim a conversion the parser would not make.
 */
export function shouldConvertToCheatsheet(input) {
  const text = String(input ?? "");
  if (!text.trim()) return false;
  if (!looksLikeProse(text)) return false;
  return plainTextToCheatsheet(text).trim() !== text.replace(/\r\n?/g, "\n").trim();
}

// ---------------------------------------------------------------------------
// reshaping the tree for a hand-picked layout
// ---------------------------------------------------------------------------

/**
 * Adapt a parse tree so a MANUALLY CHOSEN layout has something to draw.
 *
 * buildGraph() synthesises edges and groups from whatever the text supplied:
 * arrows make flows, indentation makes hierarchy, `A vs B` makes comparisons.
 * When a layout is picked by hand the text usually does not carry what that
 * layout needs — forcing "comparison" onto a flat list would give two empty
 * columns, and forcing "cycle" onto text with no arrows would give a ring with
 * no ring. This fills those gaps deterministically WITHOUT touching the text,
 * and it never removes information: existing flows, comparisons and nesting
 * are always kept.
 */
export function reshapeForStructure(tree, structure) {
  const all = Object.values(tree.registry);
  if (!all.length) return tree;

  switch (structure) {
    case "comparison": return tree.comparisons.length ? tree : withComparison(tree, all);
    case "cycle": return hasClosedLoop(tree) ? tree : withCycle(tree, all);
    case "flow": case "steps": case "timeline": case "funnel":
      return tree.flows.length ? tree : withChain(tree, all, structure !== "flow");
    case "proportion": return withWeights(tree, all);
    case "hub": case "convergence": case "pillars": return withCenter(tree, all);
    case "hierarchy": case "pyramid": return withNesting(tree, all);
    default: return tree;
  }
}

// The members of a synthesised structure. Leaves win when the text is nested:
// a tree's leaves are the concrete items, its roots are usually headings.
function membersOf(tree, all) {
  const leaves = all.filter((n) => n.children.length === 0);
  if (tree.roots.length && leaves.length >= 2 && leaves.length < all.length) return leaves;
  return all;
}

const hasClosedLoop = (tree) => tree.flows.some((chain) => chain.length >= 3 && chain[0] === chain[chain.length - 1]);

// Split the concepts into two balanced sides.
function withComparison(tree, all) {
  const members = membersOf(tree, all);
  if (members.length < 2) return tree;

  let left, right;
  if (tree.roots.length === 2) { left = [tree.roots[0]]; right = [tree.roots[1]]; }
  else {
    const mid = Math.ceil(members.length / 2);
    left = members.slice(0, mid); right = members.slice(mid);
  }
  const comparisons = [];
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const a = left[Math.min(i, left.length - 1)], b = right[Math.min(i, right.length - 1)];
    if (a && b && a.id !== b.id) comparisons.push([a.id, b.id]);
  }
  return { ...tree, comparisons, hasExplicitStructure: true };
}

// Chain the concepts in reading order, optionally marking them ordered.
function withChain(tree, all, ordered) {
  const members = membersOf(tree, all);
  if (members.length < 2) return tree;
  const chain = members.map((n) => n.id);
  const registry = { ...tree.registry };
  if (ordered) for (const id of chain) registry[id] = { ...registry[id], ordered: true };
  return { ...tree, registry, flows: [chain], hasExplicitStructure: true };
}

// Chain them and close the loop back to the first.
function withCycle(tree, all) {
  const members = membersOf(tree, all);
  if (members.length < 2) return tree;
  const chain = members.map((n) => n.id);
  return { ...tree, flows: [[...chain, chain[0]]], hasExplicitStructure: true };
}

// Give every concept a share: percentages already in the text win, the rest
// split the remainder evenly so a pie / treemap always has segments.
function withWeights(tree, all) {
  const members = membersOf(tree, all);
  if (!members.length) return tree;
  const hasWeight = (n) => PERCENT_RE.test(`${n.label} ${n.description ?? ""}`);
  const unweighted = members.filter((n) => !hasWeight(n));
  if (!unweighted.length) return tree;

  const share = Math.max(1, Math.round(100 / members.length));
  const registry = { ...tree.registry };
  for (const n of unweighted) {
    const detail = registry[n.id].description;
    registry[n.id] = { ...registry[n.id], description: detail ? `${detail} (${share}%)` : `${share}%` };
  }
  return { ...tree, registry };
}

/**
 * Guarantee real nesting. Text that is only a chain of arrows has no
 * parent/child relationships, so drawing it "as a tree" would be pixel-
 * identical to drawing it as a flow. Promote the first concept to root and
 * hang the rest beneath it.
 */
function withNesting(tree, all) {
  if (all.some((n) => n.children.length > 0)) return tree;
  const members = membersOf(tree, all);
  if (members.length < 2) return tree;

  const [head, ...rest] = members;
  const registry = { ...tree.registry };
  registry[head.id] = { ...registry[head.id], level: 0, children: rest.map((n) => registry[n.id]) };
  for (const n of rest) registry[n.id] = { ...registry[n.id], level: 1, children: [] };
  return {
    ...tree, registry, roots: [registry[head.id]],
    // The chain is expressed as nesting now; keeping it would double the edges.
    flows: [], hasExplicitStructure: true,
  };
}

// Guarantee a single centre. buildGraph() synthesises one from the title when
// there is none, so this only has to stop a lone root being taken for a peer.
function withCenter(tree, all) {
  if (tree.title) return tree;
  if (tree.roots.length === 1 && tree.roots[0].children.length > 0) return tree;
  const members = membersOf(tree, all);
  if (members.length < 3 || tree.roots.length < 2) return tree;

  const [head, ...rest] = tree.roots;
  if (!head || !rest.length) return tree;
  const registry = { ...tree.registry };
  registry[head.id] = { ...head, children: [...head.children, ...rest] };
  for (const n of rest) registry[n.id] = { ...registry[n.id], level: 1 };
  return { ...tree, registry, roots: [registry[head.id]], hasExplicitStructure: true };
}

// ---------------------------------------------------------------------------
// presets
// ---------------------------------------------------------------------------

/**
 * The browsable groups the layout picker shows, in display order. A preset can
 * live in several of them: a mind map is as useful for brainstorming as it is
 * for hierarchy, and pretending otherwise would hide it from half the people
 * looking for it.
 */
export const CATEGORIES = [
  { id: "mindmap", label: "Mindmap" },
  { id: "process", label: "Process" },
  { id: "timelines", label: "Timelines" },
  { id: "comparison", label: "Comparison" },
  { id: "frameworks", label: "Business Frameworks" },
  { id: "brainstorming", label: "Brainstorming" },
  { id: "parts", label: "Parts of a whole" },
  { id: "problems", label: "Problems and Solutions" },
  { id: "metaphors", label: "Visual Metaphors" },
  { id: "narrative", label: "Narrative" },
  { id: "cause-effect", label: "Cause and Effect" },
  { id: "hierarchy", label: "Hierarchy" },
];

/**
 * Every visual template the generator can draw.
 *
 *   structures        the semantic shapes this preset is a natural fit for
 *   targetStructure   what picking it BY HAND re-interprets the text as
 *   categories        where it shows up in the picker
 *   layout / shape    which engine positions the nodes, and in which mode
 *
 * Presets that share an engine pass a different `shape`, so each one encodes
 * its own meaning instead of being a renamed neighbour: a cycle is a ring with
 * no centre, a proportion sizes its cards by share, a journey winds.
 */
export const PRESETS = [
  { id: "flow-lr", label: "Flow →", structures: ["flow", "steps"], categories: ["process", "narrative", "cause-effect"], keywords: ["arrow", "sequence", "left to right"], layout: "layered", direction: "LR", description: "Left-to-right directed process." },
  { id: "flow-tb", label: "Flow ↓", structures: ["flow", "steps"], categories: ["process", "cause-effect"], keywords: ["arrow", "sequence", "top down"], layout: "layered", direction: "TB", description: "Top-down directed process." },
  { id: "tree-lr", label: "Tree", structures: ["hierarchy"], categories: ["hierarchy", "mindmap", "cause-effect"], keywords: ["branch", "org", "taxonomy"], layout: "layered", direction: "LR", description: "Hierarchical tree / org chart." },
  { id: "tree-tb", label: "Org chart ↓", structures: ["hierarchy"], categories: ["hierarchy", "process"], keywords: ["org chart", "reporting"], layout: "layered", direction: "TB", description: "Top-down hierarchy / org chart." },
  { id: "mindmap", label: "Mind map", structures: ["hierarchy", "hub", "grid"], categories: ["mindmap", "brainstorming", "hierarchy"], keywords: ["radial", "branches", "ideas"], layout: "radial", shape: "mindmap", description: "Central idea with radiating branches." },
  { id: "hub-spoke", label: "Hub & spoke", structures: ["hub", "convergence", "grid"], categories: ["mindmap", "brainstorming"], keywords: ["center", "satellites", "star"], layout: "radial", shape: "mindmap", description: "One core concept with satellites." },
  { id: "hub-tree", label: "Hub tree ↓", structures: ["hub", "convergence"], categories: ["mindmap", "hierarchy"], keywords: ["center", "branches"], layout: "layered", direction: "TB", description: "Center on top with branches below." },
  { id: "cycle-ring", label: "Cycle", structures: ["cycle"], categories: ["process", "cause-effect", "timelines"], keywords: ["loop", "iteration", "feedback", "circular"], layout: "radial", shape: "ring", description: "Looping sequence around a ring." },
  { id: "grid-cards", label: "Grid", structures: ["grid", "proportion", "hub"], categories: ["brainstorming", "comparison", "parts"], keywords: ["cards", "matrix", "tiles"], layout: "grid", description: "Matrix of peer cards." },
  { id: "pie", label: "Proportion", structures: ["proportion", "grid"], categories: ["parts", "comparison"], keywords: ["pie", "share", "percentage", "donut"], layout: "radial", shape: "pie", description: "Weighted segments around a center." },
  { id: "pillars", label: "Pillars", structures: ["pillars", "hub"], categories: ["metaphors", "frameworks"], keywords: ["support", "temple", "foundation"], layout: "pillars", description: "One idea supported by columns." },
  { id: "comparison", label: "Comparison", structures: ["comparison"], categories: ["comparison", "frameworks"], keywords: ["versus", "vs", "pros cons", "trade-off"], layout: "grid", description: "Two sides weighed against each other." },
  { id: "timeline", label: "Timeline", structures: ["timeline", "steps"], categories: ["timelines", "narrative"], keywords: ["events", "history", "schedule"], layout: "linear", direction: "LR", description: "Events along an axis." },
  { id: "roadmap", label: "Roadmap ↓", structures: ["timeline", "steps"], categories: ["timelines", "process"], keywords: ["milestones", "plan", "quarters"], layout: "linear", direction: "TB", description: "Vertical timeline of milestones." },
  { id: "steps", label: "Steps", structures: ["steps", "flow"], categories: ["process", "timelines"], keywords: ["staircase", "stages", "how to"], layout: "staircase", description: "Ascending staircase of stages." },
  { id: "journey", label: "Journey →", structures: ["flow", "steps"], categories: ["process", "narrative", "timelines"], keywords: ["path", "customer journey", "story"], layout: "linear", direction: "LR", shape: "journey", description: "Winding path of stages along an axis." },
  { id: "pyramid", label: "Pyramid", structures: ["pyramid", "hierarchy"], categories: ["hierarchy", "metaphors", "frameworks", "parts"], keywords: ["maslow", "layers", "ranked", "tiers"], layout: "stacked", description: "Ranked layers, widest at the base." },
  { id: "funnel", label: "Funnel", structures: ["funnel", "steps"], categories: ["parts", "metaphors", "process", "frameworks"], keywords: ["narrowing", "conversion", "sales", "pipeline"], layout: "stacked", description: "Narrowing stages." },
  { id: "convergence", label: "Convergence", structures: ["convergence", "hub"], categories: ["metaphors", "problems", "frameworks"], keywords: ["bullseye", "focus", "inputs", "lens"], layout: "radial", shape: "convergence", description: "Many inputs meeting one target." },

  // --- matrix family -------------------------------------------------------
  { id: "swot", label: "SWOT", structures: ["grid", "comparison"], targetStructure: "grid", categories: ["frameworks", "problems", "comparison"], keywords: ["strengths", "weaknesses", "opportunities", "threats", "2x2"], layout: "matrix", columns: 2, description: "Four-quadrant strategic analysis." },
  { id: "quadrant", label: "Quadrant", structures: ["grid", "comparison"], targetStructure: "grid", categories: ["frameworks", "comparison", "hierarchy"], keywords: ["2x2", "matrix", "axes", "priority"], layout: "matrix", columns: 2, shape: "quadrant", description: "Two-by-two positioning matrix." },
  { id: "pestel", label: "PESTEL", structures: ["grid"], targetStructure: "grid", categories: ["frameworks", "problems"], keywords: ["political", "economic", "social", "technological", "6 cell"], layout: "matrix", columns: 3, description: "Six-factor environment scan." },
  { id: "matrix-table", label: "Table", structures: ["grid", "comparison"], targetStructure: "grid", categories: ["comparison", "brainstorming", "hierarchy"], keywords: ["cells", "rows", "columns", "compare"], layout: "matrix", columns: 3, shape: "auto", description: "Rows and columns of peer cells." },

  // --- concentric family ---------------------------------------------------
  { id: "bullseye", label: "Bullseye", structures: ["convergence", "hierarchy", "grid"], targetStructure: "convergence", categories: ["metaphors", "frameworks", "hierarchy"], keywords: ["target", "rings", "focus", "priority"], layout: "concentric", description: "Nested rings closing on a core." },
  { id: "onion", label: "Onion", structures: ["hierarchy", "grid"], targetStructure: "hierarchy", categories: ["parts", "metaphors", "hierarchy"], keywords: ["layers", "rings", "nested", "sunburst"], layout: "concentric", shape: "onion", description: "Layers wrapped around a core." },

  // --- specialised shapes --------------------------------------------------
  { id: "fishbone", label: "Fishbone", structures: ["hierarchy", "convergence"], targetStructure: "hierarchy", categories: ["cause-effect", "problems"], keywords: ["ishikawa", "root cause", "causes", "why"], layout: "fishbone", description: "Causes branching off a spine into an effect." },
  { id: "venn", label: "Venn", structures: ["comparison", "grid"], targetStructure: "comparison", categories: ["comparison", "parts", "brainstorming"], keywords: ["overlap", "intersection", "sets", "shared"], layout: "venn", description: "Overlapping sets with a shared middle." },
  { id: "swimlane", label: "Swimlane", structures: ["hierarchy", "flow", "steps"], targetStructure: "hierarchy", categories: ["process", "timelines"], keywords: ["lanes", "roles", "responsibility", "parallel"], layout: "swimlane", description: "One lane per group, running left to right." },
  { id: "bowtie", label: "Bowtie", structures: ["convergence", "hub", "comparison"], targetStructure: "convergence", categories: ["cause-effect", "problems", "metaphors"], keywords: ["risk", "causes consequences", "butterfly"], layout: "butterfly", description: "Causes on the left, consequences on the right." },
  { id: "balance", label: "Balance", structures: ["comparison"], targetStructure: "comparison", categories: ["comparison", "metaphors", "frameworks"], keywords: ["scales", "weigh", "pros cons", "trade-off"], layout: "butterfly", shape: "balance", description: "Two sides weighed around a pivot." },

  // --- parts of a whole ----------------------------------------------------
  { id: "treemap", label: "Treemap", structures: ["proportion", "grid"], targetStructure: "proportion", categories: ["parts", "hierarchy"], keywords: ["area", "share", "tiles", "squares", "breakdown"], layout: "treemap", description: "Tiles whose area is each item's share." },
  { id: "stacked-bar", label: "Stacked bar", structures: ["proportion", "grid"], targetStructure: "proportion", categories: ["parts", "comparison"], keywords: ["100%", "segments", "composition", "split", "bands"], layout: "stacked-bar", description: "One bar divided into weighted bands." },

  // --- visual metaphors ----------------------------------------------------
  { id: "iceberg", label: "Iceberg", structures: ["hierarchy", "grid"], targetStructure: "hierarchy", categories: ["metaphors", "problems"], keywords: ["hidden", "surface", "underlying", "beneath", "visible"], layout: "iceberg", description: "A visible tip above the hidden bulk beneath." },
  { id: "bridge", label: "Bridge", structures: ["flow", "steps"], targetStructure: "flow", categories: ["metaphors", "narrative", "problems"], keywords: ["gap", "current future", "transition", "cross", "from to"], layout: "bridge", description: "Two piers spanned by the steps between them." },
  { id: "gauge", label: "Gauge", structures: ["steps", "grid"], targetStructure: "steps", categories: ["metaphors", "frameworks"], keywords: ["dial", "meter", "level", "maturity", "scale"], layout: "gauge", description: "A dial sweeping from low to high." },
  { id: "fan", label: "Fan", structures: ["hub", "grid"], targetStructure: "hub", categories: ["metaphors", "brainstorming", "narrative"], keywords: ["options", "blades", "spread", "possibilities", "branch out"], layout: "fan", description: "Options fanning out from a single source." },

  // --- problems / narrative ------------------------------------------------
  { id: "problem-solution", label: "Problem → Solution", structures: ["comparison"], targetStructure: "comparison", categories: ["problems", "comparison"], keywords: ["issue", "fix", "remedy", "pain gain", "before after"], layout: "problem-solution", description: "Each issue paired with its answer opposite." },
  { id: "story-arc", label: "Story arc", structures: ["steps", "flow"], targetStructure: "steps", categories: ["narrative", "timelines"], keywords: ["beats", "climax", "plot", "rising falling", "three act"], layout: "story-arc", description: "Beats rising to a climax and easing down." },
];

const PRESET_BY_ID = new Map(PRESETS.map((p) => [p.id, p]));

export function getPreset(id) { return PRESET_BY_ID.get(id) || PRESET_BY_ID.get("grid-cards"); }

// Every preset able to render a given semantic structure.
export function presetsForStructure(structure) { return PRESETS.filter((p) => p.structures.includes(structure)); }

// The presets filed under one browsable category, in registry order.
export function presetsByCategory(category) { return PRESETS.filter((p) => (p.categories || []).includes(category)); }

/**
 * The structure a preset re-interprets the text as when it is chosen BY HAND.
 * Picking a layout is not just "move the same boxes somewhere else": a layout
 * implies a shape, so the text is reparsed for it (see reshapeForStructure).
 */
export function targetStructureOf(preset) {
  return preset.targetStructure || preset.structures[0];
}

/** Free-text search over label, description, id and keywords. */
export function searchPresets(query) {
  const q = String(query ?? "").trim().toLowerCase();
  if (!q) return PRESETS;
  const terms = q.split(/\s+/);
  return PRESETS.filter((p) => {
    const hay = [p.label, p.description, p.id, ...(p.keywords || [])].join(" ").toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
}

const DEFAULT_PRESET = {
  flow: "flow-lr", hierarchy: "tree-lr", cycle: "cycle-ring", grid: "grid-cards",
  hub: "hub-spoke", proportion: "pie", pillars: "pillars", comparison: "comparison",
  timeline: "timeline", steps: "steps", pyramid: "pyramid", funnel: "funnel",
  convergence: "convergence",
};

export function defaultPreset(structure) {
  return DEFAULT_PRESET[structure] || (presetsForStructure(structure)[0] || {}).id || "grid-cards";
}

// ---------------------------------------------------------------------------
// structure detection + graph building
// ---------------------------------------------------------------------------

// Title keywords that strongly imply a structure.
const TITLE_HINTS = [
  [/funnel/i, "funnel"],
  [/pyramid|maslow|hierarchy of needs/i, "pyramid"],
  [/timeline|roadmap|schedule|milestones?/i, "timeline"],
  [/cycle|loop|lifecycle|iterat|feedback loop/i, "cycle"],
  [/pillar/i, "pillars"],
  [/compar|versus|\bvs\b|trade-?off|pros?\s*(and|&|\/)\s*cons?/i, "comparison"],
  [/mind\s?map/i, "hub"],
  [/pie|proportion|breakdown|distribution|market share/i, "proportion"],
  [/converg|bullseye|focus/i, "convergence"],
  [/process|workflow|pipeline|steps|procedure/i, "steps"],
  [/org\s?chart|tree|taxonomy|hierarchy/i, "hierarchy"],
];

const PERCENT_RE = /(\d{1,3}(?:\.\d+)?)\s?%/;

function parseWeight(node) {
  const m = `${node.label} ${node.description ?? ""}`.match(PERCENT_RE);
  return m ? parseFloat(m[1]) : undefined;
}

function hasCycle(flows) {
  for (const chain of flows) {
    if (chain.length >= 2 && chain[0] === chain[chain.length - 1]) return true;
    const seen = new Set();
    for (const id of chain) { if (seen.has(id)) return true; seen.add(id); }
  }
  return false;
}

/**
 * Structures that PRESERVE parent/child nesting. Every other structure is a
 * flat presentation, so letting a title hint force one of them onto a real tree
 * would silently throw away the hierarchy someone typed.
 */
const NESTING_STRUCTURES = new Set(["hierarchy", "hub"]);

// Classify the semantic structure a parsed tree describes.
export function detectStructure(tree) {
  const { registry, roots, flows, comparisons, title } = tree;

  const all = Object.values(registry);
  const depth = all.reduce((m, n) => Math.max(m, n.level), 0);
  const anyOrdered = all.some((n) => n.ordered);
  const anyWeight = all.some((n) => parseWeight(n) !== undefined);

  // An explicit title hint wins — unless the text has real nesting and the hint
  // would flatten it. A title containing the common word "focus" must not turn
  // a two-level tree into a flat convergence diagram.
  if (title) {
    for (const [re, structure] of TITLE_HINTS) {
      if (!re.test(title)) continue;
      if (depth >= 1 && !NESTING_STRUCTURES.has(structure)) break;
      return { structure, confidence: 0.9 };
    }
  }

  if (comparisons.length > 0 && flows.length === 0) return { structure: "comparison", confidence: 0.9 };
  if (flows.length > 0) return hasCycle(flows) ? { structure: "cycle", confidence: 0.85 } : { structure: "flow", confidence: 0.85 };
  if (depth >= 1) {
    if (depth === 1 && roots.length === 1) return { structure: "hub", confidence: 0.8 };
    return { structure: "hierarchy", confidence: 0.85 };
  }
  if (anyWeight) return { structure: "proportion", confidence: 0.7 };
  if (anyOrdered) return { structure: "steps", confidence: 0.75 };
  // A titled flat list reads as a mind map: the title is the central concept.
  if (title) return { structure: "hub", confidence: 0.6 };
  return { structure: "grid", confidence: 0.5 };
}

// A ParseTree -> a full graph (nodes + edges + structure). Positions come later.
export function buildGraph(tree, source = "dsl", forcedStructure) {
  const { registry, roots, flows, comparisons, title } = tree;
  const natural = detectStructure(tree);
  // A hand-picked layout re-interprets the text; the natural reading is kept in
  // meta so the UI can offer "reset to the detected structure".
  const detection = forcedStructure ? { structure: forcedStructure, confidence: natural.confidence } : natural;

  const nodes = Object.values(registry).map((n, i) => ({
    id: n.id, label: n.label, description: n.description,
    level: n.level, order: i, weight: parseWeight(n), variant: "card",
  }));

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges = [], seenEdge = new Set();
  const addEdge = (s, t, kind) => {
    if (s === t) return;
    const key = `${s}->${t}`;
    if (seenEdge.has(key)) return;
    seenEdge.add(key);
    edges.push({ id: `e-${key}`, source: s, target: t, kind });
  };

  const walk = (node) => { for (const child of node.children) { addEdge(node.id, child.id, "line"); walk(child); } };
  roots.forEach(walk);
  for (const chain of flows) for (let i = 0; i < chain.length - 1; i++) addEdge(chain[i], chain[i + 1], "arrow");

  // Ordered structures with no explicit connectors get sequential edges so the
  // staircase / timeline reads as a chain.
  if ((detection.structure === "steps" || detection.structure === "timeline") && edges.length === 0) {
    const seq = [...nodes].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    for (let i = 0; i < seq.length - 1; i++) addEdge(seq[i].id, seq[i + 1].id, "arrow");
  }
  if (detection.structure === "cycle") {
    for (const chain of flows) if (chain.length >= 2 && chain[0] !== chain[chain.length - 1]) addEdge(chain[chain.length - 1], chain[0], "arrow");
  }
  if (detection.structure === "comparison") {
    comparisons.forEach(([a, b]) => {
      const na = byId.get(a), nb = byId.get(b);
      if (na) na.group = "left";
      if (nb) nb.group = "right";
    });
  }
  // Hub / mind map / convergence need a single center node.
  if (detection.structure === "hub" || detection.structure === "convergence") {
    const singleParent = roots.length === 1 && roots[0].children.length > 0 ? byId.get(roots[0].id) : null;
    if (singleParent) singleParent.variant = "hub";
    else {
      let cid = "center", k = 1;
      while (byId.has(cid)) cid = `center-${(k += 1)}`;
      const center = { id: cid, label: title ?? "Topic", level: 0, order: -1, variant: "hub" };
      nodes.unshift(center); byId.set(cid, center);
      const targets = roots.length ? roots.map((r) => r.id) : nodes.filter((n) => n.id !== cid).map((n) => n.id);
      for (const tid of targets) {
        if (detection.structure === "convergence") addEdge(tid, cid, "arrow");
        else addEdge(cid, tid, "line");
      }
    }
  }

  return {
    id: "graph",
    structure: detection.structure,
    preset: defaultPreset(detection.structure),
    nodes, edges,
    meta: {
      title, confidence: natural.confidence, source,
      naturalStructure: natural.structure,
      forced: forcedStructure !== undefined && forcedStructure !== natural.structure,
    },
  };
}

/**
 * Top-level text -> graph entry point.
 *
 * `mode` is "auto" (normalize plain text into the cheatsheet syntax, then run
 * the deterministic DSL parser over it), "dsl" (force the DSL parser) or
 * "prose" (force the sentence heuristic).
 *
 * "auto" no longer routes prose to a second, weaker parser: it rewrites the
 * sentences as cheatsheet syntax and parses THAT, so what the diagram is built
 * from is exactly what the "Convert to cheatsheet" button would put in the
 * textarea.
 *
 * `forcedStructure` re-interprets the same text for a hand-picked layout: the
 * tree is reshaped so the target structure has the relationships it needs
 * (comparison sides, a cycle chain, weights, a centre) and then rebuilt.
 */
export function textToGraph(input, mode = "auto", forcedStructure) {
  const text = input ?? "";
  const useProse = mode === "prose";
  const normalized = mode === "auto" && shouldConvertToCheatsheet(text) ? plainTextToCheatsheet(text) : text;
  const tree = useProse ? proseParse(text) : parse(normalized);
  const shaped = forcedStructure ? reshapeForStructure(tree, forcedStructure) : tree;
  return buildGraph(shaped, useProse ? "prose" : "dsl", forcedStructure);
}

// ---------------------------------------------------------------------------
// layout
// ---------------------------------------------------------------------------

export const CARD_W = 220, CARD_H = 88, HUB_SIZE = 150;
export const BAND_MAX_W = 380, BAND_MIN_W = 150, BAND_H = 66;
export const GAP_X = 70, GAP_Y = 55, PADDING = 60;

// Layered ("Sugiyama-lite") layout: rank by longest path along the edges, order
// each rank by the barycenter of its predecessors, then space the ranks evenly.
// Replaces the dagre dependency with ~40 deterministic lines.
export function layeredLayout(graph, direction = "TB") {
  const nodes = graph.nodes;
  const ids = new Set(nodes.map((n) => n.id));
  const edges = graph.edges.filter((e) => ids.has(e.source) && ids.has(e.target));
  const rank = new Map(nodes.map((n) => [n.id, 0]));

  // Longest-path ranking, relaxed at most |V| times so cycles simply stop.
  for (let pass = 0; pass < nodes.length; pass++) {
    let changed = false;
    for (const e of edges) {
      const want = rank.get(e.source) + 1;
      if (want > rank.get(e.target) && want < nodes.length) { rank.set(e.target, want); changed = true; }
    }
    if (!changed) break;
  }

  const layers = [];
  for (const n of nodes) (layers[rank.get(n.id)] ||= []).push(n);
  for (const layer of layers) if (layer) layer.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  const preds = new Map(nodes.map((n) => [n.id, []]));
  for (const e of edges) preds.get(e.target).push(e.source);

  // Two barycenter passes are enough to untangle typical hand-typed diagrams.
  const index = new Map();
  for (const layer of layers) if (layer) layer.forEach((n, i) => index.set(n.id, i));
  for (let sweep = 0; sweep < 2; sweep++) {
    for (const layer of layers) {
      if (!layer) continue;
      layer.sort((a, b) => bary(a) - bary(b) || (a.order ?? 0) - (b.order ?? 0));
      layer.forEach((n, i) => index.set(n.id, i));
    }
  }
  function bary(n) {
    const p = preds.get(n.id).map((id) => index.get(id)).filter((v) => v !== undefined);
    return p.length ? p.reduce((a, b) => a + b, 0) / p.length : (index.get(n.id) ?? 0);
  }

  const size = (n) => ({ w: n.width ?? (n.variant === "hub" ? HUB_SIZE : CARD_W), h: n.height ?? (n.variant === "hub" ? HUB_SIZE : CARD_H) });
  const pos = new Map();
  const across = direction === "LR" ? CARD_H + GAP_Y : CARD_W + GAP_X;
  const along = direction === "LR" ? CARD_W + GAP_X + 30 : CARD_H + GAP_Y + 30;
  layers.forEach((layer, r) => {
    if (!layer) return;
    const span = (layer.length - 1) * across;
    layer.forEach((n, i) => {
      const s = size(n);
      const off = i * across - span / 2;
      pos.set(n.id, direction === "LR"
        ? { x: r * along, y: off - s.h / 2 + CARD_H / 2 }
        : { x: off - s.w / 2 + CARD_W / 2, y: r * along });
    });
  });

  return {
    ...graph,
    nodes: nodes.map((n) => {
      const s = size(n), p = pos.get(n.id) || { x: 0, y: 0 };
      return { ...n, width: s.w, height: s.h, x: p.x, y: p.y };
    }),
  };
}

// ---- shared helpers ------------------------------------------------------

// Parent lookup built from the hierarchy ("line") edges.
function parentMap(graph) {
  const parent = new Map();
  for (const e of graph.edges || []) {
    if (e.kind === "line" && !parent.has(e.target)) parent.set(e.target, e.source);
  }
  return parent;
}

/**
 * Split a graph into top-level "groups" and their members. A flat list is
 * chunked instead, so the grouped layouts (swimlane, fishbone, venn) always
 * have something sensible to draw rather than degenerating into one lane.
 */
function groupsOf(graph, fallbackGroups = 3) {
  const parent = parentMap(graph);
  const tops = graph.nodes.filter((n) => !parent.has(n.id));
  // A lone root means its CHILDREN are the real groups.
  const roots = tops.length === 1 && graph.nodes.some((n) => parent.get(n.id) === tops[0].id)
    ? graph.nodes.filter((n) => parent.get(n.id) === tops[0].id)
    : tops;

  if (roots.length >= 2 && roots.length < graph.nodes.length) {
    return roots.map((head) => ({
      head, members: graph.nodes.filter((n) => parent.get(n.id) === head.id),
    }));
  }

  const items = [...graph.nodes];
  const size = Math.max(1, Math.ceil(items.length / Math.min(fallbackGroups, items.length || 1)));
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    const chunk = items.slice(i, i + size);
    out.push({ head: chunk[0], members: chunk.slice(1) });
  }
  return out;
}

// Apply computed boxes back onto the graph, defaulting anything unplaced.
function place(graph, pos, fallback) {
  return {
    ...graph,
    nodes: graph.nodes.map((n) => {
      const p = pos.get(n.id);
      return p
        ? { ...n, x: p.x, y: p.y, width: p.w, height: p.h }
        : { ...n, x: 0, y: 0, width: fallback.w, height: fallback.h };
    }),
  };
}

// Nodes in sequence order — the order the text listed them in.
const inOrder = (graph) => [...graph.nodes].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

/**
 * Radial family. Every mode arranges nodes around a centre, but each encodes a
 * different meaning, so they must not draw alike:
 *
 *   mindmap      concentric rings by hierarchy depth, branches kept together
 *   ring         one evenly spaced circle in sequence order, and no centre
 *   pie          wedge angle AND card size track each item's share
 *   convergence  inputs bowed down a left arc into one target
 */
export function radialLayout(graph, mode = "mindmap") {
  const pos = new Map();
  const hub = graph.nodes.find((n) => n.variant === "hub") || null;

  // `mindmap` and `convergence` elect a centre even when the parser did not mark
  // one (a lone root is a centre in all but name), and they give it a HUB_SIZE
  // box. That box has to come with the variant: a node sized like a hub but
  // still drawn as a card is a fat square among ordinary cards, which is not a
  // centre — it just looks like a mistake.
  let centerId = null;
  if (mode === "ring") ringLayout(graph, pos);
  else if (mode === "pie") pieLayout(graph, pos);
  else if (mode === "convergence") centerId = convergenceLayout(graph, pos, hub);
  else centerId = mindmapLayout(graph, pos, hub);

  return {
    ...graph,
    nodes: graph.nodes.map((node) => {
      const p = pos.get(node.id) || { x: 0, y: 0, w: CARD_W, h: CARD_H };
      const variant = node.id === centerId ? "hub" : node.variant;
      return { ...node, x: p.x, y: p.y, width: p.w, height: p.h, variant };
    }),
  };
}

// A cycle has no centre: everything sits on one evenly spaced circle.
function ringLayout(graph, pos) {
  const ordered = inOrder(graph);
  const n = ordered.length || 1;
  const radius = Math.max(260, (n * (CARD_W + 50)) / (2 * Math.PI));
  ordered.forEach((node, i) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / n;
    pos.set(node.id, {
      x: radius * Math.cos(angle) - CARD_W / 2,
      y: radius * Math.sin(angle) - CARD_H / 2,
      w: CARD_W, h: CARD_H,
    });
  });
}

// Wedges sized by weight, so `- Engineering: 45%` really is bigger than `- Support: 10%`.
function pieLayout(graph, pos) {
  const ordered = inOrder(graph);
  const weights = ordered.map((n) => Math.max(1, n.weight ?? 1));
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  const count = ordered.length || 1;
  const radius = Math.max(300, (count * (CARD_W + 40)) / (2 * Math.PI));

  let acc = 0;
  ordered.forEach((node, i) => {
    const share = weights[i] / total;
    const angle = -Math.PI / 2 + 2 * Math.PI * (acc + share / 2);
    acc += share;
    const scale = Math.min(1.5, Math.max(0.7, 0.75 + share * count * 0.35));
    const w = Math.round(CARD_W * scale), h = Math.round(CARD_H * Math.min(1.4, scale));
    pos.set(node.id, { x: radius * Math.cos(angle) - w / 2, y: radius * Math.sin(angle) - h / 2, w, h });
  });
}

// Inputs stacked on a bowed left arc, funnelling into a target on the right.
function convergenceLayout(graph, pos, hub) {
  const center = hub || graph.nodes[graph.nodes.length - 1] || null;
  const inputs = graph.nodes.filter((n) => n.id !== (center && center.id));
  const n = inputs.length || 1;
  const height = Math.max(360, n * (CARD_H + 34));

  inputs.forEach((node, i) => {
    const t = n === 1 ? 0.5 : i / (n - 1);
    const bow = Math.sin(t * Math.PI);
    pos.set(node.id, {
      x: -340 - bow * 120 - CARD_W / 2,
      y: (t - 0.5) * height - CARD_H / 2,
      w: CARD_W, h: CARD_H,
    });
  });
  if (center) pos.set(center.id, { x: -HUB_SIZE / 2, y: -HUB_SIZE / 2, w: HUB_SIZE, h: HUB_SIZE });
  return center ? center.id : null;
}

// Concentric rings by hierarchy depth: children inherit their parent's bearing
// so a branch stays together instead of being scattered around the ring.
function mindmapLayout(graph, pos, hub) {
  const parent = parentMap(graph);
  const roots = graph.nodes.filter((n) => !parent.has(n.id));
  const center = hub
    || (roots.length === 1 ? roots[0] : null)
    || [...graph.nodes].sort((a, b) =>
      (graph.edges || []).filter((e) => e.source === b.id).length
      - (graph.edges || []).filter((e) => e.source === a.id).length)[0]
    || null;

  if (center) pos.set(center.id, { x: -HUB_SIZE / 2, y: -HUB_SIZE / 2, w: HUB_SIZE, h: HUB_SIZE });
  const others = graph.nodes.filter((n) => n.id !== (center && center.id));

  const ringOf = (id) => {
    let d = 0, cur = id;
    const seen = new Set([cur]);
    while (d < 8) {
      const p = parent.get(cur);
      if (p === undefined || seen.has(p)) break;
      d += 1;
      if (center && p === center.id) break;
      seen.add(p); cur = p;
    }
    return Math.max(1, d);
  };

  const byRing = new Map();
  for (const n of others) {
    const ring = ringOf(n.id);
    byRing.set(ring, (byRing.get(ring) || []).concat(n));
  }

  const angleOf = new Map();
  for (const ring of [...byRing.keys()].sort((a, b) => a - b)) {
    const list = byRing.get(ring);
    const radius = Math.max(250 * ring, (list.length * (CARD_W + 40)) / (2 * Math.PI));
    list.forEach((n, i) => {
      const inherited = angleOf.get(parent.get(n.id) ?? "");
      const siblings = list.filter((m) => parent.get(m.id) === parent.get(n.id));
      const idx = siblings.indexOf(n);
      const angle = inherited !== undefined
        ? inherited + (idx - (siblings.length - 1) / 2) * 0.22
        : -Math.PI / 2 + (2 * Math.PI * i) / list.length;
      angleOf.set(n.id, angle);
      pos.set(n.id, {
        x: radius * Math.cos(angle) - CARD_W / 2,
        y: radius * Math.sin(angle) - CARD_H / 2,
        w: CARD_W, h: CARD_H,
      });
    });
  }
  return center ? center.id : null;
}

// Peer cards in a matrix; comparisons split into two labelled columns.
export function gridLayout(graph) {
  const pos = new Map();
  if (graph.structure === "comparison") {
    const left = graph.nodes.filter((n) => n.group !== "right");
    const right = graph.nodes.filter((n) => n.group === "right");
    left.forEach((n, i) => pos.set(n.id, { x: 0, y: i * (CARD_H + GAP_Y) }));
    right.forEach((n, i) => pos.set(n.id, { x: CARD_W + 140, y: i * (CARD_H + GAP_Y) }));
  } else {
    const cols = Math.max(1, Math.ceil(Math.sqrt(graph.nodes.length)));
    graph.nodes.forEach((n, i) => pos.set(n.id, { x: (i % cols) * (CARD_W + GAP_X), y: Math.floor(i / cols) * (CARD_H + GAP_Y) }));
  }
  return { ...graph, nodes: graph.nodes.map((n) => ({ ...n, ...(pos.get(n.id) || { x: 0, y: 0 }), width: CARD_W, height: CARD_H })) };
}

/**
 * A single row (LR) or column (TB) in sequence order.
 *
 *   timeline  alternates either side of a straight axis
 *   journey   follows a full sine period, so the path visibly winds
 */
export function linearLayout(graph, direction = "LR", mode = "timeline") {
  const sorted = inOrder(graph);
  const pos = new Map();
  const n = Math.max(1, sorted.length - 1);
  sorted.forEach((node, i) => {
    if (direction === "TB") {
      // Milestones step either side of a vertical spine, so a roadmap does not
      // collapse into the same single column as a top-down tree.
      const offset = mode === "journey" ? 0 : (i % 2 === 0 ? 0 : CARD_W * 0.55);
      pos.set(node.id, { x: offset, y: i * (CARD_H + GAP_Y) });
    } else if (mode === "journey") {
      pos.set(node.id, { x: i * (CARD_W + GAP_X * 0.8), y: Math.sin((i / n) * Math.PI * 2) * CARD_H * 1.6 });
    } else {
      pos.set(node.id, { x: i * (CARD_W + GAP_X), y: i % 2 === 0 ? 0 : CARD_H + 40 });
    }
  });
  return { ...graph, nodes: graph.nodes.map((n) => ({ ...n, ...(pos.get(n.id) || { x: 0, y: 0 }), width: CARD_W, height: CARD_H })) };
}

// Horizontal bands on a common axis: `funnel` narrows downward, `pyramid` widens.
export function stackedLayout(graph, shape = "funnel") {
  const lerp = (a, b, t) => a + (b - a) * t;
  const sorted = inOrder(graph);
  const n = sorted.length, pos = new Map();
  sorted.forEach((node, i) => {
    const t = n <= 1 ? 0 : i / (n - 1);
    const width = shape === "funnel" ? lerp(BAND_MAX_W, BAND_MIN_W, t) : lerp(BAND_MIN_W, BAND_MAX_W, t);
    pos.set(node.id, { x: (BAND_MAX_W - width) / 2, y: i * (BAND_H + 22), w: width });
  });
  return {
    ...graph,
    nodes: graph.nodes.map((node) => {
      const p = pos.get(node.id) || { x: 0, y: 0, w: BAND_MAX_W };
      return { ...node, x: p.x, y: p.y, width: p.w, height: BAND_H, variant: "band" };
    }),
  };
}

/**
 * Cells in fixed columns.
 *
 *   grid      contiguous cells (SWOT's four boxes, PESTEL's six)
 *   quadrant  a gap down the middle and across, so the axes are visible
 *   auto      wide, shallow rows derived from the item count — a table
 */
export function matrixLayout(graph, cols = 2, mode = "grid") {
  const n = graph.nodes.length;
  const columns = mode === "auto"
    ? Math.max(2, Math.min(4, Math.ceil(Math.sqrt(Math.max(1, n)))))
    : Math.max(1, Math.min(cols, Math.max(1, n)));

  const gapX = mode === "quadrant" ? GAP_X * 1.6 : mode === "auto" ? 10 : GAP_X / 2;
  const gapY = mode === "quadrant" ? GAP_Y * 1.4 : mode === "auto" ? 10 : GAP_Y / 2;
  const cellW = mode === "auto" ? Math.round((CARD_W + 60) * 1.2) : CARD_W + 60;
  const cellH = mode === "auto" ? Math.round((CARD_H + 40) * 0.7) : CARD_H + 40;

  const pos = new Map();
  graph.nodes.forEach((node, i) => {
    pos.set(node.id, {
      x: (i % columns) * (cellW + gapX),
      y: Math.floor(i / columns) * (cellH + gapY),
      w: cellW, h: cellH,
    });
  });
  return place(graph, pos, { w: cellW, h: cellH });
}

/**
 * Nested rings.
 *
 *   bullseye  rings share a CENTRE, so it reads as a target
 *   onion     rings share a BOTTOM EDGE, so every layer's label stays visible
 *             in the band above the one inside it
 */
export function concentricLayout(graph, mode = "bullseye") {
  const OUTER = 520, MIN = 150;
  const ordered = inOrder(graph);
  const n = ordered.length, pos = new Map();
  if (n === 0) return place(graph, pos, { w: CARD_W, h: CARD_H });

  ordered.forEach((node, i) => {
    const t = n <= 1 ? 0 : i / (n - 1);
    const size = OUTER - (OUTER - MIN) * t;
    pos.set(node.id, {
      x: (OUTER - size) / 2,
      y: mode === "onion" ? OUTER - size : (OUTER - size) / 2,
      w: size, h: size,
    });
  });
  const laid = place(graph, pos, { w: CARD_W, h: CARD_H });
  return { ...laid, nodes: laid.nodes.map((n) => ({ ...n, variant: "hub" })) };
}

/**
 * Each stage one step up and to the right of the last, so progress reads as
 * ascending. This is what separates "Steps" from a plain left-to-right flow,
 * which keeps every node on one baseline.
 */
export function staircaseLayout(graph) {
  const pos = new Map();
  const rise = CARD_H + 34;
  inOrder(graph).forEach((node, i) => {
    // Negative y climbs the screen; normalize() shifts it back into view.
    pos.set(node.id, { x: i * (CARD_W + GAP_X / 2), y: -i * rise, w: CARD_W, h: CARD_H });
  });
  return place(graph, pos, { w: CARD_W, h: CARD_H });
}

/**
 * A wide capital resting on evenly spaced columns of equal height. Unlike a
 * top-down tree, the supports share one base line — which is the whole point
 * of the metaphor.
 */
export function pillarsLayout(graph) {
  const CAPITAL_H = 92, PILLAR_H = 300;
  const parent = parentMap(graph);
  const roots = graph.nodes.filter((n) => !parent.has(n.id));
  const capital = graph.nodes.find((n) => n.variant === "hub") || (roots.length === 1 ? roots[0] : null);
  const columns = graph.nodes.filter((n) => n.id !== (capital && capital.id));

  const pos = new Map();
  const step = CARD_W + GAP_X / 2;
  const totalW = Math.max(CARD_W, columns.length * step - GAP_X / 2);
  columns.forEach((node, i) => pos.set(node.id, { x: i * step, y: CAPITAL_H + 40, w: CARD_W, h: PILLAR_H }));
  if (capital) pos.set(capital.id, { x: 0, y: 0, w: totalW, h: CAPITAL_H });

  const laid = place(graph, pos, { w: CARD_W, h: PILLAR_H });
  return {
    ...laid,
    nodes: laid.nodes.map((n) => (capital && n.id === capital.id ? { ...n, variant: "band" } : { ...n, variant: "card" })),
  };
}

/**
 * Fishbone (Ishikawa) — a horizontal spine running into the effect, with cause
 * categories branching off alternately above and below it and their causes
 * strung along each bone.
 */
export function fishboneLayout(graph) {
  const SPAN = 300, RISE = 150;
  const bones = groupsOf(graph, 4);
  const pos = new Map();

  bones.forEach((group, i) => {
    const dir = i % 2 === 0 ? -1 : 1;
    const baseX = i * SPAN;
    pos.set(group.head.id, { x: baseX, y: dir * RISE - CARD_H / 2, w: CARD_W, h: CARD_H });
    group.members.forEach((m, j) => {
      pos.set(m.id, {
        x: baseX + (j + 1) * 40,
        y: dir * (RISE + (j + 1) * (CARD_H + 26)) - CARD_H / 2,
        w: CARD_W, h: CARD_H,
      });
    });
  });

  // Anything unplaced (a synthesised centre, say) goes on the spine tip.
  let extra = 0;
  for (const n of graph.nodes) {
    if (pos.has(n.id)) continue;
    pos.set(n.id, { x: bones.length * SPAN, y: extra * (CARD_H + 20) - CARD_H / 2, w: CARD_W, h: CARD_H });
    extra += 1;
  }
  return place(graph, pos, { w: CARD_W, h: CARD_H });
}

/**
 * Two or three large overlapping circles with their members listed inside.
 * Anything left over lands in the overlap, which is where a "shared" concept
 * belongs.
 */
export function vennLayout(graph) {
  const CIRCLE = 380, OVERLAP = 0.32;
  const groups = groupsOf(graph, 3).slice(0, 3);
  const pos = new Map();
  const step = CIRCLE * (1 - OVERLAP);
  const centers = groups.length >= 3
    ? [{ x: 0, y: 0 }, { x: step, y: 0 }, { x: step / 2, y: step * 0.86 }]
    : [{ x: 0, y: 0 }, { x: step, y: 0 }];

  groups.forEach((group, i) => {
    const c = centers[Math.min(i, centers.length - 1)];
    pos.set(group.head.id, { x: c.x, y: c.y, w: CIRCLE, h: CIRCLE });
    const pull = i === 0 ? -1 : 1;
    group.members.forEach((m, j) => {
      pos.set(m.id, {
        x: c.x + CIRCLE / 2 - CARD_W / 2 + pull * CIRCLE * 0.18,
        y: c.y + CIRCLE / 2 - CARD_H / 2 + (j - (group.members.length - 1) / 2) * (CARD_H + 12),
        w: CARD_W, h: CARD_H,
      });
    });
  });

  const mid = centers.reduce((acc, c) => ({ x: acc.x + c.x / centers.length, y: acc.y + c.y / centers.length }), { x: 0, y: 0 });
  let k = 0;
  for (const n of graph.nodes) {
    if (pos.has(n.id)) continue;
    pos.set(n.id, {
      x: mid.x + CIRCLE / 2 - CARD_W / 2,
      y: mid.y + CIRCLE / 2 - CARD_H / 2 + k * (CARD_H + 12),
      w: CARD_W, h: CARD_H,
    });
    k += 1;
  }

  const laid = place(graph, pos, { w: CARD_W, h: CARD_H });
  const heads = new Set(groups.map((g) => g.head.id));
  return { ...laid, nodes: laid.nodes.map((n) => (heads.has(n.id) ? { ...n, variant: "hub" } : n)) };
}

// One horizontal lane per group: the heading on the left, its members running
// left to right. "Who does what, when."
export function swimlaneLayout(graph) {
  const LANE_GAP = 46, HEAD_W = 190;
  const groups = groupsOf(graph, 3);
  const pos = new Map();

  groups.forEach((group, lane) => {
    const y = lane * (CARD_H + LANE_GAP);
    pos.set(group.head.id, { x: 0, y, w: HEAD_W, h: CARD_H });
    group.members.forEach((m, i) => {
      pos.set(m.id, { x: HEAD_W + GAP_X + i * (CARD_W + GAP_X), y, w: CARD_W, h: CARD_H });
    });
  });

  let lane = groups.length;
  for (const n of graph.nodes) {
    if (pos.has(n.id)) continue;
    pos.set(n.id, { x: 0, y: lane * (CARD_H + LANE_GAP), w: CARD_W, h: CARD_H });
    lane += 1;
  }
  return place(graph, pos, { w: CARD_W, h: CARD_H });
}

/**
 * A central pivot with two opposing sides.
 *
 *   bowtie   causes on the left, consequences on the right, level with the pivot
 *   balance  the pivot sits above and both pans hang below it, like scales
 */
export function butterflyLayout(graph, mode = "bowtie") {
  const SPAN_X = 420, GAP = 30;
  const pos = new Map();
  const center = graph.nodes.find((n) => n.variant === "hub")
    || graph.nodes.find((n) => !n.group)
    || graph.nodes[0];
  if (!center) return place(graph, pos, { w: CARD_W, h: CARD_H });

  const rest = graph.nodes.filter((n) => n.id !== center.id);
  let leftSide = rest.filter((n) => n.group === "left");
  let rightSide = rest.filter((n) => n.group === "right");
  if (leftSide.length === 0 && rightSide.length === 0) {
    const mid = Math.ceil(rest.length / 2);
    leftSide = rest.slice(0, mid);
    rightSide = rest.slice(mid);
  } else {
    const spare = rest.filter((n) => n.group !== "left" && n.group !== "right");
    leftSide = [...leftSide, ...spare.filter((_, i) => i % 2 === 0)];
    rightSide = [...rightSide, ...spare.filter((_, i) => i % 2 === 1)];
  }

  const column = (list, x) => {
    const total = list.length * CARD_H + Math.max(0, list.length - 1) * GAP;
    list.forEach((n, i) => {
      pos.set(n.id, {
        x, y: (mode === "balance" ? HUB_SIZE : -total / 2) + i * (CARD_H + GAP),
        w: CARD_W, h: CARD_H,
      });
    });
  };
  const span = mode === "balance" ? SPAN_X * 0.62 : SPAN_X;
  column(leftSide, -span - CARD_W / 2);
  column(rightSide, span - CARD_W / 2);
  pos.set(center.id, {
    x: -HUB_SIZE / 2, y: mode === "balance" ? -HUB_SIZE : -HUB_SIZE / 2,
    w: HUB_SIZE, h: HUB_SIZE,
  });

  const laid = place(graph, pos, { w: CARD_W, h: CARD_H });
  return { ...laid, nodes: laid.nodes.map((n) => (n.id === center.id ? { ...n, variant: "hub" } : n)) };
}

/**
 * Treemap — rectangles whose AREA is the share. Slice-and-dice with alternating
 * direction: deterministic, and it fills the frame exactly, which is what makes
 * "parts of a whole" legible at a glance.
 */
export function treemapLayout(graph) {
  const AREA = 620;
  const ordered = [...graph.nodes].sort((a, b) => (b.weight ?? 1) - (a.weight ?? 1) || (a.order ?? 0) - (b.order ?? 0));
  const weights = ordered.map((n) => Math.max(0.0001, n.weight ?? 1));
  const pos = new Map();

  const slice = (items, x, y, w, h, horizontal) => {
    if (!items.length) return;
    if (items.length === 1) { pos.set(ordered[items[0]].id, { x, y, w, h }); return; }
    const sum = items.reduce((acc, i) => acc + weights[i], 0);
    // Split near the halfway point by WEIGHT, not by count.
    let acc = 0, cut = 1;
    for (let k = 0; k < items.length - 1; k++) {
      acc += weights[items[k]];
      cut = k + 1;
      if (acc >= sum / 2) break;
    }
    const head = items.slice(0, cut), tail = items.slice(cut);
    const frac = head.reduce((a, i) => a + weights[i], 0) / sum;
    if (horizontal) {
      slice(head, x, y, w * frac, h, !horizontal);
      slice(tail, x + w * frac, y, w * (1 - frac), h, !horizontal);
    } else {
      slice(head, x, y, w, h * frac, !horizontal);
      slice(tail, x, y + h * frac, w, h * (1 - frac), !horizontal);
    }
  };
  slice(ordered.map((_, i) => i), 0, 0, AREA, AREA, true);

  // Inset each tile so they read as separate cards rather than one mosaic.
  for (const [id, box] of pos) {
    pos.set(id, { x: box.x + 5, y: box.y + 5, w: Math.max(60, box.w - 10), h: Math.max(46, box.h - 10) });
  }
  return place(graph, pos, { w: CARD_W, h: CARD_H });
}

// One column split into bands whose HEIGHT is the share: "100% of something,
// divided up".
export function stackedBarLayout(graph) {
  const BAR_W = 420, BAR_H = 560;
  const ordered = inOrder(graph);
  const weights = ordered.map((n) => Math.max(0.0001, n.weight ?? 1));
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  const pos = new Map();

  let y = 0;
  ordered.forEach((node, i) => {
    const h = Math.max(44, (weights[i] / total) * BAR_H);
    pos.set(node.id, { x: 0, y, w: BAR_W, h });
    y += h + 4;
  });
  const laid = place(graph, pos, { w: BAR_W, h: CARD_H });
  return { ...laid, nodes: laid.nodes.map((n) => ({ ...n, variant: "band" })) };
}

// A small visible tip above the waterline and the bulk beneath it, widening
// with depth: "what you see vs what is really going on".
export function icebergLayout(graph) {
  const ordered = inOrder(graph);
  const pos = new Map();
  if (!ordered.length) return place(graph, pos, { w: CARD_W, h: CARD_H });

  const [tip, ...below] = ordered;
  const maxW = CARD_W * 2.2;
  pos.set(tip.id, { x: (maxW - CARD_W) / 2, y: -(CARD_H + 60), w: CARD_W, h: CARD_H });
  below.forEach((node, i) => {
    const t = below.length <= 1 ? 1 : (i + 1) / below.length;
    const w = CARD_W * (1 + t * 1.2);
    pos.set(node.id, { x: (maxW - w) / 2, y: i * (CARD_H + 18), w, h: CARD_H });
  });
  return place(graph, pos, { w: CARD_W, h: CARD_H });
}

// Two piers with a span of decks between them: "from here, across these steps,
// to there".
export function bridgeLayout(graph) {
  const ordered = inOrder(graph);
  const pos = new Map();
  if (!ordered.length) return place(graph, pos, { w: CARD_W, h: CARD_H });
  if (ordered.length <= 2) {
    ordered.forEach((n, i) => pos.set(n.id, { x: i * (CARD_W + GAP_X * 3), y: 0, w: CARD_W, h: CARD_H * 2 }));
    return place(graph, pos, { w: CARD_W, h: CARD_H });
  }

  const spans = ordered.slice(1, -1);
  const step = CARD_W + GAP_X;
  pos.set(ordered[0].id, { x: 0, y: 0, w: CARD_W, h: CARD_H * 2.4 });
  spans.forEach((n, i) => pos.set(n.id, { x: (i + 1) * step, y: -CARD_H - 40, w: CARD_W, h: CARD_H }));
  pos.set(ordered[ordered.length - 1].id, { x: (spans.length + 1) * step, y: 0, w: CARD_W, h: CARD_H * 2.4 });
  return place(graph, pos, { w: CARD_W, h: CARD_H });
}

// A half dial sweeping left (low) to right (high) — a measure, not a cycle.
export function gaugeLayout(graph) {
  const ordered = inOrder(graph);
  const n = ordered.length, pos = new Map();
  if (!n) return place(graph, pos, { w: CARD_W, h: CARD_H });

  const radius = Math.max(320, (n * (CARD_W + 30)) / Math.PI);
  ordered.forEach((node, i) => {
    const t = n === 1 ? 0.5 : i / (n - 1);
    const angle = Math.PI - t * Math.PI;
    pos.set(node.id, {
      x: radius * Math.cos(angle) - CARD_W / 2,
      y: -radius * Math.sin(angle) - CARD_H / 2,
      w: CARD_W, h: CARD_H,
    });
  });
  return place(graph, pos, { w: CARD_W, h: CARD_H });
}

// Blades opening out from a pivot: "one source, several possibilities", without
// the implied equality of a hub and spoke.
export function fanLayout(graph) {
  const ordered = inOrder(graph);
  const n = ordered.length, pos = new Map();
  if (!n) return place(graph, pos, { w: CARD_W, h: CARD_H });

  const spread = Math.PI * 0.62;
  const radius = Math.max(360, (n * (CARD_H + 40)) / spread);
  ordered.forEach((node, i) => {
    const t = n === 1 ? 0.5 : i / (n - 1);
    const angle = -Math.PI / 2 - spread / 2 + t * spread;
    pos.set(node.id, {
      x: radius * Math.cos(angle) - CARD_W / 2,
      y: radius * Math.sin(angle) - CARD_H / 2,
      w: CARD_W, h: CARD_H,
    });
  });
  return place(graph, pos, { w: CARD_W, h: CARD_H });
}

/**
 * Issues stacked on the left, the answer to each directly opposite across a
 * wide gutter. The solution cards are wider, which is what separates this from
 * a symmetric two-column comparison.
 */
export function problemSolutionLayout(graph) {
  const GUTTER = 260, SOLUTION_W = CARD_W * 1.25;
  const ordered = inOrder(graph);
  const pos = new Map();
  if (!ordered.length) return place(graph, pos, { w: CARD_W, h: CARD_H });

  const tagged = ordered.filter((n) => n.group === "left" || n.group === "right");
  let problems = ordered.filter((n) => n.group === "left");
  let solutions = ordered.filter((n) => n.group === "right");
  if (tagged.length !== ordered.length) {
    const mid = Math.ceil(ordered.length / 2);
    problems = ordered.slice(0, mid);
    solutions = ordered.slice(mid);
  }

  const row = CARD_H + GAP_Y;
  problems.forEach((n, i) => pos.set(n.id, { x: 0, y: i * row, w: CARD_W, h: CARD_H }));
  solutions.forEach((n, i) => pos.set(n.id, { x: CARD_W + GUTTER, y: i * row, w: SOLUTION_W, h: CARD_H }));
  return place(graph, pos, { w: CARD_W, h: CARD_H });
}

// Beats rising to a climax and easing back down. Unlike the gauge (a true
// semicircle, whose beats bunch up at the ends) the spacing is uniform, because
// a story's beats are.
export function storyArcLayout(graph) {
  const ordered = inOrder(graph);
  const n = ordered.length, pos = new Map();
  if (!n) return place(graph, pos, { w: CARD_W, h: CARD_H });

  const step = CARD_W + 70, peak = CARD_H * 3.2;
  ordered.forEach((node, i) => {
    const t = n === 1 ? 0.5 : i / (n - 1);
    pos.set(node.id, { x: i * step, y: -Math.sin(t * Math.PI) * peak, w: CARD_W, h: CARD_H });
  });
  return place(graph, pos, { w: CARD_W, h: CARD_H });
}

const PALETTE = ["#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6"];

/**
 * Map every node to the top-level BRANCH it belongs to, by walking hierarchy
 * edges upwards. Returns null when the graph has no nesting, so the caller can
 * fall back to colouring per node.
 */
function branchIndexByNode(graph) {
  const parent = parentMap(graph);
  if (parent.size === 0) return null;

  // The centres are the hubs, plus a lone top-level root — its CHILDREN are the
  // branches, not the root itself.
  const centers = new Set(graph.nodes.filter((n) => n.variant === "hub").map((n) => n.id));
  const tops = graph.nodes.filter((n) => !parent.has(n.id));
  if (tops.length === 1 && graph.nodes.some((n) => parent.get(n.id) === tops[0].id)) centers.add(tops[0].id);

  const isBranchRoot = (id) => {
    const p = parent.get(id);
    return p === undefined || centers.has(p);
  };
  const rootOf = (id) => {
    let cur = id;
    const seen = new Set([cur]);
    while (!isBranchRoot(cur)) {
      const p = parent.get(cur);
      if (p === undefined || seen.has(p)) break;
      cur = p; seen.add(p);
    }
    return cur;
  };

  const order = new Map(), result = new Map();
  for (const n of graph.nodes) {
    if (centers.has(n.id)) continue;
    const root = rootOf(n.id);
    if (!order.has(root)) order.set(root, order.size);
    result.set(n.id, order.get(root));
  }
  return result;
}

// Accent color per node, by role (comparison side / hub / branch).
function assignColors(graph) {
  const branches = branchIndexByNode(graph);
  return {
    ...graph,
    nodes: graph.nodes.map((n) => {
      if (n.color) return n;
      let color;
      if (graph.structure === "comparison") color = n.group === "right" ? "#0ea5e9" : "#6366f1";
      else if (n.variant === "hub") color = "#4f46e5";
      // One colour per branch, shared with its descendants, so a mind map reads
      // as branches rather than as a rainbow of unrelated cards.
      else color = PALETTE[((branches && branches.get(n.id)) ?? n.order ?? 0) % PALETTE.length];
      return { ...n, color };
    }),
  };
}

// Shift the diagram so its top-left corner sits at (PADDING, PADDING).
function normalize(graph) {
  if (!graph.nodes.length) return graph;
  const dx = PADDING - Math.min(...graph.nodes.map((n) => n.x ?? 0));
  const dy = PADDING - Math.min(...graph.nodes.map((n) => n.y ?? 0));
  return { ...graph, nodes: graph.nodes.map((n) => ({ ...n, x: (n.x ?? 0) + dx, y: (n.y ?? 0) + dy })) };
}

/**
 * Position every node for `presetId`. Always call this on the *base* graph from
 * buildGraph (never on an already-laid-out one) so switching presets is
 * idempotent.
 */
export function applyLayout(graph, presetId) {
  const preset = getPreset(presetId);
  const base = {
    ...graph,
    nodes: graph.nodes.map((n) => ({
      ...n,
      width: n.variant === "hub" ? HUB_SIZE : CARD_W,
      height: n.variant === "hub" ? HUB_SIZE : CARD_H,
      variant: n.variant === "hub" ? "hub" : "card",
    })),
  };
  let laid;
  switch (preset.layout) {
    case "layered": laid = layeredLayout(base, preset.direction || "TB"); break;
    case "radial": laid = radialLayout(base, preset.shape || "mindmap"); break;
    case "linear": laid = linearLayout(base, preset.direction || "LR", preset.shape || "timeline"); break;
    case "stacked": laid = stackedLayout(base, preset.id === "pyramid" ? "pyramid" : "funnel"); break;
    case "matrix": laid = matrixLayout(base, preset.columns || 2, preset.shape || "grid"); break;
    case "concentric": laid = concentricLayout(base, preset.shape || "bullseye"); break;
    case "staircase": laid = staircaseLayout(base); break;
    case "pillars": laid = pillarsLayout(base); break;
    case "fishbone": laid = fishboneLayout(base); break;
    case "venn": laid = vennLayout(base); break;
    case "swimlane": laid = swimlaneLayout(base); break;
    case "butterfly": laid = butterflyLayout(base, preset.shape || "bowtie"); break;
    case "treemap": laid = treemapLayout(base); break;
    case "stacked-bar": laid = stackedBarLayout(base); break;
    case "iceberg": laid = icebergLayout(base); break;
    case "bridge": laid = bridgeLayout(base); break;
    case "gauge": laid = gaugeLayout(base); break;
    case "fan": laid = fanLayout(base); break;
    case "problem-solution": laid = problemSolutionLayout(base); break;
    case "story-arc": laid = storyArcLayout(base); break;
    default: laid = gridLayout(base);
  }
  return normalize(assignColors({ ...laid, preset: preset.id }));
}

// ---------------------------------------------------------------------------
// text metrics
// ---------------------------------------------------------------------------

/**
 * Per-glyph advance widths of the engine's built-in face, as a fraction of the
 * font size, for printable ASCII (0x20..0x7E).
 *
 * Transcribed from the table `la-render`'s build script bakes out of
 * `assets/font.ttf` (Inter, SIL OFL) and `la_render::sdf::glyph_advance` reads
 * back. It lives here so the editor can measure text *exactly* as the renderer
 * will: every position derived from it — truncation, centering, the title's
 * box — lands in the same place in the browser and in the exported frame.
 * Anything else is a guess that drifts.
 */
const GLYPH_ADVANCE = [
  0.196126, 0.200552, 0.324834, 0.441624, 0.447412, 0.684738, 0.449115,
  0.209065, 0.254351, 0.254351, 0.349349, 0.461373, 0.200893, 0.320748,
  0.200893, 0.251286, 0.439921, 0.283633, 0.42528, 0.430728, 0.450477,
  0.413703, 0.43243, 0.394635, 0.431409, 0.43243, 0.200893, 0.210427,
  0.461373, 0.461373, 0.461373, 0.3565, 0.673502, 0.481121, 0.456265,
  0.509383, 0.503254, 0.419151, 0.41166, 0.520278, 0.518235, 0.187273,
  0.39804, 0.468523, 0.394295, 0.629918, 0.525386, 0.533217, 0.445369,
  0.533217, 0.448774, 0.447412, 0.450136, 0.518916, 0.481121, 0.687122,
  0.475673, 0.47329, 0.438559, 0.254351, 0.251286, 0.254351, 0.328579,
  0.318024, 0.225068, 0.391571, 0.426982, 0.398381, 0.426982, 0.406553,
  0.258096, 0.427663, 0.412341, 0.168886, 0.168886, 0.382718, 0.168886,
  0.61085, 0.412001, 0.41813, 0.426982, 0.426982, 0.262523, 0.368077,
  0.228133, 0.412341, 0.391911, 0.570672, 0.380675, 0.391911, 0.385101,
  0.297253, 0.231878, 0.297253, 0.461373,
];

/**
 * Fraction of the font size that sits above the baseline — `la_render::sdf`'s
 * `BUILT_IN_BASELINE`. Turning a "centre this vertically" into a baseline
 * needs it, and getting it wrong shifts every label by a few pixels.
 */
export const BASELINE = 0.7536698;

/** Whether the engine's atlas carries a glyph for `ch` (printable ASCII). */
export const hasGlyph = (ch) => {
  const c = ch.codePointAt(0);
  return c >= 0x20 && c < 0x7f;
};

/** Advance width of one glyph at `size`, or 0 for one the atlas has not got. */
export function glyphAdvance(ch, size) {
  const c = ch.codePointAt(0);
  return c >= 0x20 && c < 0x7f ? GLYPH_ADVANCE[c - 0x20] * size : 0;
}

/**
 * Advance width of a whole run at `size` — `la_render::sdf::text_advance`.
 * Characters outside the atlas advance by nothing, exactly as they do there,
 * so a label containing one measures the same on both sides (it just will not
 * draw; see `unsupportedGlyphs`).
 */
export function textAdvance(text, size) {
  let w = 0;
  for (const ch of String(text)) w += glyphAdvance(ch, size);
  return w;
}

/** The distinct characters in `text` the engine cannot draw, in first-seen order. */
export function unsupportedGlyphs(text) {
  const out = [];
  for (const ch of String(text)) {
    if (ch !== "\n" && !hasGlyph(ch) && !out.includes(ch)) out.push(ch);
  }
  return out;
}

// ---------------------------------------------------------------------------
// SVG export
// ---------------------------------------------------------------------------

const round = (n) => Math.round(n * 100) / 100;

function escapeXml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

// Cut a label down to what fits `maxWidth`, measured with the engine's own
// advances rather than an average-character guess, and mark the cut with an
// ellipsis. "..." rather than "…" because the atlas is ASCII: a glyph the
// exporter cannot draw would silently vanish from the end of the line.
const ELLIPSIS = "...";
function truncate(text, maxWidth, fontSize = 15) {
  const s = String(text);
  if (textAdvance(s, fontSize) <= maxWidth) return s;
  const room = maxWidth - textAdvance(ELLIPSIS, fontSize);
  let w = 0, out = "";
  for (const ch of s) {
    const a = glyphAdvance(ch, fontSize);
    if (w + a > room) break;
    w += a; out += ch;
  }
  return out ? out + ELLIPSIS : ELLIPSIS;
}

// ---------------------------------------------------------------------------
// drawing primitives
// ---------------------------------------------------------------------------
//
// Every piece of the diagram is described once, as a short list of primitives,
// and three backends turn that list into SVG, into MXML vector nodes, and into
// Canvas2D calls. This mirrors how `la-render` itself works — one draw-command
// stream, several backends — and it is what lets the editor preview and the
// deterministic export agree without a bitmap in between.
//
//   { t: "path", d, fill, stroke, strokeWidth, dash, cap }
//   { t: "text", x, y, text, size, color, align: "left" | "center" }
//
// `x`/`y` on a text primitive is its BASELINE origin, already resolved from the
// engine's own metrics, so no backend has to re-derive it.

/** The face the browser should try for, matching the engine's built-in Inter. */
export const FALLBACK_FONT = "Inter, system-ui, sans-serif";

/**
 * The em, as a fraction of the engine's text "size".
 *
 * `<mx:Label height>` — the engine's `size` — is the SDF atlas's CELL, not the
 * em: the generator scales each face so ascent-to-descent fills the cell minus
 * its padding (`sdf::generate::face_metrics`). A browser's `font-size` IS the
 * em, so anything drawing the same run with a real font has to shrink by this
 * factor or the glyphs come out ~43% too big for the advances they step by.
 *
 * Derived from the built-in face exactly as the atlas generator derives it:
 *   px / GEN_HI, with px = 32 * (GEN_HI - 2 * GEN_VPAD) / (ascent - descent)
 */
export const EM_PER_CELL = 0.69733655;

const pathPrim = (d, o = {}) => ({ t: "path", d, fill: o.fill || "", stroke: o.stroke || "", strokeWidth: o.strokeWidth || 0, dash: o.dash || "", cap: o.cap || "" });

/** The x of every glyph in a text primitive, at the engine's advances. */
function glyphXs(p) {
  const out = []; let pen = p.x;
  for (const ch of p.text) { out.push(round(pen)); pen += glyphAdvance(ch, p.size); }
  return out;
}

/**
 * A text primitive centred on (cx, cy), using the engine's advances and baseline.
 *
 * `field` names the thing in the graph this run is a picture OF ("label",
 * "description", "title"), or is empty when the run is derived and has no
 * source of its own — the badge mark, which is an icon or the label's first
 * letter, either way derived from words that live somewhere else.
 * The SVG editor uses it to turn a click on a glyph run into an edit of the
 * text it came from; every emitter ignores it.
 */
function centeredText(cx, cy, text, color, size, field = "") {
  const w = textAdvance(text, size);
  // Vertically centred the way the SVG's `dominant-baseline: central` was: half
  // the cap-to-descender box above the baseline.
  return { t: "text", x: round(cx - w / 2), y: round(cy + size * (BASELINE - 0.5)), text, size, color, align: "center", w: round(w), field };
}

/** A text primitive whose baseline origin is its left edge. See centeredText for `field`. */
function leftText(x, y, text, color, size, field = "") {
  return { t: "text", x: round(x), y: round(y), text, size, color, align: "left", w: round(textAdvance(text, size)), field };
}

/** A rounded rectangle as cubics — the grammar both SVG and kurbo agree on. */
function roundRectD(x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2), k = rr * (1 - 0.5522847498);
  const [x0, y0, x1, y1] = [round(x), round(y), round(x + w), round(y + h)];
  const c = (n) => round(n);
  return `M${c(x + rr)} ${y0} L${c(x1 - rr)} ${y0} C${c(x1 - k)} ${y0} ${x1} ${c(y + k)} ${x1} ${c(y + rr)}`
    + ` L${x1} ${c(y1 - rr)} C${x1} ${c(y1 - k)} ${c(x1 - k)} ${y1} ${c(x1 - rr)} ${y1}`
    + ` L${c(x + rr)} ${y1} C${c(x + k)} ${y1} ${x0} ${c(y1 - k)} ${x0} ${c(y1 - rr)}`
    + ` L${x0} ${c(y + rr)} C${x0} ${c(y + k)} ${c(x + k)} ${y0} ${c(x + rr)} ${y0} Z`;
}

/** A circle as four cubics — exact to well under a pixel, and curve data both sides parse. */
function circleD(cx, cy, r) {
  const k = r * 0.5522847498, c = (n) => round(n);
  return `M${c(cx + r)} ${c(cy)} C${c(cx + r)} ${c(cy + k)} ${c(cx + k)} ${c(cy + r)} ${c(cx)} ${c(cy + r)}`
    + ` C${c(cx - k)} ${c(cy + r)} ${c(cx - r)} ${c(cy + k)} ${c(cx - r)} ${c(cy)}`
    + ` C${c(cx - r)} ${c(cy - k)} ${c(cx - k)} ${c(cy - r)} ${c(cx)} ${c(cy - r)}`
    + ` C${c(cx + k)} ${c(cy - r)} ${c(cx + r)} ${c(cy - k)} ${c(cx + r)} ${c(cy)} Z`;
}

// ---------------------------------------------------------------------------
// icons
// ---------------------------------------------------------------------------
//
// Icons are DRAWN, not fetched. Every glyph below is a path in a 24x24 box,
// built from the same absolute M/L/C/Z vocabulary as everything else in this
// file, so an icon is not a special kind of thing: it is geometry, and it
// travels through the SVG, the MXML and the canvas by exactly the routes a card
// outline already does. That is what keeps the export dependency-free — there is
// no icon font to embed, no sprite sheet to ship and nothing to rasterize — and
// it is why an icon can be trimmed by the "Draw on" build and tweened by the
// timeline without either of those knowing icons exist.
//
// They are strokes rather than fills, at a nominal 2/24 of the box, so one path
// reads at badge size and at hub size without a second weight being drawn.

const icP = (pts, close) => pts.map(([x, y], i) => `${i ? "L" : "M"}${round(x)} ${round(y)}`).join(" ") + (close ? " Z" : "");

// An arc from a0 to a1 radians, as cubics of at most a quarter turn each.
// Written open (no leading M when `cont`) so it can continue a subpath.
function icA(cx, cy, r, a0, a1, cont = false) {
  const steps = Math.max(1, Math.ceil(Math.abs(a1 - a0) / (Math.PI / 2)));
  const c = (n) => round(n);
  let d = cont ? "" : `M${c(cx + r * Math.cos(a0))} ${c(cy + r * Math.sin(a0))}`;
  for (let i = 0; i < steps; i++) {
    const s = a0 + (a1 - a0) * (i / steps), e = a0 + (a1 - a0) * ((i + 1) / steps);
    const k = (4 / 3) * Math.tan((e - s) / 4);
    d += `C${c(cx + r * (Math.cos(s) - k * Math.sin(s)))} ${c(cy + r * (Math.sin(s) + k * Math.cos(s)))}`
      + ` ${c(cx + r * (Math.cos(e) + k * Math.sin(e)))} ${c(cy + r * (Math.sin(e) - k * Math.cos(e)))}`
      + ` ${c(cx + r * Math.cos(e))} ${c(cy + r * Math.sin(e))}`;
  }
  return d;
}

// An ellipse as four cubics — the cylinder in `database` needs one, and this
// file has no non-uniform transform to make one out of a circle.
function icE(cx, cy, rx, ry) {
  const kx = rx * 0.5522847498, ky = ry * 0.5522847498, c = (n) => round(n);
  return `M${c(cx + rx)} ${c(cy)} C${c(cx + rx)} ${c(cy + ky)} ${c(cx + kx)} ${c(cy + ry)} ${c(cx)} ${c(cy + ry)}`
    + ` C${c(cx - kx)} ${c(cy + ry)} ${c(cx - rx)} ${c(cy + ky)} ${c(cx - rx)} ${c(cy)}`
    + ` C${c(cx - rx)} ${c(cy - ky)} ${c(cx - kx)} ${c(cy - ry)} ${c(cx)} ${c(cy - ry)}`
    + ` C${c(cx + kx)} ${c(cy - ry)} ${c(cx + rx)} ${c(cy - ky)} ${c(cx + rx)} ${c(cy)} Z`;
}

/**
 * The drawable icon set, keyed by the name stored on a node.
 *
 * Names are deliberately CONCEPTS ("growth", "security") rather than pictures
 * ("chart-up", "shield"): the picker and the keyword matcher both read better
 * for it, and swapping the drawing later does not invalidate saved projects.
 */
export const ICONS = Object.freeze({
  rocket: `${icP([[12, 2], [16.5, 6], [16.5, 13], [12, 17], [7.5, 13], [7.5, 6]], true)} ${icP([[7.5, 12], [4, 15], [5.5, 19]])} ${icP([[16.5, 12], [20, 15], [18.5, 19]])} ${icP([[10, 20], [12, 22], [14, 20]])} ${circleD(12, 8.5, 1.8)}`,
  users: `${circleD(9, 8, 3.2)} ${icA(9, 20, 5.6, Math.PI, 2 * Math.PI)} ${icA(16.5, 8, 2.6, -Math.PI / 2, Math.PI / 2)} ${icP([[17, 15], [21.5, 18], [21.5, 20]])}`,
  idea: `${circleD(12, 8.5, 5.2)} ${icP([[9.6, 13], [9.6, 16.5], [14.4, 16.5], [14.4, 13]])} ${icP([[9.8, 19], [14.2, 19]])} ${icP([[10.7, 21.5], [13.3, 21.5]])}`,
  target: `${circleD(12, 12, 9)} ${circleD(12, 12, 5.2)} ${circleD(12, 12, 1.6)}`,
  settings: `${icP([[2.5, 6.5], [21.5, 6.5]])} ${icP([[2.5, 12], [21.5, 12]])} ${icP([[2.5, 17.5], [21.5, 17.5]])} ${circleD(8, 6.5, 2.4)} ${circleD(16, 12, 2.4)} ${circleD(10, 17.5, 2.4)}`,
  database: `${icE(12, 6, 8, 3.5)} ${icP([[4, 6], [4, 18]])} ${icP([[20, 6], [20, 18]])} ${icA(12, 18, 8, 0, Math.PI)} ${icA(12, 12, 8, 0, Math.PI)}`,
  cloud: `${icA(7, 14, 4.5, Math.PI * 0.5, Math.PI * 1.5)}${icA(11.5, 9.5, 4.5, Math.PI, Math.PI * 2, true)}${icA(16, 14, 4.5, Math.PI * 1.5, Math.PI * 2.5, true)} Z`,
  server: `${roundRectD(3, 3.5, 18, 7, 2)} ${roundRectD(3, 13.5, 18, 7, 2)} ${icP([[6.5, 7], [8.5, 7]])} ${icP([[6.5, 17], [8.5, 17]])}`,
  code: `${icP([[8.5, 7.5], [3.5, 12], [8.5, 16.5]])} ${icP([[15.5, 7.5], [20.5, 12], [15.5, 16.5]])} ${icP([[13.5, 4.5], [10.5, 19.5]])}`,
  security: `${icP([[12, 2.5], [20, 5.5], [20, 11.5]])} ${icA(12, 11.5, 8, 0, Math.PI * 0.5, true)}${icA(12, 11.5, 8, Math.PI * 0.5, Math.PI, true)} ${icP([[4, 11.5], [4, 5.5], [12, 2.5]])} ${icP([[8.5, 12], [11, 14.5], [15.5, 9.5]])}`,
  lock: `${roundRectD(4.5, 10.5, 15, 10.5, 2.5)} ${icP([[8, 10.5], [8, 7.5]])}${icA(12, 7.5, 4, Math.PI, 2 * Math.PI, true)} ${icP([[16, 7.5], [16, 10.5]])} ${icP([[12, 14], [12, 17.5]])}`,
  search: `${circleD(10.5, 10.5, 6.5)} ${icP([[15.2, 15.2], [20.5, 20.5]])}`,
  chart: `${icP([[3.5, 20.5], [20.5, 20.5]])} ${icP([[7, 20.5], [7, 13]])} ${icP([[12, 20.5], [12, 8]])} ${icP([[17, 20.5], [17, 15]])}`,
  growth: `${icP([[3.5, 17], [9, 11.5], [13, 15.5], [20.5, 8]])} ${icP([[15, 7.5], [20.5, 7.5], [20.5, 13]])}`,
  money: `${circleD(12, 12, 9)} ${icP([[12, 6.5], [12, 17.5]])} ${icA(12, 10, 2.6, Math.PI * 0.5, Math.PI * 1.5)} ${icA(12, 14.5, 2.6, Math.PI * 1.5, Math.PI * 2.5)}`,
  cart: `${icP([[2.5, 4], [5, 4], [7.5, 15.5], [18.5, 15.5], [20.5, 7.5], [6, 7.5]])} ${circleD(9, 19.5, 1.6)} ${circleD(17.5, 19.5, 1.6)}`,
  mail: `${roundRectD(2.5, 5, 19, 14, 2.5)} ${icP([[3, 6.5], [12, 13], [21, 6.5]])}`,
  message: `${icP([[5, 4], [19, 4]])}${icA(19, 8, 4, -Math.PI / 2, 0, true)} ${icP([[23, 8], [23, 12]])}${icA(19, 12, 4, 0, Math.PI / 2, true)} ${icP([[19, 16], [10, 16], [6, 20.5], [6, 16], [5, 16]])}${icA(5, 12, 4, Math.PI / 2, Math.PI, true)} ${icP([[1, 12], [1, 8]])}${icA(5, 8, 4, Math.PI, Math.PI * 1.5, true)}`,
  globe: `${circleD(12, 12, 9)} ${icP([[3, 12], [21, 12]])} ${icA(12, 12, 5, -Math.PI / 2, Math.PI / 2)}${icA(12, 12, 5, Math.PI / 2, Math.PI * 1.5, true)} ${icP([[12, 3], [12, 21]])}`,
  calendar: `${roundRectD(3.5, 5, 17, 16, 2.5)} ${icP([[3.5, 10], [20.5, 10]])} ${icP([[8, 2.5], [8, 7]])} ${icP([[16, 2.5], [16, 7]])} ${icP([[8, 14], [10, 14]])} ${icP([[14, 14], [16, 14]])}`,
  clock: `${circleD(12, 12, 9)} ${icP([[12, 6.5], [12, 12], [16, 14.5]])}`,
  check: `${circleD(12, 12, 9)} ${icP([[7.5, 12.2], [10.8, 15.5], [16.5, 9]])}`,
  warning: `${icP([[12, 3], [22, 20.5], [2, 20.5]], true)} ${icP([[12, 9.5], [12, 14.5]])} ${icP([[12, 17.5], [12, 18]])}`,
  flag: `${icP([[5, 21.5], [5, 3]])} ${icP([[5, 3.5], [19, 3.5], [16, 8.5], [19, 13.5], [5, 13.5]])}`,
  star: `${icP([[12, 2.5], [14.9, 8.9], [21.5, 9.7], [16.6, 14.3], [17.9, 21], [12, 17.7], [6.1, 21], [7.4, 14.3], [2.5, 9.7], [9.1, 8.9]], true)}`,
  heart: `M12 20.8 C12 20.8 2.5 14.9 2.5 8.9 C2.5 5.6 5 3.2 8.1 3.2 C10 3.2 11.2 4.2 12 5.4 C12.8 4.2 14 3.2 15.9 3.2 C19 3.2 21.5 5.6 21.5 8.9 C21.5 14.9 12 20.8 12 20.8 Z`,
  energy: `${icP([[13.5, 2], [5, 13.5], [11.5, 13.5], [10.5, 22], [19, 10.5], [12.5, 10.5]], true)}`,
  book: `${icP([[4, 4.5], [4, 19.5], [12, 19.5], [12, 6.5], [4, 4.5]], true)} ${icP([[20, 4.5], [20, 19.5], [12, 19.5], [12, 6.5], [20, 4.5]], true)}`,
  file: `${icP([[6, 2.5], [14, 2.5], [19, 7.5], [19, 21.5], [6, 21.5]], true)} ${icP([[14, 2.5], [14, 7.5], [19, 7.5]]) } ${icP([[9, 13], [16, 13]])} ${icP([[9, 17], [16, 17]])}`,
  folder: `${icP([[2.5, 6.5], [9, 6.5], [11, 9], [21.5, 9], [21.5, 19.5], [2.5, 19.5]], true)}`,
  package: `${icP([[12, 2.5], [21, 7.2], [21, 16.8], [12, 21.5], [3, 16.8], [3, 7.2]], true)} ${icP([[3, 7.2], [12, 12], [21, 7.2]])} ${icP([[12, 12], [12, 21.5]])}`,
  truck: `${icP([[1.5, 5], [13.5, 5], [13.5, 17], [1.5, 17]], true)} ${icP([[13.5, 9], [18, 9], [21.5, 12.5], [21.5, 17], [13.5, 17]])} ${circleD(6, 18.5, 2)} ${circleD(17.5, 18.5, 2)}`,
  building: `${icP([[4, 21.5], [4, 3.5], [15, 3.5], [15, 21.5]], true)} ${icP([[15, 9.5], [20.5, 9.5], [20.5, 21.5]])} ${icP([[7.5, 7.5], [11.5, 7.5]])} ${icP([[7.5, 12], [11.5, 12]])} ${icP([[7.5, 16.5], [11.5, 16.5]])}`,
  home: `${icP([[2.5, 11], [12, 2.5], [21.5, 11]])} ${icP([[5, 9.5], [5, 21], [19, 21], [19, 9.5]])} ${icP([[9.5, 21], [9.5, 14], [14.5, 14], [14.5, 21]])}`,
  lab: `${icP([[9, 2.5], [9, 9.5], [3.5, 19], [20.5, 19], [15, 9.5], [15, 2.5]], true)} ${icP([[7.5, 2.5], [16.5, 2.5]])} ${icP([[6, 14], [18, 14]])}`,
  cpu: `${roundRectD(6, 6, 12, 12, 2)} ${roundRectD(9.5, 9.5, 5, 5, 1)} ${icP([[9, 2], [9, 6]])} ${icP([[15, 2], [15, 6]])} ${icP([[9, 18], [9, 22]])} ${icP([[15, 18], [15, 22]])} ${icP([[2, 9], [6, 9]])} ${icP([[2, 15], [6, 15]])} ${icP([[18, 9], [22, 9]])} ${icP([[18, 15], [22, 15]])}`,
  mobile: `${roundRectD(6.5, 2, 11, 20, 2.5)} ${icP([[10.5, 18.5], [13.5, 18.5]])} ${icP([[10, 5], [14, 5]])}`,
  monitor: `${roundRectD(2.5, 3.5, 19, 13, 2)} ${icP([[8, 20.5], [16, 20.5]])} ${icP([[12, 16.5], [12, 20.5]])}`,
  eye: `M2 12 C5 7 8.5 4.5 12 4.5 C15.5 4.5 19 7 22 12 C19 17 15.5 19.5 12 19.5 C8.5 19.5 5 17 2 12 Z ${circleD(12, 12, 3.4)}`,
  gift: `${roundRectD(3, 8.5, 18, 4.5, 1)} ${icP([[4.5, 13], [4.5, 21], [19.5, 21], [19.5, 13]])} ${icP([[12, 8.5], [12, 21]])} ${icA(9, 5.5, 3, Math.PI * 0.5, Math.PI * 2.5)} ${icA(15, 5.5, 3, Math.PI * 0.5, Math.PI * -1.5)}`,
  sun: `${circleD(12, 12, 4.5)} ${icP([[12, 1.5], [12, 4]])} ${icP([[12, 20], [12, 22.5]])} ${icP([[1.5, 12], [4, 12]])} ${icP([[20, 12], [22.5, 12]])} ${icP([[4.6, 4.6], [6.4, 6.4]])} ${icP([[17.6, 17.6], [19.4, 19.4]])} ${icP([[19.4, 4.6], [17.6, 6.4]])} ${icP([[6.4, 17.6], [4.6, 19.4]])}`,
  network: `${circleD(12, 4.5, 2.5)} ${circleD(4.5, 19, 2.5)} ${circleD(19.5, 19, 2.5)} ${icP([[10.5, 6.5], [6, 16.8]])} ${icP([[13.5, 6.5], [18, 16.8]])} ${icP([[7, 19], [17, 19]])}`,
  share: `${circleD(18.5, 5.5, 2.8)} ${circleD(5.5, 12, 2.8)} ${circleD(18.5, 18.5, 2.8)} ${icP([[8, 10.8], [16, 6.8]])} ${icP([[8, 13.2], [16, 17.2]])}`,
  layers: `${icP([[12, 2.5], [21.5, 7.5], [12, 12.5], [2.5, 7.5]], true)} ${icP([[2.5, 12.5], [12, 17.5], [21.5, 12.5]])} ${icP([[2.5, 17], [12, 22], [21.5, 17]])}`,
  filter: `${icP([[2.5, 4], [21.5, 4], [14, 12.5], [14, 20.5], [10, 18], [10, 12.5]], true)}`,
  workflow: `${roundRectD(2.5, 3, 8, 6, 1.5)} ${roundRectD(13.5, 15, 8, 6, 1.5)} ${icP([[6.5, 9], [6.5, 18], [13.5, 18]])}`,
  work: `${roundRectD(2.5, 7, 19, 13.5, 2)} ${icP([[8.5, 7], [8.5, 4.5], [15.5, 4.5], [15.5, 7]])} ${icP([[2.5, 13], [21.5, 13]])}`,
  gauge: `${icA(12, 15.5, 9, Math.PI, 2 * Math.PI)} ${icP([[12, 15.5], [17, 10]])} ${icP([[12, 19.5], [12, 21]])}`,
  education: `${icP([[12, 3], [22, 8], [12, 13], [2, 8]], true)} ${icP([[6.5, 10.2], [6.5, 17], [12, 19.5], [17.5, 17], [17.5, 10.2]])} ${icP([[21, 8.5], [21, 14]])}`,
  compass: `${circleD(12, 12, 9)} ${icP([[15.8, 8.2], [13.8, 13.8], [8.2, 15.8], [10.2, 10.2]], true)}`,
});

/** Every icon name, in registry order — what a picker lists. */
export const ICON_NAMES = Object.freeze(Object.keys(ICONS));

// Keyword rules, first match wins, evaluated in order. This only ever supplies
// a DEFAULT: whatever it picks can be overridden per node from the picker, and
// an override survives a retype (see applyEdits).
const ICON_RULES = [
  [/launch|deploy|ship|startup|mvp|rocket|go[- ]?live/i, "rocket"],
  [/team|customer|user|people|audience|communit|stakeholder|client|member/i, "users"],
  [/idea|concept|insight|brainstorm|innovat|inspir|imagin/i, "idea"],
  [/goal|target|objective|aim|kpi|milestone|focus|outcome/i, "target"],
  [/config|settings|setup|option|parameter|admin|prefer/i, "settings"],
  [/database|storage|data\s?(base|store)|sql|record|dataset/i, "database"],
  [/cloud|saas|hosting|aws|azure|gcp|serverless/i, "cloud"],
  [/server|backend|api|endpoint|microservice|infra/i, "server"],
  [/code|develop|engineer|program|software|implement/i, "code"],
  [/secur|protect|safe|defen[cs]e|compliance|shield/i, "security"],
  [/auth|login|password|encrypt|privacy|permission|access/i, "lock"],
  [/search|discover|find|explore|research|investigat|scope/i, "search"],
  [/metric|analytic|report|dashboard|statistic|benchmark/i, "chart"],
  [/growth|increase|revenue|trend|improv|optimi|scale/i, "growth"],
  [/money|cost|budget|price|profit|financ|invest|fund|pricing/i, "money"],
  [/cart|purchase|order|ecommerce|shop|retail|checkout|sell/i, "cart"],
  [/email|newsletter|inbox|mail|campaign/i, "mail"],
  [/message|chat|comment|feedback|support|conversation|survey/i, "message"],
  [/global|world|international|web|internet|market|region|locale/i, "globe"],
  [/schedule|calendar|date|event|deadline|sprint|quarter|roadmap/i, "calendar"],
  [/time|duration|speed|latency|fast|quick|hour|realtime|wait/i, "clock"],
  [/done|complete|success|approve|valid|pass|verified|accept|review/i, "check"],
  [/risk|warning|issue|problem|error|threat|challenge|fail|blocker/i, "warning"],
  [/priority|important|highlight|flag|milestone/i, "flag"],
  [/quality|premium|favorite|rating|best|excellence|delight/i, "star"],
  [/health|wellness|care|love|loyalty|satisfaction|retention/i, "heart"],
  [/power|energy|performance|boost|instant|automat|trigger/i, "energy"],
  [/learn|educat|course|training|knowledge|study|teach|onboard/i, "education"],
  [/document|content|article|paper|note|text|spec|brief/i, "file"],
  [/folder|category|group|collection|organi[sz]e|archive/i, "folder"],
  [/product|package|feature|module|bundle|inventory|release/i, "package"],
  [/deliver|logistic|shipping|transport|supply|fulfil/i, "truck"],
  [/company|business|enterprise|organi[sz]ation|corporate|office|manufactur|factory/i, "building"],
  [/home|house|property|domestic|landing|base/i, "home"],
  [/experiment|test|prototype|hypothesis|trial|pilot|lab|qa/i, "lab"],
  [/hardware|processor|compute|chip|device|iot|ai|ml|model|intelligen/i, "cpu"],
  [/mobile|phone|android|ios|smartphone|app/i, "mobile"],
  [/monitor|screen|display|desktop|ui|interface|frontend|design/i, "monitor"],
  [/visib|observ|watch|track|audit|insight|transparen/i, "eye"],
  [/gift|bonus|offer|promo|reward|incentive|referral/i, "gift"],
  [/morning|daylight|solar|bright|awareness/i, "sun"],
  [/network|connection|graph|topology|mesh|integrat/i, "network"],
  [/share|distribute|broadcast|social|publish|syndicat/i, "share"],
  [/layer|stack|tier|level|architecture|platform/i, "layers"],
  [/filter|segment|refine|qualif|narrow|triage/i, "filter"],
  [/workflow|process|pipeline|automation|sequence|flow|stage|step/i, "workflow"],
  [/job|career|work|employ|hr|recruit|role|hiring/i, "work"],
  [/measure|gauge|meter|throughput|capacity|load|usage/i, "gauge"],
  [/library|book|read|guide|manual|documentation/i, "book"],
  [/direction|strategy|navigat|vision|north star|principle/i, "compass"],
  [/read|study|chapter|story|narrative/i, "book"],
];

/**
 * The icon a node's own words suggest, or "" when nothing matches.
 *
 * "" is the LETTER badge, and it is a deliberate default rather than a failure:
 * a wrong icon is worse than no icon, so a concept the rules do not recognise
 * keeps the initial it always had and waits to be given one by hand.
 */
export function pickIcon(text) {
  const hay = String(text || "");
  for (const [re, name] of ICON_RULES) if (re.test(hay)) return name;
  return "";
}

/**
 * What a node currently draws in its badge: its override if it has one, and
 * otherwise whatever its words suggest.
 *
 * An override of "" means "the letter, and stop guessing" — which is why this
 * tests `!== undefined` rather than truthiness. Auto-detection is re-run from
 * the CURRENT label, so retyping a card renames its icon along with its badge
 * initial unless the icon has been pinned by hand.
 */
export function nodeIcon(n) {
  if (!n) return "";
  if (n.icon !== undefined) return ICONS[n.icon] ? n.icon : "";
  return pickIcon(`${n.label || ""} ${n.description || ""}`);
}

/**
 * Scale a path `d` about the origin and then shift it — how a 24x24 icon is
 * placed into a badge. Safe for the same reason translateD is: this module only
 * ever emits absolute M/L/C/Z with plain numbers, so every number in a `d` is a
 * coordinate and the alternation holds.
 */
function placeD(d, s, dx, dy) {
  let i = 0;
  return d.replace(/-?\d*\.?\d+/g, (n) => round(Number(n) * s + (i++ % 2 === 0 ? dx : dy)));
}

/**
 * An icon primitive centred on (cx, cy) at `size` units across.
 *
 * The stroke scales with the box so one path reads at badge size and at hub
 * size; round caps and joins are what stop a 2-unit stroke from looking like
 * cut pipe at small sizes, and both spellings survive into the export.
 */
function iconPrim(name, cx, cy, size, color) {
  const d = ICONS[name];
  if (!d) return null;
  const s = size / 24;
  return pathPrim(placeD(d, s, cx - size / 2, cy - size / 2), {
    stroke: color, strokeWidth: round(Math.max(0.75, 2 * s)), cap: "round",
  });
}

/**
 * Serialize primitives as an SVG fragment.
 *
 * Text carries ONE X PER GLYPH, taken from the engine's own advance table, so
 * the browser lays the run out exactly where `la export` will — no reliance on
 * the viewer resolving the same face, and no drift between this SVG, the
 * editor's canvas and the rendered frame.
 */
function svgOfPrims(prims) {
  return prims.map((p) => {
    if (p.t === "text") {
      return `<text x="${glyphXs(p).join(" ")}" y="${p.y}" font-size="${round(p.size * EM_PER_CELL)}" fill="${p.color}">${escapeXml(p.text)}</text>`;
    }
    const a = [`d="${p.d}"`, `fill="${p.fill || "none"}"`];
    if (p.stroke) a.push(`stroke="${p.stroke}"`, `stroke-width="${p.strokeWidth}"`);
    if (p.dash) a.push(`stroke-dasharray="${p.dash}"`);
    if (p.cap) a.push(`stroke-linecap="${p.cap}"`, `stroke-linejoin="${p.cap}"`);
    return `<path ${a.join(" ")}/>`;
  }).join("\n");
}

/**
 * Serialize primitives as MXML child nodes, offset so the part's own box
 * origin sits at (0, 0) — the local space of the `<mx:Sprite>` that carries it.
 *
 * A `<mx:Label>`'s size is its node height and its box is its node width, so a
 * left-aligned label placed at the primitive's own advance width reproduces
 * exactly what the SVG draws. `y` steps back off the baseline by the face's
 * ascent, which is the one number both sides must share.
 */
function mxmlOfPrims(prims, ox, oy, idBase, indent) {
  return prims.map((p, i) => {
    const { tag, attrs } = primNode(p, `${idBase}-${i}`, ox, oy);
    return `${indent}<${tag} ${attrs.join(" ")}/>`;
  }).join("\n");
}

/** One primitive's MXML tag name and attribute list, local to (ox, oy). */
function primNode(p, id, ox, oy) {
  if (p.t === "text") {
    return {
      tag: "mx:Label",
      // No `width`: the label's width is its WRAP box, and every run here is
      // already positioned glyph-exactly, so a box would only ever break a line
      // that should not break.
      attrs: [`id="${id}"`, `x="${round(p.x - ox)}"`, `y="${round(p.y - oy - p.size * BASELINE)}"`,
        `height="${p.size}"`, `text="${escapeXml(p.text)}"`, `color="${p.color}"`],
    };
  }
  const attrs = [`id="${id}"`, `d="${escapeXml(translateD(p.d, -ox, -oy))}"`];
  if (p.fill) attrs.push(`fill="${p.fill}"`);
  if (p.stroke) attrs.push(`stroke="${p.stroke}"`, `strokeWidth="${p.strokeWidth}"`);
  if (p.dash) attrs.push(`strokeDasharray="${p.dash}"`);
  if (p.cap) attrs.push(`strokeLinecap="${p.cap}"`, `strokeLinejoin="${p.cap}"`);
  return { tag: "mx:Path", attrs };
}

/**
 * Flatten a path `d` into polylines — the same thing `la_core::trim` measures
 * along, so a trim computed here lands where the exporter's does.
 */
function flatten(d, steps = 24) {
  const subs = [];
  let cur = null, px = 0, py = 0;
  const nums = (str) => str.trim().split(/[\s,]+/).filter(Boolean).map(Number);
  for (const m of d.matchAll(/([MLCZ])([^MLCZ]*)/g)) {
    const n = nums(m[2]);
    if (m[1] === "M") { cur = [[n[0], n[1]]]; subs.push(cur); [px, py] = [n[0], n[1]]; }
    else if (m[1] === "L") { cur.push([n[0], n[1]]); [px, py] = [n[0], n[1]]; }
    else if (m[1] === "C") {
      for (let i = 1; i <= steps; i++) {
        const t = i / steps, u = 1 - t;
        cur.push([
          u * u * u * px + 3 * u * u * t * n[0] + 3 * u * t * t * n[2] + t * t * t * n[4],
          u * u * u * py + 3 * u * u * t * n[1] + 3 * u * t * t * n[3] + t * t * t * n[5],
        ]);
      }
      [px, py] = [n[4], n[5]];
    } else if (cur && cur.length) { cur.push([cur[0][0], cur[0][1]]); [px, py] = cur[0]; }
  }
  return subs;
}

/**
 * The path `d` cut down to its first `end` fraction of arc length — the
 * browser-side twin of `la_core::trim_subpaths`, so the "Draw on" preview and
 * the exported frame reveal the same amount of line at the same frame.
 *
 * Subpaths are measured end to end as one length, exactly as the runtime does,
 * so a multi-contour shape draws on continuously instead of racing itself.
 */
export function trimPathD(d, end) {
  if (!(end < 1)) return d;
  if (end <= 0) return "";
  const subs = flatten(d);
  let total = 0;
  for (const s of subs) for (let i = 1; i < s.length; i++) total += Math.hypot(s[i][0] - s[i - 1][0], s[i][1] - s[i - 1][1]);
  let want = total * end, out = "";
  for (const s of subs) {
    if (want <= 0) break;
    out += `M${round(s[0][0])} ${round(s[0][1])}`;
    for (let i = 1; i < s.length && want > 0; i++) {
      const seg = Math.hypot(s[i][0] - s[i - 1][0], s[i][1] - s[i - 1][1]);
      if (seg <= want) { out += ` L${round(s[i][0])} ${round(s[i][1])}`; want -= seg; }
      else {
        const t = seg > 0 ? want / seg : 0;
        out += ` L${round(s[i - 1][0] + (s[i][0] - s[i - 1][0]) * t)} ${round(s[i - 1][1] + (s[i][1] - s[i - 1][1]) * t)}`;
        want = 0;
      }
    }
  }
  return out;
}

/**
 * Draw primitives onto a Canvas2D context — the third backend, and the one the
 * movie editor's preview uses. Text is placed GLYPH BY GLYPH at the engine's
 * own advances rather than handed to `fillText`, so a run lands in exactly the
 * columns the exporter will put it in even when the browser resolves a
 * different face. `opts.trim` cuts unfilled strokes for the "Draw on" build.
 */
export function drawPrims(ctx, prims, opts = {}) {
  const trim = opts.trim === undefined ? 1 : opts.trim;
  for (const p of prims) {
    if (p.t === "text") {
      if (trim < 1) continue;   // labels pop in with the fills, not with the trim
      ctx.fillStyle = p.color;
      ctx.textBaseline = "alphabetic";
      ctx.font = `${round(p.size * EM_PER_CELL)}px ${opts.font || FALLBACK_FONT}`;
      let pen = p.x;
      for (const ch of p.text) { ctx.fillText(ch, pen, p.y); pen += glyphAdvance(ch, p.size); }
      continue;
    }
    const drawable = isDrawable(p);
    if (trim < 1 && !drawable) continue;
    const d = drawable && trim < 1 ? trimPathD(p.d, trim) : p.d;
    if (!d) continue;
    const path = new Path2D(d);
    if (p.fill) { ctx.fillStyle = p.fill; ctx.fill(path); }
    if (p.stroke && p.strokeWidth) {
      ctx.strokeStyle = p.stroke;
      ctx.lineWidth = p.strokeWidth;
      ctx.lineCap = p.cap || "butt";
      ctx.lineJoin = p.cap || "miter";
      ctx.setLineDash(p.dash ? p.dash.split(/[\s,]+/).filter(Boolean).map(Number) : []);
      ctx.stroke(path);
      ctx.setLineDash([]);
    }
  }
}

/**
 * Shift every coordinate in a path `d` by (dx, dy).
 *
 * Safe because this module only ever emits absolute M/L/C/Z with plain numbers
 * — no arcs (whose flag arguments are not coordinates) and no relative
 * commands. `pathPrim` is the only producer, so that stays true by
 * construction rather than by hope.
 */
function translateD(d, dx, dy) {
  let i = 0;
  return d.replace(/-?\d*\.?\d+/g, (n) => round(Number(n) + (i++ % 2 === 0 ? dx : dy)));
}

// ---------------------------------------------------------------------------

function nodeCenter(n) { return { x: (n.x ?? 0) + (n.width ?? 0) / 2, y: (n.y ?? 0) + (n.height ?? 0) / 2 }; }

// Where the line from `from` toward `toward` leaves `node`'s box.
function borderPoint(from, node, toward) {
  const dx = toward.x - from.x, dy = toward.y - from.y;
  if (dx === 0 && dy === 0) return from;
  const hw = (node.width ?? 0) / 2, hh = (node.height ?? 0) / 2;
  const scale = 1 / Math.max(Math.abs(dx) / hw, Math.abs(dy) / hh);
  return { x: from.x + dx * scale, y: from.y + dy * scale };
}

// A node's accent badge carries either a drawn icon or the concept's initial.
// Both are derived from the label, so neither is an editable text run; the icon
// can be pinned by hand from the picker (edits.nodes[id].icon), and the letter
// is what a concept with no recognised icon falls back to.
function renderNode(n) {
  const x = n.x ?? 0, y = n.y ?? 0, w = n.width ?? CARD_W, h = n.height ?? CARD_H;
  const color = n.color || "#6366f1", variant = n.variant || "card";
  const initial = (n.label.trim()[0] || "*").toUpperCase();
  const icon = nodeIcon(n);
  const cx = x + w / 2, cy = y + h / 2;

  if (variant === "hub") {
    const r = Math.min(w, h) / 2;
    const out = [pathPrim(circleD(cx, cy, r), { fill: color })];
    // The icon sits above the label rather than behind it: a circle this size
    // has room for both, and overlapping them would cost the label its legibility.
    if (icon) {
      const size = Math.min(r * 0.72, 34);
      out.push(iconPrim(icon, cx, cy - r * 0.3, size, "#ffffff"));
      out.push(centeredText(cx, cy + r * 0.42, truncate(n.label, w - 20, 14), "#ffffff", 14, "label"));
    } else {
      out.push(centeredText(cx, cy, truncate(n.label, w - 20, 14), "#ffffff", 14, "label"));
    }
    return out;
  }
  if (variant === "band") {
    const out = [pathPrim(roundRectD(x, y, w, h, 10), { fill: color })];
    if (icon) {
      // Centre the icon and the label TOGETHER, so a band reads as one
      // composition instead of a label that has drifted off its own axis.
      const size = Math.min(h * 0.55, 24), gap = 10;
      const label = truncate(n.label, w - 24 - size - gap, 14);
      const tw = textAdvance(label, 14), start = cx - (size + gap + tw) / 2;
      out.push(iconPrim(icon, start + size / 2, cy, size, "#ffffff"));
      out.push(leftText(start + size + gap, cy + 14 * (BASELINE - 0.5), label, "#ffffff", 14, "label"));
    } else {
      out.push(centeredText(cx, cy, truncate(n.label, w - 24, 14), "#ffffff", 14, "label"));
    }
    return out;
  }
  const badgeR = 18, bx = x + 16 + badgeR, by = cy, textX = x + 16 + badgeR * 2 + 12;
  const room = w - (textX - x) - 14;
  const title = truncate(n.label, room);
  const desc = n.description ? truncate(n.description, room, 12) : "";
  const out = [
    pathPrim(roundRectD(x, y, w, h, 14), { fill: "#ffffff", stroke: "#e2e8f0", strokeWidth: 1.5 }),
    pathPrim(circleD(bx, by, badgeR), { fill: color }),
  ];
  // The badge mark is DERIVED from the label, so it carries no field: editing
  // it directly would give the same letter two sources that could disagree.
  out.push(icon
    ? iconPrim(icon, bx, by, badgeR * 1.15, "#ffffff")
    : centeredText(bx, by, initial, "#ffffff", 16));
  out.push(leftText(textX, by - (desc ? 6 : -5), title, "#0f172a", 15, "label"));
  if (desc) out.push(leftText(textX, by + 14, desc, "#64748b", 12, "description"));
  return out;
}

// Render one edge as its own primitives plus the bbox that encloses it. The pad
// covers the 2px stroke and the arrowhead, which reaches ~14 units past the
// endpoint.
const ARROW_LEN = 12, ARROW_HALF = 6;

// The arrowhead is its own filled triangle rather than a marker: markers are an
// SVG-only idea, and a triangle is geometry every backend already draws. It is
// built at the tip, pointing back along the line.
function arrowHead(tip, from, color) {
  const dx = tip.x - from.x, dy = tip.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len, px = -uy, py = ux;
  const bx = tip.x - ux * ARROW_LEN, by = tip.y - uy * ARROW_LEN;
  const c = (n) => round(n);
  return pathPrim(
    `M${c(tip.x)} ${c(tip.y)} L${c(bx + px * ARROW_HALF)} ${c(by + py * ARROW_HALF)}`
    + ` L${c(bx - px * ARROW_HALF)} ${c(by - py * ARROW_HALF)} Z`,
    { fill: color },
  );
}

function renderEdge(edge, byId, connector) {
  const s = byId.get(edge.source), t = byId.get(edge.target);
  if (!s || !t) return null;
  const sc = nodeCenter(s), tc = nodeCenter(t);
  const p1 = borderPoint(sc, s, tc), p2 = borderPoint(tc, t, sc);
  const line = pathPrim(`M${round(p1.x)} ${round(p1.y)} L${round(p2.x)} ${round(p2.y)}`, {
    stroke: connector, strokeWidth: 2, dash: edge.kind === "dotted" ? "4 4" : "",
  });
  // The line is first and stays first: "draw on" trims *it*, and the heads
  // ride in behind on their own.
  const prims = [line];
  if (edge.kind !== "line") prims.push(arrowHead(p2, p1, connector));
  if (edge.kind === "bidirectional") prims.push(arrowHead(p1, p2, connector));
  const pad = 16;
  return {
    prims,
    bbox: {
      x: Math.min(p1.x, p2.x) - pad, y: Math.min(p1.y, p2.y) - pad,
      w: Math.abs(p2.x - p1.x) + pad * 2, h: Math.abs(p2.y - p1.y) + pad * 2,
    },
  };
}

function renderTitle(title, titleColor) {
  const size = 20;
  const prim = leftText(PADDING, 34, title, titleColor, size, "title");
  return { prims: [prim], bbox: { x: PADDING - 4, y: 34 - size * BASELINE - 4, w: prim.w + 8, h: size * 1.4 + 8 } };
}

// The bbox of a node, padded for its 1.5px stroke.
function nodeBbox(n) {
  const x = n.x ?? 0, y = n.y ?? 0, w = n.width ?? CARD_W, h = n.height ?? CARD_H;
  return { x: x - 3, y: y - 3, w: w + 6, h: h + 6 };
}

/**
 * The shared geometry behind every backend: the view box, the centering
 * offset, and every drawable piece in paint order (edges, then nodes, then the
 * title). A piece carries its primitives, not markup, so the SVG, the MXML and
 * the canvas all descend from one description of the drawing.
 *
 * There is no background here. The artwork is transparent, so a backdrop
 * exists in exactly one place: the composition that paints it (the editor's
 * canvas, and the `<mx:Rect>` the exporter emits).
 */
function compose(graph, opts = {}) {
  const connector = opts.connector ?? "#94a3b8";
  const fontFamily = opts.fontFamily ?? FALLBACK_FONT;
  const titleColor = opts.titleColor ?? "#0f172a";
  const nodes = graph.nodes || [];
  const contentW = Math.max(400, ...nodes.map((n) => (n.x ?? 0) + (n.width ?? 0))) + PADDING;
  const contentH = Math.max(300, ...nodes.map((n) => (n.y ?? 0) + (n.height ?? 0))) + PADDING;

  // Expand the canvas to the requested aspect ratio, centering the content.
  let vw = contentW, vh = contentH;
  if (opts.aspect && opts.aspect !== "auto") {
    const [aw, ah] = String(opts.aspect).split(":").map(Number);
    if (aw > 0 && ah > 0) {
      if (contentW / contentH < aw / ah) vw = contentH * (aw / ah);
      else vh = contentW * (ah / aw);
    }
  }
  const ox = (vw - contentW) / 2, oy = (vh - contentH) / 2;
  const byId = new Map(nodes.map((n) => [n.id, n]));

  const pieces = [];
  for (const edge of graph.edges || []) {
    const out = renderEdge(edge, byId, connector);
    if (out) pieces.push({ kind: "edge", id: `edge-${edge.source}-${edge.target}`, source: edge.source, target: edge.target, ...out });
  }
  for (const n of nodes) pieces.push({ kind: "node", id: `node-${n.id}`, node: n, prims: renderNode(n), bbox: nodeBbox(n) });
  if (graph.meta && graph.meta.title) pieces.push({ kind: "title", id: "title", ...renderTitle(graph.meta.title, titleColor) });

  return { vw, vh, ox, oy, fontFamily, pieces };
}

/**
 * Serialize a laid-out graph as a standalone, editable SVG string — the
 * "text -> SVG" payoff, and the file that rides along in the project zip.
 *
 * The background is deliberately *not* painted in. The artwork is the diagram;
 * the backdrop belongs to whatever composites it. Keeping it out means one file
 * drops cleanly onto a slide, a dark theme or a video frame without a white box
 * around it.
 *
 * Text is positioned from the engine's own advance table, so this SVG is a
 * faithful picture of what the deterministic exporter will draw — not merely
 * something that looks similar in a browser.
 *
 * opts: { connector, fontFamily, aspect ("16:9" | "auto" | ...),
 *         title (#0f172a heading color) }
 */
export function exportSvg(graph, opts = {}) {
  const { vw, vh, ox, oy, fontFamily, pieces } = compose(graph, opts);
  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${round(vw)}" height="${round(vh)}" viewBox="0 0 ${round(vw)} ${round(vh)}" font-family="${escapeXml(fontFamily)}">`);
  parts.push(`<g transform="translate(${round(ox)}, ${round(oy)})">`);
  for (const p of pieces) parts.push(svgOfPrims(p.prims));
  parts.push(`</g>`);
  parts.push(`</svg>`);
  return parts.join("\n");
}

// Group coordinates that are within `tol` of each other into ordered bands.
function bandIndex(values, tol) {
  const sorted = [...new Set(values)].sort((a, b) => a - b);
  const bands = [];
  for (const v of sorted) {
    if (!bands.length || v - bands[bands.length - 1] > tol) bands.push(v);
  }
  return (v) => {
    let best = 0;
    for (let i = 0; i < bands.length; i++) if (v >= bands[i] - tol) best = i;
    return best;
  };
}

/**
 * Split a laid-out graph into individually animatable parts: one per edge /
 * node / title, each with a tight bbox in the *final* view coordinates (the
 * centering offset is already applied).
 *
 * Returns { vw, vh, parts }, where each part is
 *   { id, kind, x, y, w, h, level, order, prims }
 * `x/y/w/h` and every primitive coordinate are in SVG user units, so a caller
 * maps them onto the stage with the clip's own box. `level`/`order` drive build
 * sequencing: `level` bands the nodes along the layout's flow axis, `order` is
 * graph order.
 *
 * The parts carry geometry, not pictures. Nothing here is rasterized — the
 * canvas draws these primitives directly and the exporter turns them into
 * `<mx:Path>` / `<mx:Label>` nodes.
 */
export function graphicParts(graph, opts = {}) {
  const { vw, vh, ox, oy, pieces } = compose(graph, opts);
  const nodes = graph.nodes || [];
  const orderOf = new Map(nodes.map((n, i) => [n.id, i]));

  // Band nodes along whichever axis the layout spread them across, so "by
  // level" means rows for a top-down flow and columns for a left-right one.
  const xs = nodes.map((n) => n.x ?? 0), ys = nodes.map((n) => n.y ?? 0);
  const spreadX = xs.length ? Math.max(...xs) - Math.min(...xs) : 0;
  const spreadY = ys.length ? Math.max(...ys) - Math.min(...ys) : 0;
  const axis = spreadX > spreadY ? "x" : "y";
  const toBand = bandIndex(axis === "x" ? xs : ys, 24);
  const levelOf = new Map(nodes.map((n) => [n.id, toBand(axis === "x" ? (n.x ?? 0) : (n.y ?? 0))]));

  const seen = new Set();
  const parts = pieces.map((p, i) => {
    const bb = p.bbox;
    const x = round(bb.x + ox), y = round(bb.y + oy);
    const w = round(Math.max(1, bb.w)), h = round(Math.max(1, bb.h));
    // Slugged ids can collide ("Alpha -> Beta Gamma" and "Alpha Beta -> Gamma"
    // both slug to edge-alpha-beta-gamma). Ids become MXML node ids and plan
    // map keys, both of which must be unique, so disambiguate by position.
    let id = p.id;
    if (seen.has(id)) id = `${id}-${i}`;
    seen.add(id);
    const level = p.kind === "title" ? -1 : p.kind === "node" ? (levelOf.get(p.node.id) ?? 0)
      // A connector waits for whichever end arrives last, so it never dangles
      // from a card that has not been revealed yet.
      : Math.max(levelOf.get(p.source) ?? 0, levelOf.get(p.target) ?? 0);
    const order = p.kind === "title" ? -1 : p.kind === "node" ? (orderOf.get(p.node.id) ?? 0)
      : Math.max(orderOf.get(p.source) ?? 0, orderOf.get(p.target) ?? 0);
    // Into final view coordinates, so a part is self-describing: the caller
    // never has to remember to add the centering offset back on.
    const prims = p.prims.map((q) => (q.t === "text"
      ? { ...q, x: round(q.x + ox), y: round(q.y + oy) }
      : { ...q, d: translateD(q.d, ox, oy) }));
    // The graph element a part came from, so a caller that lets the user click
    // a part (the editor) can address the thing it was made of.
    const ref = p.kind === "node" ? { node: p.node.id }
      : p.kind === "edge" ? { source: p.source, target: p.target } : {};
    return { id, kind: p.kind, x, y, w, h, level, order, prims, ...ref };
  });
  return { vw: round(vw), vh: round(vh), parts };
}

// ---------------------------------------------------------------------------
// direct manipulation — the SVG editor
// ---------------------------------------------------------------------------
//
// The typed outline stays the single source of *content*. Everything a pointer
// can change — where a card sits, how big it is, what colour it is, what shape
// it is, whether a connector is an arrow, what is hidden — is kept apart from
// it as a small `edits` patch keyed by element id.
//
// That separation is the whole design. Because the patch is applied *after*
// applyLayout() and *before* compose(), the SVG, the MXML export and the canvas
// preview all still descend from one graph, so a dragged card animates, exports
// and thumbnails without any of those paths knowing an editor exists. And
// because the patch is a diff rather than a snapshot, editing the text
// afterwards re-runs the layout and the edits ride along on top instead of
// being thrown away.
//
// The rule that keeps it honest: never store an edited graph. Always rebuild
// text -> layout -> edits. applyEdits() is not idempotent (offsets accumulate),
// and it is not meant to be.

/** A patch with nothing in it. */
export const EMPTY_EDITS = Object.freeze({ nodes: {}, edges: {} });

/** The stable key for an edge's entry in an edits patch. */
export const edgeKey = (source, target) => `${source}->${target}`;

/** How many elements a patch touches — what a UI shows as "3 edits". */
export function editCount(edits) {
  if (!edits) return 0;
  return Object.keys(edits.nodes || {}).length + Object.keys(edits.edges || {}).length
    + (edits.title !== undefined ? 1 : 0);
}

/** A deep-enough copy to push on an undo stack. Entries are flat by design. */
export function cloneEdits(edits) {
  const out = { nodes: {}, edges: {} };
  for (const [k, v] of Object.entries((edits && edits.nodes) || {})) out.nodes[k] = { ...v };
  for (const [k, v] of Object.entries((edits && edits.edges) || {})) out.edges[k] = { ...v };
  if (edits && edits.title !== undefined) out.title = edits.title;
  return out;
}

const MIN_NODE_W = 60, MIN_NODE_H = 40;

/**
 * Fold an edits patch into a laid-out graph.
 *
 * Node entries: { dx, dy, w, h, color, variant, hidden, label, description,
 * icon }.
 * Positions are stored as offsets from wherever the layout put the node, not as
 * absolutes, so switching preset re-flows the diagram and *keeps* the nudges
 * rather than scattering the cards across a layout they no longer belong to.
 *
 * Edge entries: { kind, hidden }. A top-level `title` overrides the heading.
 *
 * Text overrides are what let the preview be typed into directly. They shadow
 * the outline rather than rewriting it, so the source text stays the source
 * text: a node's *identity* still comes from what was typed (which is why a
 * rename never reshuffles the patch's own keys, or the ids the export uses),
 * while what it *says* can be corrected in place. An empty string is a real
 * value — it is how a description is taken away — so these are read with
 * `!== undefined`, never for truthiness.
 *
 * Hiding a node hides its connectors too — a line to nowhere is never what was
 * meant. Positions clamp at PADDING so nothing can be dragged off the top-left
 * of the frame and silently cropped; the right and bottom simply grow.
 */
export function applyEdits(graph, edits) {
  if (!graph || !editCount(edits)) return graph;
  const ne = edits.nodes || {}, ee = edits.edges || {};
  const nodes = [];
  for (const n of graph.nodes || []) {
    const e = ne[n.id];
    if (!e) { nodes.push(n); continue; }
    if (e.hidden) continue;
    const was = n.variant || "card";
    const variant = e.variant || was;
    // A node keeps its laid-out size, but a *changed* shape brings its own —
    // a hub is a circle, and stretching the old card box over it would lie.
    const defW = variant === "hub" ? HUB_SIZE : CARD_W;
    const defH = variant === "hub" ? HUB_SIZE : variant === "band" ? BAND_H : CARD_H;
    const baseW = variant === was ? (n.width ?? defW) : defW;
    const baseH = variant === was ? (n.height ?? defH) : defH;
    nodes.push({
      ...n, variant,
      x: Math.max(PADDING, (n.x ?? 0) + (e.dx || 0)),
      y: Math.max(PADDING, (n.y ?? 0) + (e.dy || 0)),
      width: Math.max(MIN_NODE_W, e.w ?? baseW),
      height: Math.max(MIN_NODE_H, e.h ?? baseH),
      color: e.color || n.color,
      label: e.label !== undefined ? e.label : n.label,
      description: e.description !== undefined ? e.description : n.description,
      // Like the text overrides, "" is a real value here: it pins the LETTER
      // badge and stops auto-detection from guessing again on the next retype.
      ...(e.icon !== undefined ? { icon: e.icon } : {}),
    });
  }
  const live = new Set(nodes.map((n) => n.id));
  const edges = [];
  for (const edge of graph.edges || []) {
    if (!live.has(edge.source) || !live.has(edge.target)) continue;
    const e = ee[edgeKey(edge.source, edge.target)];
    if (e && e.hidden) continue;
    edges.push(e && e.kind ? { ...edge, kind: e.kind } : edge);
  }
  const meta = edits.title !== undefined ? { ...graph.meta, title: edits.title } : graph.meta;
  return { ...graph, nodes, edges, meta };
}

/**
 * Drop patch entries whose element no longer exists in `graph`.
 *
 * Retyping the text is how an element disappears, and a stale entry would
 * otherwise lie in wait and re-apply itself the moment a node of the same name
 * came back. Call this whenever the graph is rebuilt. Returns a new patch, or
 * the same one when nothing was stale, so callers can skip a re-render.
 */
export function pruneEdits(edits, graph) {
  if (!editCount(edits)) return edits || { nodes: {}, edges: {} };
  const ids = new Set((graph.nodes || []).map((n) => n.id));
  const keys = new Set((graph.edges || []).map((e) => edgeKey(e.source, e.target)));
  const out = { nodes: {}, edges: {} };
  let dropped = 0;
  for (const [k, v] of Object.entries(edits.nodes || {})) { if (ids.has(k)) out.nodes[k] = v; else dropped++; }
  for (const [k, v] of Object.entries(edits.edges || {})) { if (keys.has(k)) out.edges[k] = v; else dropped++; }
  // A retitled heading has nothing to shadow once the `#` line is gone.
  if (edits.title !== undefined) {
    if (graph.meta && graph.meta.title) out.title = edits.title; else dropped++;
  }
  return dropped ? out : edits;
}

/**
 * The editable text run of `part` under (x, y) in view coordinates, or null.
 *
 * A run's box is derived the same way it is drawn: `x` is already its left edge
 * (centred runs are positioned, not centred, by the time they are primitives)
 * and `y` is its baseline, so the box steps back off the baseline by the face's
 * ascent.
 *
 * The search runs twice: once on the exact boxes, then once on boxes widened by
 * `pad`. A 12px caption is a very small target, so the slack matters — but a
 * card's label and its detail line sit close enough that padding alone would
 * make them overlap, and the lower one (drawn last) would then steal every
 * click aimed at the upper. Exact-first means the slack only ever decides where
 * nothing else was hit.
 *
 * A run with no `field` — the badge initial, which is derived from the label —
 * is never a target: it has no source of its own to edit.
 */
export function textHitAt(part, x, y, pad = 4) {
  if (!part || !part.prims) return null;
  const runs = [];
  for (let i = part.prims.length - 1; i >= 0; i--) {
    const p = part.prims[i];
    if (p.t !== "text" || !p.field) continue;
    runs.push([p, { x: p.x, y: round(p.y - p.size * BASELINE), w: Math.max(p.w, 8), h: round(p.size) }]);
  }
  for (const slack of [0, pad]) {
    for (const [p, box] of runs) {
      if (x >= box.x - slack && x <= box.x + box.w + slack && y >= box.y - slack && y <= box.y + box.h + slack) {
        return { field: p.field, box, size: p.size, color: p.color, align: p.align, text: p.text };
      }
    }
  }
  return null;
}

/**
 * What a part's editable text runs currently SAY at their source — the full
 * strings, not the truncated pictures of them that `truncate()` draws.
 *
 * Reading through to the graph is what makes inline editing honest: a card
 * whose label is too long to fit shows an ellipsis, and typing into it must
 * start from the whole label rather than from the shortened form, or every
 * edit would quietly amputate the text it was meant to correct.
 */
export function partText(part, graph, field) {
  if (!part || !graph) return "";
  if (part.kind === "title") return (graph.meta && graph.meta.title) || "";
  const n = (graph.nodes || []).find((q) => q.id === part.node);
  if (!n) return "";
  return (field === "description" ? n.description : n.label) || "";
}
function distToSegment(px, py, ax, ay, bx, by) {
  const vx = bx - ax, vy = by - ay;
  const len2 = vx * vx + vy * vy;
  const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / len2)) : 0;
  const dx = px - (ax + vx * t), dy = py - (ay + vy * t);
  return Math.hypot(dx, dy);
}

const SEG_RE = /^M\s*(-?[\d.]+)[ ,]+(-?[\d.]+)\s*L\s*(-?[\d.]+)[ ,]+(-?[\d.]+)/;

/**
 * The topmost part under (x, y) in view coordinates, or null.
 *
 * Parts arrive in paint order, so the search runs backwards: what is drawn last
 * is what the pointer lands on. Nodes and the title are hit by their box; an
 * edge is hit by proximity to its line, because its box is a big empty diagonal
 * rectangle that would otherwise steal clicks meant for the cards it crosses.
 */
export function hitTestParts(parts, x, y, tol = 6) {
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    if (p.kind === "edge") {
      const seg = SEG_RE.exec((p.prims[0] && p.prims[0].d) || "");
      if (!seg) continue;
      if (distToSegment(x, y, +seg[1], +seg[2], +seg[3], +seg[4]) <= tol + 2) return p;
      continue;
    }
    if (x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + p.h) return p;
  }
  return null;
}

/**
 * Nudge a proposed box onto its neighbours' edges and centres.
 *
 * Alignment is the difference between a diagram and a pile of boxes, and by
 * eye nobody hits it. Each axis snaps to the single nearest candidate within
 * `tol`; the guides that come back are the lines to draw so the user can see
 * *why* it stuck.
 *
 * `box` and each of `others` is { x, y, width, height }. Returns
 * { x, y, guides: [{ axis, at, from, to }] }.
 */
export function snapBox(box, others, tol = 6) {
  const pick = (edges, cands) => {
    let best = null;
    for (const [own, at] of edges) {
      for (const c of cands) {
        const d = Math.abs(c - at);
        if (d <= tol && (!best || d < best.d)) best = { d, delta: c - at, at: c, own };
      }
    }
    return best;
  };
  const xs = [], ys = [];
  for (const o of others) {
    xs.push(o.x, o.x + o.width / 2, o.x + o.width);
    ys.push(o.y, o.y + o.height / 2, o.y + o.height);
  }
  const hx = pick([["l", box.x], ["c", box.x + box.width / 2], ["r", box.x + box.width]], xs);
  const hy = pick([["t", box.y], ["m", box.y + box.height / 2], ["b", box.y + box.height]], ys);
  const x = box.x + (hx ? hx.delta : 0), y = box.y + (hy ? hy.delta : 0);
  const guides = [];
  if (hx) {
    const span = others.filter((o) => Math.abs(o.x - hx.at) < 1 || Math.abs(o.x + o.width / 2 - hx.at) < 1 || Math.abs(o.x + o.width - hx.at) < 1);
    guides.push({
      axis: "x", at: hx.at,
      from: Math.min(y, ...span.map((o) => o.y)), to: Math.max(y + box.height, ...span.map((o) => o.y + o.height)),
    });
  }
  if (hy) {
    const span = others.filter((o) => Math.abs(o.y - hy.at) < 1 || Math.abs(o.y + o.height / 2 - hy.at) < 1 || Math.abs(o.y + o.height - hy.at) < 1);
    guides.push({
      axis: "y", at: hy.at,
      from: Math.min(x, ...span.map((o) => o.x)), to: Math.max(x + box.width, ...span.map((o) => o.x + o.width)),
    });
  }
  return { x, y, guides };
}

/**
 * One-call text -> SVG. Returns the SVG string plus the graph it came from and
 * the presets that fit the detected structure, so a UI can offer alternatives.
 *
 *   const { svg, graph, presetId, choices } = textToSvg("# Roadmap\n- Plan\n- Ship");
 *
 * The SVG comes back with a transparent background; see exportSvg().
 *
 * Choosing a preset by hand REPARSES the text for it: a layout implies a
 * structure, so picking "Comparison" for a flow splits the concepts into two
 * sides and picking "Cycle" for a flat list chains them and closes the loop.
 * The text itself is never edited. `naturalStructure` is the reading the text
 * gets on its own, so a UI can offer "reset to detected".
 *
 * `opts.edits` is the SVG editor's patch: direct-manipulation changes folded in
 * after the layout runs, so a moved or restyled element flows through to the
 * SVG, the parts and the export without any of them special-casing it.
 *
 * opts: { mode, preset, aspect, connector, fontFamily, edits }
 */
export function textToSvg(text, opts = {}) {
  const chosen = opts.preset && PRESET_BY_ID.has(opts.preset) ? getPreset(opts.preset) : null;
  const natural = textToGraph(text, opts.mode || "auto");
  const forced = chosen ? targetStructureOf(chosen) : undefined;
  const base = forced && forced !== natural.structure
    ? textToGraph(text, opts.mode || "auto", forced)
    : natural;
  const choices = presetsForStructure(natural.structure);
  const wanted = chosen ? chosen.id : base.preset;
  const laid = applyLayout(base, wanted);
  const edits = pruneEdits(opts.edits, laid);
  const graph = applyEdits(laid, edits);
  return {
    svg: exportSvg(graph, opts), graph, presetId: wanted,
    structure: base.structure, naturalStructure: natural.structure,
    forced: base.structure !== natural.structure,
    choices, edits,
  };
}

// ---------------------------------------------------------------------------
// build animation
// ---------------------------------------------------------------------------
//
// A "build" is PowerPoint's staged reveal: each part of the diagram enters with
// an effect, in an order, spaced by a stagger, and optionally leaves again.
//
// Everything below is pure and unit-agnostic. planBuild() turns the settings
// into per-part keyframe rows in *absolute scene frames*; the movie editor
// feeds those same rows to both the canvas preview and the emitted .lax, so the
// two cannot disagree about timing. The easings are transcribed 1:1 from
// crates/la-tween/src/easing.rs and the sampler mirrors la_timeline::Track —
// values hold outside the keyframe range and the ease belongs to the segment
// *ending* at a keyframe.

const flipOut = (t, f) => 1 - f(1 - t);
const inOutOf = (t, f) => (t < 0.5 ? f(2 * t) / 2 : 1 - f(2 - 2 * t) / 2);
const p2 = (t) => t * t, p3 = (t) => t * t * t, p4 = (t) => t * t * t * t, p5 = (t) => t * t * t * t * t;
function bounceOut(t) {
  const N1 = 7.5625, D1 = 2.75;
  if (t < 1 / D1) return N1 * t * t;
  if (t < 2 / D1) { const u = t - 1.5 / D1; return N1 * u * u + 0.75; }
  if (t < 2.5 / D1) { const u = t - 2.25 / D1; return N1 * u * u + 0.9375; }
  const u = t - 2.625 / D1; return N1 * u * u + 0.984375;
}
const C1 = 1.70158, C3 = C1 + 1, C2 = C1 * 1.525;
const C4 = (2 * Math.PI) / 3, C5 = (2 * Math.PI) / 4.5;

/** The 31 easings the runtime understands, keyed by their MXML `ease` name. */
export const EASINGS = {
  linear: (t) => t,
  quadIn: p2, quadOut: (t) => flipOut(t, p2), quadInOut: (t) => inOutOf(t, p2),
  cubicIn: p3, cubicOut: (t) => flipOut(t, p3), cubicInOut: (t) => inOutOf(t, p3),
  quartIn: p4, quartOut: (t) => flipOut(t, p4), quartInOut: (t) => inOutOf(t, p4),
  quintIn: p5, quintOut: (t) => flipOut(t, p5), quintInOut: (t) => inOutOf(t, p5),
  sineIn: (t) => 1 - Math.cos((t * Math.PI) / 2),
  sineOut: (t) => Math.sin((t * Math.PI) / 2),
  sineInOut: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  expoIn: (t) => Math.pow(2, 10 * t - 10),
  expoOut: (t) => 1 - Math.pow(2, -10 * t),
  expoInOut: (t) => (t < 0.5 ? Math.pow(2, 20 * t - 10) / 2 : (2 - Math.pow(2, -20 * t + 10)) / 2),
  circIn: (t) => 1 - Math.sqrt(1 - t * t),
  circOut: (t) => Math.sqrt(1 - (t - 1) * (t - 1)),
  circInOut: (t) => (t < 0.5
    ? (1 - Math.sqrt(1 - Math.pow(2 * t, 2))) / 2
    : (Math.sqrt(1 - Math.pow(-2 * t + 2, 2)) + 1) / 2),
  backIn: (t) => C3 * t * t * t - C1 * t * t,
  backOut: (t) => { const u = t - 1; return 1 + C3 * u * u * u + C1 * u * u; },
  backInOut: (t) => (t < 0.5
    ? (Math.pow(2 * t, 2) * ((C2 + 1) * 2 * t - C2)) / 2
    : (Math.pow(2 * t - 2, 2) * ((C2 + 1) * (t * 2 - 2) + C2) + 2) / 2),
  elasticIn: (t) => -Math.pow(2, 10 * t - 10) * Math.sin((t * 10 - 10.75) * C4),
  elasticOut: (t) => Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * C4) + 1,
  elasticInOut: (t) => (t < 0.5
    ? -(Math.pow(2, 20 * t - 10) * Math.sin((20 * t - 11.125) * C5)) / 2
    : (Math.pow(2, -20 * t + 10) * Math.sin((20 * t - 11.125) * C5)) / 2 + 1),
  bounceIn: (t) => 1 - bounceOut(1 - t),
  bounceOut,
  bounceInOut: (t) => (t < 0.5 ? (1 - bounceOut(1 - 2 * t)) / 2 : (1 + bounceOut(2 * t - 1)) / 2),
};

export const EASING_NAMES = Object.keys(EASINGS);

/** Evaluate an easing by name; endpoints are exact, as the runtime requires. */
export function ease(name, t) {
  const f = EASINGS[name] || EASINGS.linear;
  const c = t <= 0 ? 0 : t >= 1 ? 1 : t;
  return c === 0 ? 0 : c === 1 ? 1 : f(c);
}

/**
 * Sample one property's keyframes at a (possibly fractional) frame, exactly as
 * la_timeline::Track::sample does: hold outside the range, and interpolate with
 * the easing carried by the *later* keyframe.
 *
 * `keys` is [{ frame, value, ease }], sorted by frame.
 */
export function sampleTrack(keys, frame) {
  if (!keys || !keys.length) return undefined;
  const first = keys[0], last = keys[keys.length - 1];
  if (frame <= first.frame) return first.value;
  if (frame >= last.frame) return last.value;
  let i = 1;
  while (i < keys.length && keys[i].frame <= frame) i++;
  const a = keys[i - 1], b = keys[i];
  const span = b.frame - a.frame;
  const t = span === 0 ? 1 : (frame - a.frame) / span;
  return a.value + (b.value - a.value) * ease(b.ease || "linear", t);
}

// The animatable channels of a part. `dx`/`dy` are offsets from the resting
// position in SVG user units; `sx`/`sy` scale about the anchor; `rot` is
// *radians*, matching `Stage::set_rotation`, so the exporter writes it through
// untouched. `trim` is the fraction of each stroked path that is drawn — a
// vector-only channel (`la_ir::NodeKindIr::Path::trim_end`) with no bitmap
// equivalent. Only channels that actually move get a track.
const REST = { dx: 0, dy: 0, sx: 1, sy: 1, rot: 0, alpha: 1, trim: 1 };
const DEG = Math.PI / 180;

/**
 * The entrance effects, in the order a picker should show them. Each is just a
 * starting offset that eases to REST, which is why the exporter needs no
 * per-effect knowledge at all.
 *
 * `anchor` is the pivot in 0..1 of the part's own box (default centre).
 * `dirs` lists the directions the effect accepts, if any.
 * `strokeOnly` marks an effect that needs a stroked path to act on, so a UI can
 * say so and the planner can fall back for the parts that have none.
 */
export const ENTRANCES = [
  { id: "none", label: "None" },
  { id: "appear", label: "Appear", ease: "linear", instant: true },
  { id: "fade", label: "Fade in", ease: "sineOut" },
  { id: "fly", label: "Fly in", ease: "quintOut", dirs: ["left", "right", "top", "bottom"], defaultDir: "left" },
  { id: "float", label: "Float in", ease: "quadOut", dirs: ["bottom", "top"], defaultDir: "bottom" },
  { id: "zoom", label: "Zoom in", ease: "backOut" },
  { id: "grow", label: "Grow & turn", ease: "backOut" },
  { id: "drop", label: "Drop in", ease: "bounceOut" },
  { id: "stretch", label: "Stretch", ease: "quadOut", dirs: ["left", "right", "top", "bottom"], defaultDir: "left" },
  { id: "pop", label: "Pop", ease: "quadInOut" },
  { id: "draw", label: "Draw on", ease: "quadInOut", strokeOnly: true },
];

export const EXITS = [
  { id: "none", label: "None" },
  { id: "disappear", label: "Disappear", ease: "linear", instant: true },
  { id: "fade", label: "Fade out", ease: "sineIn" },
  { id: "fly", label: "Fly out", ease: "quintIn", dirs: ["left", "right", "top", "bottom"], defaultDir: "right" },
  { id: "float", label: "Float out", ease: "quadIn", dirs: ["top", "bottom"], defaultDir: "top" },
  { id: "zoom", label: "Zoom out", ease: "backIn" },
];

const byIdOf = (list) => new Map(list.map((e) => [e.id, e]));
const ENTRANCE_BY_ID = byIdOf(ENTRANCES), EXIT_BY_ID = byIdOf(EXITS);
export const getEntrance = (id) => ENTRANCE_BY_ID.get(id) || ENTRANCE_BY_ID.get("none");
export const getExit = (id) => EXIT_BY_ID.get(id) || EXIT_BY_ID.get("none");

/** The defaults a fresh clip animates with: a gentle staggered fade-and-rise. */
export const DEFAULT_ANIM = {
  effect: "none", direction: "", sequence: "one", duration: 0.6, stagger: 0.25,
  delay: 0.2, ease: "", exit: "none", exitDirection: "", exitDuration: 0.5, exitEase: "",
};

export const SEQUENCES = [
  { id: "all", label: "All at once" },
  { id: "one", label: "One by one" },
  { id: "level", label: "By level" },
];

// How far off-canvas a flying part starts, so it is fully hidden at t=0.
function flyOffset(dir, part, view) {
  switch (dir) {
    case "left": return { dx: -(part.x + part.w + 24), dy: 0 };
    case "right": return { dx: view.vw - part.x + 24, dy: 0 };
    case "top": return { dx: 0, dy: -(part.y + part.h + 24) };
    default: return { dx: 0, dy: view.vh - part.y + 24 };
  }
}

// The "from" state and pivot for one entrance effect on one part.
function entranceFrom(effect, dir, part, view) {
  switch (effect) {
    case "appear": return { from: { alpha: 0 }, anchor: null };
    case "fade": return { from: { alpha: 0 }, anchor: null };
    case "fly": return { from: { alpha: 0, ...flyOffset(dir, part, view) }, anchor: null };
    case "float": return { from: { alpha: 0, dy: dir === "top" ? -44 : 44 }, anchor: null };
    case "zoom": return { from: { alpha: 0, sx: 0.4, sy: 0.4 }, anchor: null };
    case "grow": return { from: { alpha: 0, sx: 0.5, sy: 0.5, rot: -15 * DEG }, anchor: null };
    case "drop": return { from: { alpha: 0, dy: -(part.y + part.h + 24) }, anchor: null };
    case "stretch": {
      const horizontal = dir === "left" || dir === "right";
      const anchor = dir === "left" ? { ax: 0, ay: 0.5 } : dir === "right" ? { ax: 1, ay: 0.5 }
        : dir === "top" ? { ax: 0.5, ay: 0 } : { ax: 0.5, ay: 1 };
      return { from: { alpha: 0, sx: horizontal ? 0.02 : 1, sy: horizontal ? 1 : 0.02 }, anchor };
    }
    case "pop": return { from: { alpha: 0, sx: 0.9, sy: 0.9 }, anchor: null };
    // The connector draws itself along its own length — the renderer's trim
    // path, which is why this effect only exists now that parts are vector.
    case "draw": return isLineArt(part)
      ? { from: { trim: 0 }, anchor: null }
      : { from: { alpha: 0 }, anchor: null };
    default: return { from: {}, anchor: null };
  }
}

/**
 * Whether a primitive is an unfilled stroke — the only thing a trim can reveal.
 * Trimming cuts the contour itself, so a filled shape would be *eaten* by a
 * trim rather than uncovered by it.
 */
const isDrawable = (p) => p.t === "path" && !!p.stroke && p.strokeWidth > 0 && !p.fill;

/** Whether a part is line art, i.e. has something a "Draw on" can draw along. */
function isLineArt(part) {
  return (part.prims || []).some(isDrawable);
}

// The "to" state for one exit effect on one part.
function exitTo(effect, dir, part, view) {
  switch (effect) {
    case "disappear": return { alpha: 0 };
    case "fade": return { alpha: 0 };
    case "fly": return { alpha: 0, ...flyOffset(dir, part, view) };
    case "float": return { alpha: 0, dy: dir === "bottom" ? 44 : -44 };
    case "zoom": return { alpha: 0, sx: 0.4, sy: 0.4 };
    default: return { alpha: 0 };
  }
}

/**
 * Assign each part its position in the build. Edges take the step of whichever
 * endpoint arrives last, so a connector never dangles from nothing, and the
 * title is always first.
 */
export function buildSteps(parts, sequence) {
  if (sequence === "all") return new Map(parts.map((p) => [p.id, 0]));
  const hasTitle = parts.some((p) => p.kind === "title");
  const base = hasTitle ? 1 : 0;
  // Rank on whichever key the sequence orders by, then read every part — edges
  // included — through that same key. An edge carries the max key of its two
  // endpoints, so looking it up here is what makes it wait for the later one.
  const key = sequence === "level" ? "level" : "order";
  const ranks = [...new Set(parts.filter((p) => p.kind === "node").map((p) => p[key]))].sort((a, b) => a - b);
  const steps = new Map();
  for (const p of parts) {
    if (p.kind === "title") { steps.set(p.id, 0); continue; }
    const i = ranks.indexOf(p[key]);
    steps.set(p.id, i < 0 ? base : base + i);
  }
  return steps;
}

// Append a keyframe row, collapsing rows that would land on or before the
// previous frame (a squeezed build must still produce a monotonic track).
function emitRow(rows, frame, props, easeName) {
  const f = Math.round(frame);
  if (rows.length && rows[rows.length - 1].frame >= f) {
    rows[rows.length - 1] = { frame: rows[rows.length - 1].frame, props, ease: easeName };
    return;
  }
  rows.push({ frame: f, props, ease: easeName });
}

/**
 * Turn the animation settings into per-part keyframe rows in absolute scene
 * frames.
 *
 *   parts   from svgParts()
 *   anim    { effect, direction, sequence, duration, stagger, delay,
 *             ease, exit, exitDirection, exitDuration, exitEase }
 *   opts    { startFrame, endFrame, fps, totalFrames, vw, vh }
 *
 * Returns { parts: [{ id, anchor, channels, rows }], steps, buildFrames,
 *           overflow }, where `rows` is [{ frame, props, ease }], `channels` is
 * the set of properties that actually move (so both the preview and the .lax
 * only carry live tracks), and `overflow` is how many frames the build runs
 * past the clip (0 when it fits).
 */
export function planBuild(parts, anim = {}, opts = {}) {
  const a = { ...DEFAULT_ANIM, ...anim };
  const fps = Math.max(1, opts.fps || 30);
  const sf = Math.max(0, Math.round(opts.startFrame || 0));
  const ef = Math.max(sf + 1, Math.round(opts.endFrame ?? sf + fps));
  const total = Math.max(ef, Math.round(opts.totalFrames ?? ef));
  const view = { vw: opts.vw || 1920, vh: opts.vh || 1080 };

  const entrance = getEntrance(a.effect), exitDef = getExit(a.exit);
  const inEase = a.ease || entrance.ease || "linear";
  const outEase = a.exitEase || exitDef.ease || "linear";
  const inDir = a.direction || entrance.defaultDir || "";
  const outDir = a.exitDirection || exitDef.defaultDir || "";

  const steps = buildSteps(parts, a.sequence);
  const maxStep = Math.max(0, ...parts.map((p) => steps.get(p.id) || 0));
  // "None" is not an effect with a zero duration — it is the ABSENCE of an
  // entrance, so it must not inherit the delay a real one would wait out. The
  // rows still gate alpha, which is what makes a plan the single description of
  // a clip's visibility whether or not it animates.
  const bare = entrance.id === "none";
  const delayF = bare ? 0 : Math.max(0, Math.round((a.delay || 0) * fps));
  const durF = bare || entrance.instant ? 1 : Math.max(1, Math.round((a.duration || 0.6) * fps));
  const stagF = bare && exitDef.id === "none" ? 0 : Math.max(0, Math.round((a.stagger || 0) * fps));
  const exitDurF = exitDef.instant ? 1 : Math.max(1, Math.round((a.exitDuration || 0.5) * fps));

  // How far the build runs past the clip's last frame, so the UI can offer to
  // extend the clip instead of silently clamping.
  const needed = delayF + maxStep * stagF + durF + (exitDef.id === "none" ? 0 : maxStep * stagF + exitDurF);
  const overflow = Math.max(0, needed - (ef - sf));

  const out = parts.map((part) => {
    const step = steps.get(part.id) || 0;
    const { from, anchor } = entranceFrom(entrance.id, inDir, part, view);
    const rest = { ...REST };
    const start = { ...REST, ...from };

    let a0 = sf + delayF + step * stagF;
    let a1 = a0 + durF;
    // Never let the entrance spill past the clip; a squeezed build snaps rather
    // than animating half-way and cutting.
    if (a1 > ef - 1) { a1 = Math.max(sf + 1, ef - 1); a0 = Math.min(a0, a1 - 1); }

    let x0 = null, x1 = null, to = null;
    if (exitDef.id !== "none") {
      x1 = ef - (maxStep - step) * stagF;
      x0 = x1 - exitDurF;
      if (x0 < a1) { x0 = a1; x1 = Math.max(x0 + 1, x1); }
      to = { ...REST, ...exitTo(exitDef.id, outDir, part, view) };
    }

    // Only carry tracks for channels that actually move.
    const channels = new Set(["alpha"]);
    for (const k of ["dx", "dy", "sx", "sy", "rot", "trim"]) {
      if (start[k] !== rest[k] || (to && to[k] !== rest[k])) channels.add(k);
    }
    const pick = (state) => {
      const o = {};
      for (const k of channels) o[k] = state[k];
      return o;
    };

    // An effect that does not fade (Draw on) still has to be invisible before
    // its turn, so alpha snaps on across the single frame before the build
    // rather than cross-fading over it and diluting the effect.
    const snapOn = start.alpha === rest.alpha;
    const hold = snapOn ? Math.max(0, a0 - 1) : a0;

    const rows = [];
    emitRow(rows, 0, pick({ ...start, alpha: 0 }), "linear");
    if (hold > 0) emitRow(rows, hold, pick({ ...start, alpha: 0 }), "linear");
    if (snapOn && a0 > 0) emitRow(rows, a0, pick(start), "linear");
    if (entrance.id === "pop") {
      emitRow(rows, a0 + (a1 - a0) / 2, pick({ ...rest, sx: 1.12, sy: 1.12 }), inEase);
      emitRow(rows, a1, pick(rest), inEase);
    } else {
      emitRow(rows, a1, pick(rest), inEase);
    }
    if (to) {
      if (x0 > a1) emitRow(rows, x0, pick(rest), "linear");
      emitRow(rows, x1, pick(to), outEase);
      if (x1 < total) emitRow(rows, Math.max(x1 + 1, ef), pick({ ...to, alpha: 0 }), "linear");
    } else {
      if (ef - 1 > a1) emitRow(rows, ef - 1, pick(rest), "linear");
      if (ef < total) emitRow(rows, ef, pick({ ...rest, alpha: 0 }), "linear");
    }

    return { id: part.id, kind: part.kind, step, anchor, channels: [...channels], rows };
  });

  return { parts: out, steps, maxStep, buildFrames: needed, overflow, inEase, outEase, inDir, outDir };
}

/** The keyframes of one channel of a planned part, ready for sampleTrack(). */
export function channelKeys(planned, channel) {
  return planned.rows
    .filter((r) => channel in r.props)
    .map((r) => ({ frame: r.frame, value: r.props[channel], ease: r.ease }));
}

/**
 * The full transform of a planned part at `frame`, for the canvas preview.
 * Returns { dx, dy, sx, sy, rot, alpha } with resting defaults filled in.
 */
export function samplePart(planned, frame) {
  const out = { ...REST };
  for (const ch of planned.channels) {
    const v = sampleTrack(channelKeys(planned, ch), frame);
    if (v !== undefined) out[ch] = v;
  }
  return out;
}

// ---------------------------------------------------------------------------
// MXML emission
// ---------------------------------------------------------------------------
//
// The exported graphic is *vector*: one `<mx:Sprite>` per part, holding the
// same primitives the canvas preview draws, nested inside a single fit-Sprite
// that carries the user-space -> stage mapping. Because the mapping lives on
// the outer node, every inner coordinate — including the animation's `dx`/`dy`
// channels — stays in the SVG's own user units and needs no conversion.
//
// Nothing is rasterized on the way out. `la export` draws these nodes at the
// output resolution, so the text stays crisp at any scale and the connectors
// can animate along their own length (`trimEnd`), which a bitmap cannot do.

/** The `<mx:Keyframe>` attribute for each animatable part channel. */
const KEY_ATTR = { sx: "scaleX", sy: "scaleY", rot: "rotation", alpha: "alpha" };

function keyframeXml(frame, attrs, ease, indent) {
  const a = [`frame="${Math.round(frame)}"`, ...attrs];
  if (ease && ease !== "linear") a.push(`ease="${ease}"`);
  return `${indent}<mx:Keyframe ${a.join(" ")}/>`;
}

function timelineXml(rows, indent) {
  return `${indent}<mx:Timeline>\n${rows.join("\n")}\n${indent}</mx:Timeline>`;
}

/**
 * The frame a "Draw on" part finishes drawing, i.e. the first keyframe where
 * `trim` reaches full. Parts of the drawing that are not strokes (an
 * arrowhead) pop on there instead of being trimmed, because trimming a filled
 * shape eats the shape rather than revealing it.
 */
function trimDoneFrame(keys) {
  const done = keys.find((k) => k.value >= 1);
  return done ? done.frame : (keys.length ? keys[keys.length - 1].frame : 0);
}

/**
 * The MXML for one text clip's animated vector graphic.
 *
 *   mxmlParts({ id, view, parts, plan, box })
 *
 * `view` is `{ vw, vh }` from graphicParts(), `parts` its parts, `plan` the
 * planBuild() result, and `box` the clip's `{ x, y, w, h }` rectangle on the
 * stage. Returns an XML fragment ready to drop inside an `<mx:Layer>`.
 *
 * Paint order is sibling document order, which is the parts' own order:
 * connectors, then cards, then the title.
 */
export function mxmlParts({ id, view, parts, plan, box, indent = "    " }) {
  const i2 = indent + "  ", i3 = i2 + "  ", i4 = i3 + "  ";
  const kx = round(box.w / Math.max(1, view.vw)), ky = round(box.h / Math.max(1, view.vh));

  let body = "";
  for (const part of parts) {
    const planned = plan.parts.find((p) => p.id === part.id);
    if (!planned) continue;
    const an = planned.anchor || { ax: 0.5, ay: 0.5 };
    const ax = round(part.w * an.ax), ay = round(part.h * an.ay);
    const baseX = round(part.x + ax), baseY = round(part.y + ay);
    // A node timeline loops over its own span, so every track has to reach the
    // scene's last frame or it wraps back to its opening value mid-shot.
    const lastFrame = planned.rows.length ? planned.rows[planned.rows.length - 1].frame : 0;

    const rows = planned.rows.map((row) => {
      const p = row.props, attrs = [];
      if ("dx" in p) attrs.push(`x="${round(baseX + p.dx)}"`);
      if ("dy" in p) attrs.push(`y="${round(baseY + p.dy)}"`);
      for (const [ch, name] of Object.entries(KEY_ATTR)) {
        if (ch in p) attrs.push(`${name}="${round(p[ch])}"`);
      }
      return attrs.length ? keyframeXml(row.frame, attrs, row.ease, i4) : "";
    }).filter(Boolean);

    // "Draw on" animates each stroked child's own trimEnd; the Sprite cannot
    // carry it, because trim belongs to a path's geometry, not a transform.
    const trimKeys = planned.channels.includes("trim") ? channelKeys(planned, "trim") : null;
    const children = part.prims.map((prim, n) => {
      const kid = `${id}-${part.id}-${n}`;
      return primNodeXml(prim, kid, part.x, part.y, trimKeys, lastFrame, i3);
    }).join("\n");

    body += `${i2}<mx:Sprite id="${id}-${part.id}" x="${baseX}" y="${baseY}"`
      + ` anchorX="${ax}" anchorY="${ay}">\n`
      + (rows.length ? timelineXml(rows, i3) + "\n" : "")
      + children + "\n"
      + `${i2}</mx:Sprite>\n`;
  }

  // The user-space -> stage mapping lives here, once, so every coordinate
  // inside is in the SVG's own units. Scale is keyframe-only in MXML (`x`/`y`
  // are the only placement attributes a node takes statically), hence the
  // one-key timeline rather than a `scaleX` attribute.
  return `${indent}<mx:Sprite id="${id}" x="${round(box.x)}" y="${round(box.y)}">\n`
    + `${i2}<mx:Timeline>\n${i3}<mx:Keyframe frame="0" scaleX="${kx}" scaleY="${ky}"/>\n${i2}</mx:Timeline>\n`
    + `${body}${indent}</mx:Sprite>\n`;
}

/** One primitive as an MXML node, local to its part's box, optionally trimmed. */
function primNodeXml(prim, kid, px, py, trimKeys, lastFrame, indent) {
  const { tag, attrs } = primNode(prim, kid, px, py);
  if (!trimKeys) return `${indent}<${tag} ${attrs.join(" ")}/>`;

  let rows;
  if (isDrawable(prim)) {
    attrs.push(`trimEnd="0"`);
    rows = trimKeys.map((k) => keyframeXml(k.frame, [`trimEnd="${round(k.value)}"`], k.ease, indent + "    "));
  } else {
    // A fill (an arrowhead, a label) appears the instant the stroke it belongs
    // to finishes drawing, rather than being revealed by a trim that would eat
    // the shape instead of uncovering it.
    const done = trimDoneFrame(trimKeys);
    rows = [
      keyframeXml(0, [`alpha="0"`], "linear", indent + "    "),
      keyframeXml(Math.max(0, done - 1), [`alpha="0"`], "linear", indent + "    "),
      keyframeXml(done, [`alpha="1"`], "linear", indent + "    "),
    ];
    if (lastFrame > done) rows.push(keyframeXml(lastFrame, [`alpha="1"`], "linear", indent + "    "));
  }
  return `${indent}<${tag} ${attrs.join(" ")}>\n${timelineXml(rows, indent + "  ")}\n${indent}</${tag}>`;
}
