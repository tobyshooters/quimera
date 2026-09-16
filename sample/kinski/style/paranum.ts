// Stamp 001, 002, ... onto body paragraphs; print-v2.css prints it in the
// gutter.
//
// Not a CSS counter: paged.js rewrites counter-increment into its own
// per-page bookkeeping, and the preview (pagedjs from unpkg) and export
// (pagedjs-cli's bundled copy) disagree about how. Numbering the source
// is renderer-proof, and pads to three digits, which CSS can't.
//
// Two marks, because the number does not belong to the paragraph box:
// paged.js can break a paragraph before its first line, and a number hung
// off the box stays behind on the empty fragment while its text goes to
// the next page. So `data-para` styles the block, and `data-num` — on a
// span around the first word — carries the digits and travels with them.

// Paragraphs inside these are apparatus, not argument.
const SKIP_CLASS = ["cover", "frontmatter", "bibliography"];
const SKIP_TAG = ["figure", "blockquote"];

export function paragraphNumbers() {
  return (tree) => {
    let n = 0;

    const walk = (node, inBody) => {
      for (const child of node.children || []) {
        const cls = child.properties?.className || [];
        const skip =
          !inBody ||
          SKIP_TAG.includes(child.tagName) ||
          cls.some((c) => SKIP_CLASS.includes(c));

        if (child.tagName === "p" && !skip) {
          n += 1;
          const num = String(n).padStart(3, "0");
          child.properties["data-para"] = num;
          wrapFirstWord(child, num);
        }
        walk(child, !skip);
      }
    };

    walk(tree, true);
  };
}

/*
Wrap the paragraph's first word in <span data-num>, in place. Descends
through leading inline markup (<em>Now</em>, ...) to reach real text.
*/
function wrapFirstWord(node, num) {
  const kids = node.children || [];

  for (let i = 0; i < kids.length; i++) {
    const kid = kids[i];

    if (kid.type === "element") {
      if (wrapFirstWord(kid, num)) {
        return true;
      }
      continue;
    }
    if (kid.type !== "text" || !kid.value.trim()) {
      continue;
    }

    // Leading space stays outside the span; the word is everything up to
    // the next space.
    const start = kid.value.length - kid.value.trimStart().length;
    const end = kid.value.indexOf(" ", start + 1);
    const cut = end === -1 ? kid.value.length : end;

    const span = {
      type: "element",
      tagName: "span",
      properties: { "data-num": num },
      children: [{ type: "text", value: kid.value.slice(start, cut) }],
    };

    const before = { type: "text", value: kid.value.slice(0, start) };
    const after = { type: "text", value: kid.value.slice(cut) };
    kids.splice(i, 1, before, span, after);
    return true;
  }

  return false;
}
