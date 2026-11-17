import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// 解析内置配置文件所在目录路径
const currentFile = fileURLToPath(import.meta.url);
const srcDir = path.dirname(currentFile);
const rootDir = path.resolve(srcDir, "..");
const defaultLingPath = path.resolve(rootDir, "configs/zh-linguistics.json");
const defaultPresetsPath = path.resolve(rootDir, "configs/presets.json");
const defaultGenresPath = path.resolve(rootDir, "configs/genres.json");

// 把规则数组预编译为全局正则，并标注规则所属层级（universal / genre / project）
function compileRules(rules, layer, defaultScope = "all") {
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

  return {
    compiledDensity,
    compiledDegeneration,
    compiledCrossParallel,
  };
}

let cachedLinguistics = null;
let cachedPresets = null;
let cachedGenres = null;

// 加载并缓存中文计算语言学配置与预编译正则表达式
export function loadLinguisticsConfig(customPath = null) {
  if (!customPath && cachedLinguistics) {
    return cachedLinguistics;
  }
  const targetPath = customPath ? path.resolve(customPath) : defaultLingPath;
  const raw = JSON.parse(fs.readFileSync(targetPath, "utf8"));
  const aux = compileAuxiliaryRules(raw);

  // 预编译核心正则表达式以提升扫描性能
  const compiled = {
    ...raw,
    compiledRegex: {
      hanCharGlobal: new RegExp(raw.regex.hanChar, "gu"),
      visibleCharGlobal: raw.regex.visibleChar
        ? new RegExp(raw.regex.visibleChar, "gu")
        : new RegExp(raw.regex.hanChar, "gu"),
      sentenceDelimiter: new RegExp(raw.regex.sentenceDelimiter, "u"),
      quoteCharsGlobal: new RegExp(raw.regex.quoteChars, "gu"),
      dialogueSpanGlobal: new RegExp(raw.regex.dialogueSpan, "gu"),
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
    },
  };

  if (!customPath) {
    cachedLinguistics = compiled;
  }
  return compiled;
}

// 加载并缓存多题材语域防火墙与通用减法规则配置
export function loadGenresConfig(customPath = null) {
  if (!customPath && cachedGenres) {
    return cachedGenres;
  }
  const targetPath = customPath ? path.resolve(customPath) : defaultGenresPath;
  const raw = JSON.parse(fs.readFileSync(targetPath, "utf8"));

  // 预编译跨题材水词规则与各流派专属语域禁词规则
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

  const compiled = {
    ...raw,
    compiledUniversalFillers,
    genres: compiledGenres,
  };

  if (!customPath) {
    cachedGenres = compiled;
  }
  return compiled;
}

// 根据题材标识解析对应的语域防火墙数据包
export function resolveGenre(genreName, customPath = null) {
  const genresConfig = loadGenresConfig(customPath);
  const key = genreName || genresConfig.defaultGenre;
  const pack = genresConfig.genres[key];
  if (!pack) {
    const validKeys = Object.keys(genresConfig.genres).join(", ");
    throw new Error(`Unknown genre "${key}". Available genres: ${validKeys}`);
  }
  return pack;
}

// 加载并缓存大师声口预设门禁参数配置
export function loadPresetsConfig(customPath = null) {
  if (!customPath && cachedPresets) {
    return cachedPresets;
  }
  const targetPath = customPath ? path.resolve(customPath) : defaultPresetsPath;
  const parsed = JSON.parse(fs.readFileSync(targetPath, "utf8"));
  if (!customPath) {
    cachedPresets = parsed;
  }
  return parsed;
}

// 加载违规码分级配置，返回 code -> level 映射
let cachedSeverity = null;
export function loadSeverityConfig(customPath = null) {
  if (!customPath && cachedSeverity) {
    return cachedSeverity;
  }
  const targetPath = customPath
    ? path.resolve(customPath)
    : path.resolve(rootDir, "configs/severity.json");
  const raw = JSON.parse(fs.readFileSync(targetPath, "utf8"));
  const byCode = new Map();
  for (const [level, codes] of Object.entries(raw.levels)) {
    for (const code of codes) byCode.set(code, level);
  }
  const compiled = { byCode, defaultLevel: raw.defaultLevel || "warning" };
  if (!customPath) {
    cachedSeverity = compiled;
  }
  return compiled;
}

