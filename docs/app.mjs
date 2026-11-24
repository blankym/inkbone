// InkBone 浏览器静态试跑台主控模块（纯原生 ES Module，无网络上传，无外部依赖，严格零汉字字面量）
import {
  compileGenresConfig,
  compileLinguisticsConfig,
  compileSeverityConfig,
  compileTraditionalConfig,
} from "./vendor/core/config-compiler.mjs";
import { auditChapterText } from "./vendor/core/auditor.mjs";
import { normalizeProseText } from "./vendor/core/normalizer.mjs";
import { compileBoundaryPacket } from "./vendor/core/boundary-compiler.mjs";
import { validateEvidenceReview } from "./vendor/core/evidence-validator.mjs";
import { validateLedger } from "./vendor/core/ledger-manager.mjs";
import { buildTargetedRewritePrompt } from "./vendor/core/formatter.mjs";
import { diagnoseChapterEntries } from "./vendor/core/browser-doctor.mjs";
import {
  exportChapterEntries,
  resolvePlatformConfig,
  buildStoreZipBuffer,
  buildSubmissionDocxBytes,
} from "./vendor/core/exporter.mjs";

const DRAFT_STORAGE_KEY = "inkbone_playground_draft_v2";

const state = {
  lingConfig: null,
  genresConfig: null,
  presetsConfig: null,
  severityConfig: null,
  messagesConfig: null,
  traditionalConfig: null,
  platformsConfig: null,
  samples: null,
  activeAuditPresetId: null,
  activeReviewPresetKey: "hallucinated",
  lastAuditResult: null,
  lastAuditText: "",
  bookEntries: [],
  lastBookReport: null,
};

const el = (id) => document.getElementById(id);

