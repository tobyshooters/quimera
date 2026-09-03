// Lay the three language blocks across book spreads.
//
// The markdown authors each language as a container directive whose
// paragraphs are the tercets:
//
//   :::italian
//   Nel mezzo del cammin di nostra vita
//   mi ritrovai per una selva oscura
//   ché la diritta via era smarrita.
//   ...
//   :::
//
// A spread holds SPREAD tercets. Each spread emits two tables: the
// verso (left page) with the Italian, the recto (right page) with the
// English and Portuguese. Both tables give every tercet a fixed-height
// row, so verse N sits at the same height whether you look left or
// right. Verse lines (soft breaks) become hard <br> breaks.

const SPREAD = 8;

export function zipColumns() {
  const langs = ["italian", "english", "portuguese"];

  // Inline children with each newline turned into a <br>.
  const lines = (para) => {
    const out = [];
    for (const child of para.children) {
      if (child.type !== "text" || !child.value.includes("\n")) {
        out.push(child);
        continue;
      }
      child.value.split("\n").forEach((line, i) => {
        if (i > 0) out.push({ type: "break" });
        out.push({ type: "text", value: line });
      });
    }
    return out;
  };

  const row = (cells) => ({
    type: "tableRow",
    children: cells.map((c) => ({ type: "tableCell", children: c })),
  });

  const table = (klass, rows) => ({
    type: "table",
    align: rows[0].children.map(() => null),
    // Leading empty row: to-hast makes the first row a <thead>, hidden in CSS.
    children: [row(rows[0].children.map(() => [])), ...rows],
    data: { hProperties: { className: ["verses", klass] } },
  });

  return (tree) => {
    const blocks = {};
    let anchor = -1;
    tree.children.forEach((node, i) => {
      if (node.type === "containerDirective" && langs.includes(node.name)) {
        blocks[node.name] = node.children.filter((c) => c.type === "paragraph");
        if (anchor < 0) anchor = i;
      }
    });
    if (langs.some((l) => !blocks[l])) {
      return;
    }

    const n = blocks.italian.length;
    const spreads = [];
    for (let lo = 0; lo < n; lo += SPREAD) {
      const hi = Math.min(lo + SPREAD, n);
      const idx = [];
      for (let i = lo; i < hi; i++) idx.push(i);
      const verso = table("verso", idx.map((i) => row([lines(blocks.italian[i])])));
      const recto = table("recto", idx.map((i) =>
        row([lines(blocks.english[i]), lines(blocks.portuguese[i])]),
      ));
      spreads.push(verso, recto);
    }

    tree.children = tree.children.filter(
      (n) => !(n.type === "containerDirective" && langs.includes(n.name)),
    );
    tree.children.splice(anchor, 0, ...spreads);
  };
}
