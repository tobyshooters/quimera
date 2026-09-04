import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkDirective from "remark-directive";
import remarkRehype from "remark-rehype";
import rehypeRaw from "rehype-raw";
import rehypeStringify from "rehype-stringify";
import { visit } from "unist-util-visit";
import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { citations, loadBib, defaultFormatCitation } from "./citations.ts";

const TOOL_DIR = new URL(".", import.meta.url).pathname;

// Stylesheets live under <project>/style/; config.ts sits at the project root.
export const STYLE_DIR = "style";

// The active sheet plus every sheet it pulls in via `@import`, so export paths
// ship the whole chain, not just the entry. Names are relative to STYLE_DIR;
// only same-directory imports are followed. Missing sheets are skipped.
export async function styleSheetChain(projectDir, styleSheet) {
  const chain: string[] = [];
  const seen = new Set<string>();
  const queue = [styleSheet];
  while (queue.length) {
    const name = queue.shift()!;
    if (seen.has(name)) {
      continue;
    }
    seen.add(name);
    const path = join(projectDir, STYLE_DIR, name);
    if (!existsSync(path)) {
      continue;
    }
    chain.push(name);
    const css = await readFile(path, "utf8");
    for (const m of css.matchAll(/@import\s+(?:url\()?["']([^"')]+)["']\)?/g)) {
      queue.push(m[1].replace(/^\.\//, ""));
    }
  }
  return chain;
}

// CSS page size name → [width, height] in mm
const PAGE_SIZES: Record<string, [number, number]> = {
  a3: [297, 420],
  a4: [210, 297],
  a5: [148, 210],
  a6: [105, 148],
  letter: [215.9, 279.4],
  legal: [215.9, 355.6],
  tabloid: [279.4, 431.8],
};

// Parse a CSS length value (cm, mm, in, pt, px) to mm.
function cssLenToMm(val: string): number | null {
  const m = val.trim().match(/^([\d.]+)(cm|mm|in|pt|px)$/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  switch (m[2]) {
    case "cm":
      return n * 10;
    case "mm":
      return n;
    case "in":
      return n * 25.4;
    case "pt":
      return (n * 25.4) / 72;
    case "px":
      return (n * 25.4) / 96;
  }
  return null;
}

// Parse margin shorthand (1–4 values) → { top, right, bottom, left } in mm.
function parseMarginShorthand(val: string): { right: number; left: number } | null {
  const parts = val.trim().split(/\s+/);
  const mm = parts.map(cssLenToMm);
  if (mm.some((v) => v === null)) return null;
  const [top, right, bottom, left] = mm as number[];
  // CSS shorthand: 1=all, 2=top/bottom & right/left, 3=top & right/left & bottom, 4=top right bottom left
  switch (parts.length) {
    case 1:
      return { right: top, left: top };
    case 2:
      return { right: right!, left: right! };
    case 3:
      return { right: right!, left: right! };
    case 4:
      return { right: right!, left: left! };
  }
  return null;
}

// Compute content column width in mm from style.css @page rules.
// Returns null if it can't be determined.
function computeColWidthMm(css: string): number | null {
  // Strip comments
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");

  // Extract the base @page block (not :left/:right)
  const baseMatch = stripped.match(/@page\s*\{([^}]*)\}/);
  const baseBlock = baseMatch ? baseMatch[1] : "";

  // Extract @page :right block (recto; most books have inner on left)
  const rightMatch = stripped.match(/@page\s*:right\s*\{([^}]*)\}/);
  const rightBlock = rightMatch ? rightMatch[1] : "";

  // Determine page width from size:
  let pageWidthMm: number | null = null;
  const sizeMatch = baseBlock.match(/size\s*:\s*([^;]+)/);
  if (sizeMatch) {
    const sizeParts = sizeMatch[1].trim().toLowerCase().split(/\s+/);
    const named = PAGE_SIZES[sizeParts[0]];
    if (named) {
      pageWidthMm = named[0]; // portrait width
    } else {
      // Explicit dimensions e.g. "200mm 280mm"
      const w = cssLenToMm(sizeParts[0]);
      if (w !== null) pageWidthMm = w;
    }
  }
  if (pageWidthMm === null) return null;

  // Determine margins: prefer @page :right, fall back to base @page
  const activeBlock = rightBlock || baseBlock;

  // Try margin shorthand first
  const marginMatch = activeBlock.match(/(?:^|[;\s])margin\s*:\s*([^;]+)/);
  if (marginMatch) {
    const sides = parseMarginShorthand(marginMatch[1]);
    if (sides) return pageWidthMm - sides.left - sides.right;
  }

  // Try individual sides
  const mlMatch = activeBlock.match(/margin-left\s*:\s*([^;]+)/);
  const mrMatch = activeBlock.match(/margin-right\s*:\s*([^;]+)/);
  const ml = mlMatch ? cssLenToMm(mlMatch[1].trim()) : null;
  const mr = mrMatch ? cssLenToMm(mrMatch[1].trim()) : null;
  if (ml !== null && mr !== null) return pageWidthMm - ml! - mr!;

  return null;
}

// Bundle pretext-polyfill.ts and inject COL_WIDTH, returning an inline <script>.
// In `measure` mode (web output) pretext ignores COL_WIDTH and measures each
// paragraph's rendered width instead, since the DOM is already laid out.
async function pretextScript(colWidthPx: number, measure = false): Promise<string> {
  const entry = resolve(join(TOOL_DIR, "pretext-polyfill.ts"));
  const result = await Bun.build({
    entrypoints: [entry],
    target: "browser",
    minify: true,
    define: { COL_WIDTH: colWidthPx.toFixed(2), MEASURE_WIDTH: String(measure) },
  });
  if (!result.success) {
    throw new AggregateError(result.logs, "pretext-polyfill bundle failed");
  }
  const code = await result.outputs[0]!.text();
  return `<script>${code}<\/script>`;
}

// Turn container/leaf/text directives into HTML elements per the registry.
// `:margin[hi]` → `<aside class="margin">hi</aside>`.
// The tool ships no defaults — the registry comes entirely from the
// user's quimera.config.ts. See sample/book for an example.
function directivesToHast(registry) {
  return (tree) => {
    visit(tree, (node) => {
      const kinds = ["containerDirective", "leafDirective", "textDirective"];
      if (!kinds.includes(node.type)) {
        return;
      }
      const entry = registry[node.name];
      if (!entry) {
        return;
      }
      const data = node.data || (node.data = {});
      const userClass = node.attributes?.class;
      const className = userClass ? [entry.class, userClass] : [entry.class];
      data.hName = entry.tag;
      data.hProperties = { ...node.attributes, className };
    });
  };
}

async function loadConfig(projectDir) {
  for (const name of ["config.ts", "config.js"]) {
    const path = join(projectDir, name);
    if (existsSync(path)) {
      const mod = await import(`${path}?t=${Date.now()}`);
      return mod.default || {};
    }
  }
  return {};
}

// Names of the configured variants, for the preview picker. Empty if none.
export async function variantNames(projectDir) {
  const config = await loadConfig(projectDir);
  return config.variants ? Object.keys(config.variants) : [];
}

// The resolved config for a variant, so callers (e.g. export) can inspect
// flags like `web` before deciding how to render.
export async function variantConfig(projectDir, variant) {
  return resolveConfig(await loadConfig(projectDir), variant);
}

// Merge the chosen variant over the shared base; `variants` never reaches
// the pipeline. An absent or unknown variant resolves to the first one.
function resolveConfig(raw, variant) {
  const { variants, ...base } = raw;
  if (!variants) {
    return base;
  }
  const name = variant && variants[variant] ? variant : Object.keys(variants)[0];
  return { ...base, ...variants[name] };
}

// Rewrite relative asset paths in a chunk so they resolve against the
// project dir (the base the rendered HTML is served from) rather than the
// markdown file's own directory. Absolute paths, URLs, and data URIs pass
// through untouched. Covers markdown images `![](path)` and raw HTML
// `src="path"` attributes.
function rewriteAssetPaths(md, fileDir, projectDir) {
  const prefix = relative(projectDir, fileDir);
  if (!prefix || prefix.startsWith("..")) {
    return md;
  }
  const isRelative = (url) =>
    url &&
    !isAbsolute(url) &&
    !/^[a-z][a-z0-9+.-]*:/i.test(url) &&
    !url.startsWith("/") &&
    !url.startsWith("#");
  const rebase = (url) => {
    const clean = url.replace(/^\.\//, "");
    return `${prefix}/${clean}`;
  };
  return md
    .replace(/(!\[[^\]]*\]\()([^)\s]+)(\))/g, (m, pre, url, post) =>
      isRelative(url) ? `${pre}${rebase(url)}${post}` : m,
    )
    .replace(/(\bsrc\s*=\s*")([^"]+)(")/g, (m, pre, url, post) =>
      isRelative(url) ? `${pre}${rebase(url)}${post}` : m,
    );
}

