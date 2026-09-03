#!/usr/bin/env bun

import { buildHtml, variantConfig, STYLE_DIR } from "./compile.ts";
import { buildEpub } from "./epub.ts";
import { preview } from "./preview.ts";
import { cp, copyFile, writeFile, unlink, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const TOOL_DIR = new URL(".", import.meta.url).pathname;
const SAMPLE_DIR = resolve(TOOL_DIR, "..", "sample-book");

// Write index.html directly in the project dir so relative paths
// (style.css, images/foo.png) resolve when pagedjs-cli loads it as file://.
// Also drop the tool's template.css alongside it if the user has no style.css,
// so the export is not unstyled.
async function exportPdf(projectDir, variant) {
  // Strip the paged.polyfill.js <script>: pagedjs-cli injects its own,
  // and running both paginates the already-paginated output.
  const html = (await buildHtml(projectDir, variant)).replace(
    /\s*<script src="[^"]*paged\.polyfill\.js"[^>]*><\/script>/,
    "",
  );
  const htmlPath = join(projectDir, ".quimera-build.html");
  await writeFile(htmlPath, html);

  const userCss = join(projectDir, STYLE_DIR, "default.css");
  const droppedFallback = !existsSync(userCss);
  if (droppedFallback) {
    await mkdir(join(projectDir, STYLE_DIR), { recursive: true });
    await copyFile(join(TOOL_DIR, "template.css"), userCss);
  }

  const outputDir = join(projectDir, "output");
  await mkdir(outputDir, { recursive: true });
  const outputPdf = join(outputDir, variant ? `book-${variant}.pdf` : "book.pdf");
  const proc = Bun.spawn(["bunx", "pagedjs-cli", "-o", outputPdf, htmlPath], {
    stdio: ["inherit", "inherit", "inherit"],
  });
  const code = await proc.exited;

  await unlink(htmlPath);
  if (droppedFallback) {
    await unlink(userCss);
  }

  if (code !== 0) {
    throw new Error(`pagedjs-cli exited ${code}`);
  }
  console.log(`wrote ${outputPdf}`);
}

// A `web` variant is a static site, not a PDF: write index.html and copy the
// asset dirs it references (style/, plus content/ and images/ if present) so
// the relative paths in the HTML resolve when served or opened directly.
// Only ship rendered assets — the active stylesheet, fonts, images — never the
// sources (`.md`, `config.ts`) or the other variants' stylesheets.
async function exportWeb(projectDir, variant) {
  const config = await variantConfig(projectDir, variant);
  const activeCss = config.css || "default.css";
  const html = await buildHtml(projectDir, variant);

  const outputDir = join(projectDir, "output", variant || "web");
  await mkdir(outputDir, { recursive: true });
  await writeFile(join(outputDir, "index.html"), html);

  // Copy filter: keep directories (so cp recurses) and rendered assets; drop
  // markdown/config sources and any stylesheet other than the active one.
  const keep = (src) => {
    const name = src.split("/").pop() || "";
    const ext = name.includes(".") ? name.slice(name.lastIndexOf(".")).toLowerCase() : "";
    if ([".md", ".ts", ".js"].includes(ext)) return false;
    if (ext === ".css") return name === activeCss;
    return true;
  };

  for (const dir of [STYLE_DIR, "content", "images"]) {
    const src = join(projectDir, dir);
    if (existsSync(src)) {
      await cp(src, join(outputDir, dir), { recursive: true, filter: keep });
    }
  }

  console.log(`wrote ${join(outputDir, "index.html")}`);
}

async function exportEpub(projectDir, variant) {
  const outputDir = join(projectDir, "output");
  await mkdir(outputDir, { recursive: true });
  const out = join(outputDir, variant ? `book-${variant}.epub` : "book.epub");
  await buildEpub(projectDir, variant, out);
  console.log(`wrote ${out}`);
}

async function init(projectDir) {
  if (existsSync(projectDir)) {
    console.error(`${projectDir} already exists — refusing to overwrite`);
    process.exit(1);
  }
  await cp(SAMPLE_DIR, projectDir, { recursive: true });
  console.log(`initialized ${projectDir} from ${SAMPLE_DIR}`);
}

function usage() {
  console.error("usage: quimera <preview|export|init> <dir> [variant]");
  process.exit(1);
}

const [cmd, dir, variant] = process.argv.slice(2);
if (!cmd || !dir) {
  usage();
}
const abs = resolve(dir);

switch (cmd) {
  case "preview":
    await preview(abs, variant);
    break;
  case "export": {
    const config = await variantConfig(abs, variant);
    if (config.epub) {
      await exportEpub(abs, variant);
    } else if (config.web) {
      await exportWeb(abs, variant);
    } else {
      await exportPdf(abs, variant);
    }
    break;
  }
  case "init":
    await init(abs);
    break;
  default:
    usage();
}
