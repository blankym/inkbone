#!/usr/bin/env node
// 把 skill 打包成自包含目录：SKILL.md 旁边放齐 CLI、配置、提示词与知识库
// 默认输出到 skills/inkbone（仓库里给用户拷贝的那份），也可用 --out 输出到任意 skills 目录
// --check 只比对、不写入，用于测试与发布前检查
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(scriptDir, "..");
export const DEFAULT_OUT = path.join(ROOT_DIR, "skills", "inkbone");
export const SKILL_SOURCE = path.join(DEFAULT_OUT, "SKILL.md");

// 打包内容：运行 CLI 必需的代码与配置，加上各阶段提示词、知识库和评估种子
export const PACKAGE_ITEMS = [
  "bin",
  "src",
  "configs",
  "prompts",
  "resources",
  "benchmarks/eval-set",
  "package.json",
  "LICENSE",
  "README.md",
];

const IGNORED_NAMES = new Set([".DS_Store"]);

// 递归列出目录下的文件（相对路径），跳过系统杂项文件
function listFiles(base, rel = "") {
  const abs = path.join(base, rel);
  if (!fs.existsSync(abs)) return [];
  const stat = fs.statSync(abs);
  if (stat.isFile()) return [rel];
  const out = [];
  for (const entry of fs.readdirSync(abs).sort()) {
    if (IGNORED_NAMES.has(entry)) continue;
    out.push(...listFiles(base, path.join(rel, entry)));
  }
  return out;
}

// 防止把输出目录设成仓库本身或它的上级目录，避免误删源文件
function assertSafeOut(outDir) {
  const out = path.resolve(outDir);
  const root = path.resolve(ROOT_DIR);
  if (out === root || root.startsWith(out + path.sep)) {
    throw new Error(`Refusing to write the skill package into ${out}: it contains the source repository.`);
  }
  return out;
}

// 期望的打包文件清单（相对输出目录的路径 -> 源文件绝对路径）
export function expectedFiles(outDir = DEFAULT_OUT) {
  const map = new Map();
  for (const item of PACKAGE_ITEMS) {
    for (const rel of listFiles(ROOT_DIR, item)) {
      map.set(rel, path.join(ROOT_DIR, rel));
    }
  }
  if (path.resolve(outDir) !== path.resolve(DEFAULT_OUT)) {
    map.set("SKILL.md", SKILL_SOURCE);
  }
  return map;
}

// 生成打包目录：只清理打包清单里的路径，再整体复制
export function buildSkill(outDir = DEFAULT_OUT) {
  const out = assertSafeOut(outDir);
  fs.mkdirSync(out, { recursive: true });
  for (const item of PACKAGE_ITEMS) {
    fs.rmSync(path.join(out, item), { recursive: true, force: true });
  }
  const files = expectedFiles(out);
  for (const [rel, src] of files) {
    const dest = path.join(out, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
  return { outDir: out, fileCount: files.size };
}

// 比对打包目录与源文件：缺失、内容不同、多出来的文件
export function checkSkill(outDir = DEFAULT_OUT) {
  const out = path.resolve(outDir);
  const expected = expectedFiles(out);
  const missing = [];
  const different = [];
  for (const [rel, src] of expected) {
    const dest = path.join(out, rel);
    if (!fs.existsSync(dest)) missing.push(rel);
    else if (!fs.readFileSync(dest).equals(fs.readFileSync(src))) different.push(rel);
  }
  const extra = [];
  for (const item of PACKAGE_ITEMS) {
    for (const rel of listFiles(out, item)) {
      if (!expected.has(rel)) extra.push(rel);
    }
  }
  return { outDir: out, inSync: missing.length + different.length + extra.length === 0, missing, different, extra };
}

// 取出 SKILL.md 里以 $SKILL_DIR/ 开头的路径引用（去掉尖括号占位与结尾标点）
export function referencedSkillPaths(skillMarkdown) {
  const refs = new Set();
  const re = /\$SKILL_DIR\/([A-Za-z0-9_./-]+)/gu;
  let m;
  while ((m = re.exec(skillMarkdown)) !== null) {
    const rel = m[1].replace(/[./]+$/u, "");
    if (rel) refs.add(rel);
  }
  return [...refs];
}

function main() {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf("--out");
  const outDir = outIdx >= 0 && args[outIdx + 1] ? path.resolve(args[outIdx + 1]) : DEFAULT_OUT;
  if (args.includes("--check")) {
    const result = checkSkill(outDir);
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.inSync ? 0 : 1;
    return;
  }
  const result = buildSkill(outDir);
  const skillMd = fs.readFileSync(path.join(result.outDir, "SKILL.md"), "utf8");
  const broken = referencedSkillPaths(skillMd).filter((rel) => !fs.existsSync(path.join(result.outDir, rel)));
  console.log(JSON.stringify({ ...result, brokenReferences: broken }, null, 2));
  process.exitCode = broken.length === 0 ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
