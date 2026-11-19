// Node 端台账管理入口：自动加载本地语言学配置并委托给纯内存核心引擎
import { loadLinguisticsConfig } from "./config-loader.mjs";
import {
  validateLedger,
  applyChapterSettlement,
  extractCandidateCharacters as extractCandidateCharactersCore,
} from "./core/ledger-manager.mjs";

export { validateLedger, applyChapterSettlement };

// 零依赖启发式挖掘存量章节中的高频角色名候选
export function extractCandidateCharacters(texts, options = {}) {
  const lingConfig = options.linguisticsConfig || loadLinguisticsConfig();
  return extractCandidateCharactersCore(texts, lingConfig, options);
}
