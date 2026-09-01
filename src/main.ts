#!/usr/bin/env bun

import { preview } from "./serve.ts";
import { exportPdf } from "./export.ts";
import { cp } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const TOOL_DIR = new URL(".", import.meta.url).pathname;
const SAMPLE_DIR = resolve(TOOL_DIR, "..", "sample-book");

async function init(projectDir) {
  if (existsSync(projectDir)) {
    console.error(`${projectDir} already exists — refusing to overwrite`);
    process.exit(1);
  }
  await cp(SAMPLE_DIR, projectDir, { recursive: true });
  console.log(`initialized ${projectDir} from ${SAMPLE_DIR}`);
}

function usage() {
  console.error("usage: something <preview|export|init> <dir> [variant]");
  process.exit(1);
}

const [cmd, dir, variant] = process.argv.slice(2);
if (!cmd || !dir) {
  usage();
}
const abs = resolve(dir);

switch (cmd) {
  case "preview":
    await preview(abs);
    break;
  case "export":
    await exportPdf(abs, variant);
    break;
  case "init":
    await init(abs);
    break;
  default:
    usage();
}
