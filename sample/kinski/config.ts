export default {

  // Only the exceptions: anything else becomes div.<name> (span inline).
  directives: {
    cover:  { tag: "section", class: "cover"  },
    figure: { tag: "figure",  class: "figure" },
    margin: { tag: "span",    class: "margin" },
  },

  variants: {
    print: {
      css: "print.css",
      justification: {
        minSpace:   0.4,  // reject a line tighter than this x normal space
        tightSpace: 0.65, // below this it reads tight
        riverSpace: 1.5,  // above this it reads as a river
        shortLine:  0.6,  // shorter than this x column, don't stretch
        stretch:    1000, // cost of deviating from normal space, cubed
        river:      5000,
        riverCurve: 10000,
        tight:      3000,
        tightCurve: 10000,
      },
    },
    web: {
      web: true,
      css: "web.css",
      justification: {},
    },
    epub: {
      epub: true,
      css: "epub.css",
    },
  },
};
