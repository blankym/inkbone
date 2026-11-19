// 零版权风险“安全拆书”风格画像引擎（纯内存、零文件系统依赖，绝不输出任何范文原句）
import { profileText } from "./profiler.mjs";
import { stripSpokenDialogue } from "./rule-engine.mjs";
import { resolveLocaleBundle } from "./formatter.mjs";

const PROFILE_METRICS = [
  "sentLenMean",
  "sentLenCV",
  "flowingSentRatio",
  "ultraShortSentRatio",
  "dePer100Han",
  "longModPerClause",
  "nestedDePer1kHan",
  "mattr50",
  "hapaxRatio",
  "topicAnchorRatio",
  "sentsPerParaMean",
  "paraLenMean",
  "emDashPer1kHan",
  "dialogueCharRatio",
];

// 预设距离匹配所用的核心维度及其归一化尺度
const PRESET_COMPARE_AXES = [
  { metric: "mattr50", gate: "maxMattr50", scale: 0.06 },
  { metric: "sentLenCV", gate: "minSentLenCV", scale: 0.25 },
  { metric: "flowingSentRatio", gate: "minFlowingSentRatio", scale: 0.25 },
  { metric: "ultraShortSentRatio", gate: "minUltraShortSentRatio", scale: 0.12 },
  { metric: "dePer100Han", gate: "maxDePer100Han", scale: 2.0 },
  { metric: "longModPerClause", gate: "maxLongModPerClause", scale: 0.15 },
  { metric: "emDashPer1kHan", gate: "maxEmDashPer1kHan", scale: 0.8 },
];

function quantile(sorted, q) {
  if (!sorted || sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const val = sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  return Math.round(val * 1000) / 1000;
}

function clamp(val, min, max, decimals = 3) {
  const factor = 10 ** decimals;
  return Math.round(Math.max(min, Math.min(max, val)) * factor) / factor;
}

// 计算单篇文本中的对白字符占有效汉字的比例
function computeDialogueCharRatio(text, lingConfig, totalHan) {
  if (!totalHan || totalHan <= 0) return 0;
  const lines = String(text || "").split(/\r?\n/u);
  let spokenTotal = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const info = stripSpokenDialogue(trimmed, lingConfig, " ");
    spokenTotal += info.spokenChars || 0;
  }
  return clamp(spokenTotal / Math.max(totalHan, 1), 0, 1, 3);
}

