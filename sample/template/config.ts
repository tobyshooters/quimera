export default {
  // Markdown extensions. Each name maps to an HTML tag + CSS class; the class
  // must have a matching rule in the stylesheets. Three call sites:
  //   :name[text]        inline   -> <tag class="name">text</tag>
  //   ::name             leaf     -> <tag class="name"></tag>
  //   :::name ... :::    block    -> <tag class="name">...</tag>
  // Add a directive here + a CSS rule and you have a new construct. That's the
  // whole extension surface — the tool ships no directives of its own.
  directives: {
    cover: { tag: "section", class: "cover" }, // :::cover ... :::
    margin: { tag: "span", class: "margin" }, // :margin[a side note]
    figure: { tag: "figure", class: "figure" }, // :::figure ![cap](img) :::
    pagebreak: { tag: "div", class: "pagebreak" }, // ::pagebreak
  },

  // Optimal (Knuth–Plass) paragraph justification. On for paged output; off
  // where the reader reflows the text (web, epub) and baked breaks would lie.
  knuth_pratt_via_pretext: true,

  // Output formats. Each is shallow-merged over the settings above and names
  // its own stylesheet under style/. `export` builds the one you name
  // (`quimera export . web`); the first is the default.
  variants: {
    // A5 print PDF.
    print: {
      css: "print.css",
    },

    // Static website: one flowing column, no pages, no paged.js.
    web: {
      web: true,
      css: "web.css",
    },

    // Reflowable EPUB. No baked line breaks — readers reflow at will.
    epub: {
      epub: true,
      css: "epub.css",
      knuth_pratt_via_pretext: false,
    },
  },

  // Further extension points, all optional:
  // remarkPlugins: [],   // rewrite the Markdown AST
  // rehypePlugins: [],   // rewrite the HTML AST
  // formatCitation: (entry, locator, mode) => `${entry.author} (${entry.year})`,
};
