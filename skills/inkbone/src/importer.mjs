// 存量小说反推台账导入器：扫描已有章稿并无损合并生成 ledger.json
import fs from "fs";
import path from "path";
import { collectTextFiles } from "./calibrator.mjs";
import { loadLinguisticsConfig } from "./config-loader.mjs";
import { countHan } from "./profiler.mjs";
import { parseChineseOrArabicNumber } from "./rule-engine.mjs";
import { extractCandidateCharacters } from "./core/ledger-manager.mjs";

export { parseChineseOrArabicNumber };

// 从章首正文标题行或文件名解析章节号与章名
export function parseChapterNumberAndTitle(
  filePath,
  rawContent,
  customLingConfig = null
) {
  const cfg = customLingConfig || loadLinguisticsConfig();
  const cn = cfg.chineseNumerals || {};
  const headingRe = cn.chapterHeadingParseRegex
    ? new RegExp(cn.chapterHeadingParseRegex)
    : null;
  const fileRe = cn.chapterFileParseRegex
    ? new RegExp(cn.chapterFileParseRegex)
    : null;

  const lines = String(rawContent || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 8);

  if (headingRe) {
    for (const line of lines) {
      const match = headingRe.exec(line);
      if (match) {
        const chapterNumber = parseChineseOrArabicNumber(match[1], cn);
        if (chapterNumber !== null) {
          return {
            chapterNumber,
            title: (match[2] || "").replace(/^[_:\-\s\u2014]+/, "").trim(),
          };
        }
      }
    }
  }

  if (fileRe && filePath) {
    const base = path.basename(filePath);
    const match = fileRe.exec(base);
    if (match) {
      const chapterNumber = parseChineseOrArabicNumber(match[1], cn);
      if (chapterNumber !== null) {
        return {
          chapterNumber,
          title: (match[2] || "").replace(/^[_:\-\s\u2014]+/, "").trim(),
        };
      }
    }
  }

  return { chapterNumber: null, title: "" };
}

// 从单章正文提取候选专有名词（如书名号功法/物品/典籍）
function extractChapterBookTerms(rawContent, bookTitleRegex) {
  if (!bookTitleRegex || !rawContent) return [];
  const terms = new Set();
  bookTitleRegex.lastIndex = 0;
  let m;
  while ((m = bookTitleRegex.exec(rawContent)) !== null) {
    if (m[0] && m[0].length >= 3) {
      terms.add(m[0]);
    }
  }
  return Array.from(terms);
}

