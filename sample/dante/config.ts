import { zipColumns } from "./style/columns.ts";

export default {
  css: "print.css",
  knuth_pratt_via_pretext: false,
  remarkPlugins: [zipColumns],
  directives: {
    cover: { tag: "section", class: "cover" },
  },
};
