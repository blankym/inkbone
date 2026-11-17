import fs from "node:fs";
import path from "node:path";
import {
  loadGenresConfig,
  loadLinguisticsConfig,
  resolveGenre,
} from "./config-loader.mjs";
import { auditChapterText } from "./auditor.mjs";
import { collectTextFiles } from "./calibrator.mjs";
import { parseChapterNumberAndTitle } from "./importer.mjs";

// 列出所有内置题材语域包及其默认预设配置摘要
export function listGenres(customGenresPath = null) {
  const cfg = loadGenresConfig(customGenresPath);
  return Object.values(cfg.genres).map((g) => ({
    id: g.id,
    title: g.title,
    defaultPreset: g.defaultPreset,
    registerFormula: g.registerFormula,
    ruleCount: g.compiledRegisterRules.length,
  }));
}

// 根据大纲、设定集或章节文本中的领域信号词自动推断最佳题材语域包
export function inferGenreFromTexts(texts, customGenresPath = null) {
  const cfg = loadGenresConfig(customGenresPath);
  const combined = (texts || []).join("\n");
  let bestId = cfg.defaultGenre;
  let bestScore = 0;
  let bestSignals = [];

  for (const [id, pack] of Object.entries(cfg.genres)) {
    const signals = pack.domainSignals || [];
    if (signals.length === 0) continue;

    const matched = [];
    let totalHits = 0;
    for (const sig of signals) {
      const parts = combined.split(sig);
      const count = parts.length - 1;
      if (count > 0) {
        matched.push({ term: sig, count });
        totalHits += count;
      }
    }

    // 要求至少命中两个不同的领域特征词以防止单点误判
    if (matched.length >= 2) {
      const score = matched.length * 10 + Math.min(totalHits, 60);
      if (score > bestScore) {
        bestScore = score;
        bestId = id;
        bestSignals = matched.sort((a, b) => b.count - a.count);
      }
    }
  }

  const chosen = cfg.genres[bestId];
  return {
    genreId: chosen.id,
    title: chosen.title,
    defaultPreset: chosen.defaultPreset,
    autoDetected: bestScore > 0,
    matchedSignalCount: bestSignals.length,
    matchedSignals: bestSignals.slice(0, 8),
    registerFormula: chosen.registerFormula,
    voiceMatrix: chosen.voiceMatrix,
  };
}

// 从章首标题或文件名解析数字/中文数字章节号，并与台账目录核对匹配
function resolveDoctorChapterInfo(filePath, rawContent, ledger, lingConfig) {
  const parsed = parseChapterNumberAndTitle(filePath, rawContent, lingConfig);
  let detectedNumber = parsed.chapterNumber;
  if (detectedNumber === null) {
    const base = path.basename(filePath);
    const m = base.match(/(\d{1,4})/u);
    if (m) detectedNumber = Number(m[1]);
  }
  let ledgerChapterNumber = null;
  if (
    detectedNumber !== null &&
    ledger &&
    Array.isArray(ledger.chapters) &&
    ledger.chapters.some((c) => Number(c.chapterNumber) === detectedNumber)
  ) {
    ledgerChapterNumber = detectedNumber;
  }
  return { detectedNumber, ledgerChapterNumber };
}

