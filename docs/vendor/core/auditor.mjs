import {
  resolveGenreFromConfig,
  resolvePresetFromConfig,
} from "./config-compiler.mjs";

// 对照 calibrate 生成的人类参考区间，列出每项指标的位置
function compareWithReference(metrics, reference) {
  const rows = [];
  for (const [key, stat] of Object.entries(reference.metrics || {})) {
    const actual = metrics[key];
    if (typeof actual !== "number") continue;
    let position = "inside";
    if (actual < stat.p10) position = "below_p10";
    else if (actual > stat.p90) position = "above_p90";
    rows.push({ metric: key, actual, p10: stat.p10, median: stat.median, p90: stat.p90, position });
  }
  return {
    sampleCount: reference.sampleCount,
    reliable: Boolean(reference.reliable),
    outside: rows.filter((r) => r.position !== "inside"),
    rows,
  };
}
import { profileText } from "./profiler.mjs";
import { collectCharacterNames, scanSubjectContinuity } from "./continuity.mjs";
import {
  verifyChapterBoundaries,
  computeBoundaryEchoRatio,
} from "./boundary-compiler.mjs";
import {
  scanParagraphRuleSet,
  evaluateHitsWithDensity,
  scanCrossParagraphParallel,
  runDensityTics,
  runDegenerationChecks,
  checkOutlineCopy,
  checkCharCountClaims,
} from "./rule-engine.mjs";

// 统计命中列表里指定 family 的总次数（用于跨规则家族联合密度升级）
function countRuleFamily(hits, rules) {
  const familyById = new Map();
  for (const r of rules || []) {
    if (r && r.id && r.family) familyById.set(r.id, r.family);
  }
  const counts = new Map();
  for (const h of hits || []) {
    const fam = h.family || familyById.get(h.id);
    if (fam) counts.set(fam, (counts.get(fam) || 0) + 1);
  }
  return counts;
}

