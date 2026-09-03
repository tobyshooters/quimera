// Regenerate the poem from the source facsimile. Run from the project root:
//
//   pdftohtml -xml -i -fontfullname reference/un_coup_de_des.pdf reference/coords.xml
//   bun run reference/gen.ts > content/poem.md
//
// It reads the word coordinates poppler extracts from the PDF and snaps them
// onto the monospace character grid the `::l[...]` lines use — leading spaces
// for the horizontal position, blank `::l[]` lines for the vertical gaps, and
// :big / :mid / :it wrappers for the four typefaces (by PDF font id).
import { readFileSync } from "node:fs";
const xml = readFileSync("reference/coords.xml","utf8");

const U = 6;        // px per character column (horizontal grid)
const ROW = 13.5;   // px per line (vertical grid)
const BASE0 = 135;  // global baseline anchor (top+height of first line)
const LEFT0 = 135;  // left margin baseline
const SAME = 7;     // tops within this many px share one visual line

type Frag = { top:number; base:number; left:number; font:number; text:string };

const pages: Frag[][] = [];
const pageRe = /<page number="(\d+)"[^>]*>([\s\S]*?)<\/page>/g;
let pm: RegExpExecArray | null;
while ((pm = pageRe.exec(xml))) {
  const frags: Frag[] = [];
  const tRe = /<text top="(\d+)" left="(\d+)" width="\d+" height="(\d+)" font="(\d+)">([\s\S]*?)<\/text>/g;
  let tm: RegExpExecArray | null;
  while ((tm = tRe.exec(pm[2]))) {
    const [top,left,height,font] = [ +tm[1], +tm[2], +tm[3], +tm[4] ];
    const text = tm[5].replace(/<\/?[bi]>/g,"").replace(/\u2019/g,"'").replace(/\u2014/g,"--");
    if (!text.trim() || left === 0) continue;
    frags.push({ top, base: top+height, left, font, text });
  }
  pages.push(frags);
}

const wrap = (font:number, s:string) =>
  font===0 ? `:big[${s}]` : font===3 ? `:mid[${s}]` : font===2 ? `:it[${s}]` : s;

// Pad with non-breaking spaces: paged.js trims a block's leading whitespace
// when it sits before an inline element (`:big`/`:it`/`:mid`), which would drop
// the indentation. NBSP isn't collapsible whitespace, so the grid survives —
// and it still reads as blank space in the source.
const PAD = "\u00A0";  // NBSP

let maxLen = 0;
const out: string[] = [];
for (const frags of pages) {
  frags.sort((a,b)=> a.base-b.base || a.left-b.left);
  // cluster fragments into visual lines by proximity of `top`
  const lines: Frag[][] = [];
  for (const f of frags) {
    const last = lines[lines.length-1];
    if (last && f.base - last[0].base < SAME) last.push(f);
    else lines.push([f]);
  }
  out.push(":::spread");
  let prevRow = -1, prevBase = BASE0;
  for (const line of lines) {
    const base = line[0].base;
    const row = prevRow < 0
      ? Math.round((base - BASE0)/ROW)
      : prevRow + Math.max(1, Math.round((base - prevBase)/ROW));
    for (let g=prevRow+1; g<row; g++) out.push("::l[]");
    prevRow = row; prevBase = base;
    line.sort((a,b)=> a.left-b.left);
    let cur = 0, s = "";
    for (const f of line) {
      let col = Math.round((f.left - LEFT0)/U);
      if (col <= cur && cur>0) col = cur + 1;
      s += PAD.repeat(Math.max(0, col - cur)) + wrap(f.font, f.text);
      cur = col + f.text.length;
    }
    maxLen = Math.max(maxLen, cur);
    out.push(`::l[${s}]`);
  }
  out.push(":::","");
}
console.error("maxLen(chars) =", maxLen);
console.log(out.join("\n"));