// 根据预设名称解析对应的阈值配置对象
export function resolvePreset(presetName, customPath = null) {
  const presetsConfig = loadPresetsConfig(customPath);
  const key = presetName || presetsConfig.defaultPreset;
  const preset = presetsConfig.presets[key];
  if (!preset) {
    const validKeys = Object.keys(presetsConfig.presets).join(", ");
    throw new Error(`Unknown preset "${key}". Available presets: ${validKeys}`);
  }
  return preset;
}

const PROJECT_CONFIG_NAME = "novel.json";
const PROJECT_SEARCH_DEPTH = 6;

// 从章节所在目录逐级向上查找书目录里的 novel.json
export function findProjectConfig(startDir) {
  let curDir = path.resolve(startDir || process.cwd());
  for (let depth = 0; depth < PROJECT_SEARCH_DEPTH; depth += 1) {
    const candidate = path.join(curDir, PROJECT_CONFIG_NAME);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(curDir);
    if (parent === curDir) break;
    curDir = parent;
  }
  return null;
}

const DEFAULT_WHITELIST_FILE = ".inkbone-whitelist";

// 读取纯字面量书级白名单文件（忽略空行与井号注释，不支持正则与跨目录继承）
export function loadWhitelistFile(filePath) {
  const absPath = path.resolve(filePath);
  if (!fs.existsSync(absPath)) return [];
  return fs
    .readFileSync(absPath, "utf8")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
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

// 加载书目录的 novel.json（或直接给出的规则文件），合并内联 projectRules、rulesFile 与书级白名单
export function loadProjectConfig(configPath) {
  const absPath = path.resolve(configPath);
  const raw = JSON.parse(fs.readFileSync(absPath, "utf8"));
  const baseDir = path.dirname(absPath);
  const isBareRulesFile =
    !raw.projectRules &&
    !raw.rulesFile &&
    !raw.genre &&
    !raw.projectTitle &&
    !raw.whitelistFile;
  const layers = [];
  if (isBareRulesFile) layers.push(raw);
  if (raw.rulesFile) {
    layers.push(
      JSON.parse(fs.readFileSync(path.resolve(baseDir, raw.rulesFile), "utf8"))
    );
  }
  if (raw.projectRules) layers.push(raw.projectRules);

  const merged = {
    clicheRules: [],
    fillerRules: [],
    registerRules: [],
    symmetricSkeletons: [],
    rhetoricalRules: [],
    disabledRuleIds: [],
    whitelistLiterals: [],
  };
  for (const layer of layers) {
    for (const key of Object.keys(merged)) {
      merged[key].push(...(layer[key] || []));
    }
  }

  // 读取书级字面量白名单（显式 whitelistFile 或同目录下的 .inkbone-whitelist）
  const explicitWhitelist = raw.whitelistFile
    ? path.resolve(baseDir, raw.whitelistFile)
    : null;
  const defaultWhitelist = path.join(baseDir, DEFAULT_WHITELIST_FILE);
  if (explicitWhitelist) {
    merged.whitelistLiterals.push(...loadWhitelistFile(explicitWhitelist));
  } else if (fs.existsSync(defaultWhitelist)) {
    merged.whitelistLiterals.push(...loadWhitelistFile(defaultWhitelist));
  }

  return {
    path: absPath,
    projectTitle: raw.projectTitle || null,
    genre: raw.genre || null,
    preset: raw.preset || null,
    ledgerFile: raw.ledgerFile ? path.resolve(baseDir, raw.ledgerFile) : null,
    whitelistFile: explicitWhitelist || (fs.existsSync(defaultWhitelist) ? defaultWhitelist : null),
    rules: compileProjectRules(merged),
  };
}
