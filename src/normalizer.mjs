// 零 Token 确定性排版与标点清洗器（严格零汉字代码，规则词条来自 JSON 配置）
import fs from "node:fs";
import path from "node:path";
import { collectTextFiles } from "./calibrator.mjs";
import { loadLinguisticsConfig } from "./config-loader.mjs";

// 按行拆解文本并保留每一行的原始换行符（\r\n 或 \n），避免全局改写无关行尾
function splitLinesKeepingEndings(input) {
  const lines = [];
  const endings = [];
  let cursor = 0;

  while (cursor < input.length) {
    const nlIndex = input.indexOf("\n", cursor);
    if (nlIndex === -1) {
      lines.push(input.slice(cursor));
      endings.push("");
      break;
    }
    const isCrlf = nlIndex > cursor && input[nlIndex - 1] === "\r";
    lines.push(input.slice(cursor, isCrlf ? nlIndex - 1 : nlIndex));
    endings.push(isCrlf ? "\r\n" : "\n");
    cursor = nlIndex + 1;
  }

  return { lines, endings };
}

function hasYamlFrontMatter(lines) {
  if (!lines[0] || lines[0].trim() !== "---") return false;
  let sawField = false;
  for (let i = 1; i < Math.min(lines.length, 40); i += 1) {
    const trimmed = lines[i].trim();
    if (trimmed === "---") return sawField;
    if (/^[A-Za-z0-9_-]+:\s*/.test(trimmed)) sawField = true;
  }
  return false;
}

function parseOpeningFence(line) {
  const m = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
  if (!m) return null;
  if (m[1][0] === "`" && m[2].includes("`")) return null;
  return { marker: m[1][0], minLen: m[1].length };
}

function isClosingFence(line, fence) {
  const esc = fence.marker === "`" ? "`" : "~";
  const m = line.match(new RegExp(`^ {0,3}(${esc}{3,})[\\t ]*$`));
  return Boolean(m && m[1].length >= fence.minLen);
}

// 计算单行内 HTML 注释区间（支持跨行状态透传）
function getHtmlCommentSpans(line, openBefore) {
  const spans = [];
  let open = openBefore;
  let cursor = 0;

  while (cursor < line.length) {
    if (open) {
      const close = line.indexOf("-->", cursor);
      if (close === -1) {
        spans.push([cursor, line.length]);
        return { spans, open: true };
      }
      spans.push([cursor, close + 3]);
      cursor = close + 3;
      open = false;
      continue;
    }
    const start = line.indexOf("<!--", cursor);
    if (start === -1) break;
    cursor = start;
    open = true;
  }

  return { spans, open };
}

// 计算单行内反引号代码与书级字面量白名单的受保护区间
function getProtectedSpans(line, commentSpans, whitelistLiterals) {
  const spans = [...commentSpans];

  // 保护行内反引号片段
  let btIdx = 0;
  while (btIdx < line.length) {
    const open = line.indexOf("`", btIdx);
    if (open === -1) break;
    const close = line.indexOf("`", open + 1);
    if (close === -1) break;
    spans.push([open, close + 1]);
    btIdx = close + 1;
  }

  // 保护书级白名单字面量
  for (const literal of whitelistLiterals || []) {
    if (!literal) continue;
    let idx = line.indexOf(literal);
    while (idx !== -1) {
      spans.push([idx, idx + literal.length]);
      idx = line.indexOf(literal, idx + literal.length);
    }
  }

  return spans;
}

// 提取单行对话引号区间与方括号面板区间（含行末未收口多段对白）
function getDialogueAndPanelSpans(line) {
  const spans = [];
  const stack = [];
  const openMap = new Map([
    ["\"", "\""],
    ["\u201c", "\u201d"],
    ["\u300c", "\u300d"],
    ["\u300e", "\u300f"],
    ["\u3010", "\u3011"],
  ]);
  const closeSet = new Set(["\u201d", "\u300d", "\u300f", "\u3011"]);

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    const top = stack.length > 0 ? stack[stack.length - 1] : null;
    if (ch === "\"" && top && top.ch === "\"") {
      const open = stack.pop();
      if (stack.length === 0) spans.push([open.at + 1, i]);
    } else if (openMap.has(ch)) {
      stack.push({ ch, expected: openMap.get(ch), at: i });
    } else if (closeSet.has(ch) && top && top.expected === ch) {
      const open = stack.pop();
      if (stack.length === 0) spans.push([open.at + 1, i]);
    }
  }
  if (stack.length > 0) {
    spans.push([stack[0].at + 1, line.length]);
  }
  return spans;
}

