// 规则扫描引擎：统一承接书级字面量白名单、单行安全引号遮蔽、密度门槛、必改/提示分级、修辞与退化检测
import { loadLinguisticsConfig } from "./config-loader.mjs";

const LAYER_RANK = { project: 3, genre: 2, universal: 1 };

// 统计可见字符（汉字与字母数字，具体字符类由 JSON 配置提供）
export function countVisibleChars(text, visibleCharRegex) {
  if (!text) return 0;
  const matched = text.match(visibleCharRegex);
  return matched ? matched.length : 0;
}

// 书级字面量白名单等长空格遮罩（仅用于规则与句式扫描，不影响字数和统计指纹）
export function maskWhitelistLiterals(
  text,
  whitelistLiterals = [],
  maskChar = " "
) {
  if (!text || !whitelistLiterals || whitelistLiterals.length === 0) {
    return text;
  }
  const sorted = [...whitelistLiterals].sort((a, b) => b.length - a.length);
  const chars = text.split("");
  for (const literal of sorted) {
    if (!literal) continue;
    let idx = text.indexOf(literal);
    while (idx !== -1) {
      for (let i = idx; i < idx + literal.length; i += 1) {
        chars[i] = maskChar;
      }
      idx = text.indexOf(literal, idx + literal.length);
    }
  }
  return chars.join("");
}

// 提取单行内成对引号的 [start, end) 区间
export function getQuotedRanges(text, quoteMaskRegexes = []) {
  const ranges = [];
  for (const re of quoteMaskRegexes) {
    re.lastIndex = 0;
    let match;
    while ((match = re.exec(text)) !== null) {
      if (match[0].length === 0) {
        re.lastIndex += 1;
        continue;
      }
      ranges.push([match.index, match.index + match[0].length]);
    }
  }
  return ranges.sort((a, b) => a[0] - b[0]);
}

// 把成对引号内片段等长遮罩为中性占位符以保留列号；可选把行末未闭合开引号也遮到行尾
export function maskQuotedText(
  text,
  quoteMaskRegexes = [],
  maskChar = "?",
  unclosedQuoteStart = null
) {
  if (!text) return text;
  let out = text;
  for (const re of quoteMaskRegexes) {
    re.lastIndex = 0;
    out = out.replace(re, (match) => maskChar.repeat(match.length));
  }
  if (unclosedQuoteStart) {
    const m = unclosedQuoteStart.exec(out);
    if (m) {
      out = out.slice(0, m.index) + maskChar.repeat(out.length - m.index);
    }
  }
  return out;
}

// 从单段文本中剥离真正的说话对白（区分弯双引号对白与直角引号书名/器物强调）
export function stripSpokenDialogue(text, lingConfig, replacement = "") {
  const src = String(text || "");
  const spanRe = lingConfig?.compiledRegex?.dialogueSpanGlobal;
  if (!src || !spanRe) {
    return {
      narration: src,
      hasSpokenDialogue: false,
      spokenChars: 0,
      isPureDialogue: false,
    };
  }
  const cornerCfg = lingConfig.compiledRegex.cornerQuoteDialogue || null;
  spanRe.lastIndex = 0;
  const spans = [];
  let match;
  while ((match = spanRe.exec(src)) !== null) {
    if (match[0].length === 0) {
      spanRe.lastIndex += 1;
      continue;
    }
    spans.push({
      start: match.index,
      end: match.index + match[0].length,
      raw: match[0],
    });
  }
  if (spans.length === 0) {
    return {
      narration: src,
      hasSpokenDialogue: false,
      spokenChars: 0,
      isPureDialogue: false,
    };
  }

  // 整段只由引号片段构成时，即使使用直角引号也按纯对白段处理
  let nonSpanText = "";
  let pos = 0;
  for (const sp of spans) {
    nonSpanText += src.slice(pos, sp.start);
    pos = sp.end;
  }
  nonSpanText += src.slice(pos);
  const wholeLineQuoted = nonSpanText.trim().length === 0;

  let out = "";
  let cursor = 0;
  let spokenChars = 0;
  let hasSpokenDialogue = false;
  for (const sp of spans) {
    const openChar = sp.raw[0];
    let isDialogue = true;
    if (cornerCfg && cornerCfg.cornerChars.has(openChar) && !wholeLineQuoted) {
      const inner = sp.raw.slice(1, -1);
      const before = src.slice(Math.max(0, sp.start - 8), sp.start);
      const hasPunct = cornerCfg.innerPunctRegex
        ? cornerCfg.innerPunctRegex.test(inner)
        : false;
      const hasLead = cornerCfg.leadSpeechRegex
        ? cornerCfg.leadSpeechRegex.test(before)
        : false;
      isDialogue = hasPunct || hasLead;
    }
    if (isDialogue) {
      out += src.slice(cursor, sp.start) + replacement;
      cursor = sp.end;
      spokenChars += sp.raw.length;
      hasSpokenDialogue = true;
    }
  }
  out += src.slice(cursor);
  const isPureDialogue = hasSpokenDialogue && out.trim().length === 0;
  return { narration: out, hasSpokenDialogue, spokenChars, isPureDialogue };
}

// 同一段落内被更长命中完全包住的短命中只保留最长的一条；同长撞车按 project > genre > universal 保留
export function dedupContainedHits(hits) {
  return hits.filter((a) => {
    const aLen = a.end - a.start;
    return !hits.some((b) => {
      if (b === a) return false;
      const bLen = b.end - b.start;
      if (b.start <= a.start && b.end >= a.end) {
        if (bLen > aLen) return true;
        if (bLen === aLen) {
          const rankA = LAYER_RANK[a.layer] || 0;
          const rankB = LAYER_RANK[b.layer] || 0;
          if (rankB > rankA) return true;
          if (rankB === rankA && hits.indexOf(b) < hits.indexOf(a)) return true;
        }
      }
      return false;
    });
  });
}

// 承接确认语与合成词排除守卫（用于反序对比句等易误报模式，所有字表来自 JSON 配置）
function passesReverseNotIsGuard(rule, text, match) {
  const start = match.index;
  if (start > 0 && rule.prevExcludeSet && rule.prevExcludeSet.has(text[start - 1])) {
    return false;
  }
  if (rule.secondCharNot && text[start + 1] === rule.secondCharNot) {
    return false;
  }
  if (rule.nextIgnoreRegexObj && match[2] && rule.nextIgnoreRegexObj.test(match[2])) {
    return false;
  }
  if (rule.affirmationParticleSet && rule.affirmationBoundarySet) {
    const nextChar = text[start + 1] || "";
    const afterChar = text[start + 2] || "";
    if (
      rule.affirmationParticleSet.has(nextChar) &&
      rule.affirmationBoundarySet.has(afterChar)
    ) {
      return false;
    }
  }
  return true;
}