function createNode(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function interpolate(template, vars = {}) {
  let out = String(template || "");
  for (const [k, v] of Object.entries(vars)) {
    out = out.split(`{${k}}`).join(String(v ?? ""));
  }
  return out;
}

function getZhLocale() {
  return state.messagesConfig?.locales?.zh || {};
}

function parseCharacterList(raw) {
  return String(raw || "")
    .split(/[\s,;\uFF0C\u3001]+/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

// 触发纯本地浏览器文件下载（不触碰任何网络）
function triggerLocalDownload(filename, content, mimeType = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// 根据违规等级与条目标注推断每行的展示严重度
function resolveLineSeverity(lineIssues, violationSeverityMap) {
  let sev = "warning";
  for (const item of lineIssues) {
    if (item.level === "blocking") return "error";
    const vSev = violationSeverityMap.get(item.tag);
    if (vSev === "error") return "error";
    if (vSev === "info") sev = "info";
  }
  return sev;
}

// 渲染当前选定题材的公式、三层声口矩阵与规则厚度提示
function renderGenreMeta() {
  const box = el("genreMetaBox");
  const genreId = el("genreSelect").value;
  const pack = state.genresConfig?.genres?.[genreId];
  const truth = state.samples?.genreTruthNotes?.[genreId];
  box.replaceChildren();
  if (!pack) return;

  if (truth) {
    const totalGenreRules =
      (pack.compiledRegisterRules?.length || 0) +
      (pack.compiledClicheRules?.length || 0) +
      (pack.compiledFillerRules?.length || 0);
    const statusCls = totalGenreRules >= 3 ? "badge badge-ok" : "badge badge-info";
    box.appendChild(createNode("span", statusCls, truth.status));
    box.appendChild(createNode("span", "", truth.note));
  }
  if (pack.registerFormula) {
    box.appendChild(createNode("span", "badge badge-muted", pack.registerFormula));
  }
}

// 渲染顶部语言学指标卡片
function renderKpis(result) {
  const grid = el("kpiGrid");
  const zh = getZhLocale();
  const labels = zh.metricLabels || state.samples.metricLabels || {};
  const sevLabels = zh.severityLabels || state.samples.severityLabels || {};
  const m = result.metrics || {};
  const s = result.summary || {};

  const cards = [
    { val: s.error || 0, label: sevLabels.error || "error", color: s.error ? "var(--accent)" : "var(--ok)" },
    { val: s.warning || 0, label: sevLabels.warning || "warning", color: s.warning ? "var(--warn)" : "var(--ok)" },
    { val: s.info || 0, label: sevLabels.info || "info", color: "var(--info)" },
    { val: m.totalHan ?? 0, label: labels.totalHan || "totalHan" },
    { val: m.sentLenMean ?? 0, label: labels.sentLenMean || "sentLenMean" },
    { val: m.sentLenCV ?? 0, label: labels.sentLenCV || "sentLenCV" },
    { val: m.mattr50 ?? 0, label: labels.mattr50 || "mattr50" },
    { val: m.dePer100Han ?? 0, label: labels.dePer100Han || "dePer100Han" },
  ];

  grid.replaceChildren();
  for (const item of cards) {
    const card = createNode("div", "kpi");
    const valNode = createNode("div", "kpi-val", item.val);
    if (item.color) valNode.style.color = item.color;
    card.appendChild(valNode);
    card.appendChild(createNode("div", "kpi-label", item.label));
    grid.appendChild(card);
  }
}

// 渲染纯 DOM/CSS 段落篇幅与命中节奏心电图
function renderRhythmStrip(rawText, result, violationSeverityMap) {
  const barsEl = el("rhythmBars");
  const hintEl = el("rhythmSummaryHint");
  const msgs = state.samples.uiMessages || {};
  const lines = String(rawText || "").split(/\r?\n/u);
  const hanRe = state.lingConfig.compiledRegex.hanCharGlobal;
  const quoteRe = state.lingConfig.compiledRegex.quoteCharsGlobal;

  const targetByLine = new Map();
  for (const t of result.surgeryTargets || []) {
    targetByLine.set(t.line, t.issues);
  }

  const paraRows = [];
  lines.forEach((lineText, idx) => {
    const trimmed = lineText.trim();
    if (!trimmed) return;
    const hanMatches = trimmed.match(hanRe);
    const hanLen = hanMatches ? hanMatches.length : 0;
    if (hanLen === 0) return;
    const lineNo = idx + 1;
    const issues = targetByLine.get(lineNo);
    const sev = issues ? resolveLineSeverity(issues, violationSeverityMap) : "";
    const hasQuote = Boolean(trimmed.match(quoteRe));
    paraRows.push({ lineNo, hanLen, sev, hasQuote });
  });

  const m = result.metrics || {};
  hintEl.textContent = interpolate(msgs.rhythmSummary || "{paras} / {mean} / {cv}", {
    paras: paraRows.length,
    mean: m.sentLenMean ?? 0,
    cv: m.sentLenCV ?? 0,
  });

  barsEl.replaceChildren();
  const maxHan = Math.max(40, ...paraRows.map((p) => p.hanLen));
  for (const row of paraRows) {
    const pct = Math.max(14, Math.round((row.hanLen / maxHan) * 100));
    const cls = row.sev
      ? `rbar sev-${row.sev}`
      : row.hasQuote
        ? "rbar is-dialogue"
        : "rbar";
    const bar = createNode("div", cls);
    bar.style.height = `${pct}%`;
    bar.title = interpolate(msgs.rhythmBarTip || "L{line}: {han}", {
      line: row.lineNo,
      han: row.hanLen,
    });
    bar.addEventListener("click", () => flashSourceLine(row.lineNo));
    barsEl.appendChild(bar);
  }
}

// 从单行命中列表提取可在原文中精确标注的非重叠词级区间（零正则注入、纯 DOM 安全渲染）
function computeLineHighlights(lineText, issues, violationSeverityMap) {
  if (!lineText || !issues || issues.length === 0) return [];
  const rawRanges = [];
  for (const issue of issues) {
    const detail = String(issue.detail || "").trim();
    if (!detail) continue;
    const candidates = [detail];
    const colonIdx = detail.indexOf(": ");
    if (colonIdx > 0 && colonIdx + 2 < detail.length) {
      candidates.push(detail.slice(colonIdx + 2).trim());
    }
    const sev =
      issue.level === "blocking" || violationSeverityMap.get(issue.tag) === "error"
        ? "error"
        : "warning";
    for (const needle of candidates) {
      if (!needle || needle.length < 1 || needle.length > lineText.length) continue;
      let pos = lineText.indexOf(needle);
      let foundAny = false;
      while (pos !== -1) {
        foundAny = true;
        rawRanges.push({
          start: pos,
          end: pos + needle.length,
          sev,
          tooltip: `${issue.tag}: ${detail}`,
        });
        pos = lineText.indexOf(needle, pos + needle.length);
      }
      if (foundAny) break;
    }
  }
  if (rawRanges.length === 0) return [];

  rawRanges.sort((a, b) => a.start - b.start || b.end - a.end);
  const merged = [];
  for (const r of rawRanges) {
    const last = merged[merged.length - 1];
    if (!last || r.start >= last.end) {
      merged.push(r);
    } else if (r.sev === "error" && last.sev !== "error") {
      last.sev = "error";
      last.end = Math.max(last.end, r.end);
      last.tooltip = `${last.tooltip} | ${r.tooltip}`;
    }
  }
  return merged;
}

// 渲染单行原文，必要时插入词级 <mark> 高亮节点
function appendHighlightedLineContent(parentEl, lineText, issues, violationSeverityMap) {
  if (!lineText) {
    parentEl.textContent = " ";
    return;
  }
  const ranges = computeLineHighlights(lineText, issues, violationSeverityMap);
  if (ranges.length === 0) {
    parentEl.textContent = lineText;
    return;
  }
  let cursor = 0;
  for (const r of ranges) {
    if (r.start > cursor) {
      parentEl.appendChild(document.createTextNode(lineText.slice(cursor, r.start)));
    }
    const mark = createNode("mark", `hit-mark sev-${r.sev}`, lineText.slice(r.start, r.end));
    mark.title = r.tooltip;
    parentEl.appendChild(mark);
    cursor = r.end;
  }
  if (cursor < lineText.length) {
    parentEl.appendChild(document.createTextNode(lineText.slice(cursor)));
  }
}

// 渲染左侧带行号与词级高亮的原文对照区
function renderAnnotatedLines(rawText, surgeryTargets, violationSeverityMap) {
  const container = el("annotatedLines");
  const lines = String(rawText || "").split(/\r?\n/u);
  const targetByLine = new Map();
  for (const t of surgeryTargets || []) {
    targetByLine.set(t.line, t.issues);
  }

  el("lineStatsHint").textContent = `${lines.length} L`;
  container.replaceChildren();

  lines.forEach((lineText, idx) => {
    const lineNo = idx + 1;
    const issues = targetByLine.get(lineNo);
    const sev = issues ? resolveLineSeverity(issues, violationSeverityMap) : "";
    const row = createNode("div", sev ? `aline sev-${sev}` : "aline");
    row.dataset.line = String(lineNo);

    const numCell = createNode("div", "aline-num", lineNo);
    numCell.style.cursor = "pointer";
    numCell.addEventListener("click", () => startInlineLineEdit(row, textCell, idx));
    row.appendChild(numCell);

    const textCell = createNode("div", "aline-text");
    textCell.title = state.samples?.uiMessages?.inlineEditTip || "";
    appendHighlightedLineContent(textCell, lineText, issues, violationSeverityMap);
    textCell.addEventListener("dblclick", () => startInlineLineEdit(row, textCell, idx));
    row.appendChild(textCell);
    container.appendChild(row);
  });
}

// 启动单行就地编辑模式：回车或失焦时自动写回主文本框并即时重算消警
function startInlineLineEdit(rowEl, textCell, zeroLineIdx) {
  if (textCell.contentEditable === "true") return;
  const textarea = el("chapterInput");
  const allLines = String(textarea.value || "").split(/\r?\n/u);
  const originalLine = allLines[zeroLineIdx] ?? "";

  textCell.textContent = originalLine;
  textCell.contentEditable = "true";
  textCell.classList.add("editing");
  textCell.focus();

  const commitEdit = () => {
    if (textCell.contentEditable !== "true") return;
    textCell.contentEditable = "false";
    textCell.classList.remove("editing");
    const updatedLine = String(textCell.textContent || "").replace(/\r?\n/gu, " ");
    if (updatedLine !== originalLine) {
      allLines[zeroLineIdx] = updatedLine;
      textarea.value = allLines.join("\n");
      saveDraftToLocal(textarea.value);
      runAudit();
    } else {
      runAudit();
    }
  };

  textCell.addEventListener("blur", commitEdit, { once: true });
  textCell.addEventListener("keydown", (evt) => {
    if (evt.key === "Enter" && !evt.shiftKey) {
      evt.preventDefault();
      textCell.blur();
    } else if (evt.key === "Escape") {
      evt.preventDefault();
      textCell.textContent = originalLine;
      textCell.blur();
    }
  });
}

function saveDraftToLocal(text) {
  try {
    window.localStorage.setItem(DRAFT_STORAGE_KEY, String(text || ""));
  } catch {
    // 忽略隐私模式下 localStorage 写入失败
  }
}

function flashSourceLine(lineNo) {
  const row = el("annotatedLines").querySelector(`[data-line="${lineNo}"]`);
  if (!row) return;
  row.scrollIntoView({ behavior: "smooth", block: "center" });
  row.classList.remove("flash");
  void row.offsetWidth;
  row.classList.add("flash");
  window.setTimeout(() => row.classList.remove("flash"), 1400);
}

// 更新右侧精准改稿 Prompt 预览内容
function updateRewritePromptPreview() {
  if (!state.lastAuditResult) return;
  const genreId = el("genreSelect").value;
  const pack = state.genresConfig?.genres?.[genreId];
  const built = buildTargetedRewritePrompt(state.lastAuditText, state.lastAuditResult, {
    messagesConfig: state.messagesConfig,
    lang: "zh",
    genreTitle: pack ? `${pack.title} (${pack.id})` : genreId,
  });
  el("promptPreview").textContent = built.prompt;
  return built;
}

// 渲染右侧诊断手术单与整章门禁告警
function renderFindings(result) {
  const list = el("findingsList");
  const banner = el("auditBanner");
  const badge = el("findingCountBadge");
  const msgs = state.samples.uiMessages || {};
  const zh = getZhLocale();
  const vLabels = zh.violationLabels || state.samples.violationLabels || {};
  const remedies = zh.remedies || {};
  const lLabels = zh.layerLabels || state.samples.layerLabels || {};
  const sLabels = zh.severityLabels || state.samples.severityLabels || {};

  const targets = result.surgeryTargets || [];
  const violations = result.violations || [];
  const totalItems =
    targets.reduce((acc, t) => acc + t.issues.length, 0) + violations.length;
  badge.textContent = String(totalItems);

  banner.replaceChildren();
  list.replaceChildren();

  if (targets.length === 0 && violations.length === 0) {
    const okBox = createNode("div", "status-banner ok");
    okBox.appendChild(createNode("strong", "", msgs.allClearTitle || "OK"));
    okBox.appendChild(createNode("div", "", msgs.allClearSub || ""));
    banner.appendChild(okBox);
    return;
  }

  if (result.pass) {
    banner.appendChild(createNode("div", "status-banner ok", msgs.passWithWarnings || "PASS"));
  } else if (result.mode === "strict" && (result.summary?.error || 0) === 0) {
    banner.appendChild(createNode("div", "status-banner err", msgs.failStrict || "STRICT FAIL"));
  } else {
    banner.appendChild(createNode("div", "status-banner err", msgs.failDefault || "FAIL"));
  }

  for (const target of targets) {
    for (const issue of target.issues) {
      const sev = issue.level === "blocking" ? "error" : "warning";
      const card = createNode("div", `finding-item clickable sev-${sev}`);
      card.addEventListener("click", () => flashSourceLine(target.line));

      const head = createNode("div", "finding-head");
      head.appendChild(
        createNode(
          "span",
          `badge badge-${sev}`,
          `${msgs.linePrefix || "L"}${target.line}${msgs.lineSuffix || ""}`
        )
      );
      head.appendChild(createNode("span", `badge badge-${sev}`, sLabels[sev] || sev));
      if (issue.layer) {
        head.appendChild(createNode("span", "badge badge-muted", lLabels[issue.layer] || issue.layer));
      }
      head.appendChild(createNode("span", "badge badge-muted", issue.tag));
      card.appendChild(head);

      const detailText = `${msgs.matchLabel || ""}${issue.detail || ""}`;
      card.appendChild(createNode("div", "finding-detail", detailText));
      list.appendChild(card);
    }
  }

  const rank = { error: 0, warning: 1, info: 2 };
  const sortedViolations = [...violations].sort(
    (a, b) => (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9)
  );
  for (const v of sortedViolations) {
    const sev = v.severity || "warning";
    const card = createNode("div", `finding-item sev-${sev}`);
    const head = createNode("div", "finding-head");
    head.appendChild(createNode("span", `badge badge-${sev}`, sLabels[sev] || sev));
    head.appendChild(createNode("span", "finding-title", vLabels[v.code] || v.code));
    head.appendChild(createNode("span", "badge badge-muted", v.code));
    card.appendChild(head);

    const metaParts = [];
    if (v.actual !== undefined) metaParts.push(`actual: ${v.actual}`);
    if (v.maxAllowed !== undefined) metaParts.push(`max: ${v.maxAllowed}`);
    if (v.minRequired !== undefined) metaParts.push(`min: ${v.minRequired}`);
    if (v.expected !== undefined) metaParts.push(`expected: ${JSON.stringify(v.expected)}`);
    if (metaParts.length > 0) {
      card.appendChild(createNode("div", "finding-detail", metaParts.join(" | ")));
    }
    const remedyText = remedies[v.code] || v.remedy;
    if (remedyText) {
      card.appendChild(
        createNode("div", "finding-remedy", `${msgs.remedyLabel || ""}${remedyText}`)
      );
    }
    list.appendChild(card);
  }
}

function runAudit() {
  if (!state.lingConfig) return;
  const text = el("chapterInput").value;
  const genre = el("genreSelect").value;
  const variant = el("variantSelect").value || "auto";
  const characterNames = parseCharacterList(el("charactersInput").value);
  const protagonistName = el("protagonistInput").value.trim();
  const skipLengthGate = el("skipLengthCheck").checked;
  const goldenThree = el("goldenThreeCheck") ? el("goldenThreeCheck").checked : false;
  const aigcGuard = el("aigcGuardCheck") ? el("aigcGuardCheck").checked : false;
  const strict = el("strictModeCheck").checked;

  const result = auditChapterText(text, {
    genre,
    variant,
    skipLengthGate,
    goldenThree,
    aigcGuard,
    strict,
    characterNames,
    ledger: protagonistName ? { protagonist: { name: protagonistName } } : undefined,
    linguisticsConfig: state.lingConfig,
    genresConfig: state.genresConfig,
    presetsConfig: state.presetsConfig,
    severityConfig: state.severityConfig,
    traditionalConfig: state.traditionalConfig,
  });

  state.lastAuditResult = result;
  state.lastAuditText = text;
  el("promptCopyNotice").style.display = "none";

  const msgs = state.samples.uiMessages || {};
  const vBadge = el("variantDetectedBadge");
  vBadge.textContent =
    result.scriptVariant === "zh-hant"
      ? msgs.variantBadgeHant || "zh-hant"
      : msgs.variantBadgeHans || "zh-hans";

  const violationSeverityMap = new Map();
  for (const v of result.violations) {
    violationSeverityMap.set(v.code, v.severity);
  }

  renderKpis(result);
  renderRhythmStrip(text, result, violationSeverityMap);
  renderAnnotatedLines(text, result.surgeryTargets, violationSeverityMap);
  renderFindings(result);
  updateRewritePromptPreview();
}

async function copyRewritePrompt() {
  const notice = el("promptCopyNotice");
  const msgs = state.samples.uiMessages || {};
  const built = updateRewritePromptPreview();
  if (!built) return;
  try {
    await navigator.clipboard.writeText(built.prompt);
    notice.className = "status-banner ok";
    notice.textContent = msgs.copiedPrompt || "Copied";
    notice.style.display = "block";
  } catch {
    el("promptDrawer").classList.add("open");
    notice.className = "status-banner info";
    notice.textContent = msgs.copyFallback || "Copy manually below";
    notice.style.display = "block";
  }
}

function runNormalize() {
  if (!state.lingConfig) return;
  const inputEl = el("chapterInput");
  const notice = el("normalizeNotice");
  const msgs = state.samples.uiMessages || {};

  const res = normalizeProseText(inputEl.value, {
    lingConfig: state.lingConfig,
    stripMarkdownEmphasis: true,
    fixNarrationEmDash: false,
  });

  notice.style.display = "block";
  if (res.changed) {
    inputEl.value = res.output;
    notice.className = "status-banner ok";
    notice.textContent = `${msgs.normalizeChanged || ""} (${res.findingCount})`;
    runAudit();
  } else {
    notice.className = "status-banner info";
    notice.textContent = msgs.normalizeUnchanged || "";
  }
}

function handleLocalFileRead(file) {
  if (!file) return;
  const msgs = state.samples.uiMessages || {};
  const reader = new FileReader();
  reader.onload = () => {
    el("chapterInput").value = String(reader.result || "");
    const notice = el("normalizeNotice");
    notice.style.display = "block";
    notice.className = "status-banner ok";
    notice.textContent = `${msgs.importedFile || ""}${file.name}`;
    runAudit();
  };
  reader.readAsText(file, "utf-8");
}

function applyAuditPreset(preset) {
  state.activeAuditPresetId = preset.id;
  el("genreSelect").value = preset.genre;
  el("variantSelect").value = preset.variant || "auto";
  el("charactersInput").value = preset.characters || "";
  el("protagonistInput").value = preset.protagonist || "";
  el("chapterInput").value = preset.text;
  el("normalizeNotice").style.display = "none";

  for (const btn of el("auditPresetBtns").querySelectorAll("button")) {
    btn.classList.toggle("active", btn.dataset.presetId === preset.id);
  }
  renderGenreMeta();
  runAudit();
}

// 渲染带 [REDACTED] 高亮的 JSON 输出块
function renderHighlightedJson(preEl, jsonText) {
  preEl.replaceChildren();
  const token = "[REDACTED]";
  const parts = jsonText.split(token);
  parts.forEach((part, idx) => {
    if (part) preEl.appendChild(document.createTextNode(part));
    if (idx < parts.length - 1) {
      const mark = createNode("span", "badge badge-error", token);
      preEl.appendChild(mark);
    }
  });
}

// 在 Tab 2 顶部渲染实时台账健康检查状态
function renderLedgerHealth(ledger, chapterNo) {
  const healthBox = el("ledgerHealthBanner");
  const msgs = state.samples.uiMessages || {};
  const zh = getZhLocale();
  const issueLabels = zh.ledgerIssueLabels || {};
  healthBox.replaceChildren();

  const health = validateLedger(ledger, { currentChapter: chapterNo });
  if (health.issues.length === 0) {
    const okMsg = interpolate(msgs.ledgerHealthy || "OK", {
      chapters: health.stats.chapterCount,
      chars: health.stats.characterCount,
      activeFs: health.stats.activeForeshadowingCount,
    });
    healthBox.appendChild(createNode("div", "status-banner ok", okMsg));
    return;
  }

  const cls = health.summary.error > 0 ? "status-banner err" : "status-banner warn";
  const box = createNode("div", cls);
  const headText = interpolate(msgs.ledgerIssues || "Issues: {errors} / {warnings}", {
    errors: health.summary.error,
    warnings: health.summary.warning,
  });
  box.appendChild(createNode("strong", "", headText));
  for (const item of health.issues) {
    const label = issueLabels[item.code] || item.code;
    box.appendChild(createNode("div", "", `- [${item.severity}] ${label}: ${item.detail}`));
  }
  healthBox.appendChild(box);
}

function runPacket() {
  const banner = el("packetStatusBanner");
  const out = el("packetOutput");
  const msgs = state.samples.uiMessages || {};
  banner.replaceChildren();

  let ledger;
  try {
    ledger = JSON.parse(el("ledgerInput").value);
  } catch (err) {
    el("ledgerHealthBanner").replaceChildren();
    banner.appendChild(
      createNode("div", "status-banner err", `${msgs.jsonParseError || ""} ${err.message}`)
    );
    out.textContent = "";
    return;
  }

  const chapterNo = Number(el("packetChapterInput").value || 1);
  renderLedgerHealth(ledger, chapterNo);
  try {
    const packet = compileBoundaryPacket(ledger, chapterNo, "");
    const hasLocked = (packet.knowledgeLedger || []).some((k) => !k.revealed);
    const cls = hasLocked ? "status-banner info" : "status-banner ok";
    const hint = hasLocked ? msgs.packetMaskedHint : msgs.packetRevealedHint;
    banner.appendChild(createNode("div", cls, hint));
    renderHighlightedJson(out, JSON.stringify(packet, null, 2));
  } catch (err) {
    banner.appendChild(createNode("div", "status-banner err", err.message));
    out.textContent = "";
  }
}

function runReviewCheck() {
  if (!state.lingConfig) return;
  const banner = el("reviewStatusBanner");
  const out = el("reviewOutput");
  const msgs = state.samples.uiMessages || {};
  banner.replaceChildren();

  let payload;
  try {
    payload = JSON.parse(el("reviewJsonInput").value);
  } catch (err) {
    banner.appendChild(
      createNode("div", "status-banner err", `${msgs.jsonParseError || ""} ${err.message}`)
    );
    out.textContent = "";
    return;
  }

  const result = validateEvidenceReview(
    el("reviewChapterInput").value,
    payload,
    state.lingConfig
  );
  const cls = result.valid ? "status-banner ok" : "status-banner err";
  const msg = result.valid ? msgs.reviewValid : msgs.reviewInvalid;
  banner.appendChild(createNode("div", cls, msg));
  out.textContent = JSON.stringify(result, null, 2);
}

// Tab 4：运行浏览器端整书多章体检（Browser Doctor）并渲染走势、Top 10 榜与自动角色名单
function runBookDoctor() {
  const notice = el("bookNotice");
  const msgs = state.samples.uiMessages || {};
  if (!state.bookEntries || state.bookEntries.length === 0) {
    notice.style.display = "block";
    notice.className = "status-banner info";
    notice.textContent = msgs.bookEmpty || "No chapters loaded.";
    return;
  }

  const explicitGenre = el("bookGenreSelect").value || undefined;
  const report = diagnoseChapterEntries(state.bookEntries, {
    genre: explicitGenre,
    skipLengthGate: true,
    variant: "auto",
    linguisticsConfig: state.lingConfig,
    genresConfig: state.genresConfig,
    presetsConfig: state.presetsConfig,
    severityConfig: state.severityConfig,
    traditionalConfig: state.traditionalConfig,
  });
  state.lastBookReport = report;

  notice.style.display = "block";
  notice.className = report.pass ? "status-banner ok" : "status-banner warn";
  notice.textContent = interpolate(msgs.bookLoaded || "{count}", {
    count: report.totals.chaptersScanned,
  });

  // 1. 全书汇总 KPI 卡片
  const kpiGrid = el("bookKpiGrid");
  const kpiCards = [
    { val: report.totals.chaptersScanned, label: msgs.bookKpiChapters || "Chapters" },
    { val: report.totals.totalHan, label: msgs.bookKpiHan || "Total Han" },
    {
      val: report.totals.hardErrors,
      label: msgs.bookKpiErrors || "Errors",
      color: report.totals.hardErrors ? "var(--accent)" : "var(--ok)",
    },
    {
      val: report.totals.totalWarnings,
      label: msgs.bookKpiWarnings || "Warnings",
      color: report.totals.totalWarnings ? "var(--warn)" : "var(--ok)",
    },
    {
      val: report.totals.echoWarnings,
      label: msgs.bookKpiEcho || "Echo",
      color: report.totals.echoWarnings ? "var(--accent)" : "var(--ok)",
    },
    { val: report.candidateCharacters.length, label: msgs.bookKpiChars || "Characters", color: "var(--info)" },
  ];
  kpiGrid.replaceChildren();
  for (const c of kpiCards) {
    const card = createNode("div", "kpi");
    const v = createNode("div", "kpi-val", c.val);
    if (c.color) v.style.color = c.color;
    card.appendChild(v);
    card.appendChild(createNode("div", "kpi-label", c.label));
    kpiGrid.appendChild(card);
  }

  // 2. 逐章走势柱状图
  el("bookGenreBadge").textContent = `${report.genre.title} (${report.genre.id})`;
  const trendBars = el("bookTrendBars");
  trendBars.replaceChildren();
  const maxHan = Math.max(80, ...report.trend.map((t) => t.totalHan));
  for (const row of report.trend) {
    const pct = Math.max(18, Math.round((row.totalHan / maxHan) * 100));
    const cls = row.errors > 0 ? "rbar sev-error" : row.warnings > 0 ? "rbar sev-warning" : "rbar is-dialogue";
    const bar = createNode("div", cls);
    bar.style.height = `${pct}%`;
    bar.title = `${row.name} | ${row.totalHan} Han | ${row.errors}E/${row.warnings}W | echo=${row.echoRatio}`;
    trendBars.appendChild(bar);
  }

  // 3. 逐章体检明细表
  const tbody = el("bookChapterTableBody");
  tbody.replaceChildren();
  for (const ch of report.chapters) {
    const tr = document.createElement("tr");
    tr.appendChild(createNode("td", "", ch.name));
    tr.appendChild(createNode("td", "num", ch.totalHan));
    const errTd = createNode("td", "num", ch.summary.error);
    if (ch.summary.error > 0) errTd.style.color = "var(--accent)";
    tr.appendChild(errTd);
    tr.appendChild(createNode("td", "num", ch.summary.warning));
    const echoTd = createNode("td", "num", ch.echoRatio || 0);
    if (ch.echoRatio > 0.15) echoTd.style.color = "var(--accent)";
    tr.appendChild(echoTd);
    tbody.appendChild(tr);
  }

  // 4. 全书高频规则 Top 10 榜
  const topList = el("bookTopRulesList");
  topList.replaceChildren();
  if (report.topRules.length === 0) {
    topList.appendChild(createNode("div", "status-banner ok", msgs.bookTopEmpty || "Clean"));
  } else {
    for (const r of report.topRules) {
      const sev = r.level === "blocking" ? "error" : "warning";
      const item = createNode("div", `finding-item sev-${sev}`);
      const head = createNode("div", "finding-head");
      head.appendChild(createNode("span", `badge badge-${sev}`, `${r.count}x / ${r.chapterCount}ch`));
      head.appendChild(createNode("span", "badge badge-muted", r.tag));
      item.appendChild(head);
      if (r.sample) item.appendChild(createNode("div", "finding-detail", r.sample));
      topList.appendChild(item);
    }
  }

  // 5. 自动挖掘的角色名单标签
  const charChips = el("bookCharChips");
  charChips.replaceChildren();
  if (report.candidateCharacters.length === 0) {
    charChips.appendChild(createNode("span", "badge badge-muted", msgs.bookCharsEmpty || "None"));
  } else {
    for (const c of report.candidateCharacters) {
      charChips.appendChild(createNode("span", "badge badge-info", `${c.name} (${c.totalCount})`));
    }
  }
}

async function loadBookFileList(fileList) {
  const valid = Array.from(fileList || []).filter((f) => /\.(md|txt)$/iu.test(f.name));
  if (valid.length === 0) return;
  const entries = await Promise.all(
    valid.map(
      (file) =>
        new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve({ name: file.name, text: String(reader.result || "") });
          reader.readAsText(file, "utf-8");
        })
    )
  );
  state.bookEntries = entries;
  el("bookDemoBtn").classList.remove("active");
  runBookDoctor();
}

function setupTabs() {
  const buttons = document.querySelectorAll(".tab-btn");
  const panels = document.querySelectorAll(".panel");
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.dataset.tab;
      buttons.forEach((b) => b.classList.toggle("active", b === btn));
      panels.forEach((p) => p.classList.toggle("active", p.id === `tab-${target}`));
    });
  });
}

