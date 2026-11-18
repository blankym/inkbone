#!/usr/bin/env node
// 把浏览器纯前端试跑页所需的零依赖核心模块与 JSON 配置同步到 docs/vendor
// --check 只比对、不写入，用于单元测试与 CI 同步检查
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(scriptDir, "..");
export const DEFAULT_DOCS_VENDOR = path.join(ROOT_DIR, "docs", "vendor");

const CORE_DIR = "src/core";
const CONFIG_FILES = [
  "configs/zh-linguistics.json",
  "configs/genres.json",
  "configs/presets.json",
  "configs/severity.json",
];

// 列出目录下所有文件名（按字典序）
function listRelFiles(base, relDir) {
  const absDir = path.join(base, relDir);
  if (!fs.existsSync(absDir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(absDir).sort()) {
    if (entry === ".DS_Store") continue;
    const rel = path.join(relDir, entry);
    const stat = fs.statSync(path.join(base, rel));
    if (stat.isFile()) out.push(rel);
    else if (stat.isDirectory()) out.push(...listRelFiles(base, rel));
  }
  return out;
}

// 计算期望同步到 docs/vendor 的文件清单（相对 docs/vendor 的路径 -> 源文件绝对路径）
export function expectedDocsVendorFiles() {
  const map = new Map();
  for (const rel of listRelFiles(ROOT_DIR, CORE_DIR)) {
    const targetRel = path.join("core", path.relative(CORE_DIR, rel));
    map.set(targetRel, path.join(ROOT_DIR, rel));
  }
  for (const rel of CONFIG_FILES) {
    const abs = path.join(ROOT_DIR, rel);
    if (fs.existsSync(abs)) {
      map.set(rel, abs);
    }
  }
  return map;
}

// 同步文件到 docs/vendor
export function buildDocs(outDir = DEFAULT_DOCS_VENDOR) {
  const out = path.resolve(outDir);
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  const files = expectedDocsVendorFiles();
  for (const [rel, src] of files) {
    const dest = path.join(out, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
  return { outDir: out, fileCount: files.size };
}

// 检查 docs/vendor 是否与 src/core 和 configs 完全同步
export function checkDocs(outDir = DEFAULT_DOCS_VENDOR) {
  const out = path.resolve(outDir);
  const expected = expectedDocsVendorFiles();
  const missing = [];
  const different = [];
  for (const [rel, src] of expected) {
    const dest = path.join(out, rel);
    if (!fs.existsSync(dest)) missing.push(rel);
    else if (!fs.readFileSync(dest).equals(fs.readFileSync(src))) {
      different.push(rel);
    }
  }
  const extra = [];
  for (const rel of listRelFiles(out, ".")) {
    const normalized = rel.replace(/^\.\//, "");
    if (!expected.has(normalized)) extra.push(normalized);
  }
  return {
    outDir: out,
    inSync: missing.length + different.length + extra.length === 0,
    missing,
    different,
    extra,
  };
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--check")) {
    const result = checkDocs();
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.inSync ? 0 : 1;
    return;
  }
  const result = buildDocs();
  console.log(JSON.stringify(result, null, 2));
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
