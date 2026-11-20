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
  const submissionMinHan = platformSpec.submissionMinHan ?? 20000;
  const submissionReady = totalHan >= submissionMinHan;
  const submissionShortfallHan = Math.max(0, submissionMinHan - totalHan);

  return {
    platform: platformSpec.id,
    platformTitle: platformSpec.title,
    chapterCount: chapters.length,
    totalHan,
    outOfRangeCount,
    submissionMinHan,
    submissionReady,
    submissionShortfallHan,
    chapters,
    mergedText,
  };
}

// 预计算标准 CRC32 查表数组（供零依赖纯内存 ZIP 与 DOCX 容器生成使用）
const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function computeCrc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// 零依赖构建标准 STORE（无压缩）ZIP 二进制流，兼容 Node 与浏览器 Blob 下载及 OOXML .docx
export function buildStoreZipBuffer(fileEntries) {
  const encoder = new TextEncoder();
  const prepared = (fileEntries || []).map((entry) => {
    const nameBytes = encoder.encode(String(entry.name || "file.txt"));
    const dataBytes =
      entry.data instanceof Uint8Array
        ? entry.data
        : encoder.encode(String(entry.data ?? ""));
    const crc = computeCrc32(dataBytes);
    return { nameBytes, dataBytes, crc };
  });

  let localTotalSize = 0;
  let centralTotalSize = 0;
  for (const item of prepared) {
    localTotalSize += 30 + item.nameBytes.length + item.dataBytes.length;
    centralTotalSize += 46 + item.nameBytes.length;
  }
  const totalSize = localTotalSize + centralTotalSize + 22;
  const out = new Uint8Array(totalSize);
  const view = new DataView(out.buffer);

  let localOffset = 0;
  const localOffsets = [];

  for (const item of prepared) {
    localOffsets.push(localOffset);
    view.setUint32(localOffset, 0x04034b50, true);
    view.setUint16(localOffset + 4, 20, true);
    view.setUint16(localOffset + 6, 0x0800, true); // UTF-8 文件名标志位
    view.setUint16(localOffset + 8, 0, true); // STORE 方式（0 = 不压缩）
    view.setUint16(localOffset + 10, 0, true);
    view.setUint16(localOffset + 12, 0x21, true);
    view.setUint32(localOffset + 14, item.crc, true);
    view.setUint32(localOffset + 18, item.dataBytes.length, true);
    view.setUint32(localOffset + 22, item.dataBytes.length, true);
    view.setUint16(localOffset + 26, item.nameBytes.length, true);
    view.setUint16(localOffset + 28, 0, true);
    out.set(item.nameBytes, localOffset + 30);
    out.set(item.dataBytes, localOffset + 30 + item.nameBytes.length);
    localOffset += 30 + item.nameBytes.length + item.dataBytes.length;
  }

  const centralStart = localOffset;
  let centralOffset = centralStart;

  for (let i = 0; i < prepared.length; i += 1) {
    const item = prepared[i];
    view.setUint32(centralOffset, 0x02014b50, true);
    view.setUint16(centralOffset + 4, 20, true);
    view.setUint16(centralOffset + 6, 20, true);
    view.setUint16(centralOffset + 8, 0x0800, true);
    view.setUint16(centralOffset + 10, 0, true);
    view.setUint16(centralOffset + 12, 0, true);
    view.setUint16(centralOffset + 14, 0x21, true);
    view.setUint32(centralOffset + 16, item.crc, true);
    view.setUint32(centralOffset + 20, item.dataBytes.length, true);
    view.setUint32(centralOffset + 24, item.dataBytes.length, true);
    view.setUint16(centralOffset + 28, item.nameBytes.length, true);
    view.setUint16(centralOffset + 30, 0, true);
    view.setUint16(centralOffset + 32, 0, true);
    view.setUint16(centralOffset + 34, 0, true);
    view.setUint16(centralOffset + 36, 0, true);
    view.setUint32(centralOffset + 38, 0, true);
    view.setUint32(centralOffset + 42, localOffsets[i], true);
    out.set(item.nameBytes, centralOffset + 46);
    centralOffset += 46 + item.nameBytes.length;
  }

  const eocdOffset = centralOffset;
  view.setUint32(eocdOffset, 0x06054b50, true);
  view.setUint16(eocdOffset + 4, 0, true);
  view.setUint16(eocdOffset + 6, 0, true);
  view.setUint16(eocdOffset + 8, prepared.length, true);
  view.setUint16(eocdOffset + 10, prepared.length, true);
  view.setUint32(eocdOffset + 12, centralOffset - centralStart, true);
  view.setUint32(eocdOffset + 16, centralStart, true);
  view.setUint16(eocdOffset + 20, 0, true);

  return out;
}

function escapeXml(str) {
  return String(str || "")
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&apos;");
}

