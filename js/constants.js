// LittleA Editor — static configuration and data tables.
//
// Pure module: literals only, no editor state and no DOM access. Extracted
// from the editor's inline module so the config lives in one importable place.

// Starter scene shown on first load (and the source the browser test asserts
// against — the hand-authored comment and the odd spacing must round-trip).
export const DEFAULT_SRC = `<!-- hand-authored demo: the editor must keep this comment -->
<mx:Scene xmlns:mx="http://littlea.dev/2026/mxml" width="400" height="200" fps="60">
  <mx:Layer name="actors">
    <mx:Rect id="box"   x="20" y="20" width="40" height="40" fill="#FF0000"/>
    <mx:Rect id="mover" x="0" y="120" width="30" height="30" fill="#00FF00">
      <mx:Timeline>
        <mx:Keyframe frame="0"  x="0"/>
        <mx:Keyframe frame="60" x="300"/>
      </mx:Timeline>
    </mx:Rect>
  </mx:Layer>
  <mx:Layer name="backdrop">
    <mx:Rect id="floor" x="0" y="180" width="400" height="20" fill="#444455"/>
  </mx:Layer>
</mx:Scene>
`;

// Empty scene used by File ▸ New.
export const BLANK_SRC =
  `<mx:Scene xmlns:mx="http://littlea.dev/2026/mxml" width="400" height="200" fps="60">\n` +
  `  <mx:Layer name="layer1">\n  </mx:Layer>\n</mx:Scene>\n`;

// ---- timeline geometry ----------------------------------------------------
export const CELL = 10; // px per frame (Flash used 9)
export const MIN_FRAMES = 120; // default timeline extent (also the minimum)
export const FRAME_CHUNK = 120; // grow a screen-width at a time -> effectively infinite
export const GROW_LEAD = 30; // start extending before the playhead reaches the end
export const SWATCHES = ["#4A78C3", "#4FA35C", "#C05B5B", "#C0A04A", "#8A5BC0", "#4AAFC0"];

// Node kinds whose width/height do NOT drive what is drawn, so a resize
// handle there would move a number nobody can see. A container is only ever
// as big as its children. (A <mx:Path> is not one of these: its geometry is
// its `d=`, which the resize scales.)
export const UNSIZED_KINDS = new Set(["Sprite", "Canvas"]);

// Options-tray "Snap" grid step, in stage px.
export const SNAP_GRID = 10;

// Every property "insert keyframe" captures from a node's current pose. It
// tracks the compiler's KEYFRAME_PROPS (tools/la-compiler/src/lib.rs) — which
// is what <mx:Keyframe> actually ACCEPTS — minus the exception below. A
// property missing here simply never gets keyed from the UI.
//
// `width` and `height` are that exception: the compiler animates them, but
// almost every node carries a size, so auto-capturing it would put a size on
// EVERY key and a later inspector resize would snap back on playback. They
// stay hand-authored until the timeline UI can show a property as
// keyed-or-not, which is the thing that would make it legible.
export const KEYFRAME_PROPS = [
  "x", "y", "scaleX", "scaleY", "rotation", "alpha",
  "drawOrder", "trimStart", "trimEnd", "trimOffset", "feather",
  // A shadow's three numbers. Captured like trim and feather, and unlike
  // width/height, because a shadow is rare and deliberate: the loop only
  // keys a property the node actually carries, so a node without one gains
  // nothing.
  "shadowX", "shadowY", "shadowBlur",
];

// Easing presets accepted by <mx:Keyframe ease=>, in the order la-tween
// declares them (crates/la-tween/src/easing.rs). "" writes no ease at all,
// which is the linear default the runtime already uses.
export const EASINGS = [
  "", "linear",
  "quadIn", "quadOut", "quadInOut",
  "cubicIn", "cubicOut", "cubicInOut",
  "quartIn", "quartOut", "quartInOut",
  "quintIn", "quintOut", "quintInOut",
  "sineIn", "sineOut", "sineInOut",
  "expoIn", "expoOut", "expoInOut",
  "circIn", "circOut", "circInOut",
  "backIn", "backOut", "backInOut",
  "elasticIn", "elasticOut", "elasticInOut",
  "bounceIn", "bounceOut", "bounceInOut",
];