// 对单章或整书目录执行四维体检（客观错误、语域冲突、穿插水词、AI句法热区）
export function diagnoseProject(targetPaths, options = {}) {
  const chapterFiles = collectTextFiles([].concat(targetPaths || []));
  if (chapterFiles.length === 0) {
    throw new Error("No .md or .txt files found in target paths for doctor.");
  }

  const lingConfig = options.linguisticsConfig || loadLinguisticsConfig();
  const outlineFiles = collectTextFiles([].concat(options.outlinePaths || []));
  const chapterTexts = chapterFiles.map((f) => fs.readFileSync(f, "utf8"));
  const outlineTexts = outlineFiles.map((f) => fs.readFileSync(f, "utf8"));
  const chapInfos = chapterFiles.map((filePath, idx) =>
    resolveDoctorChapterInfo(
      filePath,
      chapterTexts[idx],
      options.ledger,
      lingConfig
    )
  );

  const inferred = inferGenreFromTexts(
    [...outlineTexts, ...chapterTexts.slice(0, 5)],
    options.genresPath
  );
  const genrePack = options.genre
    ? resolveGenre(options.genre, options.genresPath)
    : resolveGenre(inferred.genreId, options.genresPath);

  const totals = {
    chaptersScanned: chapterFiles.length,
    hardErrors: 0,
    registerCollisions: 0,
    narrativeFillers: 0,
    aiCliches: 0,
    rhetoricalPatterns: 0,
    densityTics: 0,
    degenerationErrors: 0,
    metaLeaks: 0,
    pronounStreaks: 0,
    totalWarnings: 0,
  };

  const chapters = chapterFiles.map((filePath, idx) => {
    const raw = chapterTexts[idx];
    const info = chapInfos[idx];
    const chapNum =
      chapterFiles.length === 1 && options.chapterNumber
        ? Number(options.chapterNumber)
        : info.ledgerChapterNumber;
    const prevInfo = idx > 0 ? chapInfos[idx - 1] : null;
    const prevText =
      idx > 0 &&
      info.detectedNumber !== null &&
      prevInfo?.detectedNumber === info.detectedNumber - 1
        ? chapterTexts[idx - 1]
        : "";

    const audit = auditChapterText(raw, {
      genre: genrePack.id,
      presetName: options.presetName || genrePack.defaultPreset,
      ledger: options.ledger || null,
      chapterNumber: chapNum,
      previousChapterText: prevText,
      skipLengthGate: Boolean(options.skipLengthGate),
      genresPath: options.genresPath,
      presetsPath: options.presetsPath,
      linguisticsConfig: lingConfig,
      projectRules: options.projectRules || null,
    });

    const regV = audit.violations.find((v) => v.code === "REGISTER_COLLISION");
    const filV = audit.violations.find((v) => v.code === "NARRATIVE_FILLER");
    const cliV = audit.violations.find((v) => v.code === "FORBIDDEN_AI_CLICHE");
    const rhetV = audit.violations.find((v) => v.code === "RHETORICAL_AI_PATTERN");
    const ticV = audit.violations.find((v) => v.code === "PROSE_DENSITY_TIC");
    const degV = audit.violations.find((v) => v.code === "DEGENERATION_DETECTED");
    const metaV = audit.violations.find((v) => v.code === "ENGINEERING_META_LEAK");
    const proV = audit.violations.find((v) => v.code === "PRONOUN_HEAD_STREAK");

    const regCount = regV ? regV.count : 0;
    const filCount = filV ? filV.count : 0;
    const cliCount = cliV ? cliV.count : 0;
    const rhetCount = rhetV ? rhetV.count : 0;
    const ticCount = ticV ? ticV.count : 0;
    const degCount = degV ? degV.count : 0;
    const metaCount = metaV ? metaV.count : 0;
    const proSpans = proV ? proV.spans.length : 0;

    totals.hardErrors += audit.summary.error;
    totals.registerCollisions += regCount;
    totals.narrativeFillers += filCount;
    totals.aiCliches += cliCount;
    totals.rhetoricalPatterns += rhetCount;
    totals.densityTics += ticCount;
    totals.degenerationErrors += degCount;
    totals.metaLeaks += metaCount;
    totals.pronounStreaks += proSpans;
    totals.totalWarnings += audit.summary.warning;

    return {
      file: path.basename(filePath),
      path: filePath,
      chapterNumber: chapNum,
      detectedChapterNumber: info.detectedNumber,
      pass: audit.pass,
      totalHan: audit.metrics.totalHan,
      maxPronounHeadStreak: audit.metrics.maxPronounHeadStreak,
      summary: audit.summary,
      counts: {
        registerCollisions: regCount,
        narrativeFillers: filCount,
        aiCliches: cliCount,
        rhetoricalPatterns: rhetCount,
        densityTics: ticCount,
        degenerationErrors: degCount,
        metaLeaks: metaCount,
        pronounStreakSpans: proSpans,
      },
      violations: audit.violations.filter((v) => v.severity !== "info"),
      surgeryTargets: audit.surgeryTargets,
    };
  });

  return {
    pass: totals.hardErrors === 0,
    genre: {
      id: genrePack.id,
      title: genrePack.title,
      source:
        options.genreSource ||
        (options.genre ? "explicit" : inferred.autoDetected ? "inferred" : "default"),
      matchedSignals: inferred.matchedSignals,
      defaultPreset: genrePack.defaultPreset,
      registerFormula: genrePack.registerFormula,
      voiceMatrix: genrePack.voiceMatrix,
    },
    totals,
    chapters,
  };
}