// 构造单个 OOXML 段落节点字符串（统一宋体五号、1.25 倍行距，正文首行缩进 2 字符，标题居中加粗）
function buildDocxParagraphXml(text, opts = {}) {
  const fontSong = "\u5b8b\u4f53"; // 宋体
  const align = opts.center ? "center" : "both";
  const sz = opts.sizeHalfPt || 21; // 21 = 五号 (10.5pt), 24 = 小四 (12pt), 28 = 四号 (14pt)
  const before = opts.spaceBefore ?? (opts.isHeading ? 160 : 0);
  const after = opts.spaceAfter ?? (opts.isHeading ? 140 : 0);
  const keepNext = opts.isHeading ? "<w:keepNext/>" : "";
  const pageBreak = opts.pageBreakBefore ? "<w:pageBreakBefore/>" : "";
  const indent = opts.indentFirstLine
    ? '<w:ind w:firstLine="420" w:firstLineChars="200"/>'
    : "";
  const bold = opts.bold || opts.isHeading ? "<w:b/><w:bCs/>" : "";
  const safeText = escapeXml(text);

  return [
    "<w:p>",
    "<w:pPr>",
    keepNext,
    pageBreak,
    `<w:spacing w:before="${before}" w:after="${after}" w:line="300" w:lineRule="auto"/>`,
    indent,
    `<w:jc w:val="${align}"/>`,
    "</w:pPr>",
    "<w:r>",
    "<w:rPr>",
    `<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="${fontSong}" w:cs="Times New Roman"/>`,
    bold,
    '<w:color w:val="000000"/>',
    `<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/>`,
    "</w:rPr>",
    `<w:t xml:space="preserve">${safeText}</w:t>`,
    "</w:r>",
    "</w:p>",
  ].join("");
}

// 零依赖生成网文内投标准 Word (.docx) 二进制字节流（纯黑宋体、五号字、首行缩进 2 字符、1.25 倍行距，支持拼入大纲）
export function buildSubmissionDocxBytes(exportResultOrChapters, options = {}) {
  const chapters = Array.isArray(exportResultOrChapters)
    ? exportResultOrChapters
    : Array.isArray(exportResultOrChapters?.chapters)
      ? exportResultOrChapters.chapters
      : [];

  const paragraphsXml = [];

  if (options.bookTitle && String(options.bookTitle).trim()) {
    paragraphsXml.push(
      buildDocxParagraphXml(String(options.bookTitle).trim(), {
        isHeading: true,
        center: true,
        sizeHalfPt: 28,
        spaceBefore: 120,
        spaceAfter: 200,
      })
    );
  }

  let hasOutline = false;
  if (options.outlineText && String(options.outlineText).trim()) {
    const outlineLines = String(options.outlineText)
      .replace(/\r\n/gu, "\n")
      .split("\n");
    for (const rawLine of outlineLines) {
      const trimmed = rawLine.trim();
      if (!trimmed || /^[-*_]{3,}$/u.test(trimmed)) continue;
      const isHeading = /^#{1,4}\s+/u.test(trimmed);
      const cleanLine = trimmed
        .replace(/^#{1,6}\s+/u, "")
        .replace(/\*\*([^*]+)\*\*/gu, "$1");
      paragraphsXml.push(
        buildDocxParagraphXml(cleanLine, {
          isHeading,
          bold: isHeading,
          sizeHalfPt: isHeading ? 24 : 21,
          indentFirstLine: !isHeading && !/^[-*•0-9]/u.test(cleanLine),
          spaceBefore: isHeading ? 140 : 20,
          spaceAfter: isHeading ? 80 : 20,
        })
      );
      hasOutline = true;
    }
  }

  chapters.forEach((ch, idx) => {
    const rawOutput = String(ch.output || ch.text || "");
    const lines = rawOutput
      .replace(/\r\n/gu, "\n")
      .split("\n")
      .map((l) => l.trim().replace(/^[\s\u3000]+/u, ""))
      .filter(Boolean);
    if (lines.length === 0) return;

    const explicitTitle = String(ch.title || "").trim();
    let headingText = explicitTitle;
    let bodyLines = lines;
    if (explicitTitle && lines[0] === explicitTitle) {
      bodyLines = lines.slice(1);
    } else if (!headingText) {
      headingText = lines[0];
      bodyLines = lines.slice(1);
    }

    paragraphsXml.push(
      buildDocxParagraphXml(headingText, {
        isHeading: true,
        center: true,
        sizeHalfPt: 24,
        pageBreakBefore: idx > 0 || hasOutline,
      })
    );

    for (const bLine of bodyLines) {
      paragraphsXml.push(
        buildDocxParagraphXml(bLine, {
          indentFirstLine: true,
          sizeHalfPt: 21,
        })
      );
    }
  });

  const documentXml = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
    "<w:body>",
    ...paragraphsXml,
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>',
    "</w:body>",
    "</w:document>",
  ].join("");

  const contentTypesXml = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>',
    "</Types>",
  ].join("");

  const rootRelsXml = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>',
    "</Relationships>",
  ].join("");

  const docRelsXml = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
    "</Relationships>",
  ].join("");

  const fontSong = "\u5b8b\u4f53";
  const stylesXml = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
    "<w:docDefaults>",
    `<w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="${fontSong}" w:cs="Times New Roman"/><w:sz w:val="21"/><w:szCs w:val="21"/></w:rPr></w:rPrDefault>`,
    "</w:docDefaults>",
    "</w:styles>",
  ].join("");

  return buildStoreZipBuffer([
    { name: "[Content_Types].xml", data: contentTypesXml },
    { name: "_rels/.rels", data: rootRelsXml },
    { name: "word/_rels/document.xml.rels", data: docRelsXml },
    { name: "word/styles.xml", data: stylesXml },
    { name: "word/document.xml", data: documentXml },
  ]);
}