function setupFileDropAndImport() {
  const textarea = el("chapterInput");
  const input = el("fileImportInput");
  el("fileImportBtn").addEventListener("click", () => input.click());
  input.addEventListener("change", () => {
    if (input.files && input.files[0]) {
      handleLocalFileRead(input.files[0]);
      input.value = "";
    }
  });
  textarea.addEventListener("dragover", (evt) => {
    evt.preventDefault();
    textarea.classList.add("drag-over");
  });
  textarea.addEventListener("dragleave", () => textarea.classList.remove("drag-over"));
  textarea.addEventListener("drop", (evt) => {
    evt.preventDefault();
    textarea.classList.remove("drag-over");
    const file = evt.dataTransfer?.files?.[0];
    if (file) handleLocalFileRead(file);
  });

  // Tab 4 多章文件与目录导入
  const bookFilesInput = el("bookFilesInput");
  const bookDirInput = el("bookDirInput");
  const dropZone = el("bookDropZone");
  el("bookFilesBtn").addEventListener("click", () => bookFilesInput.click());
  el("bookDirBtn").addEventListener("click", () => bookDirInput.click());
  bookFilesInput.addEventListener("change", () => {
    loadBookFileList(bookFilesInput.files);
    bookFilesInput.value = "";
  });
  bookDirInput.addEventListener("change", () => {
    loadBookFileList(bookDirInput.files);
    bookDirInput.value = "";
  });
  dropZone.addEventListener("dragover", (evt) => {
    evt.preventDefault();
    dropZone.classList.add("drag-over");
  });
  dropZone.addEventListener("dragleave", () => dropZone.classList.remove("drag-over"));
  dropZone.addEventListener("drop", (evt) => {
    evt.preventDefault();
    dropZone.classList.remove("drag-over");
    loadBookFileList(evt.dataTransfer?.files);
  });
}

