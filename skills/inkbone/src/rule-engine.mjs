import { loadLinguisticsConfig } from "./config-loader.mjs";
import {
  countVisibleChars,
  maskWhitelistLiterals,
  getQuotedRanges,
  maskQuotedText,
  stripSpokenDialogue,
  dedupContainedHits,
  computeTailStartIndex,
  scanParagraphRuleSet,
  evaluateHitsWithDensity,
  scanCrossParagraphParallel,
  runDensityTics,
  extractBodyParagraphLines as extractBodyParagraphLinesCore,
  runDegenerationChecks,
  checkOutlineCopy as checkOutlineCopyCore,
  parseChineseOrArabicNumber,
  checkCharCountClaims as checkCharCountClaimsCore,
  checkOutlineContract as checkOutlineContractCore,
  checkCalendarSpanContradictions as checkCalendarSpanContradictionsCore,
  checkGoldenOpeningPacing as checkGoldenOpeningPacingCore,
} from "./core/rule-engine.mjs";

export {
  countVisibleChars,
  maskWhitelistLiterals,
  getQuotedRanges,
  maskQuotedText,
  stripSpokenDialogue,
  dedupContainedHits,
  computeTailStartIndex,
  scanParagraphRuleSet,
  evaluateHitsWithDensity,
  scanCrossParagraphParallel,
  runDensityTics,
  runDegenerationChecks,
  parseChineseOrArabicNumber,
};

// 提取用于语言学画像与规则扫描的含汉字正文自然段
export function extractBodyParagraphLines(rawContent, customLingConfig = null) {
  return extractBodyParagraphLinesCore(
    rawContent,
    customLingConfig || loadLinguisticsConfig()
  );
}

// 检测正文是否大段照搬章节细纲文字（支持白名单原话/复沓锚句豁免）
export function checkOutlineCopy(chapterText, outlineText, options = {}) {
  return checkOutlineCopyCore(chapterText, outlineText, {
    ...options,
    lingConfig: options.lingConfig || loadLinguisticsConfig(),
  });
}

// 校验引号相邻句的“短短 X 字 / 这 X 个字”字数宣称是否与引号内实际字数一致
export function checkCharCountClaims(
  rawContent,
  customLingConfig = null,
  whitelistLiterals = []
) {
  return checkCharCountClaimsCore(
    rawContent,
    customLingConfig || loadLinguisticsConfig(),
    whitelistLiterals
  );
}

// 校验章节细纲是否缺失核心情节要素或残留未填占位符
export function checkOutlineContract(outlineText, options = {}) {
  return checkOutlineContractCore(outlineText, {
    ...options,
    lingConfig: options.lingConfig || loadLinguisticsConfig(),
  });
}

// 校验同章内的历法月日跨度是否与“半个月”宣称自相矛盾
export function checkCalendarSpanContradictions(rawContent, customLingConfig = null) {
  return checkCalendarSpanContradictionsCore(
    rawContent,
    customLingConfig || loadLinguisticsConfig()
  );
}

// 校验黄金三章首屏是否存在无对白且无即时冲突的慢热开局
export function checkGoldenOpeningPacing(rawContent, customLingConfig = null) {
  return checkGoldenOpeningPacingCore(
    rawContent,
    customLingConfig || loadLinguisticsConfig()
  );
}
