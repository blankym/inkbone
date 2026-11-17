#!/usr/bin/env node
// 把可以公开的文件导出到公开仓库的工作目录：按白名单复制，不在白名单里的一律不带
// 作者小说的正文、全书台账、检测报告、人类作品语料和本地临时文件都不在白名单里
// 用法：node scripts/export-public.mjs --out <公开仓库目录> [--check]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(scriptDir, "..");

// 允许公开的路径（目录会整体复制）
export const PUBLIC_ITEMS = [
  "LICENSE",
  "README.md",
  "README.en.md",
  "package.json",
  "bin",
  "src",
  "configs",
  "prompts",
  "resources",
  "scripts",
  "skills",
  "tests",
  "benchmarks/eval-set",
  "benchmarks/shoushi-wenxian/README.md",
  "benchmarks/shoushi-wenxian/manifest.json",
  "benchmarks/shoushi-wenxian/project-rules.json",
];

// 即使出现在白名单目录里，也不导出的文件名
const SKIP_NAMES = new Set([".DS_Store", ".env", ".zhuque-cache.json"]);

// 公开仓库用的 .gitignore（私有仓库的 .gitignore 里有只适用于私有同步仓库的说明）
export const PUBLIC_GITIGNORE = [
  "# local secrets and caches",
  ".env",
  ".env.*",
  ".zhuque-cache.json",
  "# local corpora and scratch files (never publish copyrighted text)",
  "benchmarks/master-corpus.json",
  "tmp/",
  "runs/",
  "# system and tooling",
  ".DS_Store",
  "node_modules/",
  "*.log",
  "coverage/",
  "",
].join("\n");

function listFiles(base, rel = "") {
  const abs = path.join(base, rel);
  if (!fs.existsSync(abs)) return [];
  const stat = fs.statSync(abs);
  if (stat.isFile()) return SKIP_NAMES.has(path.basename(rel)) ? [] : [rel];
  const out = [];
  for (const entry of fs.readdirSync(abs).sort()) {
    if (SKIP_NAMES.has(entry) || entry === "_reviews") continue;
    out.push(...listFiles(base, path.join(rel, entry)));
  }
  return out;
}

// 导出目录不能是源仓库本身或它的上级，避免覆盖源文件
function assertSafeOut(outDir) {
  const out = path.resolve(outDir);
  const root = path.resolve(ROOT_DIR);
  if (out === root || root.startsWith(out + path.sep) || out.startsWith(root + path.sep)) {
    throw new Error(`Refusing to export into ${out}: choose a directory outside the source package.`);
  }
  return out;
}

export function expectedPublicFiles() {
  const files = new Map();
  for (const item of PUBLIC_ITEMS) {
    for (const rel of listFiles(ROOT_DIR, item)) files.set(rel, path.join(ROOT_DIR, rel));
  }
  return files;
}

// 写入公开目录：只清理白名单路径和 .gitignore，再复制；不会碰 .git 目录
export function exportPublic(outDir) {
  const out = assertSafeOut(outDir);
  fs.mkdirSync(out, { recursive: true });
  for (const item of PUBLIC_ITEMS) {
    fs.rmSync(path.join(out, item), { recursive: true, force: true });
  }
  const files = expectedPublicFiles();
  for (const [rel, src] of files) {
    const dest = path.join(out, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
  fs.writeFileSync(path.join(out, ".gitignore"), PUBLIC_GITIGNORE);
  return { outDir: out, fileCount: files.size + 1 };
}

// 检查公开目录：缺了什么、内容不同、以及白名单之外多出来的文件（.git 除外）
export function checkPublic(outDir) {
  const out = path.resolve(outDir);
  const expected = expectedPublicFiles();
  expected.set(".gitignore", null);
  const missing = [];
  const different = [];
  for (const [rel, src] of expected) {
    const dest = path.join(out, rel);
    if (!fs.existsSync(dest)) missing.push(rel);
    else if (src && !fs.readFileSync(dest).equals(fs.readFileSync(src))) different.push(rel);
  }
  const unexpected = [];
  const walk = (rel = "") => {
    const abs = path.join(out, rel);
    if (!fs.existsSync(abs)) return;
    for (const entry of fs.readdirSync(abs)) {
      if (entry === ".git" || entry === ".DS_Store") continue;
      const childRel = path.join(rel, entry);
      if (fs.statSync(path.join(out, childRel)).isDirectory()) walk(childRel);
      else if (!expected.has(childRel)) unexpected.push(childRel);
    }
  };
  walk();
  return { outDir: out, inSync: missing.length + different.length + unexpected.length === 0, missing, different, unexpected };
}

function main() {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf("--out");
  if (outIdx < 0 || !args[outIdx + 1]) {
    console.error("Usage: node scripts/export-public.mjs --out <public repo dir> [--check]");
    process.exit(2);
  }
  const outDir = path.resolve(args[outIdx + 1]);
  const result = args.includes("--check") ? checkPublic(outDir) : exportPublic(outDir);
  console.log(JSON.stringify(result, null, 2));
  if (result.inSync === false) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
