# Vendored browser assets

Third-party files served directly by `editor/html/index.html`. Nothing here is built
from source in this repository, so each entry records what it is and how to
verify it.

## `tailwindcss.js`

| | |
| --- | --- |
| Package | [`tailwindcss`](https://github.com/tailwindlabs/tailwindcss) — Play CDN browser build |
| Version | **3.4.17** |
| Size | 418,973 bytes |
| SHA-256 | `a789ce5a73191759006b64a0c05f63afbf9aa43a86511bf798d688737429e60a` |
| Upstream | `https://cdn.tailwindcss.com/3.4.17` |
| Licence | MIT |

Verify the committed copy has not been altered:

```sh
sha256sum editor/vendor/tailwindcss.js
# a789ce5a73191759006b64a0c05f63afbf9aa43a86511bf798d688737429e60a
```

The version is also recoverable from the bundle itself — it embeds the string
`"3.4.17"`, and it carries the `text-balance`, `text-pretty`, `subgrid` and
`forced-colors` utilities that Tailwind added in the 3.4 line.

### Why it is vendored

The editor is a buildless ES-module app opened straight from disk, with no npm
install and no bundler step. The Play CDN build compiles Tailwind classes in the
browser at runtime, which is what makes that possible. Fetching it from a CDN
instead would make the editor fail to style itself offline.

The cost is that this file cannot be audited or upgraded by a package manager.
If the editor ever gains a build step, replace this with a `tailwindcss` dev
dependency and a compiled stylesheet.

### Upgrading

Replace the file, then update the version, size and hash in the table above.

```sh
curl -fsSL https://cdn.tailwindcss.com/<version> -o editor/vendor/tailwindcss.js
sha256sum editor/vendor/tailwindcss.js
```

## `editor.css`

Legacy stylesheet from the old browser shell. It now lives here with the other
vendored browser assets, even though the current entry pages use inline styles.

## `fonts.css` and `fonts/`

Self-hosted web font faces used by the editor chrome, kept local for the same
offline reason.

### `fonts/material-symbols-outlined-100-default.woff2`

A **subset**: it carries only the icon ligatures the editor names, so an icon
name that is not in the list below renders as its own text. Adding an icon to
the UI means regenerating this file. The names must be sorted alphabetically —
the API rejects any other order.

```sh
names=account_circle,add,add_box,ads_click,arrow_downward,arrow_drop_down_circle,arrow_upward,audiotrack,border_vertical,brush,chat_bubble,check_box,checklist,close_fullscreen,colorize,content_copy,content_cut,crop_free,delete,download,edit,expand_more,fit_screen,folder_open,format_color_fill,gesture,graphic_eq,grid_view,height,highlight_alt,horizontal_rule,image,info,ink_eraser,ink_pen,ios_share,label,layers,linear_scale,link,list,lock,lock_open_right,loop,movie,movie_edit,movie_filter,music_note,near_me,note_add,notes,numbers,open_in_full,palette,pan_tool,pause,play_arrow,radio_button_checked,radio_button_unchecked,rectangle,search,settings,skip_next,skip_previous,smart_button,space_bar,swap_vert,tab,terminal,text_fields,title,transform,tune,upload_file,view_agenda,view_column,visibility,visibility_off,web_asset,widgets,window,zoom_in,zoom_out
# Without a browser User-Agent the API answers with seven static TrueType faces
# instead of one variable woff2, which `fonts.css` would then misdeclare.
ua='Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
css=$(curl -fsSL -A "$ua" "https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,100..700,0,0&icon_names=${names}&display=swap")
curl -fsSL -A "$ua" "$(printf '%s' "$css" | grep -oP 'url\(\K[^)]+')" \
  -o editor/vendor/fonts/material-symbols-outlined-100-default.woff2
```

The axes (`wght 100..700`, `FILL 0`, `GRAD 0`, `opsz 24`) are what the
`@font-face` in `fonts.css` declares; requesting the full axis ranges instead
quadruples the file for no visible difference.
