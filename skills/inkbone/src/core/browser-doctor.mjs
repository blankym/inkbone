// 纯内存整书多章体检引擎（Browser Doctor：零文件系统依赖，供浏览器静态试跑台与内存批量分析共用）
import { auditChapterText } from "./auditor.mjs";
import { resolveGenreFromConfig } from "./config-compiler.mjs";
import { countHan } from "./profiler.mjs";
import { parseChineseOrArabicNumber, stripSpokenDialogue } from "./rule-engine.mjs";
import { extractCandidateCharacters } from "./ledger-manager.mjs";

// 纯内存解析单章的章节号与标题（复用与 importer.mjs 一致的中文/阿拉伯章号正则）
export function parseChapterMetaFromEntry(fileName, rawText, lingConfig) {
  const cn = lingConfig?.chineseNumerals || {};
  const headingRe = cn.chapterHeadingParseRegex ? new RegExp(cn.chapterHeadingParseRegex) : null;
  const fileRe = cn.chapterFileParseRegex ? new RegExp(cn.chapterFileParseRegex) : null;

  const lines = String(rawText || "")
    .split(/\r?\n/u)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 8);

  if (headingRe) {
    for (const line of lines) {
      const m = headingRe.exec(line);
      if (m) {
        const num = parseChineseOrArabicNumber(m[1], cn);
        if (num !== null) {
          return {
            chapterNumber: num,
            title: (m[2] || "").replace(/^[_:\-\s\u2014]+/, "").trim(),
          };
        }
      }
    }
  }

  if (fileRe && fileName) {
    const m = fileRe.exec(fileName);
    if (m) {
      const num = parseChineseOrArabicNumber(m[1], cn);
      if (num !== null) {
        return {
          chapterNumber: num,
          title: (m[2] || "").replace(/^[_:\-\s\u2014]+/, "").trim(),
        };
      }
    }
  }

  if (fileName) {
    const fallback = String(fileName).match(/(\d{1,4})/u);
    if (fallback) {
      return { chapterNumber: Number(fallback[1]), title: "" };
    }
  }

  return { chapterNumber: null, title: "" };
}

// 纯内存题材信号推断（复用 genresConfig.domainSignals）
export function inferGenreFromEntries(texts, genresConfig) {
  const combined = (texts || []).join("\n");
  let bestId = genresConfig.defaultGenre;
  let bestScore = 0;

  for (const [id, pack] of Object.entries(genresConfig.genres || {})) {
    const signals = pack.domainSignals || [];
    if (signals.length === 0) continue;
    let distinctHits = 0;
    let totalHits = 0;
    for (const sig of signals) {
      const count = combined.split(sig).length - 1;
      if (count > 0) {
        distinctHits += 1;
        totalHits += count;
      }
    }
    if (distinctHits >= 2) {
      const score = distinctHits * 10 + Math.min(totalHits, 60);
      if (score > bestScore) {
        bestScore = score;
        bestId = id;
      }
    }
  }
  return {
    genreId: bestId,
    autoDetected: bestScore > 0,
  };
}

// 计算单章对白字数占比（供走势图展示）
function computeChapterDialogueRatio(text, lingConfig, totalHan) {
  if (!totalHan || totalHan <= 0) return 0;
  let spoken = 0;
  for (const line of String(text || "").split(/\r?\n/u)) {
    const t = line.trim();
    if (!t) continue;
    spoken += stripSpokenDialogue(t, lingConfig, " ").spokenChars || 0;
  }
  return Math.round(Math.min(1, spoken / totalHan) * 1000) / 1000;
}

