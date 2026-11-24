import fs from "node:fs";
import path from "node:path";
import { collectTextFiles } from "./calibrator.mjs";
import {
  classifyParagraphCadence,
  computeCadenceEntropy,
  measureCompoundBricks,
  extractNumberedParagraphs,
  evaluateWindowSlice,
  scanChapterAigcWindows,
} from "./core/aigc-guard.mjs";

export {
  classifyParagraphCadence,
  computeCadenceEntropy,
  measureCompoundBricks,
  extractNumberedParagraphs,
  evaluateWindowSlice,
  scanChapterAigcWindows,
};

// 批量扫描单章或目录的离线 280 字滑窗 AIGC 结构风险，输出汇总报告
export function checkFilesAigcRisk(targetPaths, options = {}) {
  const files = collectTextFiles(targetPaths);
  const threshold = options.threshold !== undefined ? Number(options.threshold) : 0.5;
  const chapters = [];

  for (const fp of files) {
    const raw = fs.readFileSync(fp, "utf8");
    const report = scanChapterAigcWindows(raw, {
      ...options,
      threshold,
    });
    chapters.push({
      file: path.basename(fp),
      path: fp,
      ...report,
    });
  }

  const failingChapters = chapters.filter((c) => !c.pass);
  return {
    pass: failingChapters.length === 0,
    threshold,
    filesScanned: chapters.length,
    failingCount: failingChapters.length,
    chapters,
  };
}

// 将滑窗 AIGC 预检结果格式化为直观的 Markdown 诊断报告
export function formatAigcCheckMarkdown(batchReport) {
  const lines = [
    "# InkBone Offline AIGC Window Guard",
    "",
    `- **Scanned**: ${batchReport.filesScanned} | **Threshold**: \`${batchReport.threshold}\` | **Status**: ${batchReport.pass ? "PASS" : `ALERT (${batchReport.failingCount} file(s))`}`,
    "",
    "| File | Overall Risk | Max Win Risk | Worst Span | De% / Dem% | Entropy | Sandwich% | Flagged Wins |",
    "| :--- | ---: | ---: | :--- | :--- | ---: | ---: | ---: |",
  ];

  for (const ch of batchReport.chapters) {
    const w = ch.worstWindow;
    const span = w ? `L${w.startLine}-L${w.endLine}` : "-";
    const deDem = w ? `${w.dePer100} / ${w.demonsPer100}` : "-";
    lines.push(
      `| ${ch.file} | ${ch.overallRisk.toFixed(4)} | **${ch.maxWindowRisk.toFixed(4)}** | ${span} | ${deDem} | ${ch.chapterCadence.cadenceEntropy.toFixed(2)} | ${(ch.chapterCadence.sandwichRatio * 100).toFixed(0)}% | ${ch.flaggedWindows.length} |`
    );
  }

  for (const ch of batchReport.chapters) {
    if (ch.flaggedWindows.length === 0) continue;
    lines.push("", `## ${ch.file}`);
    for (const fw of ch.flaggedWindows) {
      const reasons = fw.reasons.length > 0 ? fw.reasons.join(", ") : "elevated_composite_risk";
      lines.push(
        `- **L${fw.startLine}-L${fw.endLine}** (\`risk=${fw.estimatedRisk.toFixed(4)}\`, seq=\`${fw.sequence}\`, de=${fw.dePer100}, dem=${fw.demonsPer100}, brick1k=${fw.brickPer1k}): ${reasons}`
      );
    }
  }

  return lines.join("\n");
}