// 批量扫描存量章稿目录并无损生成或增补全书台账
export function importLedgerFromChapters(targetPaths, options = {}) {
  const inputs = Array.isArray(targetPaths) ? targetPaths : [targetPaths];
  const files = collectTextFiles(inputs);
  const lingConfig = options.lingConfig || loadLinguisticsConfig();
  const hanRegex = lingConfig.compiledRegex.hanCharGlobal;
  const bookTitleRegex = lingConfig.compiledRegex.bookTitleTermGlobal;

  const existing = options.existingLedger || {};
  const existingChapters = Array.isArray(existing.chapters)
    ? existing.chapters
    : [];
  const existingByNumber = new Map();
  for (const ch of existingChapters) {
    if (ch && ch.chapterNumber != null) {
      existingByNumber.set(Number(ch.chapterNumber), ch);
    }
  }

  const parsedEntries = [];
  const skippedFiles = [];
  const termFreq = new Map();
  const matchedTexts = [];

  for (const filePath of files) {
    const rawContent = fs.readFileSync(filePath, "utf8");
    const parsed = parseChapterNumberAndTitle(filePath, rawContent, lingConfig);
    if (parsed.chapterNumber === null) {
      skippedFiles.push(path.basename(filePath));
      continue;
    }

    matchedTexts.push(rawContent);
    const hanCount = countHan(rawContent, hanRegex);
    const bookTerms = extractChapterBookTerms(rawContent, bookTitleRegex);
    for (const term of bookTerms) {
      const rec = termFreq.get(term) || {
        term,
        chapterCount: 0,
        firstChapter: parsed.chapterNumber,
      };
      rec.chapterCount += 1;
      if (parsed.chapterNumber < rec.firstChapter) {
        rec.firstChapter = parsed.chapterNumber;
      }
      termFreq.set(term, rec);
    }

    parsedEntries.push({
      chapterNumber: parsed.chapterNumber,
      title: parsed.title,
      hanCount,
      sourceFile: path.basename(filePath),
    });
  }

  parsedEntries.sort((a, b) => a.chapterNumber - b.chapterNumber);

  // 无损合并：保留已有精修章节条目，仅对新增章节插入空壳待补条目
  const mergedMap = new Map(existingByNumber);
  let preservedChapters = 0;
  let addedChapters = 0;

  for (const entry of parsedEntries) {
    if (mergedMap.has(entry.chapterNumber)) {
      preservedChapters += 1;
    } else {
      mergedMap.set(entry.chapterNumber, {
        chapterNumber: entry.chapterNumber,
        title: entry.title,
        hanCount: entry.hanCount,
        sourceFile: entry.sourceFile,
        coreSummary: "",
        requiredAnchors: [],
        futureForbiddenTerms: [],
      });
      addedChapters += 1;
    }
  }

  const mergedChapters = Array.from(mergedMap.values()).sort(
    (a, b) => Number(a.chapterNumber) - Number(b.chapterNumber)
  );

  // 零依赖启发式挖掘高频角色名候选，解决存量书稿 characterNames 默认为空导致主语歧义不触发的问题
  const candidateCharacters = extractCandidateCharacters(matchedTexts, lingConfig, {
    minTotalCount: options.minCharacterCount,
    maxCandidates: options.maxCharacterCandidates,
  });
  const baseCharacterNames = Array.isArray(existing.characterNames)
    ? [...existing.characterNames]
    : [];
  let autoPopulatedCharacters = [];
  if (options.autoPopulateCharacters && candidateCharacters.length > 0) {
    const existingSet = new Set(baseCharacterNames);
    const minConfidence = options.minCharacterConfidence || "medium";
    const eligible = candidateCharacters.filter(
      (c) => minConfidence === "medium" || c.confidence === "high"
    );
    for (const c of eligible) {
      if (!existingSet.has(c.name)) {
        baseCharacterNames.push(c.name);
        existingSet.add(c.name);
        autoPopulatedCharacters.push(c.name);
      }
    }
  }

  // 深浅保真地克隆其余台账字段，并补全双栏知识与伏笔空壳
  const ledger = {
    ...existing,
    projectTitle: existing.projectTitle || options.projectTitle || "",
    protagonist: existing.protagonist || "",
    characterNames: baseCharacterNames,
    immutableWorldRules: Array.isArray(existing.immutableWorldRules)
      ? existing.immutableWorldRules
      : [],
    deprecatedTerms: Array.isArray(existing.deprecatedTerms)
      ? existing.deprecatedTerms
      : [],
    knowledgeLedger: Array.isArray(existing.knowledgeLedger)
      ? existing.knowledgeLedger
      : [],
    characterSnapshots:
      existing.characterSnapshots &&
      typeof existing.characterSnapshots === "object"
        ? existing.characterSnapshots
        : {},
    foreshadowing: Array.isArray(existing.foreshadowing)
      ? existing.foreshadowing
      : [],
    chapters: mergedChapters,
  };

  const candidateTerms = Array.from(termFreq.values()).sort(
    (a, b) => b.chapterCount - a.chapterCount || a.firstChapter - b.firstChapter
  );

  return {
    ledger,
    stats: {
      scannedFiles: files.length,
      matchedChapters: parsedEntries.length,
      preservedChapters,
      addedChapters,
      skippedFiles,
      candidateTerms: candidateTerms.slice(0, 60),
      candidateCharacters,
      autoPopulatedCharacters,
    },
  };
}
