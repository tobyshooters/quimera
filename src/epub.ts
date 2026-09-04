// An EPUB is a zip of XHTML + a package manifest. Layout:
//   mimetype                 stored first, uncompressed (spec)
//   META-INF/container.xml   points at the package document
//   OEBPS/content.opf        metadata + manifest + spine
//   OEBPS/nav.xhtml          table of contents
//   OEBPS/index.xhtml        the whole book, one reflowable document
//   OEBPS/style|content/…    the stylesheet, fonts, and images it uses

import { renderBody, styleSheetChain, STYLE_DIR } from "./compile.ts";
import { readdir, writeFile, mkdir, cp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, extname, relative } from "node:path";
import { randomUUID } from "node:crypto";

const MEDIA_TYPES: Record<string, string> = {
  ".css": "text/css",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

function esc(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Shippable rendered assets under `dir`, as paths relative to `base`. Drops
// sources (no known media type) and every .css outside the active @import chain.
async function collectAssets(dir: string, base: string, keepCss: string[]) {
  const out: string[] = [];
  if (!existsSync(dir)) {
    return out;
  }
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await collectAssets(full, base, keepCss)));
      continue;
    }
    const ext = extname(entry.name).toLowerCase();
    if (!MEDIA_TYPES[ext]) {
      continue;
    }
    if (ext === ".css" && !keepCss.includes(entry.name)) {
      continue;
    }
    out.push(relative(base, full));
  }
  return out;
}

// Give each <h1> an id (TOC anchor) and collect its text as a nav entry.
function extractToc(body: string) {
  const toc: { id: string; title: string }[] = [];
  let i = 0;
  const rewritten = body.replace(/<h1(\s[^>]*)?>([\s\S]*?)<\/h1>/g, (_m, attrs, inner) => {
    const id = `sec-${i++}`;
    toc.push({ id, title: inner.replace(/<[^>]+>/g, "").trim() });
    return `<h1 id="${id}"${attrs || ""}>${inner}</h1>`;
  });
  return { body: rewritten, toc };
}

async function zip(cwd: string, args: string[]) {
  const proc = Bun.spawn(["zip", ...args], {
    cwd,
    stdio: ["inherit", "ignore", "inherit"],
  });
  if ((await proc.exited) !== 0) {
    throw new Error(`zip ${args.join(" ")} failed`);
  }
}

export async function buildEpub(projectDir: string, variant: string | undefined, out: string) {
  const rendered = await renderBody(projectDir, variant, { xhtml: true });
  const { config, styleSheet } = rendered;
  const { body, toc } = extractToc(rendered.body);

  const title = toc[0]?.title || config.title || "Book";
  const lang = config.lang || "en";
  const uuid = randomUUID();
  const modified = new Date().toISOString().replace(/\.\d+Z$/, "Z");

  const build = join(projectDir, ".quimera-epub");
  const oebps = join(build, "OEBPS");
  await rm(build, { recursive: true, force: true });
  await mkdir(join(build, "META-INF"), { recursive: true });
  await mkdir(oebps, { recursive: true });

  const cssChain = await styleSheetChain(projectDir, styleSheet);
  const assets: string[] = [];
  for (const dir of [STYLE_DIR, "content", "images"]) {
    const rels = await collectAssets(join(projectDir, dir), projectDir, cssChain);
    for (const rel of rels) {
      await mkdir(join(oebps, rel, ".."), { recursive: true });
      await cp(join(projectDir, rel), join(oebps, rel));
      assets.push(rel);
    }
  }

  await writeFile(join(build, "mimetype"), "application/epub+zip");

  await writeFile(
    join(build, "META-INF", "container.xml"),
    `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`,
  );

  await writeFile(
    join(oebps, "index.xhtml"),
    `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${lang}">
  <head>
    <meta charset="utf-8"/>
    <title>${esc(title)}</title>
    <link rel="stylesheet" type="text/css" href="${STYLE_DIR}/${styleSheet}"/>
  </head>
  <body>
${body}
  </body>
</html>
`,
  );

  const navItems = (toc.length ? toc : [{ id: "", title }]).map((t) => {
    const href = t.id ? `index.xhtml#${t.id}` : "index.xhtml";
    return `        <li><a href="${href}">${esc(t.title)}</a></li>`;
  });
  await writeFile(
    join(oebps, "nav.xhtml"),
    `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${lang}">
  <head>
    <meta charset="utf-8"/>
    <title>${esc(title)}</title>
  </head>
  <body>
    <nav epub:type="toc" id="toc">
      <h1>Contents</h1>
      <ol>
${navItems.join("\n")}
      </ol>
    </nav>
  </body>
</html>
`,
  );

  const items = [
    `    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`,
    `    <item id="content" href="index.xhtml" media-type="application/xhtml+xml"/>`,
    ...assets.map((rel, i) => {
      const type = MEDIA_TYPES[extname(rel).toLowerCase()];
      return `    <item id="a${i}" href="${rel}" media-type="${type}"/>`;
    }),
  ];
  await writeFile(
    join(oebps, "content.opf"),
    `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="pub-id">urn:uuid:${uuid}</dc:identifier>
    <dc:title>${esc(title)}</dc:title>
    <dc:language>${lang}</dc:language>
    <meta property="dcterms:modified">${modified}</meta>
  </metadata>
  <manifest>
${items.join("\n")}
  </manifest>
  <spine>
    <itemref idref="content"/>
  </spine>
</package>
`,
  );

  // mimetype first and uncompressed, then the rest deflated.
  await rm(out, { force: true });
  await zip(build, ["-X0", out, "mimetype"]);
  await zip(build, ["-Xr9D", out, "META-INF", "OEBPS"]);
  await rm(build, { recursive: true, force: true });
}
