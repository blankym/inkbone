// 纯内存配置编译模块（零文件系统依赖，供 Node 端与浏览器静态试跑页共用）

// 把规则数组预编译为全局正则，并标注规则所属层级（universal / genre / project）
export function compileRules(rules, layer, defaultScope = "all") {
  return (rules || []).map((rule) => ({
    ...rule,
    layer,
    scope: rule.scope || defaultScope,
    window: rule.window || "all",
    regex: new RegExp(rule.pattern, "gu"),
    prevExcludeSet: rule.prevExcludeChars ? new Set(rule.prevExcludeChars) : null,
    affirmationParticleSet: rule.affirmationParticles
      ? new Set(rule.affirmationParticles)
      : null,
    affirmationBoundarySet: rule.affirmationBoundaries
      ? new Set(rule.affirmationBoundaries)
      : null,
    nextIgnoreRegexObj: rule.nextIgnoreRegex
      ? new RegExp(rule.nextIgnoreRegex, "u")
      : null,
  }));
}

// 预编译修辞密度与模型退化检测配置的正则表达式
function compileAuxiliaryRules(raw) {
  const densityRaw = raw.densityRules || {};
  const compiledDensity = {
    tailWindowChars: densityRaw.tailWindowChars || 600,
    microActionTic: densityRaw.microActionTic
      ? {
          ...densityRaw.microActionTic,
          regex: new RegExp(densityRaw.microActionTic.pattern, "gu"),
        }
      : null,
    stockReactionTic: densityRaw.stockReactionTic
      ? {
          ...densityRaw.stockReactionTic,
          regexes: (densityRaw.stockReactionTic.patterns || []).map(
            (p) => new RegExp(p, "gu")
          ),
        }
      : null,
    actionListTic: densityRaw.actionListTic
      ? {
          ...densityRaw.actionListTic,
          verbRegex: new RegExp(densityRaw.actionListTic.verbPattern, "gu"),
          separatorRegex: new RegExp(
            densityRaw.actionListTic.separatorPattern,
            "gu"
          ),
        }
      : null,
    quoteEmphasisTic: densityRaw.quoteEmphasisTic
      ? {
          ...densityRaw.quoteEmphasisTic,
          speechVerbRegex: new RegExp(
            densityRaw.quoteEmphasisTic.speechVerbPattern,
            "u"
          ),
          punctuationInsideRegex: new RegExp(
            densityRaw.quoteEmphasisTic.punctuationInsidePattern,
            "u"
          ),
          onomatopoeiaSuffixRegex: new RegExp(
            densityRaw.quoteEmphasisTic.onomatopoeiaSuffixPattern,
            "u"
          ),
        }
      : null,
    metaphorDensityTic: densityRaw.metaphorDensityTic
      ? {
          ...densityRaw.metaphorDensityTic,
          markerRegex: new RegExp(densityRaw.metaphorDensityTic.markerPattern, "gu"),
          likePhraseRegex: new RegExp(
            densityRaw.metaphorDensityTic.likePhrasePattern,
            "gu"
          ),
          prefixGuardRegex: new RegExp(
            densityRaw.metaphorDensityTic.prefixGuardPattern,
            "u"
          ),
        }
      : null,
    abstractSummaryTic: densityRaw.abstractSummaryTic
      ? {
          ...densityRaw.abstractSummaryTic,
          regexes: (densityRaw.abstractSummaryTic.patterns || []).map(
            (p) => new RegExp(p, "gu")
          ),
        }
      : null,
    reasoningChainTic: densityRaw.reasoningChainTic
      ? {
          ...densityRaw.reasoningChainTic,
          compiledPatterns: (densityRaw.reasoningChainTic.patterns || []).map(
            (item) => ({
              ...item,
              regex: new RegExp(item.pattern, "gu"),
            })
          ),
        }
      : null,
    ellipsisDensityTic: densityRaw.ellipsisDensityTic
      ? {
          ...densityRaw.ellipsisDensityTic,
          regex: new RegExp(densityRaw.ellipsisDensityTic.pattern, "gu"),
        }
      : null,
    exclamationDensityTic: densityRaw.exclamationDensityTic
      ? {
          ...densityRaw.exclamationDensityTic,
          regex: new RegExp(densityRaw.exclamationDensityTic.pattern, "gu"),
        }
      : null,
    exclamationStackTic: densityRaw.exclamationStackTic
      ? {
          ...densityRaw.exclamationStackTic,
          regex: new RegExp(densityRaw.exclamationStackTic.pattern, "gu"),
        }
      : null,
    overcompressedProseTic: densityRaw.overcompressedProseTic
      ? {
          ...densityRaw.overcompressedProseTic,
          particleRegex: new RegExp(
            densityRaw.overcompressedProseTic.particlePattern,
            "gu"
          ),
          panelLineRegex: new RegExp(
            densityRaw.overcompressedProseTic.panelLinePattern,
            "u"
          ),
        }
      : null,
    lowConnectiveDensityTic: densityRaw.lowConnectiveDensityTic || null,
    dialogueOnlyStreakTic: densityRaw.dialogueOnlyStreakTic
      ? {
          ...densityRaw.dialogueOnlyStreakTic,
          quoteLineRegex: new RegExp(
            densityRaw.dialogueOnlyStreakTic.quoteLinePattern,
            "u"
          ),
        }
      : null,
  };

  const degenRaw = raw.degeneration || {};
  const compiledDegeneration = degenRaw.placeholderRules
    ? {
        ...degenRaw,
        sentenceSplitRegex: new RegExp(degenRaw.sentenceSplitRegex, "u"),
        chapterHeadingRegex: new RegExp(degenRaw.chapterHeadingRegex, "u"),
        endSignoffRegex: new RegExp(degenRaw.endSignoffRegex, "iu"),
        dividerRegex: new RegExp(degenRaw.dividerRegex, "u"),
        trailingMarkdownStripRegex: new RegExp(
          degenRaw.trailingMarkdownStripRegex,
          "u"
        ),
        terminalPunctuationRegex: new RegExp(
          degenRaw.terminalPunctuationRegex,
          "u"
        ),
        placeholderRules: (degenRaw.placeholderRules || []).map((rule) => ({
          ...rule,
          layer: "universal",
          regex: new RegExp(rule.pattern, "u"),
        })),
        metaLeakTier1Regex: degenRaw.metaLeakTier1Pattern
          ? new RegExp(degenRaw.metaLeakTier1Pattern, "gu")
          : null,
        metaLeakTier2Regex: degenRaw.metaLeakTier2Pattern
          ? new RegExp(degenRaw.metaLeakTier2Pattern, "gu")
          : null,
      }
    : null;

  const crossRaw = raw.crossParagraphParallel || null;
  const compiledCrossParallel = crossRaw
    ? {
        ...crossRaw,
        startRegexObj: new RegExp(crossRaw.startRegex, "u"),
        middleRegexObj: new RegExp(crossRaw.middleRegex, "u"),
        endRegexObj: new RegExp(crossRaw.endRegex, "u"),
      }
    : null;

  const charExtRaw = raw.characterExtraction || null;
  const compiledCharExtraction = charExtRaw
    ? {
        ...charExtRaw,
        surnameSet: new Set(charExtRaw.commonSurnames || []),
        compoundSurnames: [...(charExtRaw.compoundSurnames || [])].sort(
          (a, b) => b.length - a.length
        ),
        titleSuffixes: [...(charExtRaw.titleSuffixes || [])].sort(
          (a, b) => b.length - a.length
        ),
        stopwordSet: new Set([
          ...(raw.commonTwoCharStopwords || []),
          ...(charExtRaw.nonPersonStopwords || []),
        ]),
        speechActionRegex:
          charExtRaw.boundaryLeadPattern && charExtRaw.speechActionPattern
            ? new RegExp(
                `${charExtRaw.boundaryLeadPattern}([\\p{Script=Han}]{2,4})(?=${charExtRaw.speechActionPattern})`,
                "gu"
              )
            : null,
      }
    : null;

  return {
    compiledDensity,
    compiledDegeneration,
    compiledCrossParallel,
    compiledCharExtraction,
  };
}

