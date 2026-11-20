// Node 端网文平台投稿清洗与整卷导出入口（支持起点/番茄/七猫/晋江）
import fs from "node:fs";
import path from "node:path";
import { loadLinguisticsConfig, loadPlatformsConfig } from "./config-loader.mjs";
import { collectTextFiles } from "./calibrator.mjs";
import { parseChapterNumberAndTitle } from "./importer.mjs";
import {
  resolvePlatformConfig,
  formatChapterForPlatform as formatChapterForPlatformCore,
  exportChapterEntries as exportChapterEntriesCore,
  buildStoreZipBuffer,
  buildSubmissionDocxBytes,
} from "./core/exporter.mjs";

export { resolvePlatformConfig, buildStoreZipBuffer, buildSubmissionDocxBytes };

// 列出所有内置投稿平台预设
export function listPlatforms(customPath = null) {
  const cfg = loadPlatformsConfig(customPath);
  return Object.values(cfg.platforms || {}).map((p) => ({
    id: p.id,
    title: p.title,
    minHan: p.minHan,
    maxHan: p.maxHan,
    submissionMinHan: p.submissionMinHan ?? 20000,
    defaultIndent: Boolean(p.defaultIndent),
  }));
}

// 清洗单章正文为指定平台投稿格式
export function formatChapterForPlatform(rawText, options = {}) {
  const lingConfig = options.linguisticsConfig || loadLinguisticsConfig();
  const platformsConfig = options.platformsConfig || loadPlatformsConfig(options.platformsPath);
  const spec = resolvePlatformConfig(platformsConfig, options.platform);
  return formatChapterForPlatformCore(rawText, spec, lingConfig, options);
}

// 批量清洗并导出文件或目录（按章号自然排序；支持 --out 分章目录、--merge-out 整卷合并或 --check 仅预检）
export function exportChapters(targetPaths, options = {}) {
  const inputs = Array.isArray(targetPaths) ? targetPaths : [targetPaths];
  const files = collectTextFiles(inputs);
  if (files.length === 0) {
    throw new Error("No .md or .txt files found for export.");
  }

  const lingConfig = options.linguisticsConfig || loadLinguisticsConfig();
  const platformsConfig = options.platformsConfig || loadPlatformsConfig(options.platformsPath);
  const spec = resolvePlatformConfig(platformsConfig, options.platform);

  const rawEntries = files.map((filePath, idx) => {
    const text = fs.readFileSync(filePath, "utf8");
    const parsed = parseChapterNumberAndTitle(filePath, text, lingConfig);
    return {
      idx,
      filePath,
      name: path.basename(filePath),
      chapterNumber: parsed.chapterNumber,
      text,
    };
  });
  rawEntries.sort((a, b) => {
    const na = a.chapterNumber ?? Number.MAX_SAFE_INTEGER;
    const nb = b.chapterNumber ?? Number.MAX_SAFE_INTEGER;
    return na - nb || a.idx - b.idx;
  });

  const result = exportChapterEntriesCore(rawEntries, spec, lingConfig, options);
  const writtenFiles = [];

  if (!options.check) {
    if (options.outDir) {
      const absOutDir = path.resolve(options.outDir);
      fs.mkdirSync(absOutDir, { recursive: true });
      result.chapters.forEach((ch) => {
        const baseName = ch.name.replace(/\.md$/iu, ".txt");
        const dest = path.join(absOutDir, baseName);
        fs.writeFileSync(dest, ch.output, "utf8");
        writtenFiles.push(dest);
      });
    }
    if (options.mergeOut) {
      const absMerge = path.resolve(options.mergeOut);
      fs.mkdirSync(path.dirname(absMerge), { recursive: true });
      fs.writeFileSync(absMerge, result.mergedText, "utf8");
      writtenFiles.push(absMerge);
    }
    if (options.docxOut) {
      const absDocx = path.resolve(options.docxOut);
      fs.mkdirSync(path.dirname(absDocx), { recursive: true });
      const outlineText =
        options.outlineText ||
        (options.outlinePath && fs.existsSync(path.resolve(options.outlinePath))
          ? fs.readFileSync(path.resolve(options.outlinePath), "utf8")
          : "");
      const docxBytes = buildSubmissionDocxBytes(result, {
        bookTitle: options.bookTitle || "",
        outlineText,
      });
      fs.writeFileSync(absDocx, docxBytes);
      writtenFiles.push(absDocx);
    }
    if (options.zipOut) {
      const absZip = path.resolve(options.zipOut);
      fs.mkdirSync(path.dirname(absZip), { recursive: true });
      const zipEntries = result.chapters.map((ch) => ({
        name: ch.name.replace(/\.md$/iu, ".txt"),
        data: ch.output,
      }));
      zipEntries.push({
        name: `${result.platform}-merged.txt`,
        data: result.mergedText,
      });
      const zipBytes = buildStoreZipBuffer(zipEntries);
      fs.writeFileSync(absZip, zipBytes);
      writtenFiles.push(absZip);
    }
  }

  return {
    platform: result.platform,
    platformTitle: result.platformTitle,
    chapterCount: result.chapterCount,
    totalHan: result.totalHan,
    outOfRangeCount: result.outOfRangeCount,
    submissionMinHan: result.submissionMinHan,
    submissionReady: result.submissionReady,
    submissionShortfallHan: result.submissionShortfallHan,
    checkOnly: Boolean(options.check),
    writtenFiles,
    chapters: result.chapters.map((c) => ({
      name: c.name,
      title: c.title,
      hanCount: c.hanCount,
      paragraphCount: c.paragraphCount,
      expectedRange: c.expectedRange,
      lengthStatus: c.lengthStatus,
      normalizationFindings: c.normalizationFindings,
      ...(options.includeOutput ? { output: c.output } : {}),
    })),
    ...(options.includeMerged ? { mergedText: result.mergedText } : {}),
  };
}