// 计算尾窗起始段落索引（从文末往前累加可见字数直到达到 tailWindowChars）
export function computeTailStartIndex(
  paragraphs,
  tailWindowChars,
  quoteMaskRegexes,
  visibleCharRegex
) {
  let acc = 0;
  let startIdx = paragraphs.length;
  for (let i = paragraphs.length - 1; i >= 0 && acc < tailWindowChars; i -= 1) {
    startIdx = i;
    const stripped = maskQuotedText(paragraphs[i].text, quoteMaskRegexes, " ");
    acc += countVisibleChars(stripped, visibleCharRegex);
  }
  return startIdx;
}

// 统一扫描段落数组上的规则集合（支持 scope、tail600 窗口、白名单、引号遮蔽与包含去重）
export function scanParagraphRuleSet(paragraphs, rules, options = {}) {
  if (!rules || rules.length === 0 || !paragraphs || paragraphs.length === 0) {
    return [];
  }
  const quoteRegexes = options.quoteMaskRegexes || [];
  const quoteMaskChar = options.quoteMaskChar || "?";
  const whitelistLiterals = options.whitelistLiterals || [];
  const whitelistMaskChar = options.whitelistMaskChar || " ";
  const visibleCharRegex = options.visibleCharRegex;
  const tailWindowChars = options.tailWindowChars || 600;
  const tailStartIdx = rules.some((r) => r.window === "tail600")
    ? computeTailStartIndex(
        paragraphs,
        tailWindowChars,
        quoteRegexes,
        visibleCharRegex
      )
    : 0;

  const allHits = [];
  for (let pIdx = 0; pIdx < paragraphs.length; pIdx += 1) {
    const para = paragraphs[pIdx];
    const wlText = maskWhitelistLiterals(
      para.text,
      whitelistLiterals,
      whitelistMaskChar
    );
    let narrationText = null;
    const rawParaHits = [];

    for (const rule of rules) {
      if (rule.window === "tail600" && pIdx < tailStartIdx) continue;
      const target =
        rule.scope === "narration"
          ? (narrationText ??= maskQuotedText(wlText, quoteRegexes, quoteMaskChar))
          : wlText;

      rule.regex.lastIndex = 0;
      let match;
      while ((match = rule.regex.exec(target)) !== null) {
        if (match[0].length === 0) {
          rule.regex.lastIndex += 1;
          continue;
        }
        if (rule.guard === "reverseNotIs" && !passesReverseNotIsGuard(rule, target, match)) {
          continue;
        }
        rawParaHits.push({
          id: rule.id,
          layer: rule.layer || "universal",
          category: rule.category,
          family: rule.family || null,
          line: para.line,
          start: match.index,
          end: match.index + match[0].length,
          matched: para.text.slice(match.index, match.index + match[0].length),
          remedy: rule.remedy,
        });
      }
    }

    const deduped = dedupContainedHits(rawParaHits).map(
      ({ start: _s, end: _e, ...clean }) => clean
    );
    allHits.push(...deduped);
  }

  return allHits;
}

// 按密度门槛（minHits / perKilo）过滤，并根据 blockingMinHits * scale 判定必改/提示分级
export function evaluateHitsWithDensity(
  hits,
  rules,
  totalHan,
  extraFamilyCounts = null
) {
  if (!hits || hits.length === 0) {
    return { hits: [], hasBlocking: false };
  }
  const ruleMap = new Map();
  for (const r of rules || []) {
    if (r && r.id) ruleMap.set(r.id, r);
  }

  const byRule = new Map();
  const familyCounts = new Map(extraFamilyCounts || []);
  for (const h of hits) {
    byRule.set(h.id, (byRule.get(h.id) || 0) + 1);
    const fam = h.family || ruleMap.get(h.id)?.family;
    if (fam) {
      familyCounts.set(fam, (familyCounts.get(fam) || 0) + 1);
    }
  }

  const kept = [];
  let hasBlocking = false;
  for (const h of hits) {
    const rule = ruleMap.get(h.id) || {};
    const ruleCount = byRule.get(h.id) || 0;
    const minHits = rule.minHits || rule.advisoryMinHits || 1;
    const perKiloMin = rule.perKilo || 0;
    const actualPerKilo = totalHan > 0 ? (ruleCount / totalHan) * 1000 : 0;

    if (ruleCount < minHits) continue;
    if (perKiloMin > 0 && actualPerKilo < perKiloMin) continue;

    const unit = rule.scaleUnitChars || 4500;
    const scale = Math.max(
      1,
      Math.floor((totalHan + Math.floor(unit / 2)) / unit)
    );
    const fam = h.family || rule.family;
    const effectiveCount = fam ? familyCounts.get(fam) || ruleCount : ruleCount;

    let isBlocking = rule.level === "blocking";
    if (!isBlocking && rule.blockingMinHits) {
      isBlocking = effectiveCount >= rule.blockingMinHits * scale;
    }

    const level = isBlocking ? "blocking" : "advisory";
    const review = isBlocking ? "mechanical" : rule.review || "semantic";
    if (isBlocking) hasBlocking = true;

    kept.push({
      ...h,
      level,
      review,
    });
  }

  return { hits: kept, hasBlocking };
}

// 检查连续三段「不是A / 也不是B / 只是C」跨段工整排比（只发 advisory 语义提示）
export function scanCrossParagraphParallel(paragraphs, crossCfg, options = {}) {
  if (!crossCfg || !paragraphs || paragraphs.length < 3) return [];
  const quoteRegexes = options.quoteMaskRegexes || [];
  const quoteMaskChar = options.quoteMaskChar || "?";
  const whitelistLiterals = options.whitelistLiterals || [];
  const whitelistMaskChar = options.whitelistMaskChar || " ";

  const hits = [];
  const win = [];
  for (const para of paragraphs) {
    const wl = maskWhitelistLiterals(
      para.text,
      whitelistLiterals,
      whitelistMaskChar
    );
    const masked = maskQuotedText(wl, quoteRegexes, quoteMaskChar).trim();
    if (win.length > 0 && para.line - win[win.length - 1].line > 2) {
      win.length = 0;
    }
    win.push({ line: para.line, masked, original: para.text });
    if (win.length > 3) win.shift();
    if (win.length !== 3) continue;

    if (
      crossCfg.startRegexObj.test(win[0].masked) &&
      crossCfg.middleRegexObj.test(win[1].masked) &&
      crossCfg.endRegexObj.test(win[2].masked)
    ) {
      hits.push({
        id: crossCfg.id,
        layer: "universal",
        category: crossCfg.category,
        line: win[0].line,
        matched: win.map((w) => w.original.slice(0, 24)).join(" / "),
        level: "advisory",
        review: crossCfg.review || "semantic",
        remedy: crossCfg.remedy,
      });
    }
  }
  return hits;
}