// 从解析后的 JSON 对象编译中文计算语言学配置与正则表达式
export function compileLinguisticsConfig(raw) {
  const aux = compileAuxiliaryRules(raw);
  return {
    ...raw,
    compiledRegex: {
      hanCharGlobal: new RegExp(raw.regex.hanChar, "gu"),
      visibleCharGlobal: raw.regex.visibleChar
        ? new RegExp(raw.regex.visibleChar, "gu")
        : new RegExp(raw.regex.hanChar, "gu"),
      sentenceDelimiter: new RegExp(raw.regex.sentenceDelimiter, "u"),
      quoteCharsGlobal: new RegExp(raw.regex.quoteChars, "gu"),
      dialogueSpanGlobal: new RegExp(raw.regex.dialogueSpan, "gu"),
      cornerQuoteDialogue: raw.regex.cornerQuoteDialogue
        ? {
            cornerChars: new Set(raw.regex.cornerQuoteDialogue.cornerChars || []),
            innerPunctRegex: raw.regex.cornerQuoteDialogue.innerPunctPattern
              ? new RegExp(raw.regex.cornerQuoteDialogue.innerPunctPattern, "u")
              : null,
            leadSpeechRegex: raw.regex.cornerQuoteDialogue.leadSpeechPattern
              ? new RegExp(raw.regex.cornerQuoteDialogue.leadSpeechPattern, "u")
              : null,
          }
        : null,
      quoteMaskRegexes: (raw.regex.quoteMaskPatterns || []).map(
        (p) => new RegExp(p, "gu")
      ),
      unclosedQuoteStart: raw.regex.unclosedQuoteStart
        ? new RegExp(raw.regex.unclosedQuoteStart, "u")
        : null,
      nonDialogueRhetoricalQuestion: new RegExp(
        raw.regex.nonDialogueRhetoricalQuestion,
        "u"
      ),
      nestedDeChainGlobal: new RegExp(raw.regex.nestedDeChain, "gu"),
      ledgerBracketNoteGlobal: new RegExp(raw.regex.ledgerBracketNote, "gu"),
      bookTitleTermGlobal: new RegExp(raw.regex.bookTitleTerm, "gu"),
      pronounHeadLine: raw.regex.pronounHeadLine
        ? new RegExp(raw.regex.pronounHeadLine, "u")
        : null,
      clauseSplitterForNgram: new RegExp(raw.regex.clauseSplitterForNgram, "u"),
      quantifierNoiseFragment: new RegExp(
        raw.regex.quantifierNoiseFragment,
        "u"
      ),
      twoCharStopwordSet: new Set(raw.commonTwoCharStopwords || []),
      forbiddenCliches: compileRules(
        raw.forbiddenCliches,
        "universal",
        "narration"
      ),
      symmetricSkeletons: compileRules(
        raw.symmetricSkeletons,
        "universal",
        "narration"
      ),
      rhetoricalRules: compileRules(
        raw.rhetoricalRules,
        "universal",
        "narration"
      ),
      dialogueHygieneRules: compileRules(
        raw.dialogueHygieneRules,
        "universal",
        "all"
      ),
      crossParagraphParallel: aux.compiledCrossParallel,
      densityRules: aux.compiledDensity,
      degeneration: aux.compiledDegeneration,
      characterExtraction: aux.compiledCharExtraction,
    },
  };
}

