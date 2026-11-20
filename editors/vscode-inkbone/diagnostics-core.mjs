// VS Code / Cursor 实时诊断与 Quick Fix 纯逻辑核（零第三方依赖、零汉字字面量，可独立运行单元测试）
import {
  auditChapterText,
  normalizeProseText,
  buildTargetedRewritePrompt,
  loadMessagesConfig,
  loadPlatformsConfig,
  resolvePlatformConfig,
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
    ledger,
    wordCountStatus: computeEditorWordCountStatus(
      report.metrics?.totalHan || 0,
      options.platform || "qidian"
    ),
    diagnostics,
    rewritePrompt: buildTargetedRewritePrompt(text, report, {
      lang: options.lang || "zh",
    }),
  };
}

// 计算当前章节有效汉字数与目标投稿平台单章字数区间的差距（供状态栏实时展示）
export function computeEditorWordCountStatus(totalHan, platformId = "qidian") {
  const platformsCfg = loadPlatformsConfig();
  const spec = resolvePlatformConfig(platformsCfg, platformId);
  const minHan = spec.minHan ?? 2000;
  const maxHan = spec.maxHan ?? 5000;
  const shortfallHan = Math.max(0, minHan - totalHan);
  const excessHan = Math.max(0, totalHan - maxHan);
  const inRange = totalHan >= minHan && totalHan <= maxHan;
  return {
    platform: spec.id,
    platformTitle: spec.title,
    totalHan,
    minHan,
    maxHan,
    shortfallHan,
    excessHan,
    inRange,
  };
}

// 从光标所在行与列位置（或直接传入的词）查询台账中的角色状态卡片（供编辑器 Hover 悬浮提示防写串）
export function lookupCharacterHoverCard(lineTextOrWord, colIndexOrLedger, maybeLedger = null) {
  let lineText = String(lineTextOrWord || "");
  let colIndex = null;
  let ledger = maybeLedger;

  if (colIndexOrLedger && typeof colIndexOrLedger === "object" && !Number.isFinite(colIndexOrLedger)) {
    ledger = colIndexOrLedger;
  } else if (Number.isFinite(Number(colIndexOrLedger))) {
    colIndex = Number(colIndexOrLedger);
  }
  if (!ledger || typeof ledger !== "object" || !lineText) return null;

  const pObj =
    typeof ledger.protagonist === "object" && ledger.protagonist
      ? ledger.protagonist
      : typeof ledger.protagonist === "string" && ledger.protagonist.trim()
        ? { name: ledger.protagonist.trim() }
        : null;
  const snaps =
    ledger.characterSnapshots && typeof ledger.characterSnapshots === "object"
      ? ledger.characterSnapshots
      : {};
  const deceasedList = Array.isArray(ledger.deceasedCharacters)
    ? ledger.deceasedCharacters
    : [];

  const knownNames = new Set();
  if (pObj?.name) knownNames.add(pObj.name);
  for (const [k, v] of Object.entries(pObj || {})) {
    if (typeof v === "string" && /alias/iu.test(k) && v.trim()) knownNames.add(v.trim());
  }
  for (const n of ledger.characterNames || []) {
    if (n && String(n).trim()) knownNames.add(String(n).trim());
  }
  for (const k of Object.keys(snaps)) {
    if (k && k.trim()) knownNames.add(k.trim());
  }
  for (const d of deceasedList) {
    const dn = typeof d === "string" ? d.trim() : String(d?.name || "").trim();
    if (dn) knownNames.add(dn);
  }

  const sortedNames = Array.from(knownNames).sort((a, b) => b.length - a.length);
  let matchedName = null;

  if (colIndex === null) {
    matchedName = sortedNames.find((n) => n === lineText.trim()) || null;
  } else {
    for (const candidate of sortedNames) {
      let pos = lineText.indexOf(candidate);
      while (pos !== -1) {
        if (colIndex >= pos && colIndex <= pos + candidate.length) {
          matchedName = candidate;
          break;
        }
        pos = lineText.indexOf(candidate, pos + 1);
      }
      if (matchedName) break;
    }
  }

  if (!matchedName) return null;

  const isProtagonist =
    Boolean(pObj) &&
    Object.values(pObj).some((v) => typeof v === "string" && v.trim() === matchedName);
  const snap = snaps[matchedName] || (isProtagonist ? pObj : null) || {};
  let deceasedRec = deceasedList.find((d) =>
    typeof d === "string" ? d.trim() === matchedName : String(d?.name || "").trim() === matchedName
  );
  const statusStr = String(
    snap.status || (typeof deceasedRec === "object" && deceasedRec?.status) || (deceasedRec ? "deceased" : "active")
  ).toLowerCase();
  const isDeceased = ["deceased", "dead", "exited", "killed"].includes(statusStr);
  const afterChapter =
    snap.deceasedChapter ??
    snap.absentAfterChapter ??
    (typeof deceasedRec === "object" ? deceasedRec?.afterChapter ?? deceasedRec?.deceasedChapter : null) ??
    null;

  const lines = [
    `**[InkBone Ledger] ${matchedName}** ${isProtagonist ? "(Protagonist)" : ""}`.trim(),
    `- **Status**: \`${statusStr}\`${isDeceased ? ` (inactive after ch${afterChapter ?? "?"})` : ""}`,
  ];
  for (const [k, v] of Object.entries(snap)) {
    if (["name", "status", "deceasedChapter", "absentAfterChapter"].includes(k) || v == null || v === "") {
      continue;
    }
    lines.push(`- **${k}**: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`);
  }

  return {
    name: matchedName,
    isProtagonist,
    status: statusStr,
    isDeceased,
    afterChapter,
    snapshot: snap,
    markdown: lines.join("\n"),
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
