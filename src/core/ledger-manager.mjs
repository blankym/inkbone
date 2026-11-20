// 纯内存台账管理引擎（零文件系统依赖，供 Node CLI、MCP Server 与浏览器静态试跑台共用）
import { stripSpokenDialogue } from "./rule-engine.mjs";

const CLOSED_FORESHADOW_STATUSES = new Set(["paid_off", "abandoned"]);

// 深度克隆普通 JSON 数据对象，避免就地修改调用方传入的台账
function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

// 从主角对象或字符串提取主角名称与别名集合
function extractProtagonistNames(ledger) {
  const names = [];
  const p = ledger?.protagonist;
  if (typeof p === "string" && p.trim()) {
    names.push(p.trim());
  } else if (p && typeof p === "object") {
    for (const [key, val] of Object.entries(p)) {
      if (typeof val === "string" && val.trim() && (key === "name" || /alias/iu.test(key))) {
        names.push(val.trim());
      }
    }
  }
  return names;
}

// 检查台账整体健康度：结构合法性、章号重复/断档、揭露章矛盾、空摘要、角色名单缺失与逾期伏笔
export function validateLedger(ledger, options = {}) {
  const overdueThreshold =
    Number.isFinite(Number(options.overdueThreshold)) && Number(options.overdueThreshold) > 0
      ? Number(options.overdueThreshold)
      : 20;
  const issues = [];

  if (!ledger || typeof ledger !== "object" || Array.isArray(ledger)) {
    return {
      pass: false,
      summary: { error: 1, warning: 0 },
      stats: {
        chapterCount: 0,
        latestChapter: 0,
        characterCount: 0,
        activeForeshadowingCount: 0,
        overdueForeshadowingCount: 0,
        knowledgeCount: 0,
      },
      issues: [
        {
          code: "INVALID_LEDGER_ROOT",
          severity: "error",
          detail: "Ledger must be a JSON object.",
        },
      ],
    };
  }

  const chapters = Array.isArray(ledger.chapters) ? ledger.chapters : [];
  const knowledgeLedger = Array.isArray(ledger.knowledgeLedger)
    ? ledger.knowledgeLedger
    : [];
  const foreshadowing = Array.isArray(ledger.foreshadowing)
    ? ledger.foreshadowing
    : [];
  const protagonistNames = extractProtagonistNames(ledger);
  const allNames = Array.from(
    new Set([...(Array.isArray(ledger.characterNames) ? ledger.characterNames : []), ...protagonistNames].filter(Boolean))
  );

  // 1. 核查章节号重复、断档与缺失核心摘要
  const seenChapters = new Map();
  const duplicateNumbers = [];
  const emptySummaryChapters = [];
  const numericChapters = [];

  for (const ch of chapters) {
    if (!ch || ch.chapterNumber == null || !Number.isFinite(Number(ch.chapterNumber))) {
      continue;
    }
    const num = Number(ch.chapterNumber);
    numericChapters.push(num);
    seenChapters.set(num, (seenChapters.get(num) || 0) + 1);
    if (seenChapters.get(num) === 2) {
      duplicateNumbers.push(num);
    }
    if (!ch.coreSummary || !String(ch.coreSummary).trim()) {
      emptySummaryChapters.push(num);
    }
  }

  if (duplicateNumbers.length > 0) {
    issues.push({
      code: "DUPLICATE_CHAPTER_NUMBER",
      severity: "error",
      chapters: duplicateNumbers.sort((a, b) => a - b),
      detail: `Duplicate chapterNumber(s): ${duplicateNumbers.join(", ")}`,
    });
  }

  const sortedUnique = Array.from(new Set(numericChapters)).sort((a, b) => a - b);
  const latestChapter =
    options.currentChapter != null && Number.isFinite(Number(options.currentChapter))
      ? Number(options.currentChapter)
      : sortedUnique.length > 0
        ? sortedUnique[sortedUnique.length - 1]
        : 0;

  const gaps = [];
  for (let i = 1; i < sortedUnique.length; i += 1) {
    const prev = sortedUnique[i - 1];
    const curr = sortedUnique[i];
    if (curr - prev > 1) {
      gaps.push([prev + 1, curr - 1]);
    }
  }
  if (gaps.length > 0) {
    issues.push({
      code: "CHAPTER_NUMBER_GAP",
      severity: "warning",
      gaps,
      detail: `Missing chapter range(s): ${gaps.map(([s, e]) => (s === e ? String(s) : `${s}-${e}`)).join(", ")}`,
    });
  }

  if (emptySummaryChapters.length > 0) {
    issues.push({
      code: "EMPTY_CHAPTER_SUMMARY",
      severity: "warning",
      chapters: emptySummaryChapters.sort((a, b) => a - b),
      detail: `${emptySummaryChapters.length} chapter(s) have empty coreSummary: ${emptySummaryChapters.slice(0, 12).join(", ")}`,
    });
  }

  // 2. 核查双栏知识台账揭露章先后逻辑矛盾
  const invalidRevealEntries = [];
  for (const entry of knowledgeLedger) {
    if (!entry) continue;
    const first = entry.firstChapter != null ? Number(entry.firstChapter) : null;
    const reveal = entry.revealChapter != null ? Number(entry.revealChapter) : null;
    if (first !== null && reveal !== null && reveal < first) {
      invalidRevealEntries.push({
        entity: entry.entity || "",
        firstChapter: first,
        revealChapter: reveal,
      });
    }
  }
  if (invalidRevealEntries.length > 0) {
    issues.push({
      code: "INVALID_REVEAL_CHAPTER",
      severity: "error",
      entries: invalidRevealEntries,
      detail: invalidRevealEntries
        .map((e) => `${e.entity || "unnamed"} (reveal ${e.revealChapter} < first ${e.firstChapter})`)
        .join("; "),
    });
  }

  // 3. 核查角色名单是否为空（为空时主语歧义检测默认静默跳过）
  if (protagonistNames.length === 0) {
    issues.push({
      code: "MISSING_PROTAGONIST",
      severity: "warning",
      detail: "protagonist.name is empty.",
    });
  }
  if (allNames.length === 0) {
    issues.push({
      code: "EMPTY_CHARACTER_NAMES",
      severity: "warning",
      detail: "characterNames is empty; SUBJECT_AMBIGUITY checks will be skipped until populated.",
    });
  }

  // 4. 核查长期未回收或已过 targetChapter 的活跃伏笔
  const activeForeshadowing = foreshadowing.filter(
    (item) => item && !CLOSED_FORESHADOW_STATUSES.has(item.status)
  );
  const overdueForeshadowing = [];
  for (const item of activeForeshadowing) {
    const planted = item.plantedChapter != null ? Number(item.plantedChapter) : null;
    const target = item.targetChapter != null ? Number(item.targetChapter) : null;
    const pastTarget = target !== null && latestChapter > 0 && latestChapter > target;
    const age = planted !== null && latestChapter > 0 ? latestChapter - planted : 0;
    const pastAge = planted !== null && age >= overdueThreshold;
    if (pastTarget || pastAge) {
      overdueForeshadowing.push({
        id: item.id || "",
        clue: item.clue || "",
        plantedChapter: planted,
        targetChapter: target,
        chaptersOpen: age,
        reason: pastTarget ? "past_target_chapter" : "open_too_long",
      });
    }
  }
  if (overdueForeshadowing.length > 0) {
    issues.push({
      code: "OVERDUE_FORESHADOWING",
      severity: "warning",
      items: overdueForeshadowing,
      detail: overdueForeshadowing
        .map((f) => `${f.id || f.clue} (planted ch${f.plantedChapter ?? "?"}, target ch${f.targetChapter ?? "?"})`)
        .join("; "),
    });
  }

  // 5. 核查短线战术道具（mustResolveByChapter）是否已超过预定截止章仍未回收
  const tacticalPool = [
    ...activeForeshadowing,
    ...(Array.isArray(ledger.tacticalProps)
      ? ledger.tacticalProps.filter((p) => p && !CLOSED_FORESHADOW_STATUSES.has(p.status))
      : []),
  ];
  const unresolvedProps = [];
  for (const item of tacticalPool) {
    const resolveBy =
      item.mustResolveByChapter != null
        ? Number(item.mustResolveByChapter)
        : item.shortTerm && item.targetChapter != null
          ? Number(item.targetChapter)
          : null;
    if (resolveBy !== null && Number.isFinite(resolveBy) && latestChapter >= resolveBy) {
      unresolvedProps.push({
        id: item.id || item.anchorTerm || item.clue || "",
        anchorTerm: item.anchorTerm || item.clue || "",
        plantedChapter: item.plantedChapter != null ? Number(item.plantedChapter) : null,
        mustResolveByChapter: resolveBy,
      });
    }
  }
  if (unresolvedProps.length > 0) {
    issues.push({
      code: "UNRESOLVED_TACTICAL_PROP",
      severity: "warning",
      items: unresolvedProps,
      detail: unresolvedProps
        .map((p) => `${p.id} (mustResolveBy ch${p.mustResolveByChapter}, current ch${latestChapter})`)
        .join("; "),
    });
  }

  // 6. 核查跨章可量化资源流水（resourceDeltas）的单章加减算术与跨章期初/期末余额守恒
  const sortedChObjs = [...chapters]
    .filter((c) => c && Number.isFinite(Number(c.chapterNumber)))
    .sort((a, b) => Number(a.chapterNumber) - Number(b.chapterNumber));
  const lastResourceBalance = new Map();
  const resourceMismatches = [];

  for (const ch of sortedChObjs) {
    const chNum = Number(ch.chapterNumber);
    const deltas = ch.resourceDeltas;
    if (!deltas || typeof deltas !== "object" || Array.isArray(deltas)) continue;

    for (const [resName, rec] of Object.entries(deltas)) {
      if (!rec || typeof rec !== "object") continue;
      const before = rec.before != null ? Number(rec.before) : null;
      const delta = rec.delta != null ? Number(rec.delta) : null;
      const after = rec.after != null ? Number(rec.after) : null;

      if (
        before !== null &&
        delta !== null &&
        after !== null &&
        Number.isFinite(before) &&
        Number.isFinite(delta) &&
        Number.isFinite(after)
      ) {
        const expectedAfter = Number((before + delta).toFixed(4));
        if (Math.abs(expectedAfter - after) > 1e-4) {
          resourceMismatches.push({
            resource: resName,
            chapterNumber: chNum,
            kind: "arithmetic_error",
            before,
            delta,
            after,
            expectedAfter,
          });
        }
      }

      if (before !== null && Number.isFinite(before) && lastResourceBalance.has(resName)) {
        const prev = lastResourceBalance.get(resName);
        if (Math.abs(prev.after - before) > 1e-4) {
          resourceMismatches.push({
            resource: resName,
            chapterNumber: chNum,
            kind: "cross_chapter_discontinuity",
            previousChapter: prev.chapterNumber,
            previousAfter: prev.after,
            currentBefore: before,
          });
        }
      }

      if (after !== null && Number.isFinite(after)) {
        lastResourceBalance.set(resName, { chapterNumber: chNum, after });
      }
    }
  }

  if (resourceMismatches.length > 0) {
    issues.push({
      code: "RESOURCE_LEDGER_MISMATCH",
      severity: "error",
      mismatches: resourceMismatches,
      detail: resourceMismatches
        .map((m) =>
          m.kind === "arithmetic_error"
            ? `${m.resource}@ch${m.chapterNumber}: ${m.before} + (${m.delta}) != ${m.after}`
            : `${m.resource}@ch${m.chapterNumber}: before=${m.currentBefore} != ch${m.previousChapter}.after=${m.previousAfter}`
        )
        .join("; "),
    });
  }

  const errorCount = issues.filter((i) => i.severity === "error").length;
  const warningCount = issues.filter((i) => i.severity === "warning").length;

  return {
    pass: errorCount === 0,
    summary: { error: errorCount, warning: warningCount },
    stats: {
      chapterCount: chapters.length,
      latestChapter,
      characterCount: allNames.length,
      activeForeshadowingCount: activeForeshadowing.length,
      overdueForeshadowingCount: overdueForeshadowing.length,
      knowledgeCount: knowledgeLedger.length,
    },
    issues,
  };
}

