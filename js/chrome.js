// LittleA editors — shared window chrome.
//
// A menubar is a row of trigger elements, each owning a spec of menu items —
// objects `{ label, run, sc?, icon? }` or the string "sep". Clicking a trigger
// opens its dropdown; only one is open at a time; a click elsewhere (or on an
// item) closes it. The two editors render rows and mount panels differently —
// an inline CSS-driven pop with label+shortcut rows (index.html) vs. a
// floating panel of icon+label buttons (movieeditor.html) — so the caller
// supplies `renderItem`, `panelClass`, and the mount strategy while this module
// owns the shared open/close/outside-click state machine.

// mountMenus(opts) -> { closeAll }
//   triggers    [{ el, items }]      trigger element + its menu spec
//   panelClass  string               class name for each dropdown container
//   renderItem  (item) => Element    build one row; item is a spec object or
//                                    the string "sep" (return a separator)
//   mount       "inline" | "float"   append the panel into the trigger (shown
//                                    via CSS on `openClass`), or into <body>
//                                    (shown + positioned on open)
//   openClass   string = "open"      toggled on a trigger while its menu is open
//   hoverSwitch bool = false         hovering another trigger switches menus
//   place       (panel, el) => void  position a floating panel (mount "float")
export function mountMenus({
  triggers,
  panelClass,
  renderItem,
  mount = "inline",
  openClass = "open",
  hoverSwitch = false,
  place = null,
}) {
  const float = mount === "float";
  const entries = [];

  const closeAll = () => {
    for (const e of entries) {
      e.el.classList.remove(openClass);
      if (float) e.panel.style.display = "none";
    }
  };
  const open = (entry) => {
    closeAll();
    entry.el.classList.add(openClass);
    if (float) { entry.panel.style.display = ""; place?.(entry.panel, entry.el); }
  };

  for (const { el, items } of triggers) {
    if (!el || !items) continue;
    const panel = document.createElement("div");
    panel.className = panelClass;
    for (const item of items) {
      const row = renderItem(item);
      if (!row) continue;
      if (item !== "sep" && typeof item.run === "function") {
        row.addEventListener("click", (ev) => { ev.stopPropagation(); closeAll(); item.run(); });
      }
      panel.appendChild(row);
    }
    if (float) {
      panel.style.display = "none";
      document.body.appendChild(panel);
      // Clicks inside a floating panel must not bubble to the document-level
      // close handler (dead space between rows would otherwise close it).
      panel.addEventListener("click", (ev) => ev.stopPropagation());
    } else {
      el.appendChild(panel);
    }

    const entry = { el, panel };
    entries.push(entry);
    el.addEventListener("click", (ev) => {
      ev.stopPropagation();
      if (el.classList.contains(openClass)) closeAll();
      else open(entry);
    });
    if (hoverSwitch) {
      el.addEventListener("mouseenter", () => {
        if (entries.some((e) => e.el.classList.contains(openClass))) open(entry);
      });
    }
  }

  document.addEventListener("click", closeAll);
  return { closeAll };
}

// wireCollapse(btn, body) — a panel header button that folds its body away.
// The body carries `.collapsed`; the button's `aria-expanded` is what the
// header chevron's rotation keys off.
export function wireCollapse(btn, body) {
  btn.addEventListener("click", () => {
    const collapsed = body.classList.toggle("collapsed");
    btn.setAttribute("aria-expanded", String(!collapsed));
  });
}
