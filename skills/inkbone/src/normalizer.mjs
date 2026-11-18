// 零 Token 确定性排版与标点清洗器（严格零汉字代码，规则词条来自 JSON 配置）
import fs from "node:fs";
import path from "node:path";
import { collectTextFiles } from "./calibrator.mjs";
import { loadLinguisticsConfig } from "./config-loader.mjs";
import {
  normalizeProseText as normalizeProseTextCore,
  stripMarkdownEmphasis as stripMarkdownEmphasisCore,
} from "./core/normalizer.mjs";

// 零 Token 确定性清洗正文中的 Markdown 星号、分隔线与非标省略号/破折号
export function normalizeProseText(rawContent, options = {}) {
  return normalizeProseTextCore(rawContent, {
    ...options,
    lingConfig: options.lingConfig || loadLinguisticsConfig(),
  });
}

// 仅剥离受保护区间之外的 Markdown 加粗与斜体星号，用于边界与锚点匹配
export function stripMarkdownEmphasis(
  rawContent,
  whitelistLiterals = [],
  lingConfig = null
) {
  return stripMarkdownEmphasisCore(
    rawContent,
    whitelistLiterals,
    lingConfig || loadLinguisticsConfig()
  );
}

// 批量检查或清洗目录下所有小说文件（check 模式只读不写回）
export function normalizeFiles(targetPaths, options = {}) {
  const filePaths = collectTextFiles([].concat(targetPaths || []));
  const lingConfig = options.lingConfig || loadLinguisticsConfig();
  const isCheck = Boolean(options.check);
  let filesChanged = 0;
  let totalFindings = 0;
  const files = [];

  for (const absPath of filePaths) {
    const raw = fs.readFileSync(absPath, "utf8");
    const res = normalizeProseText(raw, {
      lingConfig,
      whitelistLiterals: options.whitelistLiterals || [],
      stripMarkdownEmphasis: Boolean(options.stripMarkdownEmphasis),
      fixNarrationEmDash: Boolean(options.fixNarrationEmDash),
    });
    totalFindings += res.findingCount;
    if (!isCheck && res.changed) {
      fs.writeFileSync(absPath, res.output, "utf8");
      filesChanged += 1;
    }
    if (res.findingCount > 0) {
      files.push({
        file: path.basename(absPath),
        path: absPath,
        findingCount: res.findingCount,
        changed: !isCheck && res.changed,
        findings: res.findings,
      });
    }
  }

  return {
    pass: !(isCheck && totalFindings > 0),
    check: isCheck,
    filesScanned: filePaths.length,
    filesChanged,
    totalFindings,
    files,
  };
}