// 无损合并单章写后结算 JSON 补丁到全书台账，并返回结构化变更 diff
export function applyChapterSettlement(ledger, patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    throw new Error("Settlement patch must be a JSON object.");
  }
  const chapNum = Number(patch.chapterNumber);
  if (!Number.isFinite(chapNum) || chapNum <= 0) {
    throw new Error("Settlement patch requires a positive numeric chapterNumber.");
  }

  const next = cloneJson(
    ledger && typeof ledger === "object"
      ? ledger
      : {
          projectTitle: "",
          protagonist: "",
          characterNames: [],
          immutableWorldRules: [],
          deprecatedTerms: [],
          knowledgeLedger: [],
          characterSnapshots: {},
          foreshadowing: [],
          chapters: [],
        }
  );

  if (!Array.isArray(next.chapters)) next.chapters = [];
  if (!Array.isArray(next.characterNames)) next.characterNames = [];
  if (!Array.isArray(next.foreshadowing)) next.foreshadowing = [];
  if (!Array.isArray(next.knowledgeLedger)) next.knowledgeLedger = [];
  if (!next.characterSnapshots || typeof next.characterSnapshots !== "object") {
    next.characterSnapshots = {};
  }

  const diff = {
    chapterNumber: chapNum,
    chapterAdded: false,
    chapterUpdated: false,
    updatedCharacters: [],
    addedCharacters: [],
    addedForeshadowing: [],
    updatedForeshadowing: [],
    resolvedForeshadowing: [],
    updatedKnowledge: [],
    updatedResources: [],
  };

  // 1. 合并或追加 chapters[] 条目
  const existingIdx = next.chapters.findIndex(
    (c) => Number(c.chapterNumber) === chapNum
  );
  if (existingIdx >= 0) {
    const cur = next.chapters[existingIdx];
    const merged = { ...cur };
    if (patch.title !== undefined && String(patch.title).trim()) {
      merged.title = String(patch.title).trim();
    }
    if (patch.coreSummary !== undefined && String(patch.coreSummary).trim()) {
      merged.coreSummary = String(patch.coreSummary).trim();
    }
    if (Array.isArray(patch.requiredAnchors)) {
      merged.requiredAnchors = Array.from(
        new Set([...(cur.requiredAnchors || []), ...patch.requiredAnchors].filter(Boolean))
      );
    }
    if (Array.isArray(patch.futureForbiddenTerms)) {
      merged.futureForbiddenTerms = Array.from(
        new Set([...(cur.futureForbiddenTerms || []), ...patch.futureForbiddenTerms].filter(Boolean))
      );
    }
    if (Array.isArray(patch.activeCharacters)) {
      merged.activeCharacters = Array.from(
        new Set([...(cur.activeCharacters || []), ...patch.activeCharacters].filter(Boolean))
      );
    }
    if (patch.hanCount != null && Number.isFinite(Number(patch.hanCount))) {
      merged.hanCount = Number(patch.hanCount);
    }
    merged.settled = true;
    next.chapters[existingIdx] = merged;
    diff.chapterUpdated = true;
  } else {
    const entry = {
      chapterNumber: chapNum,
      title: String(patch.title || "").trim(),
      coreSummary: String(patch.coreSummary || "").trim(),
      requiredAnchors: Array.isArray(patch.requiredAnchors)
        ? patch.requiredAnchors.filter(Boolean)
        : [],
      futureForbiddenTerms: Array.isArray(patch.futureForbiddenTerms)
        ? patch.futureForbiddenTerms.filter(Boolean)
        : [],
      settled: true,
    };
    if (Array.isArray(patch.activeCharacters) && patch.activeCharacters.length > 0) {
      entry.activeCharacters = Array.from(new Set(patch.activeCharacters.filter(Boolean)));
    }
    if (patch.hanCount != null && Number.isFinite(Number(patch.hanCount))) {
      entry.hanCount = Number(patch.hanCount);
    }
    next.chapters.push(entry);
    next.chapters.sort((a, b) => Number(a.chapterNumber) - Number(b.chapterNumber));
    diff.chapterAdded = true;
  }

  // 2. 合并角色 8 字段快照增量
  const charUpdates = patch.characterUpdates;
  if (charUpdates && typeof charUpdates === "object" && !Array.isArray(charUpdates)) {
    for (const [charName, delta] of Object.entries(charUpdates)) {
      if (!charName || !delta || typeof delta !== "object") continue;
      const prevSnap =
        next.characterSnapshots[charName] && typeof next.characterSnapshots[charName] === "object"
          ? next.characterSnapshots[charName]
          : { name: charName };
      const mergedSnap = {
        ...prevSnap,
        ...delta,
        name: delta.name || prevSnap.name || charName,
        lastUpdatedChapter: chapNum,
      };
      const statusLower = String(mergedSnap.status || "").toLowerCase();
      if (
        ["deceased", "dead", "exited", "killed"].includes(statusLower) &&
        mergedSnap.deceasedChapter == null &&
        mergedSnap.absentAfterChapter == null
      ) {
        mergedSnap.deceasedChapter = chapNum;
      }
      next.characterSnapshots[charName] = mergedSnap;
      diff.updatedCharacters.push(charName);
    }
  }

  // 3. 自动把新出场或更新过的角色同步写入 characterNames
  const existingNameSet = new Set(next.characterNames);
  const candidateNames = [
    ...(Array.isArray(patch.newCharacters) ? patch.newCharacters : []),
    ...(Array.isArray(patch.activeCharacters) ? patch.activeCharacters : []),
    ...diff.updatedCharacters,
  ];
  for (const name of candidateNames) {
    const clean = String(name || "").trim();
    if (clean && !existingNameSet.has(clean)) {
      next.characterNames.push(clean);
      existingNameSet.add(clean);
      diff.addedCharacters.push(clean);
    }
  }

  // 4. 合并伏笔台账新增与状态跃迁（planted -> paid_off / abandoned）
  if (Array.isArray(patch.foreshadowingUpdates)) {
    for (const upd of patch.foreshadowingUpdates) {
      if (!upd || typeof upd !== "object") continue;
      const idx = next.foreshadowing.findIndex(
        (item) =>
          item &&
          ((upd.id && item.id === upd.id) || (!upd.id && upd.clue && item.clue === upd.clue))
      );
      if (idx >= 0) {
        const prev = next.foreshadowing[idx];
        const merged = { ...prev, ...upd };
        if (CLOSED_FORESHADOW_STATUSES.has(merged.status) && merged.paidOffChapter == null) {
          merged.paidOffChapter = chapNum;
        }
        next.foreshadowing[idx] = merged;
        if (
          !CLOSED_FORESHADOW_STATUSES.has(prev.status) &&
          CLOSED_FORESHADOW_STATUSES.has(merged.status)
        ) {
          diff.resolvedForeshadowing.push(merged.id || merged.clue);
        } else {
          diff.updatedForeshadowing.push(merged.id || merged.clue);
        }
      } else {
        const added = {
          id: upd.id || `fs_ch${chapNum}_${next.foreshadowing.length + 1}`,
          clue: upd.clue || "",
          plantedChapter: upd.plantedChapter ?? chapNum,
          targetChapter: upd.targetChapter ?? null,
          status: upd.status || "planted",
        };
        if (upd.mustResolveByChapter != null) {
          added.mustResolveByChapter = Number(upd.mustResolveByChapter);
        }
        if (upd.anchorTerm) added.anchorTerm = String(upd.anchorTerm).trim();
        if (upd.shortTerm != null) added.shortTerm = Boolean(upd.shortTerm);
        if (upd.notes) added.notes = upd.notes;
        next.foreshadowing.push(added);
        diff.addedForeshadowing.push(added.id);
      }
    }
  }

  // 4b. 合并章节可量化资源流水（resourceDeltas / resourceUpdates）并更新总账余额
  const resInput = patch.resourceDeltas || patch.resourceUpdates;
  if (resInput && typeof resInput === "object" && !Array.isArray(resInput)) {
    if (!next.resourceLedger || typeof next.resourceLedger !== "object") {
      next.resourceLedger = {};
    }
    const chIdx = next.chapters.findIndex((c) => Number(c.chapterNumber) === chapNum);
    const chObj = chIdx >= 0 ? next.chapters[chIdx] : null;
    if (chObj && (!chObj.resourceDeltas || typeof chObj.resourceDeltas !== "object")) {
      chObj.resourceDeltas = {};
    }
    for (const [resName, rec] of Object.entries(resInput)) {
      if (!resName || !rec || typeof rec !== "object") continue;
      const cleanRec = {};
      if (rec.before != null && Number.isFinite(Number(rec.before))) {
        cleanRec.before = Number(rec.before);
      }
      if (rec.delta != null && Number.isFinite(Number(rec.delta))) {
        cleanRec.delta = Number(rec.delta);
      }
      if (rec.after != null && Number.isFinite(Number(rec.after))) {
        cleanRec.after = Number(rec.after);
      } else if (cleanRec.before !== undefined && cleanRec.delta !== undefined) {
        cleanRec.after = Number((cleanRec.before + cleanRec.delta).toFixed(4));
      }
      if (rec.note) cleanRec.note = String(rec.note);
      if (chObj) {
        chObj.resourceDeltas[resName] = cleanRec;
      }
      if (cleanRec.after !== undefined) {
        next.resourceLedger[resName] = {
          balance: cleanRec.after,
          lastUpdatedChapter: chapNum,
        };
      }
      diff.updatedResources.push(resName);
    }
  }

  // 5. 合并双栏知识台账增量更新
  if (Array.isArray(patch.knowledgeUpdates)) {
    for (const ku of patch.knowledgeUpdates) {
      if (!ku || typeof ku !== "object" || !ku.entity) continue;
      const idx = next.knowledgeLedger.findIndex((k) => k && k.entity === ku.entity);
      if (idx >= 0) {
        const prev = next.knowledgeLedger[idx];
        next.knowledgeLedger[idx] = {
          ...prev,
          ...ku,
          revealForbiddenTerms: Array.isArray(ku.revealForbiddenTerms)
            ? Array.from(
                new Set([...(prev.revealForbiddenTerms || []), ...ku.revealForbiddenTerms].filter(Boolean))
              )
            : prev.revealForbiddenTerms || [],
        };
      } else {
        next.knowledgeLedger.push({
          entity: ku.entity,
          firstChapter: ku.firstChapter ?? chapNum,
          readerKnown: ku.readerKnown || "",
          fullTruth: ku.fullTruth || "",
          revealChapter: ku.revealChapter ?? null,
          revealForbiddenTerms: Array.isArray(ku.revealForbiddenTerms)
            ? ku.revealForbiddenTerms.filter(Boolean)
            : [],
        });
      }
      diff.updatedKnowledge.push(ku.entity);
    }
  }

  return { ledger: next, diff };
}

