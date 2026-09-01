// Book-level config. This is where you register directive → HTML
// mappings, extra remark/rehype plugins, and citation formatting.
// See something/agent-notes/plan.md for the full extension surface.

export default {
  directives: {
    // E.g. inline marker
    // :margin[text]
    // <span class="margin">text</span>
    margin: { tag: "span", class: "margin" },

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
    cover: { tag: "section", class: "cover" },
  },

  // remarkPlugins: [],
  // rehypePlugins: [],
  // formatCitation: (entry, locator, mode) => "...",

  // Base stylesheet under style/. Variants override this with their own.
  css: "default.css",

  // Column width is auto-detected from @page CSS; override if needed:
  pretext: true,
  // pretext: { colWidthMm: 93 }

  // Named versions, shallow-merged over everything above. The preview
  // shows a dropdown to swap between them; the first is the default
  // (also what `export` builds). Omit `variants` for a single config.
  variants: {
    print: {}, // shared base as-is (A5)
    draft: { pretext: false }, // greedy justification, faster reloads

    // Very similar: A4 reuses default.css via @import, overriding only geometry.
    a4: { css: "a4.css" },

    // Radically different: a variant may swap the whole stylesheet.
    // `css` also drives pretext's auto column-width detection.
    instagram: { css: "instagram.css" },
  },
};