// 拆分句段辅助
function splitCleanSentences(text, splitRegex) {
  return text
    .split(splitRegex)
    .map((s) => s.trim())
    .filter(Boolean);
}

// 统计多个词语在字符串中出现的总次数
function countLiteralTerms(text, terms) {
  let count = 0;
  for (const term of terms || []) {
    if (!term) continue;
    let idx = text.indexOf(term);
    while (idx !== -1) {
      count += 1;
      idx = text.indexOf(term, idx + term.length);
    }
  }
  return count;
}

// 截取命中位置所属句段摘要
function excerptAround(text, idx, sentenceSplitRegex) {
  const parts = text.split(sentenceSplitRegex);
  let cursor = 0;
  for (const part of parts) {
    const end = cursor + part.length;
    if (idx <= end) return part.trim().slice(0, 36);
    cursor = end + 1;
  }
  return text.slice(Math.max(0, idx - 12), idx + 24).trim();
}

// 运行移植自 oh-story 的密度型文风探针（微动作、套式反应、动作清单、引号强调、电报体反向守卫等）
export function runDensityTics(
  paragraphs,
  lingConfig,
  whitelistLiterals = [],
  disabledRuleIds = new Set()
) {
  const dCfg = lingConfig.compiledRegex.densityRules;
  if (!dCfg || !paragraphs || paragraphs.length === 0) return [];

  const quoteRegexes = lingConfig.compiledRegex.quoteMaskRegexes || [];
  const unclosedQuoteStart = lingConfig.compiledRegex.unclosedQuoteStart;
  const visibleCharRegex = lingConfig.compiledRegex.visibleCharGlobal;
  const wlMaskChar = lingConfig.tokens.whitelistMaskChar || " ";
  const sentenceSplit =
    lingConfig.compiledRegex.degeneration?.sentenceSplitRegex ||
    lingConfig.compiledRegex.sentenceDelimiter;

  const tics = [];

  // 预备每段的白名单遮罩与引号外叙述文本（用空格遮罩保持字符长度不粘连）
  const prepared = paragraphs.map((p) => {
    const wlText = maskWhitelistLiterals(p.text, whitelistLiterals, wlMaskChar);
    const narration = maskQuotedText(wlText, quoteRegexes, " ");
    const narrationLen = countVisibleChars(narration, visibleCharRegex);
    return {
      line: p.line,
      raw: p.text,
      wlText,
      narration,
      narrationLen,
    };
  });

  const totalNarrationChars = prepared.reduce((acc, p) => acc + p.narrationLen, 0);

  // 辅助：运行汇总型密度计数规则
  const collectDensityMatches = (cfg, collector) => {
    if (!cfg || disabledRuleIds.has(cfg.id)) return null;
    if (totalNarrationChars === 0) return null;
    let hits = 0;
    let firstLine = null;
    const samples = [];
    for (const item of prepared) {
      const res = collector(item);
      if (res.count > 0) {
        hits += res.count;
        if (firstLine === null) firstLine = item.line;
        for (const s of res.samples || []) {
          if (samples.length < 6 && s && !samples.includes(s)) samples.push(s);
        }
      }
    }
    const perKilo = (hits / totalNarrationChars) * 1000;
    if (hits < (cfg.minHits || 1) || perKilo < (cfg.perKilo || 0)) return null;
    return {
      id: cfg.id,
      layer: "universal",
      category: cfg.id,
      line: firstLine,
      hits,
      perKilo: Number(perKilo.toFixed(1)),
      samples,
      level: "advisory",
      review: cfg.review || "semantic",
      remedy: cfg.remedy,
    };
  };

  // 1. 微动作补语复读（V了一下/了半圈）
  const microRes = collectDensityMatches(dCfg.microActionTic, (item) => {
    const re = dCfg.microActionTic.regex;
    re.lastIndex = 0;
    let count = 0;
    const samples = [];
    let m;
    while ((m = re.exec(item.narration)) !== null) {
      count += 1;
      samples.push(item.raw.slice(Math.max(0, m.index - 4), m.index + m[0].length));
    }
    return { count, samples };
  });
  if (microRes) tics.push(microRes);

  // 2. 套式身体反应成片
  const stockRes = collectDensityMatches(dCfg.stockReactionTic, (item) => {
    let count = 0;
    const samples = [];
    for (const re of dCfg.stockReactionTic.regexes) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(item.narration)) !== null) {
        count += 1;
        samples.push(excerptAround(item.raw, m.index, sentenceSplit));
      }
    }
    return { count, samples };
  });
  if (stockRes) tics.push(stockRes);

  // 3. 监控摄像头式动作清单（按段报出）
  if (dCfg.actionListTic && !disabledRuleIds.has(dCfg.actionListTic.id)) {
    const ac = dCfg.actionListTic;
    for (const item of prepared) {
      if (item.narrationLen === 0) continue;
      ac.verbRegex.lastIndex = 0;
      const verbs = [];
      let m;
      while ((m = ac.verbRegex.exec(item.narration)) !== null) {
        verbs.push(m[0]);
      }
      if (verbs.length < ac.minVerbsPerPara) continue;
      const sepMatches = item.narration.match(ac.separatorRegex);
      const sepCount = sepMatches ? sepMatches.length : 0;
      if (sepCount < ac.minSeparatorsPerPara) continue;
      tics.push({
        id: ac.id,
        layer: "universal",
        category: ac.id,
        line: item.line,
        hits: verbs.length,
        samples: verbs.slice(0, 8),
        level: "advisory",
        review: ac.review || "semantic",
        remedy: ac.remedy,
      });
    }
  }

  // 4. 叙述层短词引号强调滥用（跳过独立台词行、系统面板【】、引语动词邻接短台词、拟声词）
  if (dCfg.quoteEmphasisTic && !disabledRuleIds.has(dCfg.quoteEmphasisTic.id)) {
    const qc = dCfg.quoteEmphasisTic;
    let hits = 0;
    let firstLine = null;
    const samples = [];
    for (const item of prepared) {
      if (item.narrationLen === 0) continue;
      const ranges = getQuotedRanges(item.wlText, quoteRegexes);
      for (const [start, end] of ranges) {
        if (item.wlText[start] === qc.panelOpenChar) continue;
        if (
          ranges.some(
            ([s2, e2]) => s2 <= start && end <= e2 && (s2 !== start || e2 !== end)
          )
        ) {
          continue;
        }
        const inner = item.wlText.slice(start + 1, end - 1);
        const vis = countVisibleChars(inner, visibleCharRegex);
        if (vis < 1 || vis > qc.maxVisibleHan) continue;
        if (qc.punctuationInsideRegex.test(inner)) continue;
        const before = item.wlText.slice(Math.max(0, start - 8), start);
        const after = item.wlText.slice(end, end + 6);
        if (qc.speechVerbRegex.test(before) || qc.speechVerbRegex.test(after)) {
          continue;
        }
        if (qc.onomatopoeiaSuffixRegex.test(after)) continue;
        hits += 1;
        if (firstLine === null) firstLine = item.line;
        if (samples.length < 6 && !samples.includes(inner)) samples.push(inner);
      }
    }
    if (hits >= qc.minHits) {
      tics.push({
        id: qc.id,
        layer: "universal",
        category: qc.id,
        line: firstLine,
        hits,
        samples,
        level: "advisory",
        review: qc.review || "semantic",
        remedy: qc.remedy,
      });
    }
  }

  // 5. 比喻密度
  const metaRes = collectDensityMatches(dCfg.metaphorDensityTic, (item) => {
    const mc = dCfg.metaphorDensityTic;
    let count = 0;
    const samples = [];
    mc.markerRegex.lastIndex = 0;
    let m;
    while ((m = mc.markerRegex.exec(item.narration)) !== null) {
      count += 1;
      samples.push(excerptAround(item.raw, m.index, sentenceSplit));
    }
    mc.likePhraseRegex.lastIndex = 0;
    while ((m = mc.likePhraseRegex.exec(item.narration)) !== null) {
      const prefix = item.narration.slice(Math.max(0, m.index - 8), m.index);
      if (mc.prefixGuardRegex.test(prefix)) continue;
      count += 1;
      samples.push(excerptAround(item.raw, m.index, sentenceSplit));
    }
    return { count, samples };
  });
  if (metaRes) tics.push(metaRes);

  // 6. 抽象总结复读
  const absRes = collectDensityMatches(dCfg.abstractSummaryTic, (item) => {
    let count = 0;
    const samples = [];
    for (const re of dCfg.abstractSummaryTic.regexes) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(item.narration)) !== null) {
        count += 1;
        samples.push(m[0]);
      }
    }
    return { count, samples };
  });
  if (absRes) tics.push(absRes);

  // 7. 论文式解释推理链
  if (dCfg.reasoningChainTic && !disabledRuleIds.has(dCfg.reasoningChainTic.id)) {
    const rc = dCfg.reasoningChainTic;
    let hits = 0;
    let coreHits = 0;
    let linkHits = 0;
    let firstLine = null;
    const samples = [];
    const buckets = new Set();

    for (const item of prepared) {
      if (item.narrationLen === 0) continue;
      const accepted = [];
      for (const pObj of rc.compiledPatterns) {
        pObj.regex.lastIndex = 0;
        let m;
        while ((m = pObj.regex.exec(item.narration)) !== null) {
          const s = m.index;
          const e = s + m[0].length;
          if (accepted.some(([a, b]) => s < b && e > a)) continue;
          accepted.push([s, e]);
          hits += 1;
          if (pObj.core) coreHits += 1;
          if (pObj.key === "connector" || pObj.key === "modal") linkHits += 1;
          buckets.add(pObj.key);
          if (firstLine === null) firstLine = item.line;
          if (samples.length < 8 && !samples.includes(m[0])) samples.push(m[0]);
        }
      }
    }

    const perKilo =
      totalNarrationChars > 0 ? (hits / totalNarrationChars) * 1000 : 0;
    if (
      totalNarrationChars > 0 &&
      hits >= rc.minHits &&
      coreHits >= rc.minCoreHits &&
      linkHits >= rc.minLinkHits &&
      buckets.size >= rc.minBuckets &&
      perKilo >= rc.perKilo
    ) {
      tics.push({
        id: rc.id,
        layer: "universal",
        category: rc.id,
        line: firstLine,
        hits,
        perKilo: Number(perKilo.toFixed(1)),
        samples,
        level: "advisory",
        review: rc.review || "semantic",
        remedy: rc.remedy,
      });
    }
  }

  // 8. 叙述旁白省略号刷屏
  if (dCfg.ellipsisDensityTic && !disabledRuleIds.has(dCfg.ellipsisDensityTic.id)) {
    const ec = dCfg.ellipsisDensityTic;
    let hits = 0;
    let chars = 0;
    let firstLine = null;
    const samples = [];
    for (const item of prepared) {
      const safeNarration = maskQuotedText(
        item.wlText,
        quoteRegexes,
        " ",
        unclosedQuoteStart
      );
      chars += countVisibleChars(safeNarration, visibleCharRegex);
      ec.regex.lastIndex = 0;
      let m;
      while ((m = ec.regex.exec(safeNarration)) !== null) {
        hits += 1;
        if (firstLine === null) firstLine = item.line;
        if (samples.length < 4) {
          samples.push(
            item.raw.slice(Math.max(0, m.index - 8), m.index + m[0].length + 4).trim()
          );
        }
      }
    }
    const perKilo = chars > 0 ? (hits / chars) * 1000 : 0;
    if (chars > 0 && hits >= ec.minHits && perKilo >= ec.perKilo) {
      tics.push({
        id: ec.id,
        layer: "universal",
        category: ec.id,
        line: firstLine,
        hits,
        perKilo: Number(perKilo.toFixed(1)),
        samples,
        level: "advisory",
        review: ec.review || "semantic",
        remedy: ec.remedy,
      });
    }
  }

  // 8b. 叙述层感叹号密度（精修稿 ~0-0.7/千字，滑稿可到 7-17/千字）与连叠（一处即报）
  const exclRes = collectDensityMatches(dCfg.exclamationDensityTic, (item) => {
    const re = dCfg.exclamationDensityTic.regex;
    re.lastIndex = 0;
    let count = 0;
    const samples = [];
    let m;
    while ((m = re.exec(item.narration)) !== null) {
      count += 1;
      samples.push(
        item.raw.slice(Math.max(0, m.index - 10), m.index + m[0].length + 2).trim()
      );
    }
    return { count, samples };
  });
  if (exclRes) tics.push(exclRes);

  const stackRes = collectDensityMatches(dCfg.exclamationStackTic, (item) => {
    const re = dCfg.exclamationStackTic.regex;
    re.lastIndex = 0;
    let count = 0;
    const samples = [];
    let m;
    while ((m = re.exec(item.narration)) !== null) {
      count += 1;
      samples.push(
        item.raw.slice(Math.max(0, m.index - 10), m.index + m[0].length + 2).trim()
      );
    }
    return { count, samples };
  });
  if (stackRes) tics.push(stackRes);

  // 9. 过度精炼短段（反去 AI 味过火成电报体守卫）
  if (
    dCfg.overcompressedProseTic &&
    !disabledRuleIds.has(dCfg.overcompressedProseTic.id)
  ) {
    const oc = dCfg.overcompressedProseTic;
    let narChars = 0;
    let narParas = 0;
    let shortParas = 0;
    let particles = 0;
    let firstLine = null;
    const samples = [];
    for (const item of prepared) {
      if (oc.panelLineRegex.test(item.raw.trim())) continue;
      if (item.narrationLen === 0) continue;
      if (firstLine === null) firstLine = item.line;
      narParas += 1;
      narChars += item.narrationLen;
      if (item.narrationLen <= oc.shortMaxChars) {
        shortParas += 1;
        if (samples.length < 5) samples.push(item.narration.trim());
      }
      const pMatches = item.narration.match(oc.particleRegex);
      if (pMatches) particles += pMatches.length;
    }
    const shortRatio = narParas > 0 ? shortParas / narParas : 0;
    const particlePerKilo = narChars > 0 ? (particles / narChars) * 1000 : 0;
    if (
      narChars >= oc.minChars &&
      narParas >= oc.minParas &&
      shortRatio >= oc.shortRatio &&
      particlePerKilo < oc.maxParticlePerKilo
    ) {
      tics.push({
        id: oc.id,
        layer: "universal",
        category: oc.id,
        line: firstLine,
        hits: shortParas,
        perKilo: Number(particlePerKilo.toFixed(1)),
        samples,
        level: "advisory",
        review: oc.review || "semantic",
        remedy: oc.remedy,
      });
    }
  }

  // 10. 低连接密度（白话虚词连接与中长承接句同时偏低）
  if (
    dCfg.lowConnectiveDensityTic &&
    !disabledRuleIds.has(dCfg.lowConnectiveDensityTic.id)
  ) {
    const lc = dCfg.lowConnectiveDensityTic;
    let bodyChars = 0;
    let fnHits = 0;
    let plHits = 0;
    let firstLine = null;
    const sentLens = [];
    const samples = [];
    for (const item of prepared) {
      if (item.narrationLen === 0) continue;
      if (firstLine === null) firstLine = item.line;
      bodyChars += item.narrationLen;
      fnHits += countLiteralTerms(item.narration, lc.functionTerms);
      plHits += countLiteralTerms(item.narration, lc.plainTerms);
      for (const s of splitCleanSentences(item.narration, sentenceSplit)) {
        const len = countVisibleChars(s, visibleCharRegex);
        if (len === 0) continue;
        sentLens.push(len);
        if (len <= 12 && samples.length < 5) samples.push(s);
      }
    }
    const fnPerKilo = bodyChars > 0 ? (fnHits / bodyChars) * 1000 : 0;
    const plPerKilo = bodyChars > 0 ? (plHits / bodyChars) * 1000 : 0;
    const longRatio =
      sentLens.length > 0
        ? sentLens.filter((len) => len >= lc.longSentChars).length / sentLens.length
        : 0;
    if (
      bodyChars >= lc.minChars &&
      sentLens.length > 0 &&
      fnPerKilo < lc.maxFunctionPerKilo &&
      plPerKilo < lc.maxPlainPerKilo &&
      longRatio < lc.maxLongSentRatio
    ) {
      tics.push({
        id: lc.id,
        layer: "universal",
        category: lc.id,
        line: firstLine,
        hits: sentLens.length,
        perKilo: Number(fnPerKilo.toFixed(1)),
        samples,
        level: "advisory",
        review: lc.review || "semantic",
        remedy: lc.remedy,
      });
    }
  }

  // 11. 连续无叙述动作锚点的纯对话流检测
  if (
    dCfg.dialogueOnlyStreakTic &&
    !disabledRuleIds.has(dCfg.dialogueOnlyStreakTic.id)
  ) {
    const dc = dCfg.dialogueOnlyStreakTic;
    let streak = 0;
    let streakStartLine = null;
    let maxStreak = 0;
    let maxStartLine = null;
    let curSamples = [];
    let bestSamples = [];
    for (const item of prepared) {
      const trimmed = item.wlText.trim();
      const isPureQuoteLine =
        trimmed.length > 0 &&
        item.narrationLen === 0 &&
        dc.quoteLineRegex.test(trimmed);
      if (isPureQuoteLine) {
        if (streak === 0) {
          streakStartLine = item.line;
          curSamples = [];
        }
        streak += 1;
        if (curSamples.length < 4) curSamples.push(item.raw.trim());
        if (streak > maxStreak) {
          maxStreak = streak;
          maxStartLine = streakStartLine;
          bestSamples = curSamples;
        }
      } else {
        streak = 0;
        streakStartLine = null;
        curSamples = [];
      }
    }
    if (maxStreak >= (dc.minStreak || 8)) {
      tics.push({
        id: dc.id,
        layer: "universal",
        category: dc.id,
        line: maxStartLine,
        hits: maxStreak,
        samples: bestSamples,
        level: "advisory",
        review: dc.review || "semantic",
        remedy: dc.remedy,
      });
    }
  }

  return tics;
}

