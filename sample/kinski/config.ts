import { paragraphNumbers } from "./style/paranum.ts";

const justification = {
  minSpace: 0.4,
  tightSpace: 0.8,
  riverSpace: 1.5,
  shortLine: 0.6,
  stretch: 1000,
  tight: 3000,
  tightCurve: 10000,
  river: 5000,
  riverCurve: 10000,
  hyphenate: 1,
  hyphenPenalty: 2000,
  doubleHyphenPenalty: 6000,
  finalHyphenPenalty: 10000,
  runtLine: 0.25,
  runt: 8000,
  runtCurve: 40000,
};

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
      justification,
    },

    // Paragraph numbers in the gutter, no folio.
    "print-v2": {
      css: "print-v2.css",
      rehypePlugins: [paragraphNumbers],
      justification,
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