// Type-specific inspector fields, keyed by node kind (the NodeKindIr tag from
// doc.node_kind). Each field is [attr, label, type, options?]; edits go through
// the same CST-preserving doc.set_attr as x/y/w/h.
//
//   "text"   a text box, kept verbatim so a hand-authored value (a color, a
//            comma-list, a {binding} slot) is never reformatted.
//   "bool"   a checkbox.
//   "num"    a text box refused unless it parses as a finite number.
//   "int"    a text box refused unless it parses as a non-negative integer.
//   "select" a dropdown over `options`; the leading "" entry means "unset".
//
// Emptying a num/int/select field REMOVES the attribute rather than writing
// "", because the compiler parses an empty numeric attribute as an error and
// absent is how the IR spells "use the default". Text and bool fields keep
// writing their value, which is what they have always done.
export const KIND_FIELDS = {
  Rect: [["fill", "fill", "text"]],
  // The Label carries the whole text-layout vocabulary; `path` is Rive's
  // Text Follow Path and takes the same `d=` grammar as <mx:Path>.
  Label: [
    ["text", "text", "text"],
    ["color", "color", "text"],
    ["font", "font", "text"],
    ["align", "align", "select", ["", "left", "center", "right"]],
    ["lineHeight", "line height", "num"],
    ["letterSpacing", "letter sp", "num"],
    ["wordSpacing", "word sp", "num"],
    ["overflowWrap", "wrap", "select", ["", "normal", "break-word"]],
    ["path", "path", "text"],
  ],
  // Vector paths: the drawing tools author these, and until now the
  // inspector showed nothing for them. Trim + feather are Rive features the
  // renderer already implements.
  Path: [
    ["fill", "fill", "text"],
    ["stroke", "stroke", "text"],
    ["strokeWidth", "stroke w", "num"],
    ["fillRule", "fill rule", "select", ["", "nonzero", "evenodd"]],
    ["trimStart", "trim start", "num"],
    ["trimEnd", "trim end", "num"],
    ["trimOffset", "trim offset", "num"],
    ["feather", "feather", "num"],
    // Width multipliers at each end, 1 = full width. `num` removes the
    // attribute when emptied, which is what "no taper" has to mean —
    // writing strokeTaperStart="" would be a hard compile error.
    ["strokeTaperStart", "taper start", "num"],
    ["strokeTaperEnd", "taper end", "num"],
  ],
  // N-slice insets, as fractions of the source bitmap.
  Image: [
    ["src", "src", "text"],
    ["sliceLeft", "slice L", "num"],
    ["sliceRight", "slice R", "num"],
    ["sliceTop", "slice T", "num"],
    ["sliceBottom", "slice B", "num"],
  ],
  Button: [["label", "label", "text"]],
  LinkButton: [["label", "label", "text"]],
  CheckBox: [["label", "label", "text"], ["selected", "selected", "bool"]],
  RadioButton: [["label", "label", "text"], ["selected", "selected", "bool"], ["group", "group", "text"]],
  RadioGroup: [["items", "items", "text"], ["selectedIndex", "sel", "text"]],
  TextInput: [["text", "text", "text"]],
  TextArea: [["text", "text", "text"]],
  HSlider: [["value", "value", "text"], ["min", "min", "text"], ["max", "max", "text"]],
  VSlider: [["value", "value", "text"], ["min", "min", "text"], ["max", "max", "text"]],
  NumericStepper: [["value", "value", "text"], ["min", "min", "text"], ["max", "max", "text"], ["step", "step", "text"]],
  ProgressBar: [["value", "value", "text"]],
  ComboBox: [["items", "items", "text"], ["selectedIndex", "sel", "text"]],
  List: [["items", "items", "text"], ["selectedIndex", "sel", "text"]],
  TabBar: [["items", "items", "text"], ["selectedIndex", "sel", "text"]],
  Panel: [["fill", "fill", "text"]],
  TitleWindow: [["title", "title", "text"], ["fill", "fill", "text"]],
  Grid: [["columns", "cols", "text"], ["gap", "gap", "text"]],
  HBox: [["gap", "gap", "text"]],
  VBox: [["gap", "gap", "text"]],
  Modal: [["title", "title", "text"], ["open", "open", "bool"]],
  Tooltip: [["text", "text", "text"]],
  Video: [
    ["src", "src", "text"],
    ["trimIn", "in", "text"],
    ["trimOut", "out", "text"],
    ["rate", "rate", "text"],
    ["start", "start", "text"],
    ["mute", "mute", "bool"],
    ["loop", "loop", "bool"],
    ["autoplay", "autoplay", "bool"],
  ],
};

