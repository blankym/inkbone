import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  compileGenresConfig,
  compileLinguisticsConfig,
  compileProjectRules,
  compileSeverityConfig,
  resolveGenreFromConfig,
  resolvePresetFromConfig,
} from "./core/config-compiler.mjs";

export { compileProjectRules };

// 解析内置配置文件所在目录路径
const currentFile = fileURLToPath(import.meta.url);
const srcDir = path.dirname(currentFile);
const rootDir = path.resolve(srcDir, "..");
const defaultLingPath = path.resolve(rootDir, "configs/zh-linguistics.json");
const defaultPresetsPath = path.resolve(rootDir, "configs/presets.json");
const defaultGenresPath = path.resolve(rootDir, "configs/genres.json");
const defaultMessagesPath = path.resolve(rootDir, "configs/messages.json");

let cachedLinguistics = null;
let cachedPresets = null;
let cachedGenres = null;
let cachedSeverity = null;
let cachedMessages = null;

// 加载并缓存中文计算语言学配置与预编译正则表达式
export function loadLinguisticsConfig(customPath = null) {
  if (!customPath && cachedLinguistics) {
    return cachedLinguistics;
  }
  const targetPath = customPath ? path.resolve(customPath) : defaultLingPath;
  const raw = JSON.parse(fs.readFileSync(targetPath, "utf8"));
  const compiled = compileLinguisticsConfig(raw);
  if (!customPath) {
    cachedLinguistics = compiled;
  }
  return compiled;
}

// 加载并缓存多题材语域防火墙与通用减法规则配置
export function loadGenresConfig(customPath = null) {
  if (!customPath && cachedGenres) {
    return cachedGenres;
  }
  const targetPath = customPath ? path.resolve(customPath) : defaultGenresPath;
  const raw = JSON.parse(fs.readFileSync(targetPath, "utf8"));
  const compiled = compileGenresConfig(raw);
  if (!customPath) {
    cachedGenres = compiled;
  }
  return compiled;
}

// 根据题材标识解析对应的语域防火墙数据包
export function resolveGenre(genreName, customPath = null) {
  return resolveGenreFromConfig(loadGenresConfig(customPath), genreName);
}

// 加载并缓存大师声口预设门禁参数配置
export function loadPresetsConfig(customPath = null) {
  if (!customPath && cachedPresets) {
    return cachedPresets;
  }
  const targetPath = customPath ? path.resolve(customPath) : defaultPresetsPath;
  const parsed = JSON.parse(fs.readFileSync(targetPath, "utf8"));
  if (!customPath) {
    cachedPresets = parsed;
  }
  return parsed;
}

// 加载违规码分级配置，返回 code -> level 映射
export function loadSeverityConfig(customPath = null) {
  if (!customPath && cachedSeverity) {
    return cachedSeverity;
  }
  const targetPath = customPath
    ? path.resolve(customPath)
    : path.resolve(rootDir, "configs/severity.json");
  const raw = JSON.parse(fs.readFileSync(targetPath, "utf8"));
  const compiled = compileSeverityConfig(raw);
  if (!customPath) {
    cachedSeverity = compiled;
  }
  return compiled;
}

// 加载中英双语展示文案与精准改稿提示词模板配置
export function loadMessagesConfig(customPath = null) {
  if (!customPath && cachedMessages) {
    return cachedMessages;
  }
  const targetPath = customPath ? path.resolve(customPath) : defaultMessagesPath;
  const parsed = JSON.parse(fs.readFileSync(targetPath, "utf8"));
  if (!customPath) {
    cachedMessages = parsed;
  }
  return parsed;
}

// 根据预设名称解析对应的阈值配置对象
export function resolvePreset(presetName, customPath = null) {
  return resolvePresetFromConfig(loadPresetsConfig(customPath), presetName);
}

const PROJECT_CONFIG_NAME = "novel.json";
const PROJECT_SEARCH_DEPTH = 6;

// 从章节所在目录逐级向上查找书目录里的 novel.json
export function findProjectConfig(startDir) {
  let curDir = path.resolve(startDir || process.cwd());
  for (let depth = 0; depth < PROJECT_SEARCH_DEPTH; depth += 1) {
    const candidate = path.join(curDir, PROJECT_CONFIG_NAME);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(curDir);
    if (parent === curDir) break;
    curDir = parent;
  }
  return null;
}

const DEFAULT_WHITELIST_FILE = ".inkbone-whitelist";

// 读取纯字面量书级白名单文件（忽略空行与井号注释，不支持正则与跨目录继承）
export function loadWhitelistFile(filePath) {
  const absPath = path.resolve(filePath);
  if (!fs.existsSync(absPath)) return [];
  return fs
    .readFileSync(absPath, "utf8")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

// 加载书目录的 novel.json（或直接给出的规则文件），合并内联 projectRules、rulesFile 与书级白名单
export function loadProjectConfig(configPath) {
  const absPath = path.resolve(configPath);
  const raw = JSON.parse(fs.readFileSync(absPath, "utf8"));
  const baseDir = path.dirname(absPath);
  const isBareRulesFile =
    !raw.projectRules &&
    !raw.rulesFile &&
    !raw.genre &&
    !raw.projectTitle &&
    !raw.whitelistFile;
  const layers = [];
  if (isBareRulesFile) layers.push(raw);
  if (raw.rulesFile) {
    layers.push(
      JSON.parse(fs.readFileSync(path.resolve(baseDir, raw.rulesFile), "utf8"))
    );
  }
  if (raw.projectRules) layers.push(raw.projectRules);

  const merged = {
    clicheRules: [],
    fillerRules: [],
    registerRules: [],
    symmetricSkeletons: [],
    rhetoricalRules: [],
    disabledRuleIds: [],
    whitelistLiterals: [],
  };
  for (const layer of layers) {
    for (const key of Object.keys(merged)) {
      merged[key].push(...(layer[key] || []));
    }
  }

  // 读取书级字面量白名单（显式 whitelistFile 或同目录下的 .inkbone-whitelist）
  const explicitWhitelist = raw.whitelistFile
    ? path.resolve(baseDir, raw.whitelistFile)
    : null;
  const defaultWhitelist = path.join(baseDir, DEFAULT_WHITELIST_FILE);
  if (explicitWhitelist) {
    merged.whitelistLiterals.push(...loadWhitelistFile(explicitWhitelist));
  } else if (fs.existsSync(defaultWhitelist)) {
    merged.whitelistLiterals.push(...loadWhitelistFile(defaultWhitelist));
  }

  return {
    path: absPath,
    projectTitle: raw.projectTitle || null,
    genre: raw.genre || null,
    preset: raw.preset || null,
    ledgerFile: raw.ledgerFile ? path.resolve(baseDir, raw.ledgerFile) : null,
    whitelistFile:
      explicitWhitelist ||
      (fs.existsSync(defaultWhitelist) ? defaultWhitelist : null),
    rules: compileProjectRules(merged),
  };
}
