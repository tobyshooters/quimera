// A justification playground: one page of the book, every pretext knob on a
// slider beside it, re-broken on every drag.
//
// One page is the whole point. The preview paginates the book through
// paged.js, which takes seconds — too slow to feel a slider. Here nothing
// paginates: a single sheet is filled block by block until it overflows,
// so a re-break costs one page of line breaking and lands in a frame.

import { renderBody, variantPageBox, pretextScript, variantNames, STYLE_DIR } from "./compile.ts";
import { serveFile } from "./preview.ts";
import { watch } from "node:fs";
import { join } from "node:path";

const PORT = 4001;

/*
The knobs, grouped the way lineBadness() reads them, each with the range a
slider can usefully cover and the one-line gloss the panel shows on hover.
Spaces are multiples of the font's normal word space; everything else is a
badness cost, meaningful only against the other costs.

A table of tuples — [key, min, max, step, doc] — rather than sixteen object
literals, so the ranges line up in a column and an odd one is visible.
*/
const GROUPS: [string, [string, number, number, number, string][]][] = [
  ["spaces", [
    ["minSpace",   0.1, 1,   0.01, "spaces may not shrink below this — the line is rejected outright"],
    ["tightSpace", 0.3, 1.2, 0.01, "below this a line reads tight and starts paying the tight toll"],
    ["riverSpace", 1,   3,   0.01, "above this the gaps line up as rivers and pay the river toll"],
    ["shortLine",  0,   1,   0.01, "a line naturally shorter than this much of the column isn't stretched"],
  ]],
  ["weights", [
    ["stretch",    0, 5000,  50,  "price of any deviation from the normal space, cubed"],
    ["river",      0, 20000, 100, "flat toll for crossing riverSpace at all"],
    ["riverCurve", 0, 50000, 250, "price of the excess beyond riverSpace, squared"],
    ["tight",      0, 20000, 100, "flat toll for crossing tightSpace at all"],
    ["tightCurve", 0, 50000, 250, "price of the shortfall below tightSpace, squared"],
  ]],
  ["hyphens", [
    ["hyphenate",           0, 1,     1,   "0 breaks only between whole words, 1 may split them at syllables"],
    ["hyphenPenalty",       0, 20000, 100, "price of ending a line on a hyphen at all"],
    ["doubleHyphenPenalty", 0, 30000, 250, "extra price when the line above also ended on a hyphen"],
    ["finalHyphenPenalty",  0, 40000, 500, "extra price for hyphenating into the paragraph's last line"],
  ]],
  ["runt", [
    ["runtLine",  0, 0.9,    0.01, "a last line shorter than this much of the measure is a runt"],
    ["runt",      0, 40000,  250,  "flat toll for a short last line at all"],
    ["runtCurve", 0, 120000, 1000, "price of how far the last line falls short, squared"],
  ]],
];

const KNOBS = GROUPS.flatMap(([group, rows]) =>
  rows.map(([key, min, max, step, doc]) => ({ group, key, min, max, step, doc })),
);

// A5 with the sample's margins, for a variant whose sheet doesn't say.
const FALLBACK_BOX = { width: 148, height: 210, top: 25, right: 30, bottom: 20, left: 30 };

function panel(variants, current) {
  const options = variants
    .map((v) => `<option${v === current ? " selected" : ""}>${v}</option>`)
    .join("");

  const sliders = KNOBS.map(
    ({ key, min, max, step, doc }) => `
      <label for="${key}" title="${doc}">${key}<output id="out-${key}"></output></label>
      <input type="range" id="${key}" data-knob="${key}"
             min="${min}" max="${max}" step="${step}">
      <small>${doc}</small>`,
  ).join("");

  return `
    <div id="panel">
      <div class="row">
        <select id="variant">${options}</select>
        <button id="prev">←</button>
        <button id="next">→</button>
      </div>
      <div id="folio"></div>

      <label class="row"><input type="checkbox" id="browser"> browser justification</label>
      <label class="row"><input type="checkbox" id="tension" checked> line tension</label>
      <div id="key">
        <span><i class="sw tight"></i>tight — spaces squeezed below tightSpace</span>
        <span><i class="sw river"></i>rivery — spaces stretched past riverSpace</span>
      </div>
      <div id="bands"></div>

      ${sliders}

      <button id="reset">reset to config</button>
      <pre id="config"></pre>
      <button id="copy">copy</button>
    </div>`;
}

