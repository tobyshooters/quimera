export default {

  // Base stylesheet, which variants overwrite.
  css: "default.css",

  variants: {
    print: {},
    draft: { 
      knuth_pratt_via_pretext: false 
    },
    a4: {
      css: "a4.css"
    },
    instagram: {
      css: "instagram.css",
      knuth_pratt_via_pretext: false
    },
  },

  // Extension to markdown syntax
  // NB: the tag+class must be paired to the CSS
  directives: {

    // Cover page
    // :::cover ... :::
    cover: { tag: "section", class: "cover" },

    // Pagebreak via div
    // ::pagebreak
    pagebreak: { tag: "div", class: "pagebreak" },

    // Figure wrapper
    // :::figure ... :::
    figure: { tag: "figure", class: "figure" },

    // Margin note
    // :margin[text] => <span class="margin">text</span>
    margin: { tag: "span", class: "margin" },
  },

  // Text justification with Knuth-Pratt algorithm.
  knuth_pratt_via_pretext: true,

  // UNUSED: meta-programming of the markdown AST
  // remarkPlugins: [],

  // UNUSED: meta-programming of the HTML AST
  // rehypePlugins: [],

  // UNUSED: custom citation format
  // formatCitation: (entry, locator, mode) => "...",
};
