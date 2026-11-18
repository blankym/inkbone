import { countHan, profileText } from "./profiler.mjs";
import { loadLinguisticsConfig } from "./config-loader.mjs";
import { stripMarkdownEmphasis } from "./normalizer.mjs";

// 提取文本中的连续汉字序列并生成固定长度的 N-gram 集合用于重演回声检测
function extractHanNgrams(text, ngramSize, hanGlobalRegex) {
  const hanMatches = text.match(hanGlobalRegex);
  if (!hanMatches || hanMatches.length < ngramSize) {
    return new Set();
  }
  const pureHan = hanMatches.join("");
  const ngrams = new Set();
  for (let i = 0; i <= pureHan.length - ngramSize; i += 1) {
    ngrams.add(pureHan.slice(i, i + ngramSize));
  }
  return ngrams;
}

// 过滤并编译双栏知识台账：在揭露章节之前隐藏里层真相，防止模型提前剧透
function compileKnowledgeEntries(knowledgeLedger, numChapter) {
  if (!Array.isArray(knowledgeLedger)) {
    return undefined;
  }
  return knowledgeLedger
    .filter(
      (entry) =>
        entry &&
        (entry.firstChapter == null || Number(entry.firstChapter) <= numChapter)
    )
    .map((entry) => {
      const isRevealed =
        entry.revealChapter != null &&
        numChapter >= Number(entry.revealChapter);
      const compiled = {
        entity: entry.entity || "",
        firstChapter: entry.firstChapter ?? null,
        readerKnown: entry.readerKnown || "",
        revealChapter: entry.revealChapter ?? null,
        revealed: isRevealed,
      };
      // 仅当当前章节到达或超过揭露章节时，才向写作端释放里层真相
      if (isRevealed && entry.fullTruth) {
        compiled.fullTruth = entry.fullTruth;
      }
      return compiled;
    });
}

// 从全书台账配置中提取指定章节的硬边界创作数据包（借鉴 Pagekin 上下文隔离机制）
export function compileBoundaryPacket(
  ledger,
  chapterNumber,
  previousChapterText = ""
) {
  const numChapter = Number(chapterNumber);
  const chapterSpec = (ledger.chapters || []).find(
    (ch) => ch.chapterNumber === numChapter
  );
  if (!chapterSpec) {
    throw new Error(
      `Chapter ${chapterNumber} not found in ledger "${ledger.projectTitle || "unnamed"}"`
    );
  }

  // 提取后续章节大纲作为只读预告围栏，防止大模型提前泄底剧透
  const futureBlueprints = (ledger.chapters || [])
    .filter((ch) => ch.chapterNumber > numChapter)
    .slice(0, 3)
    .map((ch) => ({
      chapterNumber: ch.chapterNumber,
      title: ch.title,
      coreSummary: ch.coreSummary,
    }));

  // 截取上一章末尾 600 字符作为只读起点状态边界（严禁在本章开篇重演回放）
  const trimmedPrev = previousChapterText.trim();
  const previousEndingBoundary =
    trimmedPrev.length > 600 ? trimmedPrev.slice(-600) : trimmedPrev;

  const packet = {
    projectTitle: ledger.projectTitle,
    protagonist: ledger.protagonist,
    immutableWorldRules: ledger.immutableWorldRules || [],
    chapterSpec,
    previousEndingBoundary,
    futureBlueprints,
  };

  // 可选透传双栏知识台账、角色阶段快照与伏笔台账（保持无这些字段时的向后兼容）
  const compiledKnowledge = compileKnowledgeEntries(
    ledger.knowledgeLedger,
    numChapter
  );
  if (compiledKnowledge !== undefined) {
    packet.knowledgeLedger = compiledKnowledge;
  }
  if (ledger.characterSnapshots !== undefined) {
    packet.characterSnapshots = ledger.characterSnapshots;
  }
  if (Array.isArray(ledger.foreshadowing)) {
    packet.foreshadowing = ledger.foreshadowing.filter(
      (item) =>
        item &&
        (item.plantedChapter == null ||
          Number(item.plantedChapter) <= numChapter)
    );
  }

  return packet;
}