// 剥离单行与跨行 HTML 注释为等长空格，防止隐藏标记误报（未闭合注释保留正文）
function stripHtmlCommentsFromLines(rawLines) {
  const result = [];
  let inComment = false;
  const openFlags = rawLines.map((l) => l.includes("<!--"));
  const closeFlags = rawLines.map((l) => l.includes("-->"));
  let hasCloseAhead = new Array(rawLines.length + 1).fill(false);
  for (let i = rawLines.length - 1; i >= 0; i -= 1) {
    hasCloseAhead[i] = closeFlags[i] || hasCloseAhead[i + 1];
  }

  for (let idx = 0; idx < rawLines.length; idx += 1) {
    let line = rawLines[idx];
    let out = "";
    let cursor = 0;
    while (cursor < line.length) {
      if (inComment) {
        const close = line.indexOf("-->", cursor);
        const end = close === -1 ? line.length : close + 3;
        out += " ".repeat(end - cursor);
        cursor = end;
        if (close !== -1) inComment = false;
      } else {
        const start = line.indexOf("<!--", cursor);
        if (start === -1) {
          out += line.slice(cursor);
          break;
        }
        out += line.slice(cursor, start) + "    ";
        cursor = start + 4;
        const closesSameLine = line.indexOf("-->", cursor) !== -1;
        if (closesSameLine || hasCloseAhead[idx + 1]) {
          inComment = true;
        }
      }
    }
    if (!openFlags[idx] || out.trim().length > 0 || line.trim().length === 0) {
      result.push({ line: idx + 1, text: out, trimmed: out.trim() });
    }
  }
  return result;
}

