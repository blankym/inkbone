import { countHan, profileText } from "./profiler.mjs";
import { stripMarkdownEmphasis } from "./normalizer.mjs";
import { stripSpokenDialogue } from "./rule-engine.mjs";

// 转义正则特殊字符以安全匹配角色名
function escapeRegExp(str) {
  return String(str || "").replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

// 收集截至当前章已经阵亡或退场的角色清单（兼容 characterSnapshots.status 与 deceasedCharacters 两种写法）
function collectInactiveCharacters(ledger, numChapter, inactiveStatuses) {
  const byName = new Map();
  const statusSet = inactiveStatuses || new Set(["deceased", "dead", "exited", "killed"]);

  const snaps = ledger?.characterSnapshots;
  if (snaps && typeof snaps === "object" && !Array.isArray(snaps)) {
    for (const [key, snap] of Object.entries(snaps)) {
      if (!snap || typeof snap !== "object") continue;
      const status = String(snap.status || "").toLowerCase();
      if (!statusSet.has(status)) continue;
      const afterChap =
        snap.absentAfterChapter ?? snap.deceasedChapter ?? snap.lastUpdatedChapter ?? null;
      if (afterChap != null && Number(afterChap) < numChapter) {
        const name = String(snap.name || key).trim();
        if (name) {
          byName.set(name, { name, status, afterChapter: Number(afterChap) });
        }
      }
    }
  }

  for (const item of ledger?.deceasedCharacters || []) {
    if (!item) continue;
    const name = typeof item === "string" ? item.trim() : String(item.name || "").trim();
    const afterChap = typeof item === "object" ? item.afterChapter ?? item.deceasedChapter : 0;
    if (name && (afterChap == null || Number(afterChap) < numChapter)) {
      byName.set(name, {
        name,
        status: (typeof item === "object" && item.status) || "deceased",
        afterChapter: afterChap != null ? Number(afterChap) : null,
      });
    }
  }

  return Array.from(byName.values());
}

// 检查已阵亡或退场角色是否在非回忆段落的叙述层中作为活跃动作/说话主体再次出场（防吃书诈尸）
export function checkDeceasedCharacterAppearances(
  chapterText,
  ledger,
  chapterNumber,
  customLingConfig = null
) {
  const numChapter = Number(chapterNumber);
  if (!chapterText || !ledger || !Number.isFinite(numChapter)) return [];
  const guard = customLingConfig?.compiledRegex?.characterStateGuard;
  const inactive = collectInactiveCharacters(ledger, numChapter, guard?.inactiveStatuses);
  if (inactive.length === 0) return [];

  const flashbackRe = guard?.flashbackRegex || null;
  const verbPattern = guard?.activeVerbPattern || "";
  const lines = String(chapterText).split(/\r?\n/u);
  const hits = [];

  lines.forEach((rawLine, idx) => {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const { narration } = stripSpokenDialogue(trimmed, customLingConfig, " ");
    if (!narration || !narration.trim()) return;
    // 回忆、梦境、追忆、祭奠语境默认豁免，避免误杀合法回忆杀
    if (flashbackRe && flashbackRe.test(trimmed)) return;

    for (const char of inactive) {
      if (!narration.includes(char.name)) continue;
      const escaped = escapeRegExp(char.name);
      const activeRe = verbPattern
        ? new RegExp(`${escaped}[^\\n\\r。！？，,；;]{0,6}${verbPattern}`, "u")
        : new RegExp(`^\\s*${escaped}`, "u");
      const m = activeRe.exec(narration);
      if (m) {
        hits.push({
          line: idx + 1,
          character: char.name,
          status: char.status,
          afterChapter: char.afterChapter,
          matched: m[0].slice(0, 32),
        });
      }
    }
  });

  return hits;
}

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

// 收集当前章节仍处于锁定状态的禁泄底词（含本章 futureForbiddenTerms 与未到揭露章的 knowledgeLedger 禁止词）
function collectLockedForbiddenTerms(ledger, chapterSpec, numChapter) {
  const locked = new Set();
  for (const forbiddenTerm of chapterSpec?.futureForbiddenTerms || []) {
    if (forbiddenTerm) locked.add(forbiddenTerm);
  }
  for (const entry of ledger?.knowledgeLedger || []) {
    if (!entry) continue;
    const notRevealedYet =
      entry.revealChapter == null || numChapter < Number(entry.revealChapter);
    if (!notRevealedYet) continue;
    for (const forbiddenTerm of entry.revealForbiddenTerms || []) {
      if (forbiddenTerm) locked.add(forbiddenTerm);
    }
  }
  return Array.from(locked).sort((a, b) => b.length - a.length);
}

// 在传递给写作端的只读后续细纲里脱敏仍处于锁定状态的剧透词
function redactLockedTerms(text, lockedTerms) {
  let out = String(text || "");
  if (!out || !lockedTerms || lockedTerms.length === 0) return out;
  for (const term of lockedTerms) {
    if (out.includes(term)) {
      out = out.split(term).join("[REDACTED]");
    }
  }
  return out;
}

// 从全书台账配置中提取指定章节的硬边界创作数据包（借鉴 Pagekin 上下文隔离机制）
export function compileBoundaryPacket(
  ledger,
  chapterNumber,
  previousChapterText = "",
  options = {}
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

  // 提取后续章节大纲作为只读预告围栏，并对未解锁秘密词做联动脱敏，防止侧路剧透
  const lockedTerms = collectLockedForbiddenTerms(ledger, chapterSpec, numChapter);
  const futureBlueprints = (ledger.chapters || [])
    .filter((ch) => ch.chapterNumber > numChapter)
    .sort((a, b) => a.chapterNumber - b.chapterNumber)
    .slice(0, 3)
    .map((ch) => ({
      chapterNumber: ch.chapterNumber,
      title: redactLockedTerms(ch.title, lockedTerms),
      coreSummary: redactLockedTerms(ch.coreSummary, lockedTerms),
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

  // 若指定本章出场角色（options.activeCharacters 或 chapterSpec.activeCharacters），按需裁剪角色快照以控制长篇上下文体积
  if (ledger.characterSnapshots !== undefined) {
    const activeList = Array.isArray(options.activeCharacters)
      ? options.activeCharacters
      : Array.isArray(chapterSpec.activeCharacters)
        ? chapterSpec.activeCharacters
        : null;
    if (
      activeList &&
      activeList.length > 0 &&
      ledger.characterSnapshots &&
      typeof ledger.characterSnapshots === "object" &&
      !Array.isArray(ledger.characterSnapshots)
    ) {
      const keepSet = new Set(activeList.filter(Boolean));
      const pName =
        typeof ledger.protagonist === "string"
          ? ledger.protagonist
          : ledger.protagonist?.name;
      if (pName) keepSet.add(pName);
      const filteredSnapshots = {};
      let omitted = 0;
      for (const [key, snap] of Object.entries(ledger.characterSnapshots)) {
        const snapName = snap?.name || key;
        if (keepSet.has(key) || keepSet.has(snapName)) {
          filteredSnapshots[key] = snap;
        } else {
          omitted += 1;
        }
      }
      packet.characterSnapshots = filteredSnapshots;
      if (omitted > 0) {
        packet.omittedCharacterSnapshotsCount = omitted;
      }
    } else {
      packet.characterSnapshots = ledger.characterSnapshots;
    }
  }

  // 透传截至本章已埋下的活跃伏笔（默认过滤已回收/放弃条目），并单列本章到期或超期未收伏笔提醒
  if (Array.isArray(ledger.foreshadowing)) {
    const includeClosed = Boolean(options.includeClosedForeshadowing);
    const overdueThreshold =
      Number.isFinite(Number(options.overdueThreshold)) && Number(options.overdueThreshold) > 0
        ? Number(options.overdueThreshold)
        : 20;
    const closedStatuses = new Set(["paid_off", "abandoned"]);
    const visibleForeshadowing = ledger.foreshadowing.filter((item) => {
      if (!item) return false;
      if (item.plantedChapter != null && Number(item.plantedChapter) > numChapter) {
        return false;
      }
      if (!includeClosed && closedStatuses.has(item.status)) {
        return false;
      }
      return true;
    });
    packet.foreshadowing = visibleForeshadowing;

    const dueForeshadowing = visibleForeshadowing.filter((item) => {
      if (closedStatuses.has(item.status)) return false;
      const target = item.targetChapter != null ? Number(item.targetChapter) : null;
      const planted = item.plantedChapter != null ? Number(item.plantedChapter) : null;
      return (
        (target !== null && target <= numChapter) ||
        (planted !== null && numChapter - planted >= overdueThreshold)
      );
    });
    if (dueForeshadowing.length > 0) {
      packet.dueForeshadowing = dueForeshadowing;
    }
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
  const cfg = customLingConfig;
  if (!cfg) {
    throw new Error("linguisticsConfig is required for computeBoundaryEchoRatio.");
  }
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
  const cfg = customLingConfig;
  if (!cfg) {
    throw new Error("linguisticsConfig is required for verifyChapterBoundaries.");
  }
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
  const numChapter = Number(chapterNumber);
  const spoilerHits = [];
  for (const term of collectLockedForbiddenTerms(ledger, chapterSpec, numChapter)) {
    if (chapterText.includes(term) || plainChapterText.includes(term)) {
      spoilerHits.push(term);
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

  // 5. 扫描已阵亡或退场角色是否在非回忆段落中再次作为活跃主体行动/说话（warning 级防吃书提醒）
  const deceasedHits = checkDeceasedCharacterAppearances(
    plainChapterText,
    ledger,
    numChapter,
    cfg
  );

  // 6. 扫描已达 mustResolveByChapter 预定截止章的短线战术伏笔/道具是否在本章漏收（防悬空道具吃书）
  const unresolvedProps = checkUnresolvedTacticalProps(
    plainChapterText,
    ledger,
    numChapter
  );

  // 7. 扫描正文是否违反带 forbiddenPattern 的结构化世界观硬铁律（immutableWorldRules）
  const worldRuleHits = checkWorldRuleViolations(
    plainChapterText,
    ledger,
    numChapter
  );

  const totalHan = countHan(chapterText, hanRegex);

  return {
    chapterNumber: Number(chapterNumber),
    totalHan,
    boundaryEchoRatio,
    spoilerHits,
    missingAnchors,
    deprecatedHits,
    deceasedHits,
    unresolvedProps,
    worldRuleHits,
    pass:
      spoilerHits.length === 0 &&
      missingAnchors.length === 0 &&
      deprecatedHits.length === 0,
  };
}

// 检查在当前章必须结算回收的短线战术道具（mustResolveByChapter）是否已在正文兑现
export function checkUnresolvedTacticalProps(chapterText, ledger, chapterNumber) {
  const numChapter = Number(chapterNumber);
  if (!ledger || !Number.isFinite(numChapter)) return [];
  const closedStatuses = new Set(["paid_off", "abandoned", "resolved"]);
  const pool = [
    ...(Array.isArray(ledger.foreshadowing) ? ledger.foreshadowing : []),
    ...(Array.isArray(ledger.tacticalProps) ? ledger.tacticalProps : []),
  ];
  const text = String(chapterText || "");
  const unresolved = [];

  for (const item of pool) {
    if (!item || typeof item !== "object") continue;
    if (closedStatuses.has(String(item.status || "").toLowerCase())) continue;
    const resolveBy =
      item.mustResolveByChapter != null
        ? Number(item.mustResolveByChapter)
        : item.shortTerm && item.targetChapter != null
          ? Number(item.targetChapter)
          : null;
    if (resolveBy === null || !Number.isFinite(resolveBy)) continue;
    const planted = item.plantedChapter != null ? Number(item.plantedChapter) : 0;
    if (numChapter < planted || numChapter < resolveBy) continue;

    const anchor = String(item.anchorTerm || item.prop || item.clue || "").trim();
    if (!anchor) continue;
    if (!text.includes(anchor)) {
      unresolved.push({
        id: item.id || anchor,
        anchorTerm: anchor,
        plantedChapter: planted || null,
        mustResolveByChapter: resolveBy,
        clue: item.clue || anchor,
      });
    }
  }

  return unresolved;
}

// 检查正文是否违反 ledger.immutableWorldRules 中定义了 forbiddenPattern 的世界观硬铁律
export function checkWorldRuleViolations(chapterText, ledger, chapterNumber) {
  const numChapter = Number(chapterNumber);
  if (!chapterText || !ledger) return [];
  const rules = Array.isArray(ledger.immutableWorldRules)
    ? ledger.immutableWorldRules
    : [];
  const structuredRules = rules.filter(
    (r) => r && typeof r === "object" && typeof r.forbiddenPattern === "string" && r.forbiddenPattern.trim()
  );
  if (structuredRules.length === 0) return [];

  const lines = String(chapterText).split(/\r?\n/u);
  const hits = [];

  for (const ruleObj of structuredRules) {
    if (Array.isArray(ruleObj.activeChapters) && ruleObj.activeChapters.length >= 2 && Number.isFinite(numChapter)) {
      const minCh = Number(ruleObj.activeChapters[0]);
      const maxCh = Number(ruleObj.activeChapters[1]);
      if (numChapter < minCh || numChapter > maxCh) continue;
    }
    const re = new RegExp(ruleObj.forbiddenPattern, "gu");
    const exemptTerms = Array.isArray(ruleObj.exemptTerms)
      ? ruleObj.exemptTerms.filter(Boolean)
      : [];

    lines.forEach((rawLine, idx) => {
      const trimmed = rawLine.trim();
      if (!trimmed || trimmed.startsWith("#")) return;
      if (exemptTerms.some((term) => trimmed.includes(term))) return;
      re.lastIndex = 0;
      const m = re.exec(trimmed);
      if (m) {
        hits.push({
          line: idx + 1,
          id: ruleObj.id || "world_rule_guard",
          rule: String(ruleObj.rule || ruleObj.text || ruleObj.id || ""),
          matched: m[0],
        });
      }
    });
  }

  return hits;
}