async function init() {
  setupTabs();
  setupFileDropAndImport();
  try {
    const [lingRaw, genresRaw, presetsRaw, severityRaw, messagesRaw, tradRaw, platRaw, samples] =
      await Promise.all([
        fetch("./vendor/configs/zh-linguistics.json").then((r) => r.json()),
        fetch("./vendor/configs/genres.json").then((r) => r.json()),
        fetch("./vendor/configs/presets.json").then((r) => r.json()),
        fetch("./vendor/configs/severity.json").then((r) => r.json()),
        fetch("./vendor/configs/messages.json").then((r) => r.json()),
        fetch("./vendor/configs/zh-traditional.json").then((r) => r.json()),
        fetch("./vendor/configs/platforms.json").then((r) => r.json()),
        fetch("./samples.json").then((r) => r.json()),
      ]);

    state.lingConfig = compileLinguisticsConfig(lingRaw);
    state.genresConfig = compileGenresConfig(genresRaw);
    state.presetsConfig = presetsRaw;
    state.severityConfig = compileSeverityConfig(severityRaw);
    state.messagesConfig = messagesRaw;
    state.traditionalConfig = compileTraditionalConfig(tradRaw);
    state.platformsConfig = platRaw;
    state.samples = samples;

    // 填充题材下拉列表（Tab 1 与 Tab 4 共用）
    const genreSelect = el("genreSelect");
    const bookGenreSelect = el("bookGenreSelect");
    for (const [id, pack] of Object.entries(state.genresConfig.genres)) {
      const opt = createNode("option", "", `${pack.title} (${id})`);
      opt.value = id;
      genreSelect.appendChild(opt);
      const optBook = createNode("option", "", `${pack.title} (${id})`);
      optBook.value = id;
      bookGenreSelect.appendChild(optBook);
    }
    genreSelect.addEventListener("change", () => {
      renderGenreMeta();
      runAudit();
    });
    el("variantSelect").addEventListener("change", runAudit);
    bookGenreSelect.addEventListener("change", runBookDoctor);

    // 填充平台导出下拉框
    const platSelect = el("bookPlatformSelect");
    for (const [id, spec] of Object.entries(state.platformsConfig.platforms || {})) {
      const opt = createNode("option", "", `${spec.title} (${id})`);
      opt.value = id;
      platSelect.appendChild(opt);
    }

    // 绑定 Tab 1 样例按钮、体检与改稿 Prompt 复制事件
    const presetContainer = el("auditPresetBtns");
    for (const preset of samples.auditPresets || []) {
      const btn = createNode("button", "chip-btn", preset.label);
      btn.type = "button";
      btn.dataset.presetId = preset.id;
      btn.addEventListener("click", () => applyAuditPreset(preset));
      presetContainer.appendChild(btn);
    }
    el("runAuditBtn").addEventListener("click", runAudit);
    el("normalizeBtn").addEventListener("click", runNormalize);
    el("skipLengthCheck").addEventListener("change", runAudit);
    if (el("goldenThreeCheck")) {
      el("goldenThreeCheck").addEventListener("change", runAudit);
    }
    if (el("aigcGuardCheck")) {
      el("aigcGuardCheck").addEventListener("change", runAudit);
    }
    el("strictModeCheck").addEventListener("change", runAudit);
    let inputTimer = null;
    el("chapterInput").addEventListener("input", () => {
      saveDraftToLocal(el("chapterInput").value);
      if (inputTimer) window.clearTimeout(inputTimer);
      inputTimer = window.setTimeout(runAudit, 320);
    });
    el("copyPromptBtn").addEventListener("click", copyRewritePrompt);
    el("togglePromptBtn").addEventListener("click", () => {
      el("promptDrawer").classList.toggle("open");
    });

    if (samples.auditPresets && samples.auditPresets.length > 0) {
      applyAuditPreset(samples.auditPresets[0]);
    }

    // 初始化 Tab 2 台账打包与健康体检演示
    el("ledgerInput").value = JSON.stringify(samples.packetDemo.ledger, null, 2);
    const packetPresetBtns = el("packetPresetBtns");
    for (const p of samples.packetDemo.presets || []) {
      const btn = createNode("button", "chip-btn", p.label);
      btn.type = "button";
      btn.addEventListener("click", () => {
        el("packetChapterInput").value = String(p.chapter);
        for (const b of packetPresetBtns.querySelectorAll("button")) {
          b.classList.toggle("active", b === btn);
        }
        runPacket();
      });
      packetPresetBtns.appendChild(btn);
    }
    if (packetPresetBtns.firstChild) packetPresetBtns.firstChild.classList.add("active");
    el("runPacketBtn").addEventListener("click", runPacket);
    runPacket();

    // 初始化 Tab 3 审读引文核验演示
    el("reviewChapterInput").value = samples.reviewDemo.chapterText;
    const reviewPresetBtns = el("reviewPresetBtns");
    for (const [key, preset] of Object.entries(samples.reviewDemo.presets || {})) {
      const btn = createNode("button", "chip-btn", preset.label);
      btn.type = "button";
      btn.dataset.reviewKey = key;
      btn.addEventListener("click", () => {
        state.activeReviewPresetKey = key;
        el("reviewJsonInput").value = JSON.stringify(preset.payload, null, 2);
        for (const b of reviewPresetBtns.querySelectorAll("button")) {
          b.classList.toggle("active", b === btn);
        }
        runReviewCheck();
      });
      reviewPresetBtns.appendChild(btn);
    }
    el("reviewJsonInput").value = JSON.stringify(samples.reviewDemo.presets.hallucinated.payload, null, 2);
    if (reviewPresetBtns.firstChild) reviewPresetBtns.firstChild.classList.add("active");
    el("runReviewBtn").addEventListener("click", runReviewCheck);
    runReviewCheck();

    // 初始化 Tab 4 整书多章体检（默认加载 3 章连载示例）
    const loadDemoBook = () => {
      state.bookEntries = (samples.bookDoctorDemo?.chapters || []).map((c) => ({ ...c }));
      el("bookDemoBtn").classList.add("active");
      runBookDoctor();
    };
    el("bookDemoBtn").addEventListener("click", loadDemoBook);
    el("downloadLedgerBtn").addEventListener("click", () => {
      if (!state.lastBookReport) return;
      const msgs = state.samples.uiMessages || {};
      triggerLocalDownload(
        "ledger.json",
        JSON.stringify(state.lastBookReport.suggestedLedger, null, 2) + "\n",
        "application/json;charset=utf-8"
      );
      const notice = el("bookNotice");
      notice.style.display = "block";
      notice.className = "status-banner ok";
      notice.textContent = msgs.bookLedgerDownloaded || "Downloaded ledger.json";
    });
    const formatSubmissionBadge = (exported) => {
      const msgs = state.samples.uiMessages || {};
      return exported.submissionReady
        ? interpolate(msgs.submissionOk || "OK ({min})", { min: exported.submissionMinHan })
        : interpolate(msgs.submissionShort || "-{diff} ({min})", {
            min: exported.submissionMinHan,
            diff: exported.submissionShortfallHan,
          });
    };
    el("exportBookBtn").addEventListener("click", () => {
      if (!state.bookEntries || state.bookEntries.length === 0) return;
      const msgs = state.samples.uiMessages || {};
      const platId = el("bookPlatformSelect").value || "qidian";
      const spec = resolvePlatformConfig(state.platformsConfig, platId);
      const exported = exportChapterEntries(state.bookEntries, spec, state.lingConfig);
      triggerLocalDownload(`inkbone-export-${spec.id}.txt`, exported.mergedText);
      const notice = el("bookNotice");
      notice.style.display = "block";
      notice.className = "status-banner ok";
      notice.textContent = `${interpolate(msgs.bookExportReady || "Exported {count}", {
        platform: spec.title,
        count: exported.chapterCount,
        han: exported.totalHan,
      })} (${formatSubmissionBadge(exported)})`;
    });
    if (el("exportZipBtn")) {
      el("exportZipBtn").addEventListener("click", () => {
        if (!state.bookEntries || state.bookEntries.length === 0) return;
        const msgs = state.samples.uiMessages || {};
        const platId = el("bookPlatformSelect").value || "qidian";
        const spec = resolvePlatformConfig(state.platformsConfig, platId);
        const exported = exportChapterEntries(state.bookEntries, spec, state.lingConfig);
        const entries = exported.chapters.map((ch) => ({
          name: ch.name.replace(/\.md$/iu, ".txt"),
          data: ch.output,
        }));
        entries.push({
          name: `${spec.id}-merged.txt`,
          data: exported.mergedText,
        });
        const zipBytes = buildStoreZipBuffer(entries);
        triggerLocalDownload(
          `inkbone-${spec.id}-chapters.zip`,
          zipBytes,
          "application/zip"
        );
        const notice = el("bookNotice");
        notice.style.display = "block";
        notice.className = "status-banner ok";
        notice.textContent = interpolate(msgs.bookExportZipReady || "ZIP {count}", {
          platform: spec.title,
          count: exported.chapterCount,
          han: exported.totalHan,
          status: formatSubmissionBadge(exported),
        });
      });
    }
    if (el("exportDocxBtn")) {
      el("exportDocxBtn").addEventListener("click", () => {
        if (!state.bookEntries || state.bookEntries.length === 0) return;
        const msgs = state.samples.uiMessages || {};
        const platId = el("bookPlatformSelect").value || "qidian";
        const spec = resolvePlatformConfig(state.platformsConfig, platId);
        const exported = exportChapterEntries(state.bookEntries, spec, state.lingConfig);
        const docxBytes = buildSubmissionDocxBytes(exported, {
          bookTitle: state.lastBookReport?.suggestedLedger?.projectTitle || "",
        });
        triggerLocalDownload(
          `inkbone-${spec.id}-submission.docx`,
          docxBytes,
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        );
        const notice = el("bookNotice");
        notice.style.display = "block";
        notice.className = exported.submissionReady ? "status-banner ok" : "status-banner warn";
        notice.textContent = interpolate(msgs.bookExportDocxReady || "DOCX {count}", {
          platform: spec.title,
          count: exported.chapterCount,
          han: exported.totalHan,
          status: formatSubmissionBadge(exported),
        });
      });
    }
    loadDemoBook();
  } catch (err) {
    const banner = el("loadErrorBanner");
    banner.style.display = "block";
    banner.textContent = `${err.message} — ${state.samples?.uiMessages?.loadError || "Failed to load local engine/configs."}`;
  }
}

init();
