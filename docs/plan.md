# `quimera` — a Bun-based markdown-to-print CLI

## What it is

A small Bun CLI that turns a folder of markdown into a paginated,
print-ready PDF. The pipeline is:

```
md → unified/remark → html → paged.js → chromium print → pdf
```

Three commands:

```
quimera init    <dir>   # scaffold a new book from sample-book/
quimera preview <dir>   # live-reloading preview at localhost:4000
quimera export  <dir>   # write <dir>/book.pdf via pagedjs-cli
```

## The userspace model

**The tool ships small and dumb.** Everything specific — how a margin
note looks, what a citation renders as, how a spread is composed,
whether images get gray boxes in draft mode — lives in the **user's
book project**, not in the tool. Extension is the primary interface.

A book project looks like:

```
my-book/
  book.md                 # master file; orders parts via `!include`
  content/*.md            # chapter/section sources, transcluded by book.md
  images/
  refs.bib                # optional; simple @type{key, field = {value}}
  style.css               # @page rules, class visuals, custom props
  quimera.config.ts     # optional — user's plugin surface
```

`book.md` is the master file that defines the book top-level. Each
`!include <path>` line (path relative to the project root) is replaced
by that file's contents, in the order they appear; any other line
passes through, so `book.md` can also carry a title or front matter.
Includes are not recursive. If there's no `book.md`, quimera falls
back to concatenating `content/*.md` sorted by filename.

`quimera.config.ts` is a plain Bun-loadable module. Everything on it
is optional; a project with no config file still builds.

```ts
export default {
  // Directive → HTML mappings. Both simple and container forms:
  //   :margin[text]              → <span class="margin">text</span>
  //   ::pagebreak                → <div class="pagebreak"></div>
  //   :::figure ... :::          → <figure class="figure">...</figure>
  directives: {
    margin: { tag: "span", class: "margin" },
    pagebreak: { tag: "div", class: "pagebreak" },
    figure: { tag: "figure", class: "figure" },
    cover: { tag: "section", class: "cover" },
  },

  // Extra plugins spliced into the unified pipeline.
  remarkPlugins: [],
  rehypePlugins: [],

  // Override the baseline (author, year, p. N) citation string.
  formatCitation: (entry, locator, mode) => `${entry.author} (${entry.year})`,

  // Named versions, each shallow-merged over everything above. Preview
  // shows a dropdown to swap between them; the first is the default and
  // what `export` builds. Omit for a single config.
  variants: {
    print: {},
    draft: { knuth_pratt_via_pretext: false },
  },
};
```

**The tool ships no directive defaults.** Every class-shaped
construct in a project comes from that project's own `directives`
table plus a matching CSS rule. Adding a new kind of block =
one config entry + one CSS rule. That's the whole extension surface
for visuals.

## Tool architecture

Flat layout under `src/`, no subpackages:

```
src/
  main.ts        # CLI entry: dispatches init / preview / export (incl. HTML → PDF via pagedjs-cli)
  compile.ts     # md → html pipeline (remark + directives + citations)
  citations.ts   # .bib parser + citations remark plugin
  preview.ts     # HTTP server + fs.watch + WebSocket live-reload
  pretext-client.ts # in-browser optimal paragraph justification
  template.html  # HTML shell (loads paged.js + style.css)
  template.css   # baseline stylesheet, copied into empty projects
sample-book/     # what `init` copies
```

Anything that fits comfortably in one file lives in one file. Split
only when a piece grows past a few hundred lines or gains an
independent consumer.

### Markdown syntax

- **GFM extras** — tables, footnotes (`[^1]`), strikethrough, task lists
  — via `remark-gfm`.
- **Citations** — pandoc-style `[@key]` or `[@key, p. 42]`. Parsed
  against `refs.bib`, rendered as an inline anchor plus a
  `<section class="bibliography">` appended once at the end.
  The default format is `(Author, Year, p. N)`; override with
  `formatCitation` in config.