// 将四维体检报告格式化为简洁易读的 Markdown 概览与行级手术单
export function formatDoctorMarkdown(diagnosis) {
  const lines = [
    `# InkBone Doctor Report`,
    ``,
    `- **Genre Pack**: \`${diagnosis.genre.id}\` (${diagnosis.genre.title}) [${diagnosis.genre.source}]`,
    `- **Preset**: \`${diagnosis.genre.defaultPreset}\``,
    `- **Register Formula**: ${diagnosis.genre.registerFormula}`,
    `- **Totals**: ${diagnosis.totals.chaptersScanned} chapter(s) | Hard Errors: ${diagnosis.totals.hardErrors} | Register Clash: ${diagnosis.totals.registerCollisions} | Fillers: ${diagnosis.totals.narrativeFillers} | AI Cliches: ${diagnosis.totals.aiCliches} | Rhetorical: ${diagnosis.totals.rhetoricalPatterns} | Density Tics: ${diagnosis.totals.densityTics} | Degeneration: ${diagnosis.totals.degenerationErrors} | Meta Leaks: ${diagnosis.totals.metaLeaks} | Pronoun Streaks: ${diagnosis.totals.pronounStreaks}`,
    ``,
    `| File | Han | Errors | RegClash | Fillers | Cliches | Rhet/Tics | ProStreak |`,
    `| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |`,
  ];

  for (const ch of diagnosis.chapters) {
    const rhetTics = ch.counts.rhetoricalPatterns + ch.counts.densityTics;
    lines.push(
      `| ${ch.file} | ${ch.totalHan} | ${ch.summary.error} | ${ch.counts.registerCollisions} | ${ch.counts.narrativeFillers} | ${ch.counts.aiCliches} | ${rhetTics} | ${ch.maxPronounHeadStreak} |`
    );
  }

  for (const ch of diagnosis.chapters) {
    if (ch.surgeryTargets.length === 0 && ch.summary.error === 0) continue;
    lines.push(``, `## ${ch.file}`);
    for (const v of ch.violations) {
      if (v.severity === "error") {
        lines.push(`- **[ERROR] ${v.code}**: ${JSON.stringify(v.details || v.remedy)}`);
      }
    }
    for (const target of ch.surgeryTargets.slice(0, 25)) {
      const desc = target.issues
        .map((i) => {
          const badge = i.level === "blocking" ? "[BLOCK]" : "";
          return `${badge}\`${i.tag}\` (${i.detail})`;
        })
        .join("; ");
      lines.push(`- **L${target.line}**: ${desc}`);
    }
  }

  return lines.join("\n");
}

// 初始化新小说工程的通用配置与空白防吃书台账骨架
export function scaffoldProject(targetDir, options = {}) {
  const absDir = path.resolve(targetDir || ".");
  const genrePack = resolveGenre(options.genre || "general-clean", options.genresPath);
  const title = options.title || path.basename(absDir) || "Untitled-Novel";
  const force = Boolean(options.force);

  fs.mkdirSync(absDir, { recursive: true });

  const novelConfigPath = path.resolve(absDir, "novel.json");
  const ledgerPath = path.resolve(absDir, "ledger.json");
  const created = [];
  const skipped = [];

  const novelConfig = {
    projectTitle: title,
    genre: genrePack.id,
    preset: options.presetName || genrePack.defaultPreset,
    registerFormula: genrePack.registerFormula,
    voiceMatrix: genrePack.voiceMatrix,
    ledgerFile: "./ledger.json",
    projectRules: {
      clicheRules: [],
      fillerRules: [],
      registerRules: [],
      symmetricSkeletons: [],
      rhetoricalRules: [],
      disabledRuleIds: [],
      whitelistLiterals: [],
    },
  };

  const starterLedger = {
    projectTitle: title,
    protagonist: {
      name: "PROTAGONIST_NAME",
      role: "PROTAGONIST_OCCUPATION_AND_ORIGIN",
      initialState: "SURFACE_VS_ACTUAL_STATE",
      coreEdge: "UNIQUE_MECHANISM_AND_HARD_COST",
    },
    deprecatedTerms: [],
    characterNames: [],
    immutableWorldRules: [
      "Define hard cost/limit of the core mechanism here.",
      "Define irreversible power/social hierarchy threshold here.",
    ],
    knowledgeLedger: [],
    characterSnapshots: {},
    foreshadowing: [],
    chapters: [
      {
        chapterNumber: 1,
        title: "CHAPTER_1_TITLE",
        coreSummary: "Immediate anomaly/crisis + concrete stakes + hook.",
        requiredAnchors: [],
        futureForbiddenTerms: [],
      },
    ],
  };

  if (!fs.existsSync(novelConfigPath) || force) {
    fs.writeFileSync(novelConfigPath, JSON.stringify(novelConfig, null, 2) + "\n");
    created.push(novelConfigPath);
  } else {
    skipped.push(novelConfigPath);
  }

  if (!fs.existsSync(ledgerPath) || force) {
    fs.writeFileSync(ledgerPath, JSON.stringify(starterLedger, null, 2) + "\n");
    created.push(ledgerPath);
  } else {
    skipped.push(ledgerPath);
  }

  return {
    targetDir: absDir,
    genre: genrePack.id,
    preset: novelConfig.preset,
    created,
    skipped,
  };
}