// 针对输入文本执行预设门禁与题材语域审计，并生成段落级靶向手术指令单
export function auditChapterText(rawContent, options = {}) {
  const lingConfig = options.linguisticsConfig;
  const genresConfig = options.genresConfig;
  const presetsConfig = options.presetsConfig;
  const severity = options.severityConfig;
  if (!lingConfig || !genresConfig || !presetsConfig || !severity) {
    throw new Error(
      "linguisticsConfig, genresConfig, presetsConfig, and severityConfig are required in core auditor."
    );
  }
  const genrePack = options.genre
    ? resolveGenreFromConfig(genresConfig, options.genre)
    : null;
  const effectivePresetName =
    options.presetName || (genrePack ? genrePack.defaultPreset : null);
  const preset = resolvePresetFromConfig(presetsConfig, effectivePresetName);
  const gates = preset.gates;

  // 三层规则合并：通用层 → 题材包 → 书目录项目规则；项目可用 disabledRuleIds 关掉上层规则
  const project = options.projectRules || null;
  const disabled = project ? project.disabledRuleIds : new Set();
  const whitelistLiterals = project?.whitelistLiterals || [];
  const enabled = (rules) => (rules || []).filter((rule) => !disabled.has(rule.id));
  const clicheRules = enabled([
    ...lingConfig.compiledRegex.forbiddenCliches,
    ...(genrePack ? genrePack.compiledClicheRules : []),
    ...(project ? project.clicheRules : []),
  ]);
  const symmetricRules = enabled([
    ...lingConfig.compiledRegex.symmetricSkeletons,
    ...(project ? project.symmetricSkeletons : []),
  ]);
  const registerRules = enabled([
    ...(genrePack ? genrePack.compiledRegisterRules : []),
    ...(project ? project.registerRules : []),
  ]);
  const fillerRules = enabled([
    ...genresConfig.compiledUniversalFillers,
    ...(genrePack ? genrePack.compiledFillerRules : []),
    ...(project ? project.fillerRules : []),
  ]);
  const rhetoricalRules = enabled([
    ...(lingConfig.compiledRegex.rhetoricalRules || []),
    ...(genrePack ? genrePack.compiledRhetoricalRules || [] : []),
    ...(project ? project.rhetoricalRules || [] : []),
  ]);
  const dialogueHygieneRules = enabled([
    ...(lingConfig.compiledRegex.dialogueHygieneRules || []),
  ]);

  const profile = profileText(rawContent, lingConfig, {
    forbiddenCliches: clicheRules,
    symmetricSkeletons: symmetricRules,
    whitelistLiterals,
  });
  const m = profile.metrics;
  const d = profile.diagnostics;

  const scanOpts = {
    totalHan: m.totalHan,
    quoteMaskRegexes: lingConfig.compiledRegex.quoteMaskRegexes || [],
    quoteMaskChar: lingConfig.tokens.quoteMaskChar || lingConfig.tokens.questionMark || "?",
    whitelistLiterals,
    whitelistMaskChar: lingConfig.tokens.whitelistMaskChar || " ",
    visibleCharRegex:
      lingConfig.compiledRegex.visibleCharGlobal ||
      lingConfig.compiledRegex.hanCharGlobal,
    tailWindowChars:
      lingConfig.compiledRegex.densityRules?.tailWindowChars || 600,
  };

  const violations = [];

  // 0a. 扫描所选题材语域防火墙规则（默认扫描全段含对白，支持白名单、密度与必改分级）
  const rawRegisterHits = scanParagraphRuleSet(d.paragraphs, registerRules, scanOpts);
  const regEval = evaluateHitsWithDensity(rawRegisterHits, registerRules, m.totalHan);
  const registerHits = regEval.hits;
  if (registerHits.length > 0) {
    violations.push({
      code: "REGISTER_COLLISION",
      genre: genrePack ? genrePack.id : null,
      count: registerHits.length,
      hits: registerHits,
      forceSeverity: regEval.hasBlocking ? "error" : undefined,
      remedy:
        "Purge out-of-register dialect, storyteller cliches, or period anachronisms to keep narrative voice pure.",
    });
  }

  // 0b. 扫描跨题材通用无效穿插水词（送客寒暄、目的解释尾巴、说书人感叹与过桥胶水词）
  const rawFillerHits = scanParagraphRuleSet(d.paragraphs, fillerRules, scanOpts);
  const fillerEval = evaluateHitsWithDensity(rawFillerHits, fillerRules, m.totalHan);
  const fillerHits = fillerEval.hits;
  if (fillerHits.length > 0) {
    violations.push({
      code: "NARRATIVE_FILLER",
      count: fillerHits.length,
      hits: fillerHits,
      forceSeverity: fillerEval.hasBlocking ? "error" : undefined,
      remedy:
        "Apply Late-In/Early-Out cutting: remove pleasantry exits, purpose hand-holding, and narrator glue.",
    });
  }

  // 0c. 校验连续多个自然段以第三人称代词起头（读着像翻译腔）
  const maxPronounGate =
    gates.maxPronounHeadStreak !== undefined ? gates.maxPronounHeadStreak : 2;
  if (m.maxPronounHeadStreak > maxPronounGate) {
    violations.push({
      code: "PRONOUN_HEAD_STREAK",
      actual: m.maxPronounHeadStreak,
      maxAllowed: maxPronounGate,
      spans: d.pronounStreakSpans,
      remedy:
        "Avoid starting 3+ consecutive paragraphs the same way; vary with a name, a concrete object or sound, but keep the actor clear.",
    });
  }

  // 0c2. 主语连续性：省略主语后可能被读成别人的动作；连续多段用同一种方式起头（需要台账人物名单）
  const { names: characterNames, protagonistNames } = collectCharacterNames(
    options.ledger,
    options.characterNames || []
  );
  const continuity = scanSubjectContinuity(d.paragraphs, lingConfig, {
    names: characterNames,
    protagonistNames,
  });
  if (continuity.ambiguityHits.length > 0) {
    violations.push({
      code: "SUBJECT_AMBIGUITY",
      count: continuity.ambiguityHits.length,
      hits: continuity.ambiguityHits,
      remedy:
        "The previous sentence's subject is another character and this action sentence has no subject; name the actor (or use a pronoun) so the action is not read as the other character's.",
    });
  }
  if (continuity.openingStreaks.length > 0) {
    violations.push({
      code: "OPENING_PATTERN_STREAK",
      count: continuity.openingStreaks.length,
      spans: continuity.openingStreaks,
      remedy:
        "Three or more consecutive paragraphs open the same way (action-then-subject, subjectless action, or the protagonist's name); vary the openings.",
    });
  }

  // 0d. 校验对话标点硬伤（说话人提示语居中误用冒号、句号误落引号外）
  const rawDialogueHits = scanParagraphRuleSet(
    d.paragraphs,
    dialogueHygieneRules,
    scanOpts
  );
  const dialogueEval = evaluateHitsWithDensity(
    rawDialogueHits,
    dialogueHygieneRules,
    m.totalHan
  );
  const dialogueHits = dialogueEval.hits;
  if (dialogueHits.length > 0) {
    violations.push({
      code: "DIALOGUE_PUNCTUATION_ERROR",
      count: dialogueHits.length,
      hits: dialogueHits,
      forceSeverity: dialogueEval.hasBlocking ? "error" : undefined,
      remedy:
        "Fix dialogue attribution punctuation errors (mid-turn colon after comma-closed quote or period placed outside closing quote).",
    });
  }

  // 1. 校验有效汉字字数区间（可选跳过用于短片段基准测试）
  if (!options.skipLengthGate) {
    if (m.totalHan < gates.minHanChars || m.totalHan > gates.maxHanChars) {
      violations.push({
        code: "WORD_COUNT_OUT_OF_RANGE",
        actual: m.totalHan,
        expected: [gates.minHanChars, gates.maxHanChars],
        remedy: "Adjust scene pacing to stay within chapter target length.",
      });
    }
  }

  // 2. 校验自然段最大字数限制
  const oversizedParas = d.paragraphs.filter(
    (p) => p.hanLen > gates.maxParagraphHanChars
  );
  if (oversizedParas.length > 0) {
    violations.push({
      code: "PARAGRAPH_TOO_LONG",
      count: oversizedParas.length,
      lines: oversizedParas.map((p) => ({ line: p.line, hanLen: p.hanLen })),
      remedy: "Split dense walls of text at natural action or gaze shifts.",
    });
  }

  // 2b. 校验单句最大汉字数与逗号上限（抑制机械动作清单长链）
  const maxSentHanGate = gates.maxSentenceHanChars || 90;
  const maxSentCommasGate = gates.maxSentenceCommas || 7;
  const overloadedSentences = (d.sentences || []).filter(
    (s) => s.hanLen > maxSentHanGate || s.commaCount > maxSentCommasGate
  );
  if (overloadedSentences.length > 0) {
    violations.push({
      code: "OVERLOADED_ACTION_CHAIN_SENTENCE",
      count: overloadedSentences.length,
      maxAllowedHan: maxSentHanGate,
      maxAllowedCommas: maxSentCommasGate,
      hits: overloadedSentences,
      remedy:
        "Break 90+ char or 8+ comma mechanical action checklists into crisp sequential sentences with natural breathing pauses.",
    });
  }

  // 2c. 校验单个自然段内的专有名词与复合词全称机械复读（引导零指代省略与简称）
  const maxCompoundRep = gates.maxParagraphCompoundRepeat || 2;
  const maxTwoCharRep = gates.maxParagraphTwoCharRepeat || 3;
  const stuffingViolations = (d.paragraphStuffingScan || []).filter(
    (rec) =>
      rec.bookTitleRepeats.length > 0 ||
      rec.compoundRepeats.some((r) => r.count > maxCompoundRep) ||
      rec.twoCharRepeats.some((r) => r.count > maxTwoCharRep)
  );
  if (stuffingViolations.length > 0) {
    violations.push({
      code: "PARAGRAPH_TERM_STUFFING",
      count: stuffingViolations.length,
      hits: stuffingViolations,
      remedy:
        "Avoid repeating full proper nouns or 3+ char terms 3+ times inside one paragraph; use Chinese zero-anaphora omission or natural short forms.",
    });
  }

  // 2e. 校验全章级口癖短语与器物复合词听觉疲劳复读（豁免台账角色人名与别名）
  if (gates.maxChapterFourGramRepeat || gates.maxChapterThreeGramRepeat) {
    const exemptNames = new Set(characterNames);
    const isNameAdjacent = (term) => {
      for (const name of exemptNames) {
        if (name && (term.includes(name) || name.includes(term))) {
          return true;
        }
      }
      return false;
    };
    const maxChap4 = gates.maxChapterFourGramRepeat || 99;
    const maxChap3 = gates.maxChapterThreeGramRepeat || 99;
    const fatiguedFour = (d.chapterFourGramFreq || []).filter(
      (item) => item.count > maxChap4 && !isNameAdjacent(item.term)
    );
    const fatiguedThree = (d.chapterThreeGramFreq || []).filter(
      (item) => item.count > maxChap3 && !isNameAdjacent(item.term)
    );
    if (fatiguedFour.length > 0 || fatiguedThree.length > 0) {
      violations.push({
        code: "CHAPTER_TERM_FATIGUE",
        fourGramHits: fatiguedFour,
        threeGramHits: fatiguedThree,
        remedy:
          "Avoid repeating 4-char catchphrases (>3x) or 3-char prop/venue full names (>8x) across the chapter; switch to natural short forms after initial anchoring.",
      });
    }
  }

  // 2f. 校验场景开场首句悬空台词（防止首句对白孤立成段缺少说话人锚点）
  if (
    gates.maxFloatingDialogueCount !== undefined &&
    m.floatingDialogueCount > gates.maxFloatingDialogueCount
  ) {
    violations.push({
      code: "FLOATING_OPENING_DIALOGUE",
      count: m.floatingDialogueCount,
      hits: d.floatingDialogueHits,
      remedy:
        "Anchor the first line of a dialogue exchange to a speaker action/beat instead of leaving an isolated quote paragraph.",
    });
  }

  // 2d. 校验连续无对白纯叙述/设定堆砌干涸跨度（融合网文动作-反应留存律与防滑窗静态独白检测）
  const maxDryGate = gates.maxDialogueDrySpellHan || 1200;
  if (m.totalHan >= 1500 && m.maxDialogueDrySpellHan > maxDryGate) {
    const offendingSpans = (d.dialogueDrySpells || []).filter(
      (sp) => sp.hanSpan > maxDryGate
    );
    violations.push({
      code: "EXPOSITION_DIALOGUE_DROUGHT",
      actualMaxSpan: m.maxDialogueDrySpellHan,
      maxAllowedSpan: maxDryGate,
      spans: offendingSpans,
      remedy:
        "Break long static monologue or world-building exposition blocks (>950 chars without spoken interaction) using live action-reaction dialogue beats.",
    });
  }

  // 3. 校验双向词汇熵走廊（MATTR-50、一次性词占比与话题锚定上下界：左防AI塑料换词，右防笔录硬复读）
  if (m.mattr50 > gates.maxMattr50) {
    violations.push({
      code: "HIGH_LEXICAL_ENTROPY_MATTR",
      actual: m.mattr50,
      maxAllowed: gates.maxMattr50,
      remedy:
        "Replace ornate two-char literary verbs/adjectives with plain vernacular verbs instead of rotating fancy synonyms.",
    });
  }
  if (gates.maxHapaxRatio && m.hapaxRatio > gates.maxHapaxRatio) {
    violations.push({
      code: "EXCESSIVE_HAPAX_SYNONYM_CHURN",
      actual: m.hapaxRatio,
      maxAllowed: gates.maxHapaxRatio,
      remedy:
        "Too many one-off literary compounds; strip decorative modifiers and stick to plain conversational diction.",
    });
  }
  if (m.sentenceCount >= 8 && m.topicAnchorRatio < gates.minTopicAnchorRatio) {
    violations.push({
      code: "LOW_TOPIC_ANCHOR_RECURRENCE",
      actual: m.topicAnchorRatio,
      minRequired: gates.minTopicAnchorRatio,
      remedy:
        "Link adjacent sentences via natural vernacular connectors rather than jumping across unrelated literary imagery.",
    });
  }
  if (
    gates.maxTopicAnchorRatio &&
    m.sentenceCount >= 8 &&
    m.topicAnchorRatio > gates.maxTopicAnchorRatio
  ) {
    violations.push({
      code: "EXCESSIVE_TOPIC_ANCHOR_STUFFING",
      actual: m.topicAnchorRatio,
      maxAllowed: gates.maxTopicAnchorRatio,
      remedy:
        "Stop repeating full nouns in every sentence like a police transcript; use Chinese subject/object omission and pronoun 'ta'.",
    });
  }

  // 4. 校验双峰呼吸突发度（句长变异系数 CV、竹节长句占比与冷峻极短句占比）
  if (m.sentenceCount >= 8 && m.sentLenCV < gates.minSentLenCV) {
    violations.push({
      code: "FLAT_BURSTINESS_CV",
      actual: m.sentLenCV,
      minRequired: gates.minSentLenCV,
      remedy:
        "Interleave crisp <=10-char cuts with 4-7 comma bamboo-joint serial sentences to break uniform sentence length.",
    });
  }
  if (m.sentenceCount >= 8 && m.flowingSentRatio < gates.minFlowingSentRatio) {
    violations.push({
      code: "INSUFFICIENT_FLOWING_PARATAXIS",
      actual: m.flowingSentRatio,
      minRequired: gates.minFlowingSentRatio,
      remedy:
        "Merge choppy 2-clause sentences into subject-omitted serial verb chains with 4+ commas.",
    });
  }
  if (
    m.sentenceCount >= 8 &&
    m.ultraShortSentRatio < gates.minUltraShortSentRatio
  ) {
    violations.push({
      code: "INSUFFICIENT_ULTRA_SHORT_CUTS",
      actual: m.ultraShortSentRatio,
      minRequired: gates.minUltraShortSentRatio,
      remedy:
        "Insert brisk <=10-char kinetic beats or stark observations at turning points.",
    });
  }
  if (d.monotonousWindows.length > 0) {
    violations.push({
      code: "MONOTONOUS_CADENCE_WINDOW",
      windows: d.monotonousWindows,
      remedy:
        "Rewrite monotonous 6-sentence spans where sentence lengths cluster tightly.",
    });
  }

  // 5. 校验欧化左分支定语密度与嵌套“的”链
  if (m.dePer100Han > gates.maxDePer100Han) {
    violations.push({
      code: "EXCESSIVE_DE_MODIFIER_DENSITY",
      actual: m.dePer100Han,
      maxAllowed: gates.maxDePer100Han,
      remedy:
        "Unpack pre-nominal 'X-de-Noun' modifiers into post-verbal clauses or plain bare nouns.",
    });
  }
  if (m.longModPerClause > gates.maxLongModPerClause) {
    violations.push({
      code: "HEAVY_LEFT_BRANCHING_MODIFIERS",
      actual: m.longModPerClause,
      maxAllowed: gates.maxLongModPerClause,
      sampleHits: d.longModifierHits.slice(0, 8),
      remedy:
        "Break >=7-char pre-de modifier chains into sequential bamboo-joint clauses.",
    });
  }
  if (m.nestedDePer1kHan > gates.maxNestedDePer1kHan) {
    violations.push({
      code: "NESTED_DE_CHAINS",
      actual: m.nestedDePer1kHan,
      maxAllowed: gates.maxNestedDePer1kHan,
      hits: d.nestedDeHits.slice(0, 8),
      remedy: "Eliminate nested 'A-de-B-de-C' structures.",
    });
  }

  // 6. 校验标点代劳语法、修辞反问、对称骨架与禁用雕花词
  if (m.emDashPer1kHan > gates.maxEmDashPer1kHan) {
    violations.push({
      code: "EM_DASH_OVERUSE",
      actual: m.emDashPer1kHan,
      maxAllowed: gates.maxEmDashPer1kHan,
      hits: d.emDashHits,
      remedy: "Replace narrative em-dashes with commas or direct clauses.",
    });
  }
  if (m.rhetoricalQuestionCount > gates.maxRhetoricalQuestionCount) {
    violations.push({
      code: "NARRATIVE_RHETORICAL_QUESTIONS",
      actual: m.rhetoricalQuestionCount,
      maxAllowed: gates.maxRhetoricalQuestionCount,
      hits: d.rhetoricalQuestionHits,
      remedy:
        "Convert paragraph-ending rhetorical questions into plain causal statements.",
    });
  }
  // 6b. 评估对称骨架与AI雕花套话密度/必改分级（与反序对比共享 not_is 家族计数）
  const rawRhetHits = scanParagraphRuleSet(d.paragraphs, rhetoricalRules, scanOpts);
  const crossCfg = lingConfig.compiledRegex.crossParagraphParallel;
  const crossHits =
    crossCfg && !disabled.has(crossCfg.id)
      ? scanCrossParagraphParallel(d.paragraphs, crossCfg, scanOpts)
      : [];

  const symFamCounts = countRuleFamily(d.symmetricHits, symmetricRules);
  const rhetFamCounts = countRuleFamily(rawRhetHits, rhetoricalRules);
  const symEval = evaluateHitsWithDensity(
    d.symmetricHits,
    symmetricRules,
    m.totalHan,
    rhetFamCounts
  );
  const rhetEval = evaluateHitsWithDensity(
    rawRhetHits,
    rhetoricalRules,
    m.totalHan,
    symFamCounts
  );
  const combinedRhetHits = [...rhetEval.hits, ...crossHits];

  const clicheEval = evaluateHitsWithDensity(d.clicheHits, clicheRules, m.totalHan);
  const activeClicheHits = clicheEval.hits;

  if (symEval.hits.length > gates.maxSymmetricSkeletonCount || symEval.hasBlocking) {
    violations.push({
      code: "MECHANICAL_SYMMETRIC_SKELETON",
      actual: symEval.hits.length,
      maxAllowed: gates.maxSymmetricSkeletonCount,
      hits: symEval.hits,
      forceSeverity: symEval.hasBlocking ? "error" : undefined,
      remedy:
        "Dismantle 'not A, but B' / 'seemingly X, actually Y' contrastive frames.",
    });
  }
  if (combinedRhetHits.length > 0) {
    violations.push({
      code: "RHETORICAL_AI_PATTERN",
      count: combinedRhetHits.length,
      hits: combinedRhetHits,
      forceSeverity: rhetEval.hasBlocking ? "error" : undefined,
      remedy:
        "Remove volume-contrast, negation-parade, reverse-not-is, or chapter-trailer summary patterns in narration.",
    });
  }
  if (activeClicheHits.length > 0) {
    violations.push({
      code: "FORBIDDEN_AI_CLICHE",
      count: activeClicheHits.length,
      hits: activeClicheHits,
      forceSeverity: clicheEval.hasBlocking ? "error" : undefined,
      remedy:
        "Remove AI micro-acting cliches, purple-prose verbs, and modern slang.",
    });
  }

  // 6c. 密度型文风探针（微动作、套式反应、动作清单、引号强调、电报体反向守卫等）
  const densityTics = runDensityTics(
    d.paragraphs,
    lingConfig,
    whitelistLiterals,
    disabled
  );
  if (densityTics.length > 0) {
    violations.push({
      code: "PROSE_DENSITY_TIC",
      count: densityTics.length,
      hits: densityTics,
      remedy:
        "Review density-flagged prose habits (micro-actions, stock reactions, quote emphasis, or telegraphic over-compression) in context.",
    });
  }

  // 6d. 模型退化与工程词泄漏检测（复读、截断、AI自指、Tier1/Tier2 工程词）
  const { degenerationHits, metaLeakHits } = runDegenerationChecks(
    rawContent,
    lingConfig,
    whitelistLiterals,
    disabled
  );
  if (degenerationHits.length > 0) {
    violations.push({
      code: "DEGENERATION_DETECTED",
      count: degenerationHits.length,
      hits: degenerationHits,
      forceSeverity: "error",
      remedy:
        "Fix hard model degeneration artifacts (verbatim loops, truncated ending, garbled chars, or AI refusal placeholders).",
    });
  }
  if (metaLeakHits.length > 0) {
    const hasTier1 = metaLeakHits.some((h) => h.level === "blocking");
    violations.push({
      code: "ENGINEERING_META_LEAK",
      count: metaLeakHits.length,
      hits: metaLeakHits,
      forceSeverity: hasTier1 ? "error" : undefined,
      remedy:
        "Purge outline/chapter engineering terms from novel prose; replace with in-world sensory time/event anchors.",
    });
  }

  if (m.formattingArtifactCount > 0) {
    violations.push({
      code: "FORMATTING_OR_LEDGER_ARTIFACTS",
      count: m.formattingArtifactCount,
      bracketNotes: d.bracketNoteHits,
      asterisks: d.asteriskHits,
      remedy: "Strip markdown asterisks and inline ledger parentheticals.",
    });
  }

  // 7. 校验段落句数聚拢度与“一句一段”机器排版连击
  if (
    m.paragraphCount >= 6 &&
    (m.sentsPerParaMean < gates.minSentsPerPara ||
      m.sentsPerParaMean > gates.maxSentsPerPara)
  ) {
    violations.push({
      code: "UNNATURAL_PARAGRAPH_DENSITY",
      actual: m.sentsPerParaMean,
      expected: [gates.minSentsPerPara, gates.maxSentsPerPara],
      remedy:
        "Group related narrative actions into 2-3 sentence paragraphs while reserving 1-sentence paragraphs for sharp beats.",
    });
  }
  if (m.maxSingleSentParaStreak > gates.maxSingleSentParaStreak) {
    violations.push({
      code: "SINGLE_SENTENCE_PARAGRAPH_STREAK",
      actual: m.maxSingleSentParaStreak,
      maxAllowed: gates.maxSingleSentParaStreak,
      remedy:
        "Break robotic one-sentence-per-line formatting by merging continuous action beats.",
    });
  }

  // 8. 若提供全书台账，联合执行硬边界、防剧透与必达锚点核验
  let boundaryReport = null;
  if (options.ledger && options.chapterNumber) {
    boundaryReport = verifyChapterBoundaries(
      rawContent,
      options.ledger,
      options.chapterNumber,
      options.previousChapterText || "",
      lingConfig
    );
    if (boundaryReport.boundaryEchoRatio > gates.maxBoundaryEchoRatio) {
      violations.push({
        code: "PREVIOUS_ENDING_ECHO",
        actual: boundaryReport.boundaryEchoRatio,
        maxAllowed: gates.maxBoundaryEchoRatio,
        remedy:
          "Advance directly from the prior chapter's final state without replaying its closing lines.",
      });
    }
    if (!boundaryReport.pass) {
      violations.push({
        code: "LEDGER_BOUNDARY_VIOLATION",
        details: boundaryReport,
        remedy:
          "Fix missing required anchors, remove future spoilers, or purge deprecated character names.",
      });
    }
  } else if (
    options.previousChapterText &&
    options.previousChapterText.trim().length > 0
  ) {
    const echoRatio = computeBoundaryEchoRatio(
      rawContent,
      options.previousChapterText,
      lingConfig
    );
    if (echoRatio > gates.maxBoundaryEchoRatio) {
      violations.push({
        code: "PREVIOUS_ENDING_ECHO",
        actual: echoRatio,
        maxAllowed: gates.maxBoundaryEchoRatio,
        remedy:
          "Advance directly from the prior chapter's final state without replaying its closing lines.",
      });
    }
  }

  // 9. 若提供本章细纲文本，执行防抄纲重叠检测
  let outlineCopyReport = null;
  if (options.outlineText) {
    outlineCopyReport = checkOutlineCopy(rawContent, options.outlineText, {
      lingConfig,
      minRun: options.outlineMinRun,
      exemptPhrases: options.outlineExemptPhrases,
    });
    if (!outlineCopyReport.pass) {
      violations.push({
        code: "OUTLINE_COPY_DETECTED",
        overlapCount: outlineCopyReport.overlapCount,
        minRun: outlineCopyReport.minRun,
        hits: outlineCopyReport.hits.slice(0, 12),
        remedy:
          "Render beats with sensory actions and dialogue instead of copying outline prose verbatim.",
      });
    }
  }

  // 10. 校验相邻引号的“短短 X 字 / 这 X 个字”字面字数宣称与实字数是否穿帮
  const charCountHits = disabled.has("char_count_claim_mismatch")
    ? []
    : checkCharCountClaims(rawContent, lingConfig, whitelistLiterals);
  if (charCountHits.length > 0) {
    violations.push({
      code: "CHAR_COUNT_CLAIM_MISMATCH",
      count: charCountHits.length,
      hits: charCountHits,
      remedy:
        "Align stated character count with the actual characters inside the adjacent quotation.",
    });
  }

  // 汇总需要局部动刀的精确行号手术单（供 Stage 4 qu-ai-wei 靶向手术刀消费）
  const surgeryLineMap = new Map();
  const registerLineIssue = (line, tag, detail, meta = null) => {
    if (!line) return;
    const existing = surgeryLineMap.get(line) || [];
    const entry = { tag, detail };
    if (meta?.layer) entry.layer = meta.layer;
    if (meta?.level) entry.level = meta.level;
    if (meta?.review) entry.review = meta.review;
    existing.push(entry);
    surgeryLineMap.set(line, existing);
  };

  registerHits.forEach((h) => registerLineIssue(h.line, h.id, h.matched, h));
  fillerHits.forEach((h) => registerLineIssue(h.line, h.id, h.matched, h));
  dialogueHits.forEach((h) => registerLineIssue(h.line, h.id, h.matched, h));
  if (m.maxPronounHeadStreak > maxPronounGate) {
    (d.pronounStreakSpans || []).forEach((sp) =>
      registerLineIssue(
        sp.startLine,
        "pronoun_head_streak",
        `${sp.streak} consecutive pronoun-initial paragraphs (lines ${sp.startLine}-${sp.endLine})`
      )
    );
  }
  continuity.ambiguityHits.forEach((h) =>
    registerLineIssue(
      h.line,
      "subject_ambiguity",
      `previous actor ${h.previousActor}: ${h.current}`
    )
  );
  continuity.openingStreaks.forEach((sp) =>
    registerLineIssue(
      sp.startLine,
      "opening_pattern_streak",
      `${sp.streak} consecutive ${sp.kind} openings (lines ${sp.startLine}-${sp.endLine})`
    )
  );
  activeClicheHits.forEach((h) => registerLineIssue(h.line, h.id, h.matched, h));
  d.emDashHits.forEach((h) => registerLineIssue(h.line, "em_dash", h.preview));
  d.rhetoricalQuestionHits.forEach((h) =>
    registerLineIssue(h.line, "rhetorical_question", h.preview)
  );
  symEval.hits.forEach((h) => registerLineIssue(h.line, h.id, h.matched, h));
  combinedRhetHits.forEach((h) =>
    registerLineIssue(h.line, h.id, h.matched, h)
  );
  densityTics.forEach((t) =>
    registerLineIssue(
      t.line,
      t.id,
      `${t.hits}x${t.perKilo ? ` (${t.perKilo}/1k)` : ""}: ${(t.samples || []).slice(0, 4).join(" / ")}`,
      t
    )
  );
  degenerationHits.forEach((h) =>
    registerLineIssue(h.line, h.id, h.matched, h)
  );
  metaLeakHits.forEach((h) => registerLineIssue(h.line, h.id, h.matched, h));
  d.nestedDeHits.forEach((h) =>
    registerLineIssue(h.line, "nested_de", h.matched)
  );
  oversizedParas.forEach((p) =>
    registerLineIssue(p.line, "oversized_paragraph", `${p.hanLen} chars`)
  );
  if (
    gates.maxFloatingDialogueCount !== undefined &&
    m.floatingDialogueCount > gates.maxFloatingDialogueCount
  ) {
    (d.floatingDialogueHits || []).forEach((h) =>
      registerLineIssue(h.line, "floating_opening_dialogue", h.preview)
    );
  }
  overloadedSentences.forEach((s) =>
    registerLineIssue(
      s.line,
      "overloaded_sentence",
      `${s.hanLen} chars / ${s.commaCount} commas: ${s.preview}`
    )
  );
  stuffingViolations.forEach((rec) => {
    const summary = [
      ...rec.bookTitleRepeats.map((r) => `${r.term}x${r.count}`),
      ...rec.compoundRepeats.map((r) => `${r.term}x${r.count}`),
      ...rec.twoCharRepeats.map((r) => `${r.term}x${r.count}`),
    ].join(", ");
    registerLineIssue(rec.line, "paragraph_term_stuffing", summary);
  });
  if (m.totalHan >= 1500 && m.maxDialogueDrySpellHan > maxDryGate) {
    (d.dialogueDrySpells || [])
      .filter((sp) => sp.hanSpan > maxDryGate)
      .forEach((sp) =>
        registerLineIssue(
          sp.startLine,
          "exposition_dialogue_drought",
          `${sp.hanSpan} chars without spoken dialogue (lines ${sp.startLine}-${sp.endLine})`
        )
      );
  }
  if (outlineCopyReport && !outlineCopyReport.pass) {
    outlineCopyReport.hits.forEach((h) =>
      registerLineIssue(
        h.line,
        "outline_copy",
        `${h.length} chars verbatim from outline line ${h.outlineLine}: ${h.matched.slice(0, 24)}`,
        { layer: "universal", level: "advisory", review: "mechanical" }
      )
    );
  }
  (d.bracketNoteHits || []).forEach((h) =>
    registerLineIssue(h.line, "ledger_bracket_note", h.matched, {
      layer: "universal",
      level: "blocking",
      review: "mechanical",
    })
  );
  (d.asteriskHits || []).forEach((h) =>
    registerLineIssue(h.line, "markdown_asterisk", h.preview || "*", {
      layer: "universal",
      level: "blocking",
      review: "mechanical",
    })
  );
  charCountHits.forEach((h) =>
    registerLineIssue(
      h.line,
      "char_count_mismatch",
      `${h.claimed} vs actual ${h.actual}: ${h.matched}`,
      { layer: "universal", level: "blocking", review: "mechanical" }
    )
  );

  const surgeryTargets = Array.from(surgeryLineMap.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([line, issues]) => ({ line, issues }));

  // 给每条违规标注分级；默认只有 error（blocking）判失败，strict 模式下任何违规都判失败
  for (const v of violations) {
    v.severity =
      v.forceSeverity || severity.byCode.get(v.code) || severity.defaultLevel;
    v.level =
      v.severity === "error"
        ? "blocking"
        : v.severity === "warning"
          ? "advisory"
          : "info";
    delete v.forceSeverity;
  }
  const countBy = (level) => violations.filter((v) => v.severity === level).length;
  const summary = {
    error: countBy("error"),
    warning: countBy("warning"),
    info: countBy("info"),
  };
  const strict = Boolean(options.strict);
  const pass = strict ? violations.length === 0 : summary.error === 0;

  // 若提供人类参考区间，标出落在区间外的统计指标（只作对照，不判失败）
  const referenceComparison = options.reference
    ? compareWithReference(m, options.reference)
    : null;

  return {
    pass,
    mode: strict ? "strict" : "default",
    genre: genrePack ? genrePack.id : null,
    preset: preset.id,
    summary,
    metrics: m,
    referenceComparison,
    boundaryReport,
    outlineCopyReport,
    violationCount: violations.length,
    violations,
    surgeryTargets,
  };
}