function insideSpans(start, end, spans) {
  return spans.some(([s, e]) => start < e && end > s);
}

// 在未受保护区间剥离成对的 Markdown 加粗（**...**）或斜体（*...*）星号
function stripEmphasisInLine(line, lineNo, commentBefore, whitelistLiterals) {
  let current = line;
  const findings = [];
  const boldRe = /\*\*([^*\r\n]+)\*\*/g;
  const italicRe = /(?<!\*)\*([^*\r\n]+)\*(?!\*)/g;

  const stripOnePattern = (text, re, protectedList, recordFindings) => {
    re.lastIndex = 0;
    let output = "";
    let last = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      if (insideSpans(m.index, m.index + m[0].length, protectedList)) {
        continue;
      }
      output += text.slice(last, m.index) + m[1];
      last = m.index + m[0].length;
      if (recordFindings) {
        findings.push({
          line: lineNo,
          column: m.index + 1,
          type: "markdown_emphasis",
        });
      }
    }
    output += text.slice(last);
    return output;
  };

  let firstPass = true;
  for (let iter = 0; iter < 5; iter += 1) {
    const boldComments = getHtmlCommentSpans(current, commentBefore);
    const boldProtected = getProtectedSpans(
      current,
      boldComments.spans,
      whitelistLiterals
    );
    let next = stripOnePattern(current, boldRe, boldProtected, firstPass);
    const italicComments = getHtmlCommentSpans(next, commentBefore);
    const italicProtected = getProtectedSpans(
      next,
      italicComments.spans,
      whitelistLiterals
    );
    next = stripOnePattern(next, italicRe, italicProtected, firstPass);
    firstPass = false;
    if (next === current) break;
    current = next;
  }

  return { line: current, findings };
}

function prevNonSpace(text, idx) {
  for (let i = idx; i >= 0; i -= 1) {
    if (!/\s/.test(text[i])) return text[i];
  }
  return "";
}

function nextNonSpace(text, idx) {
  for (let i = idx; i < text.length; i += 1) {
    if (!/\s/.test(text[i])) return text[i];
  }
  return "";
}

const OPENING_DELIMS = new Set(["\"", "\u201c", "\u300c", "\u300e", "(", "\uff08", "\u3010", "["]);
const CLOSING_QUOTES = new Set(["\"", "\u201d", "\u300d", "\u300f", ")", "\uff09", "\u3011", "]"]);
const SENTENCE_ENDS = new Set(["\u3002", "\uff01", "\uff1f", "!", "?", "\u2026"]);
const ALL_PUNCT = new Set([
  "\u3002",
  "\uff01",
  "\uff1f",
  "\uff0c",
  "\u3001",
  "\uff1b",
  "\uff1a",
  "\u2026",
  "!",
  "?",
  ",",
  ";",
  ":",
  ".",
]);

function chooseNarrationDashReplacement(text, start, length, normCfg) {
  const before = prevNonSpace(text, start - 1);
  const after = nextNonSpace(text, start + length);
  const rest = text.slice(start + length).trimStart();
  const left = text.slice(0, start).trim();

  if (before === "" || OPENING_DELIMS.has(before)) return "";
  if (/\d/.test(before) && /\d/.test(after)) {
    return normCfg.rangeConnector || "-";
  }
  if (CLOSING_QUOTES.has(after)) {
    return SENTENCE_ENDS.has(before) ? "" : "\u3002";
  }
  if (!after) {
    return SENTENCE_ENDS.has(before) ? "" : "\u3002";
  }
  if (SENTENCE_ENDS.has(before) || ALL_PUNCT.has(after)) return "";
  if (normCfg.colonLeadRe && normCfg.colonLeadRe.test(rest)) return "\uff1a";
  if (normCfg.colonTailRe && normCfg.colonTailRe.test(left)) return "\uff1a";
  return "\uff0c";
}