// 计算本章开篇 500 字与上一章结尾 500 字的 6-gram 重合率（防前情重演）
export function computeBoundaryEchoRatio(
  chapterText,
  previousChapterText = "",
  customLingConfig = null
) {
  if (!previousChapterText || previousChapterText.trim().length === 0) {
    return 0;
  }
  const cfg = customLingConfig || loadLinguisticsConfig();
  const hanRegex = cfg.compiledRegex.hanCharGlobal;
  const prevTail = previousChapterText.trim().slice(-500);
  const currHead = String(chapterText || "").trim().slice(0, 500);
  const prevNgrams = extractHanNgrams(
    prevTail,
    cfg.thresholds.boundaryNgramSize,
    hanRegex
  );
  const currNgrams = extractHanNgrams(
    currHead,
    cfg.thresholds.boundaryNgramSize,
    hanRegex
  );
  if (currNgrams.size === 0 || prevNgrams.size === 0) {
    return 0;
  }
  let overlap = 0;
  for (const gram of currNgrams) {
    if (prevNgrams.has(gram)) overlap += 1;
  }
  return Number((overlap / currNgrams.size).toFixed(3));
}

// 对已完成章节执行硬边界、防剧透围栏与必达事实锚点的确定性代码校验
export function verifyChapterBoundaries(
  chapterText,
  ledger,
  chapterNumber,
  previousChapterText = "",
  customLingConfig = null
) {
  const cfg = customLingConfig || loadLinguisticsConfig();
  const hanRegex = cfg.compiledRegex.hanCharGlobal;
  const chapterSpec = (ledger.chapters || []).find(
    (ch) => ch.chapterNumber === Number(chapterNumber)
  );

  if (!chapterSpec) {
    return {
      pass: false,
      error: `Missing chapter specification for chapter ${chapterNumber}`,
    };
  }

  // 1. 计算本章开篇 500 字与上一章结尾 500 字的 6-gram 重合率（防前情重演）
  const boundaryEchoRatio = computeBoundaryEchoRatio(
    chapterText,
    previousChapterText,
    cfg
  );

  // 剥离成对的 Markdown 加粗/斜体星号，避免 **锚点** 误报缺失或用 **剧透词** 绕过防剧透扫描
  const plainChapterText = stripMarkdownEmphasis(chapterText, [], cfg);

  // 2. 扫描是否违规提前出现后续章节才允许解锁的剧透词（防剧情抢跑）
  const spoilerHits = [];
  const spoilerSet = new Set();
  const recordSpoiler = (term) => {
    if (
      term &&
      (chapterText.includes(term) || plainChapterText.includes(term)) &&
      !spoilerSet.has(term)
    ) {
      spoilerSet.add(term);
      spoilerHits.push(term);
    }
  };
  for (const forbiddenTerm of chapterSpec.futureForbiddenTerms || []) {
    recordSpoiler(forbiddenTerm);
  }
  // 同时校验双栏知识台账中未到揭露章节的里层禁止词
  const numChapter = Number(chapterNumber);
  for (const entry of ledger.knowledgeLedger || []) {
    if (!entry) continue;
    const notRevealedYet =
      entry.revealChapter == null || numChapter < Number(entry.revealChapter);
    if (notRevealedYet) {
      for (const forbiddenTerm of entry.revealForbiddenTerms || []) {
        recordSpoiler(forbiddenTerm);
      }
    }
  }

  // 3. 扫描本章是否遗漏了台账规定的必达事实锚点（防偏离主线或吃书）
  const missingAnchors = [];
  for (const anchor of chapterSpec.requiredAnchors || []) {
    if (
      anchor &&
      !chapterText.includes(anchor) &&
      !plainChapterText.includes(anchor)
    ) {
      missingAnchors.push(anchor);
    }
  }

  // 4. 扫描是否误用已废弃的旧人名或旧设定词（防历史残影吃书）
  const deprecatedHits = [];
  for (const legacyTerm of ledger.deprecatedTerms || []) {
    if (
      legacyTerm &&
      (chapterText.includes(legacyTerm) || plainChapterText.includes(legacyTerm))
    ) {
      deprecatedHits.push(legacyTerm);
    }
  }

  const totalHan = countHan(chapterText, hanRegex);

  return {
    chapterNumber: Number(chapterNumber),
    totalHan,
    boundaryEchoRatio,
    spoilerHits,
    missingAnchors,
    deprecatedHits,
    pass:
      spoilerHits.length === 0 &&
      missingAnchors.length === 0 &&
      deprecatedHits.length === 0,
  };
}
