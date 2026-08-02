# `js/bg/` — the background generator's drawing kernel

Plain ES-module ports of the SVGTool generator library (a clean-room,
dependency-free set of procedural SVG generators). Nothing here touches the DOM
or editor state: a generator is a `controls` list plus `render(ctx) -> string`,
where the string is the markup that goes *inside* a root `<svg>`.

```
lib/random.js      seeded RNG + tiny array helpers
lib/color.js       hex/rgb/hsl mixing and ramps
lib/geometry.js    blob / wave / spiral point sets and path builders
lib/filters.js     <defs> helpers: gradients, blur, displacement, turbulence
lib/controls.js    control descriptors (range / color / select / toggle)
lib/svgDocument.js render context + document wrapper + PNG rasterizer
generators/*.js    34 generators, grouped by family
data/tools.js      the catalog: id, name, category, renderer, description
```

Ported with `tsc --target es2022 --module esnext` from the TypeScript sources;
the only edit is `.js` on the relative import specifiers, because the editor is
buildless and the browser resolves these paths itself. Keep it that way — if a
generator needs changing, change the JavaScript here rather than adding a build
step to an app that deliberately has none.

Everything editor-facing lives one level up:

* [`../bgsvg.js`](../bgsvg.js) — the background *spec* (tool + params + seed +
  opacity), rendering, id namespacing, palettes, presets and raster caching.
* [`../bgpanel.js`](../bgpanel.js) — the shared "Background" dialog used by the
  Presentation editor, the Movie Editor and the Scene editor.
