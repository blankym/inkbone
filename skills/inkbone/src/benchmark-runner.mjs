import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { profileText } from "./profiler.mjs";
import { loadLinguisticsConfig } from "./config-loader.mjs";

const currentFile = fileURLToPath(import.meta.url);
const srcDir = path.dirname(currentFile);
const defaultCorpusPath = path.resolve(
  srcDir,
  "../benchmarks/master-corpus.json"
);

// 批量运行基准语料库与实战章节对比，生成结构化统计对照结果与 Markdown 表格
export function runCorpusBenchmark(options = {}) {
  const lingConfig = loadLinguisticsConfig();
  const corpusPath = options.corpusPath
    ? path.resolve(options.corpusPath)
    : defaultCorpusPath;
  // 人类语料涉及版权，不随仓库发布；文件缺失时只跑本地章节
  const corpusData = fs.existsSync(corpusPath)
    ? JSON.parse(fs.readFileSync(corpusPath, "utf8"))
    : { samples: [] };

  const rows = [];
  for (const sample of corpusData.samples) {
    const { metrics } = profileText(sample.text, lingConfig);
    rows.push({
      id: sample.id,
      label: sample.label,
      group: sample.group,
      note: sample.detectorNote || "",
      ...metrics,
    });
  }

  // 支持附带外部实战 Markdown 文件一同参与基准对比
  for (const extra of options.extraFiles || []) {
    const resolved = path.resolve(extra.path);
    if (fs.existsSync(resolved)) {
      const content = fs.readFileSync(resolved, "utf8");
      const { metrics } = profileText(content, lingConfig);
      rows.push({
        id: extra.id || path.basename(resolved, ".md"),
        label: extra.label || path.basename(resolved),
        group: extra.group || "benchmark_chapter",
        note: extra.note || "",
        ...metrics,
      });
    }
  }

  return rows;
}

// 将基准跑分数组渲染为清晰的 Markdown 对比表格
export function formatBenchmarkMarkdown(rows) {
  const header = [
    "| Sample | Han | SentMean | CV (Burst) | Flow>=4c | Short<=10 | De/100 | MATTR-50 | Anchor% | Dash/1k | Note |",
    "| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | :--- |",
  ];

  const lines = rows.map((r) => {
    const flowPct = `${(r.flowingSentRatio * 100).toFixed(1)}%`;
    const shortPct = `${(r.ultraShortSentRatio * 100).toFixed(1)}%`;
    const anchorPct = `${(r.topicAnchorRatio * 100).toFixed(1)}%`;
    return `| ${r.label} | ${r.totalHan} | ${r.sentLenMean} | **${r.sentLenCV}** | ${flowPct} | ${shortPct} | ${r.dePer100Han} | **${r.mattr50}** | ${anchorPct} | ${r.emDashPer1kHan} | ${r.note} |`;
  });

  return [...header, ...lines].join("\n");
}
