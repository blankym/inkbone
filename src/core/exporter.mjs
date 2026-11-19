// 纯内存网文平台投稿清洗与整卷导出模块（零文件系统依赖，供 Node CLI、MCP 与浏览器共用）
import { normalizeProseText } from "./normalizer.mjs";
import { countHan } from "./profiler.mjs";

// 解析目标平台预设对象
export function resolvePlatformConfig(platformsConfig, platformId) {
  const key = platformId || platformsConfig?.defaultPlatform || "qidian";
  const spec = platformsConfig?.platforms?.[key];
  if (!spec) {
    const valid = Object.keys(platformsConfig?.platforms || {}).join(", ");
    throw new Error(`Unknown export platform "${key}". Available platforms: ${valid}`);
  }
  return spec;
}

// 剥离文首 YAML Frontmatter 与 HTML 注释，保留干净可发布正文
function stripNonPublishMetadata(rawText) {
  let out = String(rawText || "").replace(/\r\n/gu, "\n");
  out = out.replace(/^---\n[\s\S]*?\n---\n*/u, "");
  out = out.replace(/<!--[\s\S]*?-->/gu, "");
  return out;
}

// 将单章 Markdown 正文清洗为符合指定网文平台（起点/番茄/七猫/晋江）投稿习惯的纯文本
export function formatChapterForPlatform(rawText, platformSpec, lingConfig, options = {}) {
  if (!platformSpec || !lingConfig) {
    throw new Error("platformSpec and lingConfig are required for formatChapterForPlatform.");
  }
  const cleanedMeta = stripNonPublishMetadata(rawText);
  const norm = normalizeProseText(cleanedMeta, {
    lingConfig,
    stripMarkdownEmphasis: platformSpec.stripMarkdownEmphasis !== false,
    fixNarrationEmDash: Boolean(options.fixEmDash ?? platformSpec.fixNarrationEmDash),
    whitelistLiterals: options.whitelistLiterals || [],
  });

  const useIndent =
    options.indent !== undefined ? Boolean(options.indent) : Boolean(platformSpec.defaultIndent);
  const indentStr = platformSpec.indentString || "\u3000\u3000";
  const blankLines = Number.isFinite(platformSpec.blankLinesBetweenParagraphs)
    ? platformSpec.blankLinesBetweenParagraphs
    : 1;
  const separator = "\n".repeat(blankLines + 1);
  const hanRegex = lingConfig.compiledRegex.hanCharGlobal;
  const headingRe = lingConfig.chineseNumerals?.chapterHeadingParseRegex
    ? new RegExp(lingConfig.chineseNumerals.chapterHeadingParseRegex, "u")
    : null;

  const rawLines = norm.output.split("\n");
  const outParagraphs = [];
  let extractedTitle = "";

  for (const rawLine of rawLines) {
    let line = rawLine.trim();
    if (!line) continue;
    // 跳过纯 Markdown 分隔线与围栏代码块标记
    if (/^[-*_]{3,}$/u.test(line) || /^```/u.test(line)) continue;
    // 剥离引用前缀符号
    line = line.replace(/^>\s*/u, "").trim();
    if (!line) continue;

    const isMdHeading = /^#{1,6}\s+/u.test(line);
    if (isMdHeading && platformSpec.stripMarkdownHeadings !== false) {
      const stripped = line.replace(/^#{1,6}\s+/u, "").trim();
      if (!extractedTitle && stripped) {
        extractedTitle = stripped;
      }
      if (stripped) {
        outParagraphs.push(stripped);
      }
      continue;
    }

    if (!extractedTitle && outParagraphs.length === 0 && headingRe && headingRe.test(line)) {
      extractedTitle = line;
      outParagraphs.push(line);
      continue;
    }

    // 剥离原有全角/半角缩进后按平台配置重新规范段首缩进
    const bodyText = line.replace(/^[\s\u3000]+/u, "");
    outParagraphs.push(useIndent ? `${indentStr}${bodyText}` : bodyText);
  }

  const output = outParagraphs.join(separator) + (outParagraphs.length > 0 ? "\n" : "");
  const hanCount = countHan(output, hanRegex);
  const minHan = platformSpec.minHan ?? 2000;
  const maxHan = platformSpec.maxHan ?? 5000;
  const lengthStatus =
    hanCount < minHan ? "too_short" : hanCount > maxHan ? "too_long" : "ok";

  return {
    platform: platformSpec.id,
    title: extractedTitle,
    hanCount,
    paragraphCount: outParagraphs.length,
    expectedRange: [minHan, maxHan],
    lengthStatus,
    normalizationFindings: norm.findingCount,
    output,
  };
}

// 批量导出多章稿件，输出逐章结果与整卷合并纯文本
export function exportChapterEntries(entries, platformSpec, lingConfig, options = {}) {
  const chapters = (entries || []).map((entry) => {
    const formatted = formatChapterForPlatform(entry.text, platformSpec, lingConfig, options);
    return {
      name: entry.name,
      ...formatted,
    };
  });

  const joiner = platformSpec.chapterSeparator || "\n\n\n";
  const mergedText = chapters.map((c) => c.output.trimEnd()).join(joiner) + (chapters.length > 0 ? "\n" : "");
  const totalHan = chapters.reduce((acc, c) => acc + c.hanCount, 0);
  const outOfRangeCount = chapters.filter((c) => c.lengthStatus !== "ok").length;

  return {
    platform: platformSpec.id,
    platformTitle: platformSpec.title,
    chapterCount: chapters.length,
    totalHan,
    outOfRangeCount,
    chapters,
    mergedText,
  };
}
