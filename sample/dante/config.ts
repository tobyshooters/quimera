import { zipColumns } from "./style/columns.ts";

export default {
  css: "print.css",
  justification: false,
  remarkPlugins: [zipColumns],
  directives: {
    cover: { tag: "section", class: "cover" },
  },
};