// 校验候选人名是否命中单姓、复姓或姓氏+称谓结构（完全由 JSON 配置驱动，零汉字字面量）
function classifyCandidateName(candidate, cfg) {
  if (!candidate || candidate.length < 2 || candidate.length > 4) return null;
  if (cfg.stopwordSet && cfg.stopwordSet.has(candidate)) return null;

  for (const cs of cfg.compoundSurnames || []) {
    if (candidate.startsWith(cs) && candidate.length >= cs.length + 1 && candidate.length <= cs.length + 2) {
      return { kind: "compound_surname", bonus: 2.2 };
    }
  }
  const firstChar = candidate[0];
  const hasSurname = cfg.surnameSet ? cfg.surnameSet.has(firstChar) : false;
  if (hasSurname) {
    for (const suffix of cfg.titleSuffixes || []) {
      if (candidate.endsWith(suffix) && candidate.length === 1 + suffix.length) {
        return { kind: "surname_title", bonus: 2.0 };
      }
    }
    if (candidate.length === 2 || candidate.length === 3) {
      return { kind: "surname_name", bonus: 1.6 };
    }
  }
  for (const suffix of cfg.titleSuffixes || []) {
    if (suffix.length >= 2 && candidate.endsWith(suffix) && candidate.length >= suffix.length + 1 && candidate.length <= 4) {
      return { kind: "title_name", bonus: 1.2 };
    }
  }
  return null;
}

