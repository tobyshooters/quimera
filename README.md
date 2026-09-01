# Quimera

Bookmaker CLI that converts bundles of Markdown into a multi-format book.

```
bun install
bun link

quimera init    <dir>   # scaffold a new book from sample-book/
quimera preview <dir>   # live-reloading preview at localhost:4000
quimera export  <dir>   # write <dir>/output/book.pdf
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
.
├── output                     Examples of produced outputs
│   ├── book-a4.pdf            from a single shared core, but 
│   ├── book-instagram.pdf     with varied styling.
│   └── book.pdf
│
├── book.md                    The file that drives the content.
├── content
│   ├── 01_intro.md
│   ├── 02_second.md
│   ├── screenshot.png
│   └── example.svg
├── refs.bib
└── style
    ├── config.ts              The file that drives the style/display.
    ├── default.css
    ├── a4.css
    ├── instagram.css
    ├── Agave-Bold.ttf
    └── Agave-Regular.ttf
```