// Split a leading YAML front-matter block (--- … ---) off the markdown,
// parsing it into a flat key→value map. Only simple `key: value` scalars —
// enough for `title:`. No block → empty map, whole input as body.
function parseFrontMatter(md) {
  const m = md.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) {
    return { meta: {}, body: md };
  }
  const meta = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([\w-]+)\s*:\s*(.*)$/);
    if (kv) {
      meta[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, "");
    }
  }
  return { meta, body: md.slice(m[0].length) };
}

// The book's front-matter (title, …), or empty if there's no book.md.
async function bookMeta(projectDir) {
  const bookPath = join(projectDir, "book.md");
  if (!existsSync(bookPath)) {
    return {};
  }
  return parseFrontMatter(await readFile(bookPath, "utf8")).meta;
}

// Slug of the book's title, for naming output files. Diacritics stripped;
// falls back to "book" when there's no usable title.
export async function bookBaseName(projectDir) {
  const { title } = await bookMeta(projectDir);
  const slug = (title || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "book";
}

// Assemble the book's markdown. A `book.md` at the project root defines
// the reading order via `!include <path>` lines, each resolved relative to
// the project dir. Non-include lines pass through, so book.md can also hold
// top-level prose or a title. Includes are not recursive. When there's no
// book.md, fall back to concatenating content/*.md sorted by filename.
async function loadContent(projectDir) {
  const bookPath = join(projectDir, "book.md");
  if (existsSync(bookPath)) {
    const { body: master } = parseFrontMatter(await readFile(bookPath, "utf8"));
    const out = [];
    for (const line of master.split("\n")) {
      const m = line.match(/^\s*!include\s+(.+?)\s*$/);
      if (m) {
        const path = isAbsolute(m[1]) ? m[1] : join(projectDir, m[1]);
        const raw = await readFile(path, "utf8");
        out.push(rewriteAssetPaths(raw, dirname(path), projectDir));
        out.push("");
      } else {
        out.push(line);
      }
    }
    return out.join("\n");
  }

  const contentDir = join(projectDir, "content");
  const files = existsSync(contentDir)
    ? (await readdir(contentDir)).filter((f) => f.endsWith(".md")).sort()
    : [];
  const chunks = await Promise.all(
    files.map(async (f) =>
      rewriteAssetPaths(await readFile(join(contentDir, f), "utf8"), contentDir, projectDir),
    ),
  );
  return chunks.join("\n\n");
}

// Run the markdown → HTML pipeline and return the body fragment plus the
// resolved config and active stylesheet. Shared by every output target
// (print HTML, static web, EPUB). With `xhtml`, void elements self-close so
// the output is valid XHTML — EPUB content documents require it.
export async function renderBody(projectDir, variant, { xhtml = false } = {}) {
  const config = resolveConfig(await loadConfig(projectDir), variant);
  const bib = await loadBib(join(projectDir, "refs.bib"));
  const directives = config.directives || {};
  const formatCitation = config.formatCitation || defaultFormatCitation;

  const md = await loadContent(projectDir);

  let proc = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkDirective)
    .use(directivesToHast, directives);
  for (const p of config.remarkPlugins || []) {
    proc = proc.use(p);
  }
  proc = proc
    .use(citations, { bib, formatCitation })
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw);
  for (const p of config.rehypePlugins || []) {
    proc = proc.use(p);
  }
  proc = proc.use(rehypeStringify, xhtml ? { closeSelfClosing: true, tightSelfClosing: true } : {});

  // The active stylesheet, named in config (`css`) and overridable per
  // variant. Drives both the <link> and the knuth_pratt_via_pretext column-width read.
  const styleSheet = config.css || "default.css";
  const body = String(await proc.process(md));
  return { body, config, styleSheet };
}