// 零依赖启发式挖掘存量章节中的高频角色名候选（用于初始化或补全 ledger.characterNames）
export function extractCandidateCharacters(texts, lingConfig, options = {}) {
  const cfg = lingConfig?.compiledRegex?.characterExtraction;
  if (!cfg || !cfg.speechActionRegex || !Array.isArray(texts) || texts.length === 0) {
    return [];
  }

  const minTotalCount = options.minTotalCount ?? cfg.minTotalCount ?? 2;
  const maxCandidates = options.maxCandidates ?? cfg.maxCandidates ?? 24;
  const statsMap = new Map();

  for (const rawText of texts) {
    const lines = String(rawText || "").split(/\r?\n/u);
    const seenInDoc = new Set();

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const { narration } = stripSpokenDialogue(trimmed, lingConfig, " ");
      if (!narration) continue;

      cfg.speechActionRegex.lastIndex = 0;
      let match;
      while ((match = cfg.speechActionRegex.exec(narration)) !== null) {
        const rawCandidate = match[1];
        if (!rawCandidate) continue;
        // 尝试从最长到 2 字的后缀切片匹配，避免把前导介词/副词粘进人名
        let matchedName = null;
        let matchedMeta = null;
        const maxLen = Math.min(rawCandidate.length, 4);
        for (let len = maxLen; len >= 2; len -= 1) {
          const slice = rawCandidate.slice(rawCandidate.length - len);
          const meta = classifyCandidateName(slice, cfg);
          if (meta) {
            matchedName = slice;
            matchedMeta = meta;
            break;
          }
        }
        if (!matchedName || !matchedMeta) continue;

        const rec = statsMap.get(matchedName) || {
          name: matchedName,
          kind: matchedMeta.kind,
          bonus: matchedMeta.bonus,
          actionHits: 0,
          totalCount: 0,
          chapterCount: 0,
        };
        rec.actionHits += 1;
        if (!seenInDoc.has(matchedName)) {
          rec.chapterCount += 1;
          seenInDoc.add(matchedName);
        }
        statsMap.set(matchedName, rec);
      }
    }
  }

  // 统计每个候选名在所有文本中的总出现频次，并按动作锚定次数 + 跨章覆盖综合排序
  const allCombined = texts.join("\n");
  const candidates = [];
  for (const rec of statsMap.values()) {
    const parts = allCombined.split(rec.name);
    rec.totalCount = parts.length - 1;
    if (rec.totalCount < minTotalCount) continue;
    const score = Number(
      (rec.actionHits * rec.bonus + Math.min(rec.totalCount, 40) * 0.4 + rec.chapterCount * 1.5).toFixed(2)
    );
    const confidence =
      rec.actionHits >= 2 || (rec.chapterCount >= 2 && rec.totalCount >= 3)
        ? "high"
        : "medium";
    candidates.push({
      name: rec.name,
      kind: rec.kind,
      actionHits: rec.actionHits,
      totalCount: rec.totalCount,
      chapterCount: rec.chapterCount,
      confidence,
      score,
    });
  }

  candidates.sort((a, b) => b.score - a.score || b.totalCount - a.totalCount);

  // 去除被更长高频全名完全包含的低频截断片段
  const filtered = candidates.filter((cand) => {
    if (cand.name.length >= 3) return true;
    const shadowedBy = candidates.find(
      (other) =>
        other.name.length > cand.name.length &&
        other.name.includes(cand.name) &&
        other.totalCount >= cand.totalCount * 0.7
    );
    return !shadowedBy;
  });

  return filtered.slice(0, maxCandidates);
}

