# Welcome

This is your book. Write [Markdown](https://commonmark.org) here — headings,
_emphasis_, lists, tables, footnotes[^1] — and it becomes a print-ready PDF, a
static website, and an EPUB from the one source. :margin[This sentence has a
margin note. In print it floats into the outer margin; on the web it sits in
the whitespace beside the column; in EPUB it becomes an indented aside.]

Every `h1` starts a new chapter on a right-hand page. Drop into raw
<abbr title="HyperText Markup Language">HTML</abbr> whenever Markdown runs out
of road — it passes straight through.

## Directives

Anything beyond plain Markdown is a *directive*, mapped to an HTML tag and CSS
class in `config.ts`. This book already defines four: `cover`, `margin`,
`figure`, and `pagebreak`. A figure:

:::figure
![A caption, which becomes the figcaption.](./diagram.svg)
:::

To invent your own, add one line to `config.ts` and one rule to the stylesheets
— no changes to the tool. See `config.ts` for the exact shape.

## Citations

Cite a key from `refs.bib` with `[@key]` or `[@key, p. 42]` and a bibliography
is appended automatically. [@strunk, p. 23]

::pagebreak

## Building

```
quimera preview .          # live-reloading preview at localhost:4000
quimera export . print     # output/my-book-print.pdf
quimera export . web       # output/web/index.html
quimera export . epub      # output/my-book-epub.epub
```

Each format is a *variant* in `config.ts`, differing only by stylesheet and a
few flags. Add your own the same way.

[^1]: Footnotes work too, via GitHub-Flavored Markdown.