// The vocabulary, under the page where there's room for it. Every measure
// in here is a multiple of the normal space, which is what the knobs are
// denominated in, so the words and the sliders mean the same thing.
function explainer() {
  const demo = (label, spacing, text) => `
    <figure class="demo">
      <div style="word-spacing: ${spacing}">${text}</div>
      <figcaption>${label}</figcaption>
    </figure>`;

  const rivery =
    "and he says to me that the one thing<br>" +
    "you can never get back in this world<br>" +
    "is the hour you spent waiting on it";

  const legend = KNOBS.map(({ key, doc }) => `<tr><th>${key}</th><td>${doc}</td></tr>`).join("");

  return `
  <div id="explain">
    <h2>The vocabulary</h2>

    <p><b>Normal space</b> is how wide the space character is in the book's
    own font, at the book's own size. Every number in this panel is a
    multiple of it: 1.00 is the space the typeface was drawn with, 0.70 is
    that space shrunk by a third, 1.60 is it half again as wide.</p>

    <p>A justified line has to reach both edges of the column, and the only
    give in a line is its spaces — the words themselves can't change width.
    So every line is the same words at the same size with the spaces pulled
    or squeezed to make the measure come out. What follows are the two ways
    that goes wrong.</p>

    ${demo("tight — 0.55", "-1.6px", rivery)}
    ${demo("rivery — 1.85", "4.5px", rivery)}

    <p><b>Tight</b> is a line whose spaces were squeezed. The words start to
    touch, the eye stops getting a clean signal about where one ends and the
    next begins, and the line reads darker than its neighbours — a band of
    grey across an otherwise even page.</p>

    <p><b>Rivery</b> is the opposite: spaces stretched so wide they stop
    reading as gaps between words and start reading as holes. The name is
    literal. When several stretched lines sit on top of each other, their
    gaps can line up into a pale channel running down the paragraph, and the
    eye follows it downward instead of along the line. That trickle of white
    is the river.</p>

    <p><b>Badness</b> is what a line's spacing costs, as a single number.
    A line pays for any deviation from normal at all (cubed, so small ones
    are nearly free and large ones hurt fast), and pays an extra flat toll
    plus a squared curve once it crosses into tight or rivery. Below
    <code>minSpace</code> a line isn't priced, it's refused.</p>

    <p>Which is the point of the whole scheme: pretext doesn't fill lines
    one at a time like a browser does, taking each as far as it goes. It
    scores every possible way of breaking the paragraph and keeps the set
    of lines with the lowest total badness. A merely adequate first line is
    worth taking if it saves a terrible fourth one.</p>

    <p><b>The runt</b> is the one thing the last line can still get wrong.
    It isn't justified, so it never stretches and never squeezes — but if
    it holds a single word, the paragraph ends as a stub under a solid
    block with its whole right side blank, and the eye reads the gap as a
    break that isn't there. <code>runtLine</code> is how much of the
    measure a last line has to fill before it stops paying;
    <code>runt</code> and <code>runtCurve</code> are the flat toll and the
    squared cost of falling short.</p>

    <p>Note it's measured as a length, not a word count — a lone
    <i>supervision</i> fills more of the line than <i>of it</i> does, and
    reads better for it. This is also the clearest case for scoring whole
    paragraphs rather than filling lines one at a time: nothing about the
    last line can fix the last line. The only cure is to stretch an earlier
    line slightly and pull a word down, and a breaker that has already
    committed to those lines can't go back.</p>

    <p><b>The gutter</b> beside the page is this, line by line. Each bar
    starts at the solid rule — normal space, 1.00 — and runs left if that
    line had to squeeze and right if it had to stretch, as far as the space
    actually ended up. The two dashed rules are <code>tightSpace</code> and
    <code>riverSpace</code>, so a bar crossing one is a line changing band,
    and dragging those sliders moves the wall itself. Bars past the left
    rule are orange, past the right are blue, and the same colours wash the
    lines on the page so you can find them. Hover a bar for its number.</p>

    <h2>Hyphenation</h2>

    <p>Everything above assumes the only give in a line is its spaces. There
    is a second source: a long word at the end of a line can be split, and
    part of it pulled up. <code>su-per-vi-sion</code> gives the breaker four
    places to end a line instead of one, and slack it finds in a word is
    slack the spaces don't have to absorb — so hyphenation mostly shows up
    as <i>fewer</i> tight and rivery lines rather than as visible hyphens.</p>

    <p>Where the syllables are is not a guess. pretext uses Liang's patterns,
    the same table TeX has shipped since 1983: a few thousand fragments like
    <code>hy3ph</code> or <code>n2at</code>, each voting on whether a break
    may fall at a given spot, odd votes for and even votes against. Every
    matching pattern is laid over the word and the highest vote at each
    position wins. No dictionary, about 30KB, and it agrees with TeX
    word for word. Knuth's own exception list rides along for the handful it
    gets wrong, and no fragment shorter than two letters is left behind or
    three carried over.</p>

    <p>Hyphens have costs of their own, and they aren't about the single
    line. <code>hyphenPenalty</code> is the standing charge for ending any
    line on one. <code>doubleHyphenPenalty</code> is what stops a ladder of
    them running down the right margin — two in a row is much worse than
    twice one. <code>finalHyphenPenalty</code> keeps a broken word out of
    the paragraph's last line, where the reader has to carry a fragment
    across the break to a line that then stops early. Set
    <code>hyphenate</code> to 0 to see the paragraph without any of it.</p>

    <h2>The knobs</h2>
    <p>The four space knobs say what counts as bad. The five weights say how
    much it costs; they're meaningful only against each other, so doubling
    all five changes nothing. The hyphen penalties are on that same scale —
    compare them against <code>river</code> and <code>tight</code> to see
    what the breaker is willing to trade a hyphen for.</p>
    <table>${legend}</table>
  </div>`;
}