- **Directives** — `remark-directive` provides three forms; the
  project's `directives` table maps each name to `{tag, class}`:
  - `:name[text]` — inline / text
  - `::name` — leaf (self-closing)
  - `:::name ... :::` — container
- **Raw HTML** — always passes through (`rehype-raw`). Escape hatch
  for anything the directive layer can't express.

### The unified pipeline (`compile.ts`)

```
load quimera.config.ts (if present)
expand book.md `!include`s (or concat content/*.md alphabetically)
  → unified()
      .use(remarkParse)
      .use(remarkGfm)                              // tables, footnotes
      .use(remarkDirective)
      .use(directivesToHast, config.directives)    // local plugin
      .use(...config.remarkPlugins)
      .use(citations, { bib, formatCitation })     // local plugin
      .use(remarkRehype, { allowDangerousHtml: true })
      .use(rehypeRaw)                              // keep inline HTML
      .use(...config.rehypePlugins)
      .use(rehypeStringify)
  → substitute the body into template.html
```

`directivesToHast` walks the mdast, and for any directive whose name
appears in the registry sets `data.hName` and `data.hProperties.className`
so `remark-rehype` emits the right element. Unknown directive names
pass through unchanged (rendered as their fallback text).

The `citations` plugin walks text nodes, matches `[@key]` /
`[@key, locator]`, replaces each with an `<a class="cite" href="#bib-key">`,
and appends the bibliography section. The `.bib` reader is a small
handwritten parser — entry type, key, and common fields; no full CSL
processor.

### CSS as the single source of styling truth

`style.css` owns page geometry, typography, and every class visual.
Paged.js gives us the CSS `@page` model:

```css
@page {
  size: A5;
  margin: 2cm 4cm 1.5cm 1.5cm;
  @bottom-center { content: counter(page); }
}
@page :left  { margin-left: 4cm;   margin-right: 1.5cm; }  /* verso */
@page :right { margin-left: 1.5cm; margin-right: 4cm;   }  /* recto */

h1 { break-before: right; margin-top: 30%; }  /* chapter → recto */
.margin  { width: 3cm; float: right; margin-right: -3.5cm; ... }
.figure  { break-inside: avoid; }
.cover   { break-before: right; break-after: page; display: flex; ... }
```

If a project has no `style.css`, `main.ts` drops the tool's
`template.css` in for the run and removes it after. Preview's
`preview.ts` does the same fallback via HTTP.

### Left/right-aware handlers

Paged.js's Polisher strips any selector containing `.pagedjs_left_page`
/ `.pagedjs_right_page` from user stylesheets, so CSS alone can't
express "float the margin note outward on this side." We register a
paged.js `Handler` in `template.html` whose `afterPageLayout` inspects
each finished page and sets `float` + outer offset on `.margin`
elements. Handler registration happens before `paged.polyfill.js`
loads, via `window.PagedConfig.before`.

### Optimal justification (`pretext-client.ts`)

Browsers justify greedily, line by line; the result rivers and gaps.
Opt in with `knuth_pratt_via_pretext: true` in config and each single-paragraph `<p>`
gets TeX-style optimal breaks instead: a Knuth–Plass-flavoured DP over
word widths that minimizes total line badness (stretch cubed, plus
penalties for rivers and over-tight lines). The paragraph is rewritten
into one `block` span per line with an explicit `word-spacing`.

The client script needs the content column width, which lives in CSS,
not the DOM at run time. `compile.ts` reads it: `computeColWidthMm` parses
`style.css` — page `size` (named or explicit) minus `@page :right`
margins (falling back to base `@page`, then 93 mm for default A5).
That width is `define`-injected as
`COL_WIDTH` while Bun bundles `pretext-client.ts` into the inline
`<!--PRETEXT-->` script. Paragraphs containing any element child are
skipped — only pure-text paragraphs are re-laid-out.

Like the margin handler, it runs in `PagedConfig.before` (chaining the
existing hook) after `document.fonts.ready`, so measurement uses the
real print font.

### Config variants

