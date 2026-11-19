// Node 端内存多章整书体检入口：自动加载本地配置并委托给零文件系统核心模块
import {
  loadGenresConfig,
  loadLinguisticsConfig,
  loadPresetsConfig,
  loadSeverityConfig,
  loadTraditionalConfig,
} from "./config-loader.mjs";
import {
  diagnoseChapterEntries as diagnoseChapterEntriesCore,
  parseChapterMetaFromEntry,
  inferGenreFromEntries,
} from "./core/browser-doctor.mjs";

export { parseChapterMetaFromEntry, inferGenreFromEntries };

// 对内存中的章节数组执行整书排序体检、高频规则排行与自动台账骨架生成
export function diagnoseChapterEntries(entries, options = {}) {
  return diagnoseChapterEntriesCore(entries, {
    ...options,
    linguisticsConfig: options.linguisticsConfig || loadLinguisticsConfig(),
    genresConfig: options.genresConfig || loadGenresConfig(options.genresPath),
    presetsConfig: options.presetsConfig || loadPresetsConfig(options.presetsPath),
    severityConfig: options.severityConfig || loadSeverityConfig(options.severityPath),
    traditionalConfig:
      options.traditionalConfig !== undefined
        ? options.traditionalConfig
        : loadTraditionalConfig(),
  });
}