// 对内存中的多章数组执行全书体检、跨章回声检测、高频规则排行与自动台账骨架生成
export function diagnoseChapterEntries(entries, options = {}) {
  const lingConfig = options.linguisticsConfig;
  const genresConfig = options.genresConfig;
  const presetsConfig = options.presetsConfig;
  const severityConfig = options.severityConfig;
  if (!lingConfig || !genresConfig || !presetsConfig || !severityConfig) {
    throw new Error(
      "linguisticsConfig, genresConfig, presetsConfig, and severityConfig are required."
    );
  }
  const rawList = Array.isArray(entries) ? entries : [];
  if (rawList.length === 0) {
    throw new Error("At least one chapter entry is required for diagnoseChapterEntries.");
  }

  // 1. 解析章号并按自然章号顺序排序
  const enriched = rawList.map((entry, idx) => {
    const meta = parseChapterMetaFromEntry(entry.name, entry.text, lingConfig);
    return {
      idx,
      name: entry.name || `chapter-${idx + 1}.md`,
      text: String(entry.text || ""),
      chapterNumber: meta.chapterNumber,
      title: meta.title,
    };
  });
  enriched.sort((a, b) => {
    const na = a.chapterNumber ?? Number.MAX_SAFE_INTEGER;
    const nb = b.chapterNumber ?? Number.MAX_SAFE_INTEGER;
    return na - nb || a.idx - b.idx;
  });

  // 2. 确定题材包与自动挖掘高频角色（未提供 ledger 时用于直接激活主语歧义检查并输出台账骨架）
  const texts = enriched.map((e) => e.text);
  const inferred = options.genre
    ? { genreId: options.genre, autoDetected: false }
    : inferGenreFromEntries(texts.slice(0, 6), genresConfig);
  const genrePack = resolveGenreFromConfig(genresConfig, inferred.genreId);

  const candidateCharacters = extractCandidateCharacters(texts, lingConfig);
  const autoNames = candidateCharacters.map((c) => c.name);
  const effectiveCharacterNames = Array.from(
    new Set([...(options.characterNames || []), ...(options.ledger?.characterNames || []), ...autoNames])
  );

  // 3. 逐章审计并统计跨章回声、高频命中规则 Top 10 与走势数据
  const ruleCounter = new Map();
  const totals = {
    chaptersScanned: enriched.length,
    totalHan: 0,
    hardErrors: 0,
    totalWarnings: 0,
    registerCollisions: 0,
    narrativeFillers: 0,
    aiCliches: 0,
    subjectAmbiguities: 0,
    echoWarnings: 0,
  };

  const hanRegex = lingConfig.compiledRegex.hanCharGlobal;
  const chapters = [];
  const trend = [];
  const ledgerChapters = [];

  enriched.forEach((entry, idx) => {
    const prev = idx > 0 ? enriched[idx - 1] : null;
    const isAdjacent =
      prev &&
      ((entry.chapterNumber !== null &&
        prev.chapterNumber !== null &&
        entry.chapterNumber === prev.chapterNumber + 1) ||
        (entry.chapterNumber === null && prev.chapterNumber === null));

    const audit = auditChapterText(entry.text, {
      genre: genrePack.id,
      presetName: options.presetName || genrePack.defaultPreset,
      customGates: options.customGates || null,
      ledger: options.ledger || null,
      chapterNumber: entry.chapterNumber,
      characterNames: effectiveCharacterNames,
      previousChapterText: isAdjacent ? prev.text : "",
      skipLengthGate: Boolean(options.skipLengthGate),
      strict: Boolean(options.strict),
      variant: options.variant || "auto",
      linguisticsConfig: lingConfig,
      genresConfig,
      presetsConfig,
      severityConfig,
      traditionalConfig: options.traditionalConfig || null,
      projectRules: options.projectRules || null,
    });

    const getCount = (code) => {
      const v = audit.violations.find((item) => item.code === code);
      return v ? v.count || (v.hits ? v.hits.length : 1) : 0;
    };
    const echoV = audit.violations.find((v) => v.code === "PREVIOUS_ENDING_ECHO");
    const echoRatio = echoV ? echoV.actual : 0;

    const regCount = getCount("REGISTER_COLLISION");
    const filCount = getCount("NARRATIVE_FILLER");
    const cliCount = getCount("FORBIDDEN_AI_CLICHE");
    const subjCount = getCount("SUBJECT_AMBIGUITY");

    totals.totalHan += audit.metrics.totalHan;
    totals.hardErrors += audit.summary.error;
    totals.totalWarnings += audit.summary.warning;
    totals.registerCollisions += regCount;
    totals.narrativeFillers += filCount;
    totals.aiCliches += cliCount;
    totals.subjectAmbiguities += subjCount;
    if (echoV) totals.echoWarnings += 1;

    // 累加规则标签出现次数用于全书高频问题榜
    for (const target of audit.surgeryTargets || []) {
      for (const issue of target.issues || []) {
        const rec = ruleCounter.get(issue.tag) || {
          tag: issue.tag,
          count: 0,
          chapters: new Set(),
          sample: issue.detail || "",
          level: issue.level || "advisory",
        };
        rec.count += 1;
        rec.chapters.add(entry.name);
        if (issue.level === "blocking") rec.level = "blocking";
        ruleCounter.set(issue.tag, rec);
      }
    }

    const dialogueRatio = computeChapterDialogueRatio(
      entry.text,
      lingConfig,
      audit.metrics.totalHan
    );

    chapters.push({
      name: entry.name,
      chapterNumber: entry.chapterNumber,
      title: entry.title,
      pass: audit.pass,
      scriptVariant: audit.scriptVariant || "zh-hans",
      totalHan: audit.metrics.totalHan,
      dialogueRatio,
      echoRatio,
      summary: audit.summary,
      counts: {
        registerCollisions: regCount,
        narrativeFillers: filCount,
        aiCliches: cliCount,
        subjectAmbiguities: subjCount,
      },
      surgeryTargetCount: audit.surgeryTargets.length,
      surgeryTargets: audit.surgeryTargets,
      violations: audit.violations.filter((v) => v.severity !== "info"),
    });

    trend.push({
      name: entry.name,
      chapterNumber: entry.chapterNumber ?? idx + 1,
      totalHan: audit.metrics.totalHan,
      dialogueRatio,
      errors: audit.summary.error,
      warnings: audit.summary.warning,
      echoRatio,
    });

    ledgerChapters.push({
      chapterNumber: entry.chapterNumber ?? idx + 1,
      title: entry.title,
      hanCount: countHan(entry.text, hanRegex),
      sourceFile: entry.name,
      coreSummary: "",
      requiredAnchors: [],
      futureForbiddenTerms: [],
    });
  });

  const topRules = Array.from(ruleCounter.values())
    .map((r) => ({
      tag: r.tag,
      count: r.count,
      chapterCount: r.chapters.size,
      level: r.level,
      sample: r.sample,
    }))
    .sort((a, b) => b.count - a.count || b.chapterCount - a.chapterCount)
    .slice(0, 10);

  const suggestedLedger = {
    projectTitle: options.projectTitle || "",
    protagonist: autoNames[0] ? { name: autoNames[0] } : "",
    characterNames: autoNames,
    immutableWorldRules: [],
    deprecatedTerms: [],
    knowledgeLedger: [],
    characterSnapshots: {},
    foreshadowing: [],
    chapters: ledgerChapters,
  };

  return {
    pass: totals.hardErrors === 0,
    genre: {
      id: genrePack.id,
      title: genrePack.title,
      source: options.genre ? "explicit" : inferred.autoDetected ? "inferred" : "default",
    },
    totals,
    topRules,
    trend,
    candidateCharacters,
    suggestedLedger,
    chapters,
  };
}
