import fs from "node:fs";
import path from "node:path";
import { profileText } from "./profiler.mjs";
import { loadLinguisticsConfig } from "./config-loader.mjs";

// 参与参考区间统计的指标（与篇幅关系较小、可在章节之间比较的比率类指标）
const REFERENCE_METRICS = [
  "sentLenMean",
  "sentLenCV",
  "flowingSentRatio",
  "ultraShortSentRatio",
  "dePer100Han",
  "longModPerClause",
  "mattr50",
  "hapaxRatio",
  "topicAnchorRatio",
  "sentsPerParaMean",
  "paraLenMean",
  "emDashPer1kHan",
];

// 样本数和单样本篇幅达到这两个数，参考区间才标为可靠
const MIN_RELIABLE_SAMPLES = 20;
const MIN_RELIABLE_HAN = 2000;

// 线性插值求分位数
function quantile(sorted, q) {
  if (sorted.length === 0) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const v = sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  return Math.round(v * 1000) / 1000;
}

// 递归收集目录或文件列表下的全部 .md / .txt 文本（递归时跳过隐藏目录、node_modules 与下划线开头的备份子目录）
export function collectTextFiles(inputs) {
  const files = [];
  const walkDir = (dirPath) => {
    for (const entry of fs.readdirSync(dirPath, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      if (entry.isDirectory() && entry.name.startsWith("_")) continue;
      const full = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        walkDir(full);
      } else if (entry.isFile() && /\.(md|txt)$/u.test(entry.name)) {
        files.push(full);
      }
    }
  };
  for (const input of inputs) {
    const resolved = path.resolve(input);
    if (!fs.existsSync(resolved)) continue;
    const stat = fs.statSync(resolved);
    if (stat.isDirectory()) {
      walkDir(resolved);
    } else {
      files.push(resolved);
    }
  }
  return files;
}

// 从一批人类文本计算各指标的 p10 / 中位数 / p90，只输出统计结果，不输出原文
export function calibrateReference(texts, options = {}) {
  const lingConfig = options.linguisticsConfig || loadLinguisticsConfig();
  const profiles = texts.map((t) => profileText(t, lingConfig).metrics);
  const hanCounts = profiles.map((p) => p.totalHan).sort((a, b) => a - b);
  const metrics = {};
  for (const key of REFERENCE_METRICS) {
    const values = profiles
      .map((p) => p[key])
      .filter((v) => typeof v === "number" && Number.isFinite(v))
      .sort((a, b) => a - b);
    if (values.length === 0) continue;
    metrics[key] = {
      p10: quantile(values, 0.1),
      median: quantile(values, 0.5),
      p90: quantile(values, 0.9),
      min: values[0],
      max: values[values.length - 1],
    };
  }
  const shortSamples = hanCounts.filter((h) => h < MIN_RELIABLE_HAN).length;
  const reliable =
    profiles.length >= MIN_RELIABLE_SAMPLES && shortSamples === 0;
  return {
    kind: "inkbone-human-reference",
    label: options.label || "",
    sampleCount: profiles.length,
    medianSampleHan: quantile(hanCounts, 0.5),
    shortSampleCount: shortSamples,
    reliable,
    reliabilityRule: {
      minSamples: MIN_RELIABLE_SAMPLES,
      minHanPerSample: MIN_RELIABLE_HAN,
    },
    metrics,
  };
}

// 统计纯汉字 n-gram 计数（按标点切成小句，避免跨句拼接）
function countNgrams(text, n, counts) {
  const clauses = text.split(/[^\p{Script=Han}]+/u);
  let total = 0;
  for (const clause of clauses) {
    const chars = Array.from(clause);
    for (let i = 0; i + n <= chars.length; i += 1) {
      const g = chars.slice(i, i + n).join("");
      counts.set(g, (counts.get(g) || 0) + 1);
      total += 1;
    }
  }
  return total;
}

// 对比 AI 稿与人类文本，找出在 AI 稿里出现率明显偏高的搭配，作为套话词表候选
export function mineOverusedPhrases(aiTexts, humanTexts, options = {}) {
  const sizes = options.sizes || [3, 4];
  const minAiCount = options.minAiCount ?? 3;
  const minRatio = options.minRatio ?? 5;
  const top = options.top ?? 80;
  const exclude = new Set(options.exclude || []);
  // 故事词表：设定、大纲、人物卡里出现过的 n-gram 视为本书专名，不当套话
  const vocabTexts = options.vocabTexts || [];
  const results = [];
  for (const n of sizes) {
    const aiCounts = new Map();
    const humanCounts = new Map();
    const aiDocFreq = new Map();
    let aiTotal = 0;
    let humanTotal = 0;
    for (const t of aiTexts) {
      const local = new Map();
      aiTotal += countNgrams(t, n, local);
      for (const [g, c] of local) {
        aiCounts.set(g, (aiCounts.get(g) || 0) + c);
        aiDocFreq.set(g, (aiDocFreq.get(g) || 0) + 1);
      }
    }
    for (const t of humanTexts) humanTotal += countNgrams(t, n, humanCounts);
    const vocabCounts = new Map();
    for (const t of vocabTexts) countNgrams(t, n, vocabCounts);
    if (aiTotal === 0 || humanTotal === 0) continue;
    for (const [g, aiCount] of aiCounts) {
      if (aiCount < minAiCount || exclude.has(g) || vocabCounts.has(g)) continue;
      // 只保留在两篇及以上 AI 稿里都出现的搭配，排除单章专名
      if (aiTexts.length > 1 && (aiDocFreq.get(g) || 0) < 2) continue;
      const humanCount = humanCounts.get(g) || 0;
      // 加 0.5 平滑后比较每万字出现率
      const aiRate = ((aiCount + 0.5) / aiTotal) * 1e4;
      const humanRate = ((humanCount + 0.5) / humanTotal) * 1e4;
      const ratio = aiRate / humanRate;
      if (ratio < minRatio) continue;
      results.push({
        phrase: g,
        n,
        aiCount,
        aiDocs: aiDocFreq.get(g) || 0,
        humanCount,
        aiPer10k: Math.round(aiRate * 100) / 100,
        humanPer10k: Math.round(humanRate * 100) / 100,
        ratio: Math.round(ratio * 10) / 10,
      });
    }
  }
  results.sort((a, b) => b.ratio * Math.log(b.aiCount + 1) - a.ratio * Math.log(a.aiCount + 1));
  return {
    kind: "inkbone-phrase-candidates",
    note: "candidates only; review each phrase in context before adding it to a blocklist",
    aiDocs: aiTexts.length,
    humanDocs: humanTexts.length,
    candidates: results.slice(0, top),
  };
}
