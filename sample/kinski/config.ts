export default {

  directives: {
    cover:     { tag: "section", class: "cover"     }, // :::cover ... :::
    margin:    { tag: "span",    class: "margin"    }, // :margin[a side note]
    figure:    { tag: "figure",  class: "figure"    }, // :::figure ![cap](img) :::
    pagebreak: { tag: "div",     class: "pagebreak" }, // ::pagebreak
  },

  variants: {
    print: {
      css: "print.css",
      knuth_pratt_via_pretext: true,
    },
    web: {
      web: true,
      css: "web.css",
      knuth_pratt_via_pretext: true,
    },
    epub: {
      epub: true,
      css: "epub.css",
      knuth_pratt_via_pretext: false,
    },
  },
};
