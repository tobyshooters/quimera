// Stéphane Mallarmé — Un coup de dés jamais n'abolira le hasard (1897).
//
// The poem is a spatial composition: words scattered across the page in
// constellations. The whitespace primitive here is a fixed character grid.
//
//   :::spread   one printed page (a "spread" in Mallarmé's terms)
//   ::l[...]    one line, rendered with `white-space: pre` in a monospace
//               font — so the leading spaces you type ARE the horizontal
//               position. Blank `::l[]` lines are the vertical spacing.
//
// Everything else is just which of the four typefaces a fragment uses:
//   :big[...]   the great roman capitals of the main sentence
//               (UN COUP DE DÉS ... JAMAIS ... N'ABOLIRA ... LE HASARD)
//   :mid[...]   the middle italic capitals (C'ÉTAIT, LE NOMBRE, ...)
//   :it[...]    the italic undervoice
//   (plain)     the roman body

export default {
  css: "default.css",

  variants: {
    // Paginated print — one <section class="spread"> per page.
    print: {},

    // One long scroll; each spread keeps its grid, stacked vertically.
    web: {
      web: true,
      css: "web.css",
    },
  },

  directives: {
    // A page of the poem.
    spread: { tag: "section", class: "spread" },

    // A line on the character grid (white-space: pre).
    l: { tag: "div", class: "l" },

    // The four typographic voices.
    big: { tag: "span", class: "big" },
    mid: { tag: "span", class: "mid" },
    it: { tag: "span", class: "it" },
  },

  // The grid depends on literal spacing — never re-justify.
  knuth_pratt_via_pretext: false,
};
