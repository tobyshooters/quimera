import { visit } from "unist-util-visit";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";

/*
Rewrite citation brackets inside text nodes into inline anchors, then append
a <section class="bibliography">.

A bracket holds one or more citations separated by `;`, each optionally
carrying a prefix and a locator:

    [@key]  [@key, p. 42]  [@key p. 42]  [Perloff apud @key, p. 2]
    [@a; apud @b, p. 126]

The comma before a locator is optional, as it is in pandoc.

A bracket is only rewritten if *every* part of it parses as a citation, so
ordinary bracketed prose — an editorial `[...]`, or a caption that happens to
contain one, `![Cintura estreita [@IPNW]](…)` — is left alone.
*/
const CITE_GROUP = /\[([^[\]]*@[^[\]]*)\]/g;
const ONE = /^\s*([^@]*?)\s*@([A-Za-z0-9_:.-]+)(?:\s*,?\s+(.+?))?\s*$/;

export function citations({ bib, formatCitation }) {
  return (tree) => {
    const cited = new Set();
    visit(tree, "text", (node, index, parent) => {
      if (parent.type === "link") {
        return;
      }
      if (!node.value.includes("@")) {
        return;
      }
      const parts = [];
      let last = 0;
      let m;
      CITE_GROUP.lastIndex = 0;
      while ((m = CITE_GROUP.exec(node.value))) {
        const found = m[1].split(";").map((one) => one.match(ONE));
        if (found.some((one) => !one)) {
          continue;
        }
        if (m.index > last) {
          parts.push({ type: "text", value: node.value.slice(last, m.index) });
        }
        const html = found
          .map(([_, prefix, key, locator]) => {
            cited.add(key);
            const inline = formatCitation(bib[key], locator, "inline");
            // The prefix belongs to the citation, so it travels with it —
            // into the margin, for a stylesheet that puts citations there.
            return `<a class="cite" href="#bib-${key}">${prefix ? `${prefix} ` : ""}${inline}</a>`;
          })
          .join("; ");
        parts.push({ type: "html", value: html });
        last = m.index + m[0].length;
      }
      if (parts.length === 0) {
        return;
      }
      if (last < node.value.length) {
        parts.push({ type: "text", value: node.value.slice(last) });
      }
      parent.children.splice(index, 1, ...parts);
      return index + parts.length;
    });
    if (cited.size === 0) {
      return;
    }
    const items = [...cited]
      .sort()
      .map((k) => {
        const full = formatCitation(bib[k], "", "full");
        return `  <li id="bib-${k}">${full}</li>`;
      })
      .join("\n");
    tree.children.push({
      type: "html",
      value: `<section class="bibliography">\n<h1>References</h1>\n<ul>\n${items}\n</ul>\n</section>`,
    });
  };
}

// Tiny .bib parser. Handles top-level `@type{key, field = {value}, ...}`
// entries. No @string, no crossref, no escaping — sufficient for v1.
const ENTRY = /@(\w+)\s*\{\s*([^,\s]+)\s*,([\s\S]*?)\n\}/g;
const FIELD = /(\w+)\s*=\s*(\{([\s\S]*?)\}|"([^"]*)")\s*,?/g;

export async function loadBib(path) {
  if (!existsSync(path)) {
    return {};
  }
  const text = await readFile(path, "utf8");
  const bib = {};
  let e;
  ENTRY.lastIndex = 0;
  while ((e = ENTRY.exec(text))) {
    const [_, type, key, body] = e;
    const fields = {};
    let f;
    FIELD.lastIndex = 0;
    while ((f = FIELD.exec(body))) {
      const value = (f[3] ?? f[4] ?? "").trim();
      fields[f[1].toLowerCase()] = value;
    }
    bib[key] = { type: type.toLowerCase(), key, ...fields };
  }
  return bib;
}

// Baseline citation formatter. Users override in quimera.config.ts.
// Inline citations are wrapped in parentheses by default.
export function defaultFormatCitation(entry, locator, mode) {
  if (!entry) {
    return "?";
  }
  if (mode === "inline") {
    const year = entry.year || "?";
    const first = (entry.author || "?").split(" and ")[0];
    const surname = first.includes(",") ? first.split(",")[0] : first.split(" ").pop();
    const inside = locator ? `${surname}, ${year}, ${locator}` : `${surname}, ${year}`;
    return `(${inside})`;
  }
  const author = entry.author || "?";
  const title = entry.title || "";
  const year = entry.year || "";
  return `${author}. <em>${title}</em>. ${year}.`;
}