function normalizePunctuationPass(
  line,
  lineNo,
  protectedSpans,
  options,
  normCfg
) {
  const findings = [];
  const stdEllipsis = "\u2026\u2026";
  const stdDash = "\u2014\u2014";
  const dashUnit = "(?:\u2014+[-\u2014]*|-+\u2014+[-\u2014]*|--+)";
  const ellipsisUnit = "(?:\\.+\\u2026+[.\\u2026]*|\\u2026+\\.+[.\\u2026]*|\\u2026+|\\.{3,}|\\u3002{3,})";
  const pattern = new RegExp(
    `${dashUnit}${ellipsisUnit}|${ellipsisUnit}${dashUnit}|${ellipsisUnit}|${dashUnit}`,
    "g"
  );

  const quoteOrPanelSpans = getDialogueAndPanelSpans(line);
  let output = "";
  let lastIndex = 0;
  let m;

  while ((m = pattern.exec(line)) !== null) {
    const token = m[0];
    if (insideSpans(m.index, m.index + token.length, protectedSpans)) {
      continue;
    }

    const inDialogueOrPanel = insideSpans(
      m.index,
      m.index + token.length,
      quoteOrPanelSpans
    );
    const hasEllipsis = /[\u2026\u3002]|\.{3,}/.test(token);
    const hasDash = /[\u2014-]/.test(token);

    // 1. 破折号与省略号混粘或非标省略号统一收束为标准双省略号 ……
    if (hasEllipsis) {
      const merged = lastIndex === m.index && output.endsWith(stdEllipsis);
      const rep = merged ? "" : stdEllipsis;
      output += line.slice(lastIndex, m.index) + rep;
      lastIndex = m.index + token.length;
      if (hasDash || rep !== token) {
        findings.push({
          line: lineNo,
          column: m.index + 1,
          type: "nonstandard_ellipsis",
        });
      }
      continue;
    }

    if (!hasDash) continue;

    // 2. 对话引号或【…】面板内：统一规范为双破折号 ——
    if (inDialogueOrPanel) {
      const merged = lastIndex === m.index && output.endsWith(stdDash);
      const rep = merged ? "" : stdDash;
      output += line.slice(lastIndex, m.index) + rep;
      lastIndex = m.index + token.length;
      if (rep !== token) {
        findings.push({
          line: lineNo,
          column: m.index + 1,
          type: "dialogue_dash_normalized",
        });
      }
      continue;
    }

    // 3. 引号外旁白破折号：仅在开启 fixNarrationEmDash 时替换中文破折号，默认仍清理 ASCII --
    if (!options.fixNarrationEmDash) {
      if (token.includes("-")) {
        const merged = lastIndex === m.index && output.endsWith(stdDash);
        const rep = merged ? "" : stdDash;
        output += line.slice(lastIndex, m.index) + rep;
        lastIndex = m.index + token.length;
        findings.push({
          line: lineNo,
          column: m.index + 1,
          type: "double_hyphen",
        });
      }
      continue;
    }

    const rep = chooseNarrationDashReplacement(
      line,
      m.index,
      token.length,
      normCfg
    );
    output += line.slice(lastIndex, m.index) + rep;
    lastIndex = m.index + token.length;
    findings.push({
      line: lineNo,
      column: m.index + 1,
      type: "narration_em_dash",
    });
  }

  output += line.slice(lastIndex);
  return { line: output, findings };
}