// A reflowable target (static web or EPUB content) — no paged.js pagination,
// no @page geometry. Both share the same render path; only packaging differs.
function isReflowable(config) {
  return Boolean(config.web || config.epub);
}

export async function buildHtml(projectDir, variant) {
  const { body, config, styleSheet } = await renderBody(projectDir, variant);
  const reflow = isReflowable(config);

  const shell = await readFile(join(TOOL_DIR, "template.html"), "utf8");
  // Point the <link> at the active stylesheet, or drop it entirely when the
  // sheet is missing — a dangling href makes pagedjs-cli abort, so unstyled
  // output beats no output.
  const link = existsSync(join(projectDir, STYLE_DIR, styleSheet))
    ? `href="${STYLE_DIR}/${styleSheet}"`
    : "";
  let html = shell.replace("<!--BODY-->", body).replace('href="style.css"', link);

  // A reflowable variant (web/epub) renders a plain, flowing page — no
  // paged.js pagination. Everything else (including pretext) stays orthogonal.
  if (reflow) {
    html = html
      .replace("<!--PAGEDJS-->", "")
      // Drop the print-only preview chrome + outer-margin handler, whose
      // screen styles (e.g. body background) would otherwise clobber the
      // web stylesheet.
      .replace(/<!--PRINT-ONLY-START-->[\s\S]*?<!--PRINT-ONLY-END-->/, "");
  } else {
    html = html.replace(
      "<!--PAGEDJS-->",
      '<script src="https://unpkg.com/pagedjs/dist/paged.polyfill.js"></script>',
    );
  }

  if (config.knuth_pratt_via_pretext) {
    // Web pretext measures each paragraph at runtime, so no column width is
    // needed. Print pretext runs before pagination and can't measure the DOM,
    // so bake in the column width from the stylesheet's @page rules; fall back
    // to A5 with default margins (93 mm).
    let colWidthPx = 0;
    if (!reflow) {
      const styleCssPath = join(projectDir, STYLE_DIR, styleSheet);
      let colWidthMm: number | null = null;
      if (existsSync(styleCssPath)) {
        const userCss = await readFile(styleCssPath, "utf8");
        colWidthMm = computeColWidthMm(userCss);
      }
      if (colWidthMm === null) colWidthMm = 93;
      colWidthPx = colWidthMm * (96 / 25.4);
    }
    html = html.replace("<!--PRETEXT-->", await pretextScript(colWidthPx, reflow));
  } else {
    html = html.replace("<!--PRETEXT-->", "");
  }

  return html;
}