// 从多篇样本计算纯统计节奏画像、最接近内置预设以及可直接写入 novel.json 的 customGates
export function analyzeStyleProfile(texts, lingConfig, presetsConfig, options = {}) {
  if (!lingConfig || !presetsConfig) {
    throw new Error("lingConfig and presetsConfig are required for analyzeStyleProfile.");
  }
  const cleanTexts = (Array.isArray(texts) ? texts : [texts]).filter(
    (t) => typeof t === "string" && t.trim().length > 0
  );
  if (cleanTexts.length === 0) {
    throw new Error("At least one non-empty text sample is required for style-profile.");
  }

  let totalHan = 0;
  const perSampleMetrics = cleanTexts.map((text) => {
    const prof = profileText(text, lingConfig);
    const m = prof.metrics;
    totalHan += m.totalHan || 0;
    return {
      ...m,
      dialogueCharRatio: computeDialogueCharRatio(text, lingConfig, m.totalHan),
    };
  });

  const metrics = {};
  for (const key of PROFILE_METRICS) {
    const vals = perSampleMetrics
      .map((row) => row[key])
      .filter((v) => typeof v === "number" && Number.isFinite(v))
      .sort((a, b) => a - b);
    if (vals.length === 0) continue;
    metrics[key] = {
      p10: quantile(vals, 0.1),
      median: quantile(vals, 0.5),
      p90: quantile(vals, 0.9),
      min: vals[0],
      max: vals[vals.length - 1],
    };
  }

  // 与全部内置预设做归一化距离比对，找出风格最贴近的基座预设
  const presetEntries = Object.values(presetsConfig.presets || {});
  const presetDistances = presetEntries
    .map((preset) => {
      let sqSum = 0;
      let count = 0;
      for (const axis of PRESET_COMPARE_AXES) {
        const sampleVal = metrics[axis.metric]?.median;
        const gateVal = preset.gates?.[axis.gate];
        if (typeof sampleVal !== "number" || typeof gateVal !== "number") continue;
        const diff = (sampleVal - gateVal) / axis.scale;
        sqSum += diff * diff;
        count += 1;
      }
      const distance = count > 0 ? Math.round(Math.sqrt(sqSum / count) * 1000) / 1000 : 999;
      return { id: preset.id, title: preset.title, distance };
    })
    .sort((a, b) => a.distance - b.distance);

  const nearestPreset = presetDistances[0] || {
    id: presetsConfig.defaultPreset || "modern-clean",
    title: "",
    distance: 0,
  };

  // 基于样本 p10/median/p90 推导带安全缓冲带的 customGates（可直接粘贴进 novel.json）
  const p90Para = metrics.paraLenMean?.p90 ?? 70;
  const p90De = metrics.dePer100Han?.p90 ?? 4.5;
  const p90LongMod = metrics.longModPerClause?.p90 ?? 0.28;
  const p90NestedDe = metrics.nestedDePer1kHan?.p90 ?? 1.5;
  const p90Mattr = metrics.mattr50?.p90 ?? 0.94;
  const p10CV = metrics.sentLenCV?.p10 ?? 0.52;
  const p10Sents = metrics.sentsPerParaMean?.p10 ?? 1.15;
  const p90Sents = metrics.sentsPerParaMean?.p90 ?? 3.2;
  const p90EmDash = metrics.emDashPer1kHan?.p90 ?? 0.6;
  const medDialogue = metrics.dialogueCharRatio?.median ?? 0.25;

  const suggestedGates = {
    maxParagraphHanChars: Math.round(clamp(p90Para * 2.2, 120, 320, 0)),
    minSentLenCV: clamp(p10CV * 0.9, 0.38, 0.72, 2),
    maxDePer100Han: clamp(p90De + 0.6, 3.0, 7.5, 2),
    maxLongModPerClause: clamp(p90LongMod + 0.08, 0.16, 0.5, 2),
    maxNestedDePer1kHan: clamp(p90NestedDe + 0.5, 0.8, 3.5, 2),
    maxMattr50: clamp(p90Mattr + 0.015, 0.86, 0.97, 3),
    minSentsPerPara: clamp(p10Sents * 0.85, 1.0, 2.2, 2),
    maxSentsPerPara: clamp(p90Sents * 1.15, 2.2, 4.5, 2),
    maxEmDashPer1kHan: clamp(p90EmDash + 0.4, 0.4, 2.5, 2),
    maxDialogueDrySpellHan: medDialogue >= 0.3 ? 800 : medDialogue >= 0.15 ? 1000 : 1300,
  };

  // 提炼风格画像标签代码（展示中文由 messages.json 映射）
  const medSent = metrics.sentLenMean?.median ?? 22;
  const medFlow = metrics.flowingSentRatio?.median ?? 0.15;
  const paceTier =
    medSent <= 18 ? "paceFast" : medFlow >= 0.28 || medSent >= 28 ? "paceFlowing" : "paceBalanced";
  const dialogueTier =
    medDialogue >= 0.35 ? "dialogueHigh" : medDialogue >= 0.15 ? "dialogueMedium" : "dialogueLow";
  const medDe = metrics.dePer100Han?.median ?? 4.2;
  const modifierStyle = medDe <= 3.8 ? "modClean" : medDe <= 5.2 ? "modModerate" : "modDense";

  return {
    kind: "inkbone-style-profile",
    label: options.label || "",
    sampleCount: cleanTexts.length,
    totalHan,
    reliable: cleanTexts.length >= 3 && totalHan >= 6000,
    nearestPreset,
    presetDistances: presetDistances.slice(0, 4),
    traits: {
      paceTier,
      dialogueTier,
      modifierStyle,
      dialogueCharRatioMedian: medDialogue,
    },
    metrics,
    suggestedGates,
    novelConfigSnippet: {
      preset: nearestPreset.id,
      customGates: suggestedGates,
    },
  };
}

// 渲染零原文泄露的双语文风画像 Markdown 报告
export function formatStyleProfileMarkdown(profile, options = {}) {
  const { bundle } = resolveLocaleBundle(options.messagesConfig, options.lang);
  const sp = bundle.styleProfile || {};
  const mLabels = bundle.metricLabels || {};

  const lines = [
    sp.title || "# InkBone Style Profile",
    "",
    `- **${sp.samplesLabel || "Samples"}**: ${profile.sampleCount} | **${sp.totalHanLabel || "Total Han"}**: ${profile.totalHan}`,
    `- **${sp.nearestPresetLabel || "Nearest Preset"}**: \`${profile.nearestPreset.id}\` (${profile.nearestPreset.title || ""}) [dist=${profile.nearestPreset.distance}]`,
    `- **${sp.paceLabel || "Pacing"}**: ${sp[profile.traits.paceTier] || profile.traits.paceTier} | **${sp.dialogueLabel || "Dialogue"}**: ${sp[profile.traits.dialogueTier] || profile.traits.dialogueTier} (${Math.round((profile.traits.dialogueCharRatioMedian || 0) * 100)}%) | **${sp.modifierLabel || "Modifiers"}**: ${sp[profile.traits.modifierStyle] || profile.traits.modifierStyle}`,
    "",
    sp.metricsHeading || "## Quantiles (p10 / median / p90)",
    "",
    "| Metric | p10 | median | p90 |",
    "| :--- | ---: | ---: | ---: |",
  ];

  const keyOrder = [
    "sentLenMean",
    "sentLenCV",
    "dePer100Han",
    "mattr50",
    "emDashPer1kHan",
    "paraLenMean",
    "dialogueCharRatio",
  ];
  for (const key of keyOrder) {
    const stat = profile.metrics[key];
    if (!stat) continue;
    const label = mLabels[key] ? `${mLabels[key]} (\`${key}\`)` : `\`${key}\``;
    lines.push(`| ${label} | ${stat.p10} | ${stat.median} | ${stat.p90} |`);
  }

  lines.push(
    "",
    sp.gatesHeading || "## Suggested customGates for novel.json",
    "",
    "```json",
    JSON.stringify(profile.novelConfigSnippet, null, 2),
    "```"
  );

  return lines.join("\n");
}