function chrome(box, variants, current, initial) {
  return `
<style>
  body {
    margin: 0;
    display: flex;
    align-items: flex-start;
    background: #f0f0f0;
  }
  #sheet {
    position: relative;
    width: ${box.width}mm;
    height: ${box.height}mm;
    padding: ${box.top}mm ${box.right}mm ${box.bottom}mm ${box.left}mm;
    box-sizing: border-box;
    margin: 24px;
    background: white;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  }
  /* Not a scroller: the gutter numbers hang outside the column and
     overflow:hidden would clip them. Fill measures the last block instead. */
  #col {
    height: 100%;
  }
  /* The page, and under it the prose that explains it — one column, so
     the explainer can be read at a sane measure instead of squeezed into
     the slider rail. */
  #main {
    display: flex;
    flex-direction: column;
    align-items: center;
    min-width: 0;
  }
  #stage {
    display: flex;
    align-items: flex-start;
  }
  #explain {
    width: min(34em, 90vw);
    margin: 16px 24px 96px;
    font: 14px/1.6 ui-sans-serif, system-ui, sans-serif;
    color: #222;
  }
  #explain h2 {
    font-size: 13px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #777;
    margin: 32px 0 8px;
  }
  #explain code, #explain th {
    font: 12px ui-monospace, monospace;
  }
  #explain table {
    border-collapse: collapse;
  }
  #explain th {
    text-align: left;
    vertical-align: top;
    padding: 4px 12px 4px 0;
    white-space: nowrap;
  }
  #explain td {
    padding: 4px 0;
  }
  /* Same typeface as the book, at the two extremes, so the words "tight"
     and "rivery" have something to point at. */
  .demo {
    margin: 16px 0;
    padding: 12px 16px;
    background: #fff;
    border-left: 3px solid #ddd;
    font-size: 11pt;
    line-height: 1.5;
  }
  .demo figcaption {
    margin-top: 8px;
    font: 11px ui-monospace, monospace;
    color: #888;
  }
  #panel {
    position: sticky;
    top: 0;
    flex: none;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 16px 16px 48px;
    width: 280px;
    font: 12px ui-monospace, monospace;
  }
  #panel label {
    display: flex;
    justify-content: space-between;
    margin-top: 10px;
  }
  #panel small {
    color: #888;
    font-size: 10px;
    line-height: 1.3;
  }
  #panel output {
    color: #555;
  }
  .row {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  #folio, #bands {
    color: #555;
    margin: 6px 0;
  }
  #config {
    background: #fff;
    border: 1px solid #ccc;
    padding: 8px;
    font-size: 11px;
    overflow-x: auto;
  }
  details {
    margin-top: 16px;
    color: #444;
    line-height: 1.45;
  }
  /* Tension bands, keyed off the space ratio pretext stamps on each line. */
  .tension .tight { background: rgba(220, 120, 0, 0.18); }
  .tension .river { background: rgba(0, 110, 220, 0.15); }
  .sw {
    display: inline-block;
    width: 10px;
    height: 10px;
    margin-right: 6px;
  }
  .sw.tight { background: rgba(220, 120, 0, 0.55); }
  .sw.river { background: rgba(0, 110, 220, 0.5); }
  #key {
    display: flex;
    flex-direction: column;
    gap: 3px;
    color: #555;
    font-size: 11px;
    margin: 4px 0;
  }

  /* One bar per line of the page, on the same baseline as the line it
     measures: how far that line's space had to move off normal, and which
     way. The band thresholds are drawn in, so a slider visibly moves the
     wall rather than just the tally. */
  /* A column of its own beside the page, not an overflow off the page:
     absolutely positioned it reserved no width, and the slider rail —
     the next flex item along — was laid out straight through it. */
  #gutter {
    position: relative;
    flex: none;
    width: 150px;
    height: ${box.height}mm;
    margin: 24px 24px 24px 0;
  }
  #gutter .bar {
    position: absolute;
    min-width: 2px;
    background: #bbb;
  }
  #gutter .bar.tight { background: rgba(220, 120, 0, 0.75); }
  #gutter .bar.river { background: rgba(0, 110, 220, 0.7); }
  #gutter .rule {
    position: absolute;
    top: 0;
    bottom: 0;
    border-left: 1px dashed #bbb;
  }
  #gutter .rule.normal {
    border-left: 1px solid #999;
  }
  #gutter .rule span {
    position: absolute;
    top: -16px;
    transform: translateX(-50%);
    font: 10px ui-monospace, monospace;
    color: #888;
  }
</style>
${panel(variants, current)}
<script>
  (() => {
    const ORDER = ${JSON.stringify(KNOBS.map((k) => k.key))};
    const { run, defaults } = window.pretext;
    const configured = { ...defaults, ...${JSON.stringify(initial)} };

    const sheet = document.getElementById("sheet");
    const col = document.getElementById("col");
    const src = [...document.getElementById("src").content.children];

    // Front matter and the cover are set in their own styles and aren't
    // what anyone tunes, so open on the first body paragraph. Blocks are
    // the document's top-level elements — usually one paragraph, but a
    // wrapper like div.frontmatter is a single block holding several.
    const body = src.findIndex((el) => el.tagName === "P");

    // One start index per page visited, so ← can walk back out of a fill
    // whose extent only the fill loop knew.
    const starts = [Math.max(body, 0)];

    const values = () =>
      Object.fromEntries(
        [...document.querySelectorAll("[data-knob]")].map((i) => [i.dataset.knob, +i.value]),
      );

    // The gutter's scale, in multiples of the normal space. Fixed rather
    // than fitted to the page, so a bar means the same length after a drag
    // as it did before it.
    const LO = 0.4, HI = 2.0;
    const at = (space) => ((Math.min(Math.max(space, LO), HI) - LO) / (HI - LO)) * 100;

    // A bar per line, top-aligned with the line it measures, drawn from the
    // normal-space rule out to where that line actually landed.
    const gutter = (lines, knobs) => {
      const rail = document.getElementById("gutter");
      const origin = rail.getBoundingClientRect().top;
      rail.innerHTML = "";

      for (const [space, cls] of [[1, "normal"], [knobs.tightSpace, "tight"], [knobs.riverSpace, "river"]]) {
        const rule = document.createElement("div");
        rule.className = "rule " + cls;
        rule.style.left = at(space) + "%";
        rule.innerHTML = "<span>" + space + "</span>";
        rail.appendChild(rule);
      }

      for (const line of lines) {
        const space = +line.dataset.space;
        const box = line.getBoundingClientRect();
        const bar = document.createElement("div");
        bar.className = "bar " + line.className;
        bar.style.top = box.top - origin + "px";
        // Short of the full line height, so consecutive bars read as a
        // stack of lines rather than one solid block.
        bar.style.height = Math.max(2, box.height - 4) + "px";
        bar.style.left = Math.min(at(1), at(space)) + "%";
        bar.style.width = Math.abs(at(space) - at(1)) + "%";
        bar.title = line.textContent.slice(0, 40) + " — " + space.toFixed(2);
        rail.appendChild(bar);
      }
    };

    // Fill the sheet from the current start block, breaking each paragraph
    // as it lands, and stop at the first block that hangs below the column.
    const fill = () => {
      const knobs = values();
      const raw = document.getElementById("browser").checked;
      col.innerHTML = "";

      const floor = col.getBoundingClientRect().bottom;
      const start = starts[starts.length - 1];
      let i = start;
      for (; i < src.length; i++) {
        col.appendChild(src[i].cloneNode(true));
        if (!raw) {
          // Skips the paragraphs it already broke — they hold line spans
          // now, which pretext reads as markup it can't measure.
          run(knobs);
        }
        if (col.lastElementChild.getBoundingClientRect().bottom > floor) {
          if (col.children.length > 1) {
            col.lastElementChild.remove();
          }
          break;
        }
      }
      col.dataset.end = i;

      let tight = 0, river = 0, total = 0;
      const lines = col.querySelectorAll("[data-space]");
      for (const line of lines) {
        const space = +line.dataset.space;
        line.className =
          space < knobs.tightSpace ? "tight" : space > knobs.riverSpace ? "river" : "";
        tight += line.className === "tight";
        river += line.className === "river";
        total++;
      }
      sheet.classList.toggle("tension", document.getElementById("tension").checked);
      gutter(lines, knobs);

      document.getElementById("folio").textContent =
        "page " + starts.length + " · blocks " + start + "–" + i + " of " + src.length +
        " · " + col.querySelectorAll("p").length + " paragraphs";
      document.getElementById("bands").textContent = raw
        ? "browser justification — no tension to measure"
        : total + " lines · " + tight + " tight · " + river + " rivery";

      // Numbers swing to the outer margin; alternate so both sides get seen.
      document.documentElement.style.setProperty("--recto", starts.length % 2);

      const block = ORDER.map((k) => "    " + k + ": " + knobs[k] + ",").join("\\n");
      document.getElementById("config").textContent = "justification: {\\n" + block + "\\n  },";
    };

    const sync = () => {
      for (const input of document.querySelectorAll("[data-knob]")) {
        input.value = configured[input.dataset.knob];
        document.getElementById("out-" + input.dataset.knob).textContent = input.value;
      }
    };

    document.getElementById("panel").addEventListener("input", (e) => {
      const key = e.target.dataset.knob;
      if (key) {
        document.getElementById("out-" + key).textContent = e.target.value;
      }
      fill();
    });
    document.getElementById("reset").onclick = () => { sync(); fill(); };
    document.getElementById("copy").onclick = () =>
      navigator.clipboard.writeText(document.getElementById("config").textContent);

    document.getElementById("variant").onchange = (e) => {
      const u = new URL(location.href);
      u.searchParams.set("variant", e.target.value);
      location.href = u.toString();
    };

    const go = (n) => {
      if (n > 0 && +col.dataset.end < src.length) {
        starts.push(+col.dataset.end);
      } else if (n < 0 && starts.length > 1) {
        starts.pop();
      } else {
        return;
      }
      fill();
    };
    document.getElementById("next").onclick = () => go(1);
    document.getElementById("prev").onclick = () => go(-1);
    addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight") go(1);
      if (e.key === "ArrowLeft") go(-1);
    });

    sync();

    /*
    The book's text sits in an inert <template> until the first fill, so
    nothing on the page uses its typeface yet: the browser never starts
    fetching it and document.fonts.ready resolves right away. Measuring
    then gives fallback metrics and a page of wrong line breaks, which
    silently corrects on the first slider touch. So ask for the faces by
    name — regular and italic, at the body's own size — before filling.
    */
    const boot = async () => {
      const css = getComputedStyle(document.body);
      const face = css.fontSize + " " + css.fontFamily;
      await Promise.all(
        [face, "italic " + face, "700 " + face].map((f) =>
          document.fonts.load(f).catch(() => {}),
        ),
      );
      await document.fonts.ready;
      fill();
    };
    boot();
  })();
<\/script>`;
}