// 从解析后的 JSON 对象编译多题材语域防火墙配置
export function compileGenresConfig(raw) {
  const compiledUniversalFillers = compileRules(
    raw.universalFillerRules,
    "universal",
    "all"
  );

  const compiledGenres = {};
  for (const [id, pack] of Object.entries(raw.genres || {})) {
    compiledGenres[id] = {
      ...pack,
      compiledRegisterRules: compileRules(pack.registerRules, "genre", "all"),
      compiledClicheRules: compileRules(
        pack.clicheRules,
        "genre",
        "narration"
      ),
      compiledFillerRules: compileRules(pack.fillerRules, "genre", "all"),
      compiledRhetoricalRules: compileRules(
        pack.rhetoricalRules,
        "genre",
        "narration"
      ),
    };
  }

  return {
    ...raw,
    compiledUniversalFillers,
    genres: compiledGenres,
  };
}

// 从解析后的 JSON 对象编译违规码分级映射
export function compileSeverityConfig(raw) {
  const byCode = new Map();
  for (const [level, codes] of Object.entries(raw.levels || {})) {
    for (const code of codes) byCode.set(code, level);
  }
  return { byCode, defaultLevel: raw.defaultLevel || "warning" };
}

// 从已编译的题材配置对象中解析指定题材包
export function resolveGenreFromConfig(genresConfig, genreName) {
  const key = genreName || genresConfig.defaultGenre;
  const pack = genresConfig.genres[key];
  if (!pack) {
    const validKeys = Object.keys(genresConfig.genres).join(", ");
    throw new Error(`Unknown genre "${key}". Available genres: ${validKeys}`);
  }
  return pack;
}

// 从预设配置对象中解析指定阈值预设
export function resolvePresetFromConfig(presetsConfig, presetName) {
  const key = presetName || presetsConfig.defaultPreset;
  const preset = presetsConfig.presets[key];
  if (!preset) {
    const validKeys = Object.keys(presetsConfig.presets).join(", ");
    throw new Error(`Unknown preset "${key}". Available presets: ${validKeys}`);
  }
  return preset;
}

// 把一份项目规则对象编译为可直接参与扫描的规则层
export function compileProjectRules(rawRules = {}) {
  const literals = Array.from(
    new Set(
      (rawRules.whitelistLiterals || [])
        .map((item) => String(item).trim())
        .filter(Boolean)
    )
  ).sort((a, b) => b.length - a.length);

  return {
    clicheRules: compileRules(rawRules.clicheRules, "project", "narration"),
    fillerRules: compileRules(rawRules.fillerRules, "project", "all"),
    registerRules: compileRules(rawRules.registerRules, "project", "all"),
    symmetricSkeletons: compileRules(
      rawRules.symmetricSkeletons,
      "project",
      "narration"
    ),
    rhetoricalRules: compileRules(
      rawRules.rhetoricalRules,
      "project",
      "narration"
    ),
    disabledRuleIds: new Set(rawRules.disabledRuleIds || []),
    whitelistLiterals: literals,
  };
}
