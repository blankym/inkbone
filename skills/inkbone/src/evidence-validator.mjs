import { loadLinguisticsConfig } from "./config-loader.mjs";

// 校验审稿编辑输出的 JSON 报告是否严格具备原文举证且未越权干预纯文笔风格
export function validateEvidenceReview(
  chapterText,
  reviewPayload,
  customLingConfig = null
) {
  const cfg = customLingConfig || loadLinguisticsConfig();
  const allowedCategories = new Set(cfg.allowedReviewCategories);
  const bannedKeywords = cfg.bannedStyleReviewKeywords;
  const quoteRequiredCategories = new Set(cfg.quoteRequiredCategories || []);

  const issues = [];
  if (!reviewPayload || !Array.isArray(reviewPayload.items)) {
    return {
      valid: false,
      issues: [{ code: "INVALID_SCHEMA", detail: "Missing items array." }],
    };
  }

  const normalizedChapter = chapterText.replace(/\s+/gu, "");

  reviewPayload.items.forEach((item, index) => {
    // 1. 检查审稿分类是否在允许的客观事实与因果维度内
    if (!allowedCategories.has(item.category)) {
      issues.push({
        index,
        code: "UNAUTHORIZED_REVIEW_CATEGORY",
        category: item.category,
      });
    }

    // 2. 非 pass 项与读者反应项必须附带可在正文中逐字定位的真实 quote（防审稿幻觉）
    const quoteRequired =
      item.severity === "error" ||
      item.severity === "warning" ||
      quoteRequiredCategories.has(item.category);
    if (quoteRequired) {
      if (!item.quote || typeof item.quote !== "string" || !item.quote.trim()) {
        issues.push({
          index,
          code: "MISSING_EVIDENCE_QUOTE",
          severity: item.severity,
        });
      } else {
        const normalizedQuote = item.quote.replace(/\s+/gu, "");
        if (!normalizedChapter.includes(normalizedQuote)) {
          issues.push({
            index,
            code: "HALLUCINATED_QUOTE_NOT_IN_TEXT",
            quote: item.quote.slice(0, 60),
          });
        }
      }
    }

    // 3. 拦截要求“增加五感/丰富形容词/升级动词”等会污染人类文风的越权评语
    const desc = String(item.description || "");
    for (const banned of bannedKeywords) {
      if (desc.includes(banned)) {
        issues.push({
          index,
          code: "BANNED_STYLE_INTERFERENCE",
          matchedKeyword: banned,
        });
      }
    }
  });

  return {
    valid: issues.length === 0,
    checkedCount: reviewPayload.items.length,
    issues,
  };
}
