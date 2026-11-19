// InkBone 浏览器静态试跑台主控模块（纯原生 ES Module，无网络上传，无外部依赖，严格零汉字字面量）
import {
  compileGenresConfig,
  compileLinguisticsConfig,
  compileSeverityConfig,
} from "./vendor/core/config-compiler.mjs";
import { auditChapterText } from "./vendor/core/auditor.mjs";
import { normalizeProseText } from "./vendor/core/normalizer.mjs";
import { compileBoundaryPacket } from "./vendor/core/boundary-compiler.mjs";
import { validateEvidenceReview } from "./vendor/core/evidence-validator.mjs";
import { validateLedger } from "./vendor/core/ledger-manager.mjs";
import { buildTargetedRewritePrompt } from "./vendor/core/formatter.mjs";

const state = {
  lingConfig: null,
  genresConfig: null,
  presetsConfig: null,
  severityConfig: null,
  messagesConfig: null,
  samples: null,
  activeAuditPresetId: null,
  activeReviewPresetKey: "hallucinated",
  lastAuditResult: null,
  lastAuditText: "",
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
    // 针对 "previous actor X: snippet" 或普通字面量命中提取精确片段
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

    row.appendChild(createNode("div", "aline-num", lineNo));
    const textCell = createNode("div", "aline-text");
    appendHighlightedLineContent(textCell, lineText, issues, violationSeverityMap);
    row.appendChild(textCell);
    container.appendChild(row);
  });
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

  // 1. 先按行号渲染精准定位命中
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

  // 2. 再渲染整章级维度诊断（按 error -> warning -> info 排序，优先显示中文建议）
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
  const characterNames = parseCharacterList(el("charactersInput").value);
  const protagonistName = el("protagonistInput").value.trim();
  const skipLengthGate = el("skipLengthCheck").checked;
  const strict = el("strictModeCheck").checked;

  const result = auditChapterText(text, {
    genre,
    skipLengthGate,
    strict,
    characterNames,
    ledger: protagonistName ? { protagonist: { name: protagonistName } } : undefined,
    linguisticsConfig: state.lingConfig,
    genresConfig: state.genresConfig,
    presetsConfig: state.presetsConfig,
    severityConfig: state.severityConfig,
  });

  state.lastAuditResult = result;
  state.lastAuditText = text;
  el("promptCopyNotice").style.display = "none";

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
  textarea.addEventListener("dragleave", () => {
    textarea.classList.remove("drag-over");
  });
  textarea.addEventListener("drop", (evt) => {
    evt.preventDefault();
    textarea.classList.remove("drag-over");
    const file = evt.dataTransfer?.files?.[0];
    if (file) handleLocalFileRead(file);
  });
}

async function init() {
  setupTabs();
  setupFileDropAndImport();
  try {
    const [lingRaw, genresRaw, presetsRaw, severityRaw, messagesRaw, samples] =
      await Promise.all([
        fetch("./vendor/configs/zh-linguistics.json").then((r) => r.json()),
        fetch("./vendor/configs/genres.json").then((r) => r.json()),
        fetch("./vendor/configs/presets.json").then((r) => r.json()),
        fetch("./vendor/configs/severity.json").then((r) => r.json()),
        fetch("./vendor/configs/messages.json").then((r) => r.json()),
        fetch("./samples.json").then((r) => r.json()),
      ]);

    state.lingConfig = compileLinguisticsConfig(lingRaw);
    state.genresConfig = compileGenresConfig(genresRaw);
    state.presetsConfig = presetsRaw;
    state.severityConfig = compileSeverityConfig(severityRaw);
    state.messagesConfig = messagesRaw;
    state.samples = samples;

    // 填充题材下拉列表
    const genreSelect = el("genreSelect");
    for (const [id, pack] of Object.entries(state.genresConfig.genres)) {
      const opt = createNode("option", "", `${pack.title} (${id})`);
      opt.value = id;
      genreSelect.appendChild(opt);
    }
    genreSelect.addEventListener("change", () => {
      renderGenreMeta();
      runAudit();
    });

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
    el("strictModeCheck").addEventListener("change", runAudit);
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
    if (packetPresetBtns.firstChild) {
      packetPresetBtns.firstChild.classList.add("active");
    }
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
    const defaultReview = samples.reviewDemo.presets.hallucinated;
    el("reviewJsonInput").value = JSON.stringify(defaultReview.payload, null, 2);
    if (reviewPresetBtns.firstChild) {
      reviewPresetBtns.firstChild.classList.add("active");
    }
    el("runReviewBtn").addEventListener("click", runReviewCheck);
    runReviewCheck();
  } catch (err) {
    const banner = el("loadErrorBanner");
    banner.style.display = "block";
    banner.textContent = `${err.message} — ${state.samples?.uiMessages?.loadError || "Failed to load local engine/configs."}`;
  }
}

init();
