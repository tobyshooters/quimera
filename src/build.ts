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
import { join, resolve } from "node:path";
import { citations, loadBib, defaultFormatCitation } from "./citations.ts";

const TOOL_DIR = new URL(".", import.meta.url).pathname;

// Stylesheets and config.ts live under <project>/style/.
export const STYLE_DIR = "style";

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

// Bundle pretext-client.ts and inject COL_WIDTH, returning an inline <script>.
async function pretextScript(colWidthPx: number): Promise<string> {
  const entry = resolve(join(TOOL_DIR, "pretext-client.ts"));
  const result = await Bun.build({
    entrypoints: [entry],
    target: "browser",
    minify: true,
    define: { COL_WIDTH: colWidthPx.toFixed(2) },
  });
  if (!result.success) {
    throw new AggregateError(result.logs, "pretext-client bundle failed");
  }
  const code = await result.outputs[0]!.text();
  return `<script>${code}<\/script>`;
}

// Turn container/leaf/text directives into HTML elements per the registry.
// `:margin[hi]` → `<aside class="margin">hi</aside>`.
// The tool ships no defaults — the registry comes entirely from the
// user's something.config.ts. See sample-book for an example.
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
    const path = join(projectDir, STYLE_DIR, name);
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

export async function buildHtml(projectDir, variant) {
  const config = resolveConfig(await loadConfig(projectDir), variant);
  const bib = await loadBib(join(projectDir, "refs.bib"));
  const directives = config.directives || {};
  const formatCitation = config.formatCitation || defaultFormatCitation;

  const contentDir = join(projectDir, "content");
  const files = existsSync(contentDir)
    ? (await readdir(contentDir)).filter((f) => f.endsWith(".md")).sort()
    : [];
  const chunks = await Promise.all(files.map((f) => readFile(join(contentDir, f), "utf8")));
  const md = chunks.join("\n\n");

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
  proc = proc.use(rehypeStringify);

  // The active stylesheet, named in config (`css`) and overridable per
  // variant. Drives both the <link> and the knuth_pratt_via_pretext column-width read.
  const styleSheet = config.css || "default.css";

  const body = String(await proc.process(md));
  const shell = await readFile(join(TOOL_DIR, "template.html"), "utf8");
  let html = shell
    .replace("<!--BODY-->", body)
    .replace('href="style.css"', `href="${STYLE_DIR}/${styleSheet}"`);

  if (config.knuth_pratt_via_pretext) {
    // Compute column width from the active stylesheet; fall back to A5 with default margins (93 mm).
    const styleCssPath = join(projectDir, STYLE_DIR, styleSheet);
    let colWidthMm: number | null = null;
    if (existsSync(styleCssPath)) {
      const userCss = await readFile(styleCssPath, "utf8");
      colWidthMm = computeColWidthMm(userCss);
    }
    if (colWidthMm === null) colWidthMm = 93; // A5 with default margins
    const colWidthPx = colWidthMm * (96 / 25.4);
    html = html.replace("<!--PRETEXT-->", await pretextScript(colWidthPx));
  } else {
    html = html.replace("<!--PRETEXT-->", "");
  }

  return html;
}
