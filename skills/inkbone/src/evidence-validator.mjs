import { validateEvidenceReview as validateEvidenceReviewCore } from "./core/evidence-validator.mjs";
import { loadLinguisticsConfig } from "./config-loader.mjs";

// 校验审稿编辑输出的 JSON 报告是否严格具备原文举证且未越权干预纯文笔风格
export function validateEvidenceReview(
  chapterText,
  reviewPayload,
  customLingConfig = null
) {
  return validateEvidenceReviewCore(
    chapterText,
    reviewPayload,
    customLingConfig || loadLinguisticsConfig()
  );
}