// 批量无损合并多章写后结算补丁数组（供老书半途接管或批量回填 coreSummary 与状态使用）
export function applyBatchSettlement(ledger, patchesInput) {
  const list = Array.isArray(patchesInput)
    ? patchesInput
    : Array.isArray(patchesInput?.patches)
      ? patchesInput.patches
      : null;
  if (!list || list.length === 0) {
    throw new Error("Batch settlement requires a non-empty array of chapter patches.");
  }
  const sorted = [...list].sort(
    (a, b) => Number(a?.chapterNumber || 0) - Number(b?.chapterNumber || 0)
  );
  let curLedger = ledger;
  const diffs = [];
  for (const patch of sorted) {
    const res = applyChapterSettlement(curLedger, patch);
    curLedger = res.ledger;
    diffs.push(res.diff);
  }
  return {
    ledger: curLedger,
    batchDiff: {
      settledCount: diffs.length,
      chapters: diffs.map((d) => d.chapterNumber),
      diffs,
    },
  };
}

// 针对老书尚未填写 coreSummary 的存量章节，分批生成可直接输出 settle --batch JSON 的回填提示词
export function buildLedgerBackfillPrompts(chapterEntries, ledger = {}, options = {}) {
  const batchSize =
    Number.isFinite(Number(options.batchSize)) && Number(options.batchSize) > 0
      ? Math.floor(Number(options.batchSize))
      : 5;
  const maxExcerptChars =
    Number.isFinite(Number(options.maxExcerptChars)) && Number(options.maxExcerptChars) > 200
      ? Math.floor(Number(options.maxExcerptChars))
      : 3200;

  const existingByNum = new Map();
  for (const ch of ledger?.chapters || []) {
    if (ch && Number.isFinite(Number(ch.chapterNumber))) {
      existingByNum.set(Number(ch.chapterNumber), ch);
    }
  }

  const missingEntries = (chapterEntries || [])
    .filter((entry) => {
      if (!entry || !Number.isFinite(Number(entry.chapterNumber))) return false;
      const existing = existingByNum.get(Number(entry.chapterNumber));
      if (options.includeAll) return true;
      return !existing || !existing.coreSummary || !String(existing.coreSummary).trim();
    })
    .sort((a, b) => Number(a.chapterNumber) - Number(b.chapterNumber));

  const batches = [];
  for (let i = 0; i < missingEntries.length; i += batchSize) {
    const slice = missingEntries.slice(i, i + batchSize);
    const chNums = slice.map((s) => Number(s.chapterNumber));
    const schemaExample = [
      {
        chapterNumber: chNums[0] || 1,
        title: slice[0]?.title || "",
        coreSummary: "One-sentence factual summary (<100 chars): who did what, key gain/cost, ending state.",
        requiredAnchors: ["Anchor1", "Anchor2"],
        activeCharacters: ["Protagonist"],
        characterUpdates: {},
        foreshadowingUpdates: [],
        resourceDeltas: {},
      },
    ];

    const bodyBlocks = slice.map((item) => {
      const raw = String(item.text || "").trim();
      const excerpt =
        raw.length <= maxExcerptChars
          ? raw
          : `${raw.slice(0, Math.floor(maxExcerptChars * 0.65))}\n...\n${raw.slice(-Math.floor(maxExcerptChars * 0.35))}`;
      return `=== CHAPTER ${item.chapterNumber}: ${item.title || item.name || ""} ===\n${excerpt}`;
    });

    const prompt = [
      `# InkBone Batch Ledger Backfill (Chapters ${chNums[0]}-${chNums[chNums.length - 1]})`,
      "Extract factual chapter summaries, key anchors, active characters, and resource/foreshadowing deltas from the chapters below.",
      "Output ONLY a valid JSON array matching `inkbone settle --batch` format:",
      "```json",
      JSON.stringify(schemaExample, null, 2),
      "```",
      ...bodyBlocks,
    ].join("\n\n");

    batches.push({
      batchIndex: batches.length + 1,
      chapters: chNums,
      chapterCount: slice.length,
      prompt,
    });
  }

  return {
    totalMissingChapters: missingEntries.length,
    batchSize,
    batchCount: batches.length,
    batches:
      Number.isFinite(Number(options.limit)) && Number(options.limit) > 0
        ? batches.slice(0, Number(options.limit))
        : batches,
  };
}