// 跳过 YAML Frontmatter、HTML 注释、代码块围栏、标题与分隔线后的有效正文行
function extractScannableBodyLines(rawContent, dgCfg, lingConfig) {
  const rawLines = String(rawContent || "").split(/\r?\n/u);
  const cleaned = stripHtmlCommentsFromLines(rawLines);
  const body = [];
  let fenceChar = null;
  let inFrontMatter =
    cleaned.length > 1 &&
    cleaned[0].trimmed === "---" &&
    cleaned.slice(1, 30).some((l) => /^[A-Za-z0-9_-]+:\s*/u.test(l.trimmed));

  const headingPrefix = lingConfig.tokens?.markdownHeadingPrefix || "#";
  const markdownRule = lingConfig.tokens?.markdownRule || "---";
  for (let i = 0; i < cleaned.length; i += 1) {
    const item = cleaned[i];
    if (inFrontMatter) {
      if (i > 0 && item.trimmed === "---") inFrontMatter = false;
      continue;
    }
    const fence = /^(`{3,}|~{3,})/u.exec(item.trimmed);
    if (fenceChar) {
      if (fence && item.trimmed[0] === fenceChar) fenceChar = null;
      continue;
    }
    if (fence) {
      fenceChar = item.trimmed[0];
      continue;
    }
    if (!item.trimmed) continue;
    if (item.trimmed.startsWith(headingPrefix)) continue;
    if (item.trimmed === markdownRule) continue;
    if (dgCfg?.dividerRegex && dgCfg.dividerRegex.test(item.trimmed)) continue;
    body.push(item);
  }
  return body;
}

// 提取用于语言学画像与规则扫描的含汉字正文自然段
export function extractBodyParagraphLines(rawContent, customLingConfig = null) {
  const cfg = customLingConfig || loadLinguisticsConfig();
  const dgCfg = cfg.compiledRegex?.degeneration || null;
  const hanRegex = cfg.compiledRegex.hanCharGlobal;
  const bodyLines = extractScannableBodyLines(rawContent, dgCfg, cfg);
  const paragraphs = [];
  for (const item of bodyLines) {
    const matches = item.trimmed.match(hanRegex);
    const hanLen = matches ? matches.length : 0;
    if (hanLen > 0) {
      paragraphs.push({
        line: item.line,
        text: item.trimmed,
        hanLen,
      });
    }
  }
  return paragraphs;
}

// 运行模型退化与工程词泄漏检测（复读、截断、AI 自指/占位符、Tier1/Tier2 工程词）
export function runDegenerationChecks(
  rawContent,
  lingConfig,
  whitelistLiterals = [],
  disabledRuleIds = new Set()
) {
  const dg = lingConfig.compiledRegex.degeneration;
  if (!dg) return { degenerationHits: [], metaLeakHits: [] };

  const quoteRegexes = lingConfig.compiledRegex.quoteMaskRegexes || [];
  const visibleCharRegex = lingConfig.compiledRegex.visibleCharGlobal;
  const wlMaskChar = lingConfig.tokens.whitelistMaskChar || " ";
  const body = extractScannableBodyLines(rawContent, dg, lingConfig);

  const degenerationHits = [];
  const metaLeakHits = [];

  const prepared = body.map((item) => {
    const wlText = maskWhitelistLiterals(
      item.text,
      whitelistLiterals,
      wlMaskChar
    );
    const narration = maskQuotedText(wlText, quoteRegexes, " ");
    return {
      line: item.line,
      raw: item.trimmed,
      wlText: wlText.trim(),
      narration: narration.trim(),
    };
  });

  // 1. 紧邻整行复读（排除纯对话刷屏）
  if (!disabledRuleIds.has("degen_adjacent_repeat")) {
    for (let i = 1; i < prepared.length; i += 1) {
      if (
        prepared[i].wlText === prepared[i - 1].wlText &&
        countVisibleChars(prepared[i].narration, visibleCharRegex) >=
          dg.adjacentRepeatMinLen
      ) {
        degenerationHits.push({
          id: "degen_adjacent_repeat",
          layer: "universal",
          category: "verbatim_repeat",
          line: prepared[i].line,
          matched: prepared[i].raw.slice(0, 40),
          level: "blocking",
          review: "mechanical",
        });
      }
    }
  }

  // 2. 全章长句复读（引号外叙述长句出现 >=3 次）
  if (!disabledRuleIds.has("degen_sentence_repeat")) {
    const sentCounts = new Map();
    for (const item of prepared) {
      for (const s of splitCleanSentences(item.narration, dg.sentenceSplitRegex)) {
        if (countVisibleChars(s, visibleCharRegex) < dg.sentenceRepeatMinLen) continue;
        sentCounts.set(s, (sentCounts.get(s) || 0) + 1);
      }
    }
    const flagged = new Set();
    for (const [s, cnt] of sentCounts) {
      if (cnt >= dg.sentenceRepeatMinCount) flagged.add(s);
    }
    if (flagged.size > 0) {
      for (const item of prepared) {
        for (const s of splitCleanSentences(item.narration, dg.sentenceSplitRegex)) {
          if (flagged.has(s)) {
            degenerationHits.push({
              id: "degen_sentence_repeat",
              layer: "universal",
              category: "verbatim_repeat",
              line: item.line,
              matched: `${s.slice(0, 36)} (x${sentCounts.get(s)})`,
              level: "blocking",
              review: "mechanical",
            });
            flagged.delete(s);
          }
        }
      }
    }
  }

  // 3. 章末截断检测（剥除尾部 Markdown 强调符后检查终止标点）
  if (!disabledRuleIds.has("degen_truncated_ending") && prepared.length > 0) {
    const contentOnly = prepared.filter(
      (item) =>
        !dg.chapterHeadingRegex.test(item.raw) &&
        !dg.endSignoffRegex.test(item.raw)
    );
    if (contentOnly.length > 0) {
      const last = contentOnly[contentOnly.length - 1];
      const normalizedTail = last.raw.replace(dg.trailingMarkdownStripRegex, "");
      if (normalizedTail && !dg.terminalPunctuationRegex.test(normalizedTail)) {
        degenerationHits.push({
          id: "degen_truncated_ending",
          layer: "universal",
          category: "truncated_ending",
          line: last.line,
          matched: last.raw.slice(-32),
          level: "blocking",
          review: "mechanical",
        });
      }
    }
  }

  // 4. 占位符 / 乱码 / AI 自指与拒绝语
  for (const item of prepared) {
    for (const pRule of dg.placeholderRules || []) {
      if (disabledRuleIds.has(pRule.id)) continue;
      const target = pRule.scope === "narration" ? item.narration : item.wlText;
      pRule.regex.lastIndex = 0;
      const m = pRule.regex.exec(target);
      if (m) {
        degenerationHits.push({
          id: pRule.id,
          layer: "universal",
          category: "placeholder_or_refusal",
          line: item.line,
          matched: m[0],
          level: "blocking",
          review: "mechanical",
          remedy: pRule.remedy,
        });
      }
    }
  }

  // 5. 写作工程词泄漏（Tier 1 必改阻塞；Tier 2 引号外叙述提示）
  for (const item of prepared) {
    if (dg.chapterHeadingRegex.test(item.raw) || dg.endSignoffRegex.test(item.raw)) {
      continue;
    }
    if (dg.metaLeakTier1Regex && !disabledRuleIds.has("meta_leak_tier1")) {
      dg.metaLeakTier1Regex.lastIndex = 0;
      let m;
      while ((m = dg.metaLeakTier1Regex.exec(item.wlText)) !== null) {
        metaLeakHits.push({
          id: "meta_leak_tier1",
          layer: "universal",
          category: "engineering_meta_leak",
          line: item.line,
          matched: m[0],
          level: "blocking",
          review: "mechanical",
        });
      }
    }
    if (dg.metaLeakTier2Regex && !disabledRuleIds.has("meta_leak_tier2")) {
      dg.metaLeakTier2Regex.lastIndex = 0;
      let m;
      while ((m = dg.metaLeakTier2Regex.exec(item.narration)) !== null) {
        metaLeakHits.push({
          id: "meta_leak_tier2",
          layer: "universal",
          category: "chapter_meta_reference",
          line: item.line,
          matched: m[0],
          level: "advisory",
          review: "semantic",
        });
      }
    }
  }

  return { degenerationHits, metaLeakHits };
}

// 从细纲文本中收集显式放行的原话与复沓锚句白名单
function collectOutlineExemptPhrases(outlineText, lingConfig, extraExempt = []) {
  const exemptSet = new Set();
  for (const phrase of extraExempt || []) {
    if (typeof phrase === "string" && phrase.trim().length > 0) {
      exemptSet.add(phrase.trim());
    }
  }

  const headerPattern = lingConfig.outlineCopy?.exemptHeaderRegex;
  const headerRe = headerPattern ? new RegExp(headerPattern) : null;
  const quoteRegexes = lingConfig.compiledRegex?.quoteMaskRegexes || [];
  const lines = String(outlineText || "").split(/\r?\n/);

  for (const rawLine of lines) {
    const trimmed = rawLine.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "").trim();
    if (!trimmed || !headerRe) continue;
    const headerMatch = headerRe.exec(trimmed);
    if (!headerMatch) continue;

    const rest = trimmed.slice(headerMatch[0].length).trim();
    if (!rest) continue;

    let foundQuoted = false;
    for (const qRe of quoteRegexes) {
      qRe.lastIndex = 0;
      let m;
      while ((m = qRe.exec(rest)) !== null) {
        foundQuoted = true;
        const inner = m[0].slice(1, -1).trim();
        if (inner.length >= 2) exemptSet.add(inner);
      }
    }

    if (!foundQuoted) {
      for (const part of rest.split(/[/|\uff5c\uff0c,\uff1b;]+/)) {
        const clean = part.trim();
        if (clean.length >= 4) exemptSet.add(clean);
      }
    }
  }

  return Array.from(exemptSet);
}

// 检测正文是否大段照搬章节细纲文字（支持白名单原话/复沓锚句豁免）
export function checkOutlineCopy(chapterText, outlineText, options = {}) {
  const lingConfig = options.lingConfig || loadLinguisticsConfig();
  const minRun = Math.max(
    4,
    Number(options.minRun ?? lingConfig.outlineCopy?.minRunChars ?? 16)
  );

  if (!chapterText || !outlineText) {
    return { pass: true, minRun, overlapCount: 0, hits: [] };
  }

  const exemptPhrases = collectOutlineExemptPhrases(
    outlineText,
    lingConfig,
    options.exemptPhrases
  );
  const headerPattern = lingConfig.outlineCopy?.exemptHeaderRegex;
  const headerRe = headerPattern ? new RegExp(headerPattern) : null;
  const rawHeading = lingConfig.compiledRegex?.degeneration?.chapterHeadingRegex;
  const chHeadingRe = rawHeading instanceof RegExp ? rawHeading : null;

  // 提取细纲正文片段并建立定长滑动窗口索引
  const gramMap = new Map();
  const outlineLines = String(outlineText).split(/\r?\n/);
  for (let i = 0; i < outlineLines.length; i += 1) {
    const lineNo = i + 1;
    const rawLine = outlineLines[i].trim();
    if (!rawLine || /^\s*#{1,6}\s/.test(rawLine)) continue;

    const noBullet = rawLine.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "").trim();
    if (headerRe && headerRe.test(noBullet)) continue;

    const cleanedPrefix = noBullet.replace(/^\[[^\]]+\]\s*[:\uff1a]?\s*/, "");
    const masked = maskWhitelistLiterals(
      cleanedPrefix,
      exemptPhrases,
      "\u0000"
    ).replace(/[*_]/g, "");

    for (const part of masked.split(/[\u0000:\uff1a\r\n]+/)) {
      const compact = part.replace(/\s+/g, "");
      if (compact.length < minRun) continue;
      for (let pos = 0; pos <= compact.length - minRun; pos += 1) {
        const gram = compact.slice(pos, pos + minRun);
        if (!gramMap.has(gram)) {
          gramMap.set(gram, { outlineLine: lineNo, fragment: compact, pos });
        }
      }
    }
  }

  if (gramMap.size === 0) {
    return { pass: true, minRun, overlapCount: 0, hits: [] };
  }

  // 逐行扫描正文，合并同段连续命中的抄纲片段
  const hits = [];
  const chapterLines = String(chapterText).split(/\r?\n/);
  for (let i = 0; i < chapterLines.length; i += 1) {
    const lineNo = i + 1;
    const rawLine = chapterLines[i].trim();
    if (!rawLine) continue;
    if (chHeadingRe) {
      chHeadingRe.lastIndex = 0;
      if (chHeadingRe.test(rawLine)) continue;
    }

    const masked = maskWhitelistLiterals(rawLine, exemptPhrases, "\u0000").replace(
      /[*_]/g,
      ""
    );

    for (const part of masked.split("\u0000")) {
      const compact = part.replace(/\s+/g, "");
      if (compact.length < minRun) continue;

      let pos = 0;
      while (pos <= compact.length - minRun) {
        const gram = compact.slice(pos, pos + minRun);
        const matchInfo = gramMap.get(gram);
        if (!matchInfo) {
          pos += 1;
          continue;
        }

        // 向后尽量延伸重叠区间，避免同一句拆分多条重复报警
        let ext = minRun;
        while (
          pos + ext < compact.length &&
          matchInfo.pos + ext < matchInfo.fragment.length &&
          compact[pos + ext] === matchInfo.fragment[matchInfo.pos + ext]
        ) {
          ext += 1;
        }

        const matched = compact.slice(pos, pos + ext);
        hits.push({
          line: lineNo,
          outlineLine: matchInfo.outlineLine,
          matched,
          length: matched.length,
        });
        pos += ext;
      }
    }
  }

  return {
    pass: hits.length === 0,
    minRun,
    overlapCount: hits.length,
    hits,
  };
}

// 解析中文数字或阿拉伯数字为整数（零中文字符字面量，映射表来自 JSON 配置）
export function parseChineseOrArabicNumber(token, chineseNumerals = {}) {
  if (!token) return null;
  const trimmed = String(token).trim();
  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed);
  }

  const digits = chineseNumerals.digits || {};
  const units = chineseNumerals.units || {};
  let total = 0;
  let current = 0;
  let hasDigit = false;
  let seenValid = false;

  for (const ch of trimmed) {
    if (Object.prototype.hasOwnProperty.call(digits, ch)) {
      current = digits[ch];
      hasDigit = true;
      seenValid = true;
    } else if (Object.prototype.hasOwnProperty.call(units, ch)) {
      const unit = units[ch];
      // 处理“十 / 十二”开头省略“一”的情况
      if (!hasDigit && current === 0 && unit === 10) {
        current = 1;
      }
      total += current * unit;
      current = 0;
      hasDigit = false;
      seenValid = true;
    }
  }

  total += current;
  return seenValid ? total : null;
}

// 校验引号相邻句的“短短 X 字 / 这 X 个字”字数宣称是否与引号内实际字数一致
export function checkCharCountClaims(
  rawContent,
  customLingConfig = null,
  whitelistLiterals = []
) {
  if (!rawContent) return [];
  const cfg = customLingConfig || loadLinguisticsConfig();
  const claimCfg = cfg.charCountClaim || {};
  const cn = cfg.chineseNumerals || {};
  const hanGlobal = cfg.compiledRegex?.hanCharGlobal;
  const visGlobal = cfg.compiledRegex?.visibleCharGlobal || hanGlobal;
  const wlMaskChar = cfg.tokens?.whitelistMaskChar || " ";

  const postRe = claimCfg.postQuoteRegex
    ? new RegExp(claimCfg.postQuoteRegex, "gu")
    : null;
  const preRe = claimCfg.preQuoteRegex
    ? new RegExp(claimCfg.preQuoteRegex, "gu")
    : null;

  if (!postRe && !preRe) return [];

  const countChars = (str, re) => {
    if (!str || !re) return 0;
    const m = str.match(re);
    return m ? m.length : 0;
  };

  const hits = [];
  const lines = String(rawContent).split(/\r?\n/u);

  lines.forEach((rawLine, idx) => {
    const lineNo = idx + 1;
    const maskedLine = maskWhitelistLiterals(
      rawLine,
      whitelistLiterals,
      wlMaskChar
    );
    const seenPositions = new Set();

    const inspectMatch = (quote, claimToken, fullMatch, matchIndex) => {
      const dedupKey = `${lineNo}:${matchIndex}`;
      if (seenPositions.has(dedupKey)) return;
      if (!quote || quote.includes("\u2026") || quote.includes("...")) return;

      const claimed = parseChineseOrArabicNumber(claimToken, cn);
      if (claimed === null || claimed < 1 || claimed > 20) return;

      const hanCount = countChars(quote, hanGlobal);
      const visCount = countChars(quote, visGlobal);
      if (claimed !== hanCount && claimed !== visCount) {
        seenPositions.add(dedupKey);
        hits.push({
          line: lineNo,
          matched: fullMatch,
          quote,
          claimed,
          actual: hanCount,
        });
      }
    };

    if (postRe) {
      postRe.lastIndex = 0;
      let m;
      while ((m = postRe.exec(maskedLine)) !== null) {
        inspectMatch(m[1], m[2], m[0], m.index);
      }
    }

    if (preRe) {
      preRe.lastIndex = 0;
      let m;
      while ((m = preRe.exec(maskedLine)) !== null) {
        inspectMatch(m[2], m[1], m[0], m.index);
      }
    }
  });

  return hits;
}

// 校验章节细纲是否缺失核心情节要素或残留未填占位符
export function checkOutlineContract(outlineText, options = {}) {
  const cfg = options.lingConfig || loadLinguisticsConfig();
  const contract = cfg.outlineContract || {};
  const placeholderRe = contract.placeholderRegex
    ? new RegExp(contract.placeholderRegex, "giu")
    : null;

  const placeholderHits = [];
  const lines = String(outlineText || "").split(/\r?\n/u);
  if (placeholderRe) {
    lines.forEach((line, idx) => {
      placeholderRe.lastIndex = 0;
      let m;
      while ((m = placeholderRe.exec(line)) !== null) {
        placeholderHits.push({
          line: idx + 1,
          matched: m[0].trim(),
        });
        if (m[0].length === 0) placeholderRe.lastIndex += 1;
      }
    });
  }

  const missingFacets = [];
  for (const facet of contract.requiredFacets || []) {
    if (!facet || !facet.pattern) continue;
    const facetRe = new RegExp(facet.pattern, "iu");
    if (!facetRe.test(String(outlineText || ""))) {
      missingFacets.push(facet.id);
    }
  }

  return {
    pass: missingFacets.length === 0 && placeholderHits.length === 0,
    missingFacets,
    placeholderCount: placeholderHits.length,
    placeholderHits,
  };
}
