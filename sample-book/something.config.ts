// Book-level config. This is where you register directive → HTML
// mappings, extra remark/rehype plugins, and citation formatting.
// See something/agent-notes/plan.md for the full extension surface.

export default {
  directives: {

    // E.g. inline marker
    // :margin[text]
    // <span class="margin">text</span>
    margin: { tag: "span",   class: "margin" },

    // E.g. self-contained marker
    // ::pagebreak
    // <div class="pagebreak"></div>
    pagebreak: { tag: "div", class: "pagebreak" },

    // E.g. block
    // :::figure ... :::
    // <figure class="figure">...</figure>
    figure: { tag: "figure", class: "figure" },

    // E.g. full-page block that vertically centers its content
    // :::cover ... :::
    // <section class="cover">...</section>
    cover:  { tag: "section", class: "cover" },

  },

  // remarkPlugins: [],
  // rehypePlugins: [],
  // formatCitation: (entry, locator, mode) => "...",

  // Column width is auto-detected from @page CSS; override if needed:
  pretext: true,
  // pretext: { colWidthMm: 93 }
};
