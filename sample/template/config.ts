export default {
  // Markdown extensions. Three call sites:
  //   :name[text]        inline   -> <span class="name">text</span>
  //   ::name             leaf     -> <div class="name"></div>
  //   :::name ... :::    block    -> <div class="name">...</div>
  // Any name works with no config at all — write a CSS rule for the class and
  // you have a new construct. List a name below only to change its tag.
  directives: {
    cover: { tag: "section", class: "cover" }, // :::cover ... :::
    margin: { tag: "span", class: "margin" }, // :margin[a side note]
    figure: { tag: "figure", class: "figure" }, // :::figure ![cap](img) :::
  },

  // Optimal (Knuth–Plass) paragraph justification: present = on, and any knob
  // set here overrides DEFAULTS in src/pretext-polyfill.ts. Off where the
  // reader reflows the text (web, epub) and baked breaks would lie.
  justification: {},

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
      justification: false,
    },
  },

  // Further extension points, all optional:
  // remarkPlugins: [],   // rewrite the Markdown AST
  // rehypePlugins: [],   // rewrite the HTML AST
  // formatCitation: (entry, locator, mode) => `${entry.author} (${entry.year})`,
};
