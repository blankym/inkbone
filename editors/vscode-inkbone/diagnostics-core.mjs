// VS Code / Cursor 实时诊断与 Quick Fix 纯逻辑核（零第三方依赖、零汉字字面量，可独立运行单元测试）
import {
  auditChapterText,
  normalizeProseText,
  buildTargetedRewritePrompt,
  loadMessagesConfig,
  findProjectConfig,
  loadProjectConfig,
} from "../../src/index.mjs";
import fs from "node:fs";
import path from "node:path";

// 从单行原文中定位命中的精确列区间 [startCol, endCol]
export function locateIssueSpanOnLine(lineText, detail) {
  const text = String(lineText || "");
  const rawDetail = String(detail || "").trim();
  if (!text) return { startCol: 0, endCol: 0, matchedText: "" };

  const candidates = [rawDetail];
  const colonIdx = rawDetail.indexOf(": ");
  if (colonIdx > 0 && colonIdx + 2 < rawDetail.length) {
    candidates.push(rawDetail.slice(colonIdx + 2).trim());
  }

  for (const needle of candidates) {
    if (!needle || needle.length > text.length) continue;
    const pos = text.indexOf(needle);
    if (pos >= 0) {
      return { startCol: pos, endCol: pos + needle.length, matchedText: needle };
    }
  }
  return { startCol: 0, endCol: text.length, matchedText: text.slice(0, 24) };
}

// 将 InkBone 审计报告映射为编辑器无关的行内诊断条目列表（0-based 行列号）
export function buildEditorDiagnostics(text, options = {}) {
  let project = options.project || null;
  if (!project && options.filePath) {
    const cfgPath = findProjectConfig(path.dirname(path.resolve(options.filePath)));
    if (cfgPath) project = loadProjectConfig(cfgPath);
  }
  let ledger = options.ledger || null;
  if (!ledger && project?.ledgerFile && fs.existsSync(project.ledgerFile)) {
    try {
      ledger = JSON.parse(fs.readFileSync(project.ledgerFile, "utf8"));
    } catch {
      ledger = null;
    }
  }

  const report = auditChapterText(text, {
    genre: options.genre || project?.genre || null,
    presetName: options.presetName || project?.preset || null,
    customGates: project?.customGates || null,
    variant: options.variant || project?.variant || "auto",
    projectRules: project ? project.rules : null,
    ledger,
    skipLengthGate: options.skipLengthGate !== false,
  });

  const messages = options.messagesConfig || loadMessagesConfig();
  const locale = messages?.locales?.[options.lang || "zh"] || {};
  const lines = String(text || "").split(/\r?\n/u);
  const diagnostics = [];

  for (const target of report.surgeryTargets || []) {
    const zeroLine = Math.max(0, target.line - 1);
    const lineText = lines[zeroLine] || "";
    for (const issue of target.issues || []) {
      const span = locateIssueSpanOnLine(lineText, issue.detail);
      const sev = issue.level === "blocking" ? "error" : "warning";
      const sevTag = locale.severityLabels?.[sev] || sev;
      const layerTag = issue.layer ? locale.layerLabels?.[issue.layer] || issue.layer : "";
      const prefix = layerTag ? `[${sevTag}/${layerTag}]` : `[${sevTag}]`;
      diagnostics.push({
        line: zeroLine,
        startCol: span.startCol,
        endCol: span.endCol,
        severity: sev,
        code: issue.tag,
        source: "inkbone",
        matchedText: span.matchedText,
        canWhitelist: issue.level !== "blocking" && span.matchedText.length > 0,
        canAutoNormalize: issue.tag === "markdown_asterisk",
        message: `${prefix} ${issue.tag}: ${issue.detail}`,
      });
    }
  }

  return {
    report,
    project,
    diagnostics,
    rewritePrompt: buildTargetedRewritePrompt(text, report, {
      lang: options.lang || "zh",
    }),
  };
}

// 为编辑器 Quick Fix 生成可应用的替换文本或书级白名单词条
export function computeQuickFixProposal(text, diagnostic, options = {}) {
  if (!diagnostic) return null;
  if (diagnostic.canAutoNormalize || diagnostic.code === "markdown_asterisk") {
    const norm = normalizeProseText(text, {
      stripMarkdownEmphasis: true,
      whitelistLiterals: options.whitelistLiterals || [],
    });
    if (norm.changed) {
      return {
        kind: "replace_document",
        title: "InkBone: Normalize stray Markdown emphasis & punctuation",
        newText: norm.output,
      };
    }
  }
  if (diagnostic.canWhitelist && diagnostic.matchedText) {
    return {
      kind: "append_whitelist",
      title: `InkBone: Add "${diagnostic.matchedText}" to .inkbone-whitelist`,
      literal: diagnostic.matchedText,
    };
  }
  return null;
}
