# Quimera

Bookmaker CLI that converts bundles of Markdown into a multi-format book.

```
bun install
bun link

quimera init    <dir>   # scaffold a new book from sample-book/
quimera preview <dir>   # live-reloading preview at localhost:4000
quimera export  <dir>   # write <dir>/book.pdf
```

Based on HTML/CSS, the hegemonic and most accessible way of specifiying
visual/typographic layout, extended with [paged.js](https://pagedjs.org)
semantics for pages.

The tool ships small. Markdown is extensible via directives defined in a
`config.ts` file. Since the pipeline is based around remark/rehype, custom
meta-programming is also possible. Finally, since it's fundamentally HTML,
there's always an escape hatch for more sophisticated styling.

See `sample-book/` for a working project and `docs/plan.md` for the pipeline,
extension surface, and design rationale.

```
sample-book
├── content
│   ├── 01-intro.md
│   └── 02-second.md
├── images
│   ├── 2026-08-31-19-23-20.png
│   └── example.svg
├── refs.bib
└── style
    ├── a4.css
    ├── config.ts
    ├── default.css
    └── instagram.css
```