// Fields that live on NodeIr itself rather than on a kind, so they apply to
// every node. `drawOrder` is Rive's animatable Draw Order (it re-sorts the
// display list without moving the node in the document, which is what the
// Raise/Lower buttons do instead); `solo` picks the one child that draws.
// Both are animatable — `drawOrder` is already in the compiler's
// KEYFRAME_PROPS.
export const COMMON_FIELDS = [
  ["drawOrder", "draw order", "num"],
  // Confines a node's subtree to a shape, in the same `d=` grammar the Path
  // tool writes. `text`, not `num`: it is a path string, and clearing it
  // writes an empty attribute the compiler treats as "no clip".
  ["clipPath", "clip path", "text"],
  // A drop shadow. `shadowColor` is what decides whether there is one at
  // all, which is why it is `text` (clearing it writes an empty attribute
  // the compiler reads as "no shadow") while the three numbers are `num`
  // and simply disappear when emptied.
  ["shadowColor", "shadow color", "text"],
  ["shadowX", "shadow x", "num"],
  ["shadowY", "shadow y", "num"],
  ["shadowBlur", "shadow blur", "num"],
];

// Solo indexes a node's children, so it is only offered on a container.
export const CONTAINER_FIELDS = [["solo", "solo", "int"]];

// The value a boolean attribute takes when it is absent from the source, so
// an unset checkbox mirrors the runtime default (autoplay is on by default).
export const BOOL_DEFAULT = { autoplay: true };

// tool button title (first word) -> internal tool name
export const TOOL_TITLES = {
  Selection: "select", Subselection: "subselect", Line: "line", Lasso: "lasso",
  Pen: "pen", Text: "text", Oval: "oval", Rectangle: "rect", Pencil: "pencil",
  Brush: "brush", Paint: "bucket", Eyedropper: "eyedropper", Eraser: "eraser",
  Hand: "hand", Zoom: "zoom", Free: "transform",
};

// tool -> stage cursor
export const CURSORS = {
  select: "default", subselect: "default", rect: "crosshair", text: "text",
  bucket: "pointer", eyedropper: "crosshair", eraser: "pointer", hand: "grab",
  zoom: "zoom-in", transform: "nwse-resize",
  line: "crosshair", oval: "crosshair", pen: "crosshair",
  pencil: "crosshair", brush: "crosshair", lasso: "crosshair",
};

// single-key tool shortcuts (Flash muscle memory)
export const TOOL_KEYS = {
  v: "select", a: "subselect", q: "transform", t: "text", r: "rect",
  k: "bucket", i: "eyedropper", e: "eraser", h: "hand", z: "zoom",
  l: "lasso", p: "pen", n: "line", o: "oval", y: "pencil", b: "brush",
};

// tool -> Options-tray display name
export const TOOL_LABELS = {
  select: "Selection", subselect: "Subselect", transform: "Transform", text: "Text",
  rect: "Rectangle", bucket: "Paint", eyedropper: "Dropper", eraser: "Eraser",
  hand: "Hand", zoom: "Zoom", line: "Line", oval: "Oval", pen: "Pen",
  pencil: "Pencil", brush: "Brush", lasso: "Lasso",
};

// Library row -> Material Symbols ligature. Every name here must be in the
// vendored icon subset (editor/vendor/README.md lists how to regenerate it);
// a name the font lacks renders as its own text.
export const LIBRARY_ICONS = {
  Rectangle: "rectangle", Label: "title", Button: "smart_button", LinkButton: "link",
  CheckBox: "check_box", RadioButton: "radio_button_checked", RadioGroup: "checklist",
  TextInput: "text_fields", TextArea: "notes", HSlider: "tune", VSlider: "height",
  NumericStepper: "numbers", ProgressBar: "linear_scale", ComboBox: "arrow_drop_down_circle",
  List: "list", TabBar: "tab", HRule: "horizontal_rule", VRule: "border_vertical",
  Spacer: "space_bar", HBox: "view_column", VBox: "view_agenda", Grid: "grid_view",
  Canvas: "crop_free", Panel: "web_asset", TitleWindow: "window", ScrollPane: "swap_vert",
  Modal: "layers", Tooltip: "chat_bubble", Video: "movie", Image: "image",
};

export const LIBRARY_ICON_FALLBACK = "widgets";
