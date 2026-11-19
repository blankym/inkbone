import {
  loadGenresConfig,
  loadLinguisticsConfig,
  loadPresetsConfig,
  loadSeverityConfig,
  loadTraditionalConfig,
} from "./config-loader.mjs";
import { auditChapterText as auditChapterTextCore } from "./core/auditor.mjs";

// Node 端审计入口：自动从本地 JSON 加载默认配置后委托给零文件系统依赖的核心引擎
export function auditChapterText(rawContent, options = {}) {
  return auditChapterTextCore(rawContent, {
    ...options,
    linguisticsConfig: options.linguisticsConfig || loadLinguisticsConfig(),
    genresConfig: options.genresConfig || loadGenresConfig(options.genresPath),
    presetsConfig: options.presetsConfig || loadPresetsConfig(options.presetsPath),
    severityConfig:
      options.severityConfig || loadSeverityConfig(options.severityPath),
    traditionalConfig:
      options.traditionalConfig !== undefined
        ? options.traditionalConfig
        : loadTraditionalConfig(),
  });
}