// 零 Token 确定性清洗正文中的 Markdown 星号、分隔线与非标省略号/破折号
export function normalizeProseText(rawContent, options = {}) {
  const lingConfig = options.lingConfig || loadLinguisticsConfig();
  const whitelistLiterals = options.whitelistLiterals || [];
  const rawNorm = lingConfig.normalizer || {};
  const normCfg = {
    rangeConnector: rawNorm.rangeConnector || "-",
    colonLeadRe: rawNorm.colonLeadRegex
      ? new RegExp(rawNorm.colonLeadRegex)
      : null,
    colonTailRe: rawNorm.colonTailRegex
      ? new RegExp(rawNorm.colonTailRegex)
      : null,
  };

  const input = String(rawContent || "");
  const { lines, endings } = splitLinesKeepingEndings(input);
  const findings = [];
  const outputLines = [];

  let fence = null;
  let inFrontMatter = hasYamlFrontMatter(lines);
  let commentOpen = false;
  let commentStart = null;
  const commentCloseAhead = new Array(lines.length + 1).fill(false);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    commentCloseAhead[i] =
      lines[i].includes("-->") || commentCloseAhead[i + 1];
  }

  for (let i = 0; i < lines.length; i += 1) {
    const lineNo = i + 1;
    const ending = endings[i];
    let line = lines[i];
    const trimmed = line.trim();

    if (commentOpen && !commentCloseAhead[i]) {
      findings.push({
        line: commentStart?.line || lineNo,
        column: commentStart?.column || 1,
        type: "html_comment_unclosed",
      });
      commentOpen = false;
      commentStart = null;
    }

    if (inFrontMatter) {
      outputLines.push(line + ending);
      if (i > 0 && trimmed === "---") inFrontMatter = false;
      continue;
    }

    if (fence) {
      outputLines.push(line + ending);
      if (isClosingFence(line, fence)) fence = null;
      continue;
    }

    const openingFence = parseOpeningFence(line);
    if (openingFence) {
      fence = openingFence;
      outputLines.push(line + ending);
      continue;
    }

    // 独立分隔线 --- 或 *** 直接移除（仅剥离星号模式可保留分隔线）
    if (
      !options.preserveDividers &&
      !commentOpen &&
      (trimmed === "---" || /^\s*\*{3,}\s*$/.test(line))
    ) {
      findings.push({
        line: lineNo,
        column: Math.max(1, line.search(/\S/) + 1),
        type: "markdown_divider",
      });
      continue;
    }

    // Markdown 标题行原样保留
    if (!commentOpen && /^\s*#{1,6}\s/.test(line)) {
      outputLines.push(line + ending);
      continue;
    }

    const commentBefore = commentOpen;
    const initialComments = getHtmlCommentSpans(line, commentBefore);
    commentOpen = initialComments.open;
    if (!commentBefore && commentOpen) {
      commentStart = {
        line: lineNo,
        column: Math.max(1, line.lastIndexOf("<!--") + 1),
      };
    } else if (!commentOpen) {
      commentStart = null;
    }

    if (options.stripMarkdownEmphasis) {
      const empRes = stripEmphasisInLine(
        line,
        lineNo,
        commentBefore,
        whitelistLiterals
      );
      line = empRes.line;
      findings.push(...empRes.findings);
    }

    if (!options.skipPunctuation) {
      let firstPass = true;
      for (let iter = 0; iter < 5; iter += 1) {
        const cState = getHtmlCommentSpans(line, commentBefore);
        const prot = getProtectedSpans(line, cState.spans, whitelistLiterals);
        const pRes = normalizePunctuationPass(
          line,
          lineNo,
          prot,
          options,
          normCfg
        );
        if (firstPass) {
          findings.push(...pRes.findings);
          firstPass = false;
        }
        if (pRes.line === line) break;
        line = pRes.line;
      }
    }

    outputLines.push(line + ending);
  }

  if (commentOpen) {
    findings.push({
      line: commentStart?.line || lines.length,
      column: commentStart?.column || 1,
      type: "html_comment_unclosed",
    });
  }

  const output = outputLines.join("");
  return {
    output,
    changed: output !== input,
    findingCount: findings.length,
    findings,
  };
}

// 仅剥离受保护区间之外的 Markdown 加粗与斜体星号，用于边界与锚点匹配
export function stripMarkdownEmphasis(
  rawContent,
  whitelistLiterals = [],
  lingConfig = null
) {
  return normalizeProseText(rawContent, {
    lingConfig,
    whitelistLiterals,
    stripMarkdownEmphasis: true,
    skipPunctuation: true,
    preserveDividers: true,
  }).output;
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
