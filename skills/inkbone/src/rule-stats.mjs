import {
  loadGenresConfig,
  loadLinguisticsConfig,
  resolveGenre,
} from "./config-loader.mjs";
import { profileText } from "./profiler.mjs";
import { scanParagraphRuleSet } from "./rule-engine.mjs";

// 判定阈值：人类文本每万字命中达到 tasteMinPer10k 且 AI/人类比值低于 markerMinRatio，视为口味规则
const DEFAULTS = {
  markerMinRatio: 3,
  markerMinAiHits: 3,
  tasteMinPer10k: 1,
  minReliableHumanHan: 20000,
};

// 按审计器同样的顺序合并三层规则，返回带 family 的规则清单
export function collectRuleFamilies(options = {}) {
  const lingConfig = options.linguisticsConfig || loadLinguisticsConfig();
  const genresConfig = loadGenresConfig(options.genresPath);
  const genrePack = options.genre ? resolveGenre(options.genre, options.genresPath) : null;
  const project = options.projectRules || null;
  const disabled = project ? project.disabledRuleIds : new Set();
  const families = {
    cliche: [
      ...lingConfig.compiledRegex.forbiddenCliches,
      ...(genrePack ? genrePack.compiledClicheRules : []),
      ...(project ? project.clicheRules : []),
    ],
    symmetric: [
      ...lingConfig.compiledRegex.symmetricSkeletons,
      ...(project ? project.symmetricSkeletons : []),
    ],
    register: [
      ...(genrePack ? genrePack.compiledRegisterRules : []),
      ...(project ? project.registerRules : []),
    ],
    filler: [
      ...genresConfig.compiledUniversalFillers,
      ...(genrePack ? genrePack.compiledFillerRules : []),
      ...(project ? project.fillerRules : []),
    ],
    rhetorical: [
      ...(lingConfig.compiledRegex.rhetoricalRules || []),
      ...(genrePack ? genrePack.compiledRhetoricalRules || [] : []),
      ...(project ? project.rhetoricalRules || [] : []),
    ],
  };
  const rules = [];
  for (const [family, list] of Object.entries(families)) {
    for (const rule of list) {
      if (!rule || !rule.regex || disabled.has(rule.id)) continue;
      rules.push({ family, rule });
    }
  }
  return { lingConfig, genre: genrePack ? genrePack.id : null, rules };
}

// 统计一组文本里每条规则的命中次数（逐条单独扫描，不做跨规则去重）
function countCorpus(texts, ruleEntries, lingConfig) {
  const counts = new Map();
  let totalHan = 0;
  const scanOpts = {
    quoteMaskRegexes: lingConfig.compiledRegex.quoteMaskRegexes || [],
    quoteMaskChar: lingConfig.tokens.quoteMaskChar || "?",
    visibleCharRegex: lingConfig.compiledRegex.visibleCharGlobal || lingConfig.compiledRegex.hanCharGlobal,
  };
  for (const text of texts) {
    const { metrics, diagnostics } = profileText(text, lingConfig);
    totalHan += metrics.totalHan;
    for (const { rule } of ruleEntries) {
      // tail600 窗口规则在统计时按全文扫描，避免短样本全部落在窗口外
      const scanRule = rule.window === "tail600" ? { ...rule, window: undefined } : rule;
      const hits = scanParagraphRuleSet(diagnostics.paragraphs, [scanRule], scanOpts);
      if (hits.length > 0) counts.set(rule.id, (counts.get(rule.id) || 0) + hits.length);
    }
  }
  return { counts, totalHan };
}

// 对比人类文本与 AI 稿，给每条规则打上 ai-marker / taste / inconclusive / silent 判定
export function computeRuleStats(humanTexts, aiTexts, options = {}) {
  const cfg = { ...DEFAULTS, ...(options.thresholds || {}) };
  const { lingConfig, genre, rules } = collectRuleFamilies(options);
  const human = countCorpus(humanTexts, rules, lingConfig);
  const ai = countCorpus(aiTexts, rules, lingConfig);
  const per10k = (n, han) => (han > 0 ? Math.round((n / han) * 1e5) / 10 : 0);
  const rows = rules.map(({ family, rule }) => {
    const humanHits = human.counts.get(rule.id) || 0;
    const aiHits = ai.counts.get(rule.id) || 0;
    const humanRate = per10k(humanHits, human.totalHan);
    const aiRate = per10k(aiHits, ai.totalHan);
    // 加 0.5 平滑后比较每万字命中率
    const smoothedHuman = ((humanHits + 0.5) / Math.max(human.totalHan, 1)) * 1e4;
    const smoothedAi = ((aiHits + 0.5) / Math.max(ai.totalHan, 1)) * 1e4;
    const ratio = Math.round((smoothedAi / smoothedHuman) * 10) / 10;
    let verdict = "inconclusive";
    if (humanHits === 0 && aiHits === 0) verdict = "silent";
    else if (humanRate >= cfg.tasteMinPer10k && ratio < cfg.markerMinRatio) verdict = "taste";
    else if (ratio >= cfg.markerMinRatio && aiHits >= cfg.markerMinAiHits) verdict = "ai-marker";
    return {
      id: rule.id,
      family,
      layer: rule.layer || "universal",
      humanHits,
      aiHits,
      humanPer10k: humanRate,
      aiPer10k: aiRate,
      ratio,
      verdict,
    };
  });
  const order = { taste: 0, inconclusive: 1, "ai-marker": 2, silent: 3 };
  rows.sort((a, b) => order[a.verdict] - order[b.verdict] || b.humanHits - a.humanHits || b.aiHits - a.aiHits);
  return {
    kind: "inkbone-rule-stats",
    genre,
    human: { docs: humanTexts.length, han: human.totalHan },
    ai: { docs: aiTexts.length, han: ai.totalHan },
    reliable: human.totalHan >= cfg.minReliableHumanHan,
    thresholds: cfg,
    summary: rows.reduce((acc, r) => ({ ...acc, [r.verdict]: (acc[r.verdict] || 0) + 1 }), {}),
    rules: rows,
  };
}

// 把统计结果渲染成 Markdown 表格（默认隐藏 silent 规则）
export function formatRuleStatsMarkdown(stats, options = {}) {
  const shown = stats.rules.filter((r) => options.all || r.verdict !== "silent");
  const lines = [
    `human: ${stats.human.docs} docs / ${stats.human.han} han; ai: ${stats.ai.docs} docs / ${stats.ai.han} han; reliable: ${stats.reliable}`,
    `summary: ${JSON.stringify(stats.summary)}`,
    "",
    "| verdict | rule | family | layer | human hits | ai hits | human /10k | ai /10k | ratio |",
    "| :--- | :--- | :--- | :--- | ---: | ---: | ---: | ---: | ---: |",
    ...shown.map(
      (r) =>
        `| ${r.verdict} | ${r.id} | ${r.family} | ${r.layer} | ${r.humanHits} | ${r.aiHits} | ${r.humanPer10k} | ${r.aiPer10k} | ${r.ratio} |`
    ),
  ];
  return lines.join("\n");
}
