import { loadLinguisticsConfig } from "./config-loader.mjs";
import { countHan, profileText as profileTextCore } from "./core/profiler.mjs";

export { countHan };

// 对输入章节或语料执行全维度计算语言学指纹画像分析
export function profileText(
  rawContent,
  customLingConfig = null,
  ruleOverrides = null
) {
  return profileTextCore(
    rawContent,
    customLingConfig || loadLinguisticsConfig(),
    ruleOverrides
  );
}
