import { loadLinguisticsConfig } from "./config-loader.mjs";
import {
  compileBoundaryPacket,
  computeBoundaryEchoRatio as computeBoundaryEchoRatioCore,
  verifyChapterBoundaries as verifyChapterBoundariesCore,
  checkDeceasedCharacterAppearances as checkDeceasedCharacterAppearancesCore,
} from "./core/boundary-compiler.mjs";

export { compileBoundaryPacket };

// 检查已阵亡或退场角色是否在非回忆段落中再次活跃出场
export function checkDeceasedCharacterAppearances(
  chapterText,
  ledger,
  chapterNumber,
  customLingConfig = null
) {
  return checkDeceasedCharacterAppearancesCore(
    chapterText,
    ledger,
    chapterNumber,
    customLingConfig || loadLinguisticsConfig()
  );
}

// 计算本章开篇 500 字与上一章结尾 500 字的 6-gram 重合率（防前情重演）
export function computeBoundaryEchoRatio(
  chapterText,
  previousChapterText = "",
  customLingConfig = null
) {
  return computeBoundaryEchoRatioCore(
    chapterText,
    previousChapterText,
    customLingConfig || loadLinguisticsConfig()
  );
}

// 对已完成章节执行硬边界、防剧透围栏与必达事实锚点的确定性代码校验
export function verifyChapterBoundaries(
  chapterText,
  ledger,
  chapterNumber,
  previousChapterText = "",
  customLingConfig = null
) {
  return verifyChapterBoundariesCore(
    chapterText,
    ledger,
    chapterNumber,
    previousChapterText,
    customLingConfig || loadLinguisticsConfig()
  );
}