async function playground(projectDir, variant) {
  const { body, config, styleSheet } = await renderBody(projectDir, variant);
  const variants = await variantNames(projectDir);

  // The whole @import chain, since the variant's own sheet may restate
  // @page while an imported one sets the :left/:right margins that win.
  const box = (await variantPageBox(projectDir, styleSheet)) || FALLBACK_BOX;

  // Measure mode: the sheet is real, laid-out DOM, so pretext reads the
  // column off it — no baked width to drift from the stylesheet.
  const pretext = await pretextScript(0, true, {});

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>justify — ${variant}</title>
    <link rel="stylesheet" href="${STYLE_DIR}/${styleSheet}" />
    ${pretext}
  </head>
  <body>
    <div id="main">
      <div id="stage">
        <div id="sheet"><div id="col"></div></div>
        <div id="gutter"></div>
      </div>
      ${explainer()}
    </div>
    <template id="src">${body}</template>
    ${chrome(box, variants, variant, config.justification || {})}
    <script>
      new WebSocket("ws://" + location.host + "/ws").onmessage = () => location.reload();
    <\/script>
  </body>
</html>`;
}

export async function justify(projectDir, initialVariant) {
  const clients = new Set();
  const names = await variantNames(projectDir);
  // Default to a variant that actually line-breaks through pretext.
  const fallback = names.find((n) => n.startsWith("print")) || names[0];

  let timer;
  watch(projectDir, { recursive: true }, (_event, filename) => {
    if (!filename || filename.startsWith(".") || filename.endsWith("~")) {
      return;
    }
    clearTimeout(timer);
    timer = setTimeout(() => {
      console.log("change → reload");
      for (const ws of clients) {
        ws.send("reload");
      }
    }, 100);
  });

  const server = Bun.serve({
    port: PORT,
    async fetch(req, srv) {
      const url = new URL(req.url);
      if (url.pathname === "/ws") {
        return srv.upgrade(req) ? undefined : new Response("upgrade failed", { status: 400 });
      }
      if (url.pathname === "/" || url.pathname === "/index.html") {
        const variant = url.searchParams.get("variant") || initialVariant || fallback;
        const html = await playground(projectDir, variant);
        return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
      }
      const file = await serveFile(join(projectDir, url.pathname));
      return file || new Response("not found", { status: 404 });
    },
    websocket: {
      open: (ws) => clients.add(ws),
      close: (ws) => clients.delete(ws),
      message() {},
    },
  });

  console.log(`justify at http://localhost:${server.port}`);
}