`quimera.config.ts` may carry a top-level `variants` map — named
configs (`draft`, `print`, an APA vs Chicago pair, …) each shallow-merged
over the shared base. `resolveConfig` in `compile.ts` splits `variants`
off (it never reaches the pipeline) and merges the chosen one; an absent
or unknown name resolves to the first. `buildHtml(dir, variant)` and
`variantNames(dir)` expose this. Preview renders a screen-only corner
`<select>` that reloads with `?variant=<name>`; the choice rides the
query string through live-reloads. `export` takes the default (first)
variant.

For versions that differ only in config flags (draft vs print,
citation style) the shallow merge is enough. For a _radically_
different format — square pages, big type for an Instagram carousel —
a variant sets `css: "<file>"`: `buildHtml` swaps the stylesheet
`<link>` and reads that file (not `style.css`) for pretext's
column-width detection. Geometry and type stay in CSS where they
belong; the variant just points at a different sheet. See
`sample-book/instagram.css`.

### `preview.ts` — preview

- Bun HTTP server on `localhost:4000`.
- `GET /` → freshly rebuilt HTML with a WebSocket reload script
  injected before `</body>`.
- Other paths → served from the project dir. `GET /style.css`
  falls back to the tool's `template.css` if the project has none.
- `fs.watch(projectDir, { recursive: true })`, debounced 100ms;
  dotfiles and tilde-backups ignored. Any change → all connected
  sockets get `"reload"` → browser calls `location.reload()`.

### export (`main.ts`) — PDF

Builds HTML into `<project>/.quimera-build.html`, invokes
`bunx pagedjs-cli -o book.pdf <that html>`, cleans up.

**Gotcha:** `pagedjs-cli` injects `paged.polyfill.js` itself. If the
HTML also loads it (which `template.html` does, for preview), pagedjs
runs twice and paginates the already-paginated output — you get
duplicated pages, mis-sized output, and content overlaid on later
pages. `main.ts` strips the `<script src=".../paged.polyfill.js">`
tag out of the built HTML before handing it to `pagedjs-cli`.

### CLI surface (`main.ts`)

```
quimera init    <dir>   # cp -r sample-book/ <dir>
quimera preview <dir>   # preview.ts
quimera export  <dir>   # export (main.ts)
```

Bun's built-in arg parsing — no `commander`-style dependency.

## Anti-goals

Things that are deliberately **not** the tool's job. Layer them in
userspace via config + CSS + plugins:

- Specific citation styles (ABNT, APA, Chicago). Baseline formatter
  is trivial; anything richer goes in `formatCitation`.
- Draft mode, gray-box images, watermarks — a small remark or rehype
  plugin plus a CSS toggle.
- Imposition (signature/booklet layout), TOC generation, multiple
  built-in themes, systray / background app.
- Any project-specific glyph, sidenote arrow, progress dot, or
  chapter-opening flourish — every one of these is one directive
  entry + one CSS rule away.

## Verification

End-to-end, in this order:

1. `quimera init /tmp/testbook` — scaffolds `content/`, `style.css`,
   `refs.bib`, `quimera.config.ts`, `images/`.
2. `quimera preview /tmp/testbook` — opens `localhost:4000`. Edit a
   `.md`, confirm live reload fires under 500ms. Confirm margin notes
   float on the correct side across facing pages.
3. `quimera export /tmp/testbook` — produces `book.pdf`. Open in a
   viewer and check:
   - page size = A5 (unless overridden in style.css),
   - `pdfinfo` page count matches pagedjs's "Rendering N pages" line,
   - chapter `<h1>` opens on a recto page,
   - margin notes sit in the outer margin on both verso and recto,
   - no duplicated pages, no overlapping content
     (regression guard for the paged.js double-load bug).
4. Sanity check the extension surface: add a `:::warning ... :::`
   block to a `.md`. Confirm it renders as raw text until you add
   `warning: { tag: "aside", class: "warning" }` to
   `quimera.config.ts` and a matching `.warning { ... }` rule to
   `style.css`. Then it should render styled — with zero tool edits.
