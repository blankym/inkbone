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
