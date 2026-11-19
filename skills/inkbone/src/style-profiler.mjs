// Node 端安全拆书与文风节奏画像入口：自动加载本地语言学、预设与双语文案配置
import {
  loadLinguisticsConfig,
  loadPresetsConfig,
  loadMessagesConfig,
} from "./config-loader.mjs";
import {
  analyzeStyleProfile as analyzeStyleProfileCore,
  formatStyleProfileMarkdown as formatStyleProfileMarkdownCore,
} from "./core/style-profiler.mjs";

// 从一批范文或前文章节计算纯统计节奏画像与建议 customGates（绝不输出原句）
export function analyzeStyleProfile(texts, options = {}) {
  const lingConfig = options.linguisticsConfig || loadLinguisticsConfig();
  const presetsConfig = options.presetsConfig || loadPresetsConfig(options.presetsPath);
  return analyzeStyleProfileCore(texts, lingConfig, presetsConfig, options);
}

// 将风格画像格式化为双语 Markdown 报告
export function formatStyleProfileMarkdown(profile, options = {}) {
  return formatStyleProfileMarkdownCore(profile, {
    ...options,
    messagesConfig: options.messagesConfig || loadMessagesConfig(options.messagesPath),
  });
}
