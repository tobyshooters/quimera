# Quimera

Bookmaker CLI that converts bundles of Markdown into a multi-format book.

```
bun install
bun link

quimera init    <dir>         # scaffold a new book from sample-book/
quimera preview <dir>         # live-reloading preview at localhost:4000
quimera export  <dir>  <var>  # write <dir>/output/book-<var>.<txt>
```

Based on HTML/CSS, the hegemonic and most accessible way of specifiying
visual/typographic layout, extended with [paged.js](https://pagedjs.org)
semantics for pages.

The tool ships small. Markdown is extensible via directives defined in a
`config.ts` file. Since the pipeline is based around remark/rehype, custom
meta-programming is also possible. Finally, since it's fundamentally HTML,
there's always an escape hatch for more sophisticated styling.

See `sample/book/` for a working project and `docs/plan.md` for the pipeline,
extension surface, and design rationale.

```
├── book.md              The source of the book
├── refs.bib
├── content
│   ├── 01_intro.md
│   ├── 02_second.md
│   ├── example.svg
│   └── screenshot.png
│
├── output               Sample outputs: PDFs, ePub, website
│   ├── book.pdf
│   ├── book-a4.pdf
│   ├── book-instagram.pdf
│   ├── book-epub.epub
│   └── web
│       ├── index.html
│       ├── content
│       │   ├── example.svg
│       │   └── screenshot.png
│       └── style
│           ├── Agave-Bold.ttf
│           ├── Agave-Regular.ttf
│           └── web.css
│
└── style                How the sample outputs are produced
    ├── config.ts
    ├── Agave-Bold.ttf
    ├── Agave-Regular.ttf
    ├── default.css
    ├── web.css
    ├── epub.css
    ├── a4.css
    └── instagram.css
```
