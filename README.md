# something

A Bun CLI that turns a folder of markdown into a print-ready PDF via
[paged.js](https://pagedjs.org).

```
bun install
bunk link

something init    <dir>   # scaffold a new book from sample-book/
something preview <dir>   # live-reloading preview at localhost:4000
something export  <dir>   # write <dir>/book.pdf
```

## Layout and typography

- **Full CSS `@page` control** — page size, margins, running heads, page
  counters, `break-before: right`, `break-inside: avoid`, etc. live in your
  `style.css`.
- **Facing-page layout** — mirrored verso/recto margins, chapters open on the
  recto.
- **Citations** — `[@key]` and `[@key, p. 42]` resolve against
  `refs.bib` and accumulate into a bibliography section.
- **Margin notes** — `:margin[text]` floats to the outer margin.
- **Footnotes, tables, task lists** — via GFM (`[^1]`, pipe tables, `- [ ]`).
- **Directives for class-shaped blocks** — inline `:name[]`, leaf
  `::name`, container `:::name ... :::`. Register a name in
  `something.config.ts` and style it in `style.css`. Escape hatch:
  raw HTML always passes through.

## Extending

The tool ships small. Everything project-specific — which directives
exist, how citations are formatted, extra pipeline steps — lives in
your book's `something.config.ts`:

```ts
export default {
  // Register class-shaped blocks. One entry here + one CSS rule = a
  // new kind of block. The tool ships no directive defaults.
  directives: {
    margin: { tag: "span", class: "margin" },
    figure: { tag: "figure", class: "figure" },
    cover: { tag: "section", class: "cover" },
    // yours:
    warning: { tag: "aside", class: "warning" },
  },

  // Splice your own plugins into the unified pipeline.
  remarkPlugins: [],
  rehypePlugins: [],

  // Override the baseline "(Author, Year, p. N)" citation string.
  formatCitation: (entry, locator, mode) => `${entry.author} ${entry.year}`,
};
```

Anything you'd normally reach for a Lua filter or LaTeX macro for is a
remark/rehype plugin plus a CSS rule.

See `sample-book/` for a working project and `docs/plan.md` for
the pipeline, extension surface, and design rationale.
