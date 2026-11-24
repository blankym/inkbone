// 零文件系统依赖的 280 字滑窗 AIGC 结构熵与词汇双侧护栏核心模块（供 Node CLI、MCP 与浏览器共用）

const RE_HAN_GLOBAL = /\p{Script=Han}/gu;
const RE_HAN_SINGLE = /\p{Script=Han}/u;
const RE_SENT_SPLIT = /[\u3002\uff01\uff1f!?]+/u;

// 引号与标点 Unicode 常量（避免代码字面量出现中文字符）
const OPEN_QUOTES = new Set(["\u201c", "\u300c", "\u300e"]);
const CLOSE_QUOTES = new Set(["\u201d", "\u300d", "\u300f"]);
const RE_QUOTE_SPAN = /\u201c[^\u201d\r\n]*\u201d|\u300c[^\u300d\r\n]*\u300d|\u300e[^\u300f\r\n]*\u300f/gu;
const RE_TRUE_SANDWICH =
  /(?:\u201c[^\u201d\r\n]+\u201d|\u300c[^\u300d\r\n]+\u300d)[^\u201c\u201d\u300c\u300d\uff1a:\r\n]{1,36}[\uff0c,]\s*(?:\u201c[^\u201d\r\n]+\u201d|\u300c[^\u300d\r\n]+\u300d)/u;
const RE_PERIOD_BEFORE_QUOTE =
  /(?<![\u201d\u300d\u300f\u201c\u300c\u300e])[\u3002\uff01\uff1f!?][^\S\r\n]*[\u201c\u300c\u300e]/gu;

const CH_DE = "\u7684";
const CH_ZHE_DEM = "\u8fd9";
const CH_NA_DEM = "\u90a3";

// 常用语法虚词、副词、人称代词、趋向词与数量词集合（用于识别无虚词硬拼的连续实词砖块）
const FUNC_CHAR_SET = new Set(
  Array.from(
    "\u7684\u5730\u5f97\u4e86\u7740\u8fc7\u5728\u628a\u88ab\u7ed9\u8ddf\u548c\u4e0e\u53ca\u6216\u5f80\u4ece\u5230\u5411\u4e4b" +
      "\u662f\u6709\u6ca1\u4e0d\u4e5f\u90fd\u5c31\u8fd8\u53c8\u624d\u521a\u6b63\u5148\u518d\u66f4\u6700\u5f88\u633a\u592a\u771f\u53ea\u5374\u4f46" +
      "\u80fd\u4f1a\u8981\u8ba9\u53eb\u53bb\u6765\u4e0a\u4e0b\u91cc\u5916\u597d\u5feb\u6162\u65e9\u665a\u591a\u5c11\u534a\u5168\u5404\u6bcf\u67d0\u522b\u53e6\u540c\u81ea\u76f8\u4e92" +
      "\u4f60\u6211\u4ed6\u5979\u5b83\u60a8\u54b1\u8fd9\u90a3\u54ea\u8c01\u4ec0\u600e\u5417\u5427\u554a\u5462\u5457\u5566\u561b" +
      "\u4e00\u4e8c\u4e24\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\u767e\u5343\u4e07" +
      "\u4e2a\u53ea\u5f20\u5757\u4ef6\u53e5\u58f0\u773c\u6b21\u70b9\u4e9b\u8bf4\u770b\u95ee\u60f3\u8d70"
  )
);

// 统计字符串中的有效汉字数量
function countHanChars(text) {
  const m = String(text || "").match(RE_HAN_GLOBAL);
  return m ? m.length : 0;
}

// 统计指定单字符在文本中的出现次数
function countChar(text, target) {
  let n = 0;
  const s = String(text || "");
  for (let i = 0; i < s.length; i += 1) {
    if (s[i] === target) n += 1;
  }
  return n;
}

// 识别单个正文自然段的结构句式类别：
// N = 纯叙述段；S = 居中提示语夹心对话段；Q = 首引号单轮段；A = 动作冒号引出对话段；M = 多轮冒号复合段
export function classifyParagraphCadence(paragraphText) {
  const p = String(paragraphText || "").trim();
  if (!p) return "N";
  let openCount = 0;
  for (const ch of p) {
    if (OPEN_QUOTES.has(ch)) openCount += 1;
  }
  if (openCount === 0) return "N";
  if (RE_TRUE_SANDWICH.test(p)) return "S";
  if (openCount >= 2) return "M";
  if (OPEN_QUOTES.has(p[0])) return "Q";
  return "A";
}

// 计算五类段落结构（N / A / Q / S / M）的香农熵
export function computeCadenceEntropy(types) {
  if (!types || types.length === 0) return 0;
  const counts = { N: 0, A: 0, Q: 0, S: 0, M: 0 };
  for (const t of types) {
    const key = counts[t] !== undefined ? t : "N";
    counts[key] += 1;
  }
  const total = types.length;
  let ent = 0;
  for (const v of Object.values(counts)) {
    if (v > 0) {
      const p = v / total;
      ent -= p * Math.log(p);
    }
  }
  return Number(ent.toFixed(4));
}

// 扫描连续 >=6 个实词汉字无虚词缓冲硬拼成的修饰语砖块（每千字频次及样例）
export function measureCompoundBricks(text, exemptTerms = []) {
  let masked = String(text || "");
  for (const term of exemptTerms || []) {
    if (term && term.length >= 2) {
      masked = masked.split(term).join(" ");
    }
  }
  const nh = Math.max(countHanChars(masked), 1);
  let curLen = 0;
  let buf = "";
  let bricks = 0;
  const samples = [];
  for (const ch of masked) {
    if (RE_HAN_SINGLE.test(ch) && !FUNC_CHAR_SET.has(ch)) {
      curLen += 1;
      buf += ch;
    } else {
      if (curLen >= 6) {
        bricks += 1;
        if (samples.length < 5) samples.push(buf);
      }
      curLen = 0;
      buf = "";
    }
  }
  if (curLen >= 6) {
    bricks += 1;
    if (samples.length < 5) samples.push(buf);
  }
  return {
    bricks,
    brickPer1k: Number(((bricks * 1000) / nh).toFixed(2)),
    samples,
  };
}

// 提取带原始行号的正文自然段列表（跳过空行、Markdown 标题与分隔线）
export function extractNumberedParagraphs(rawContent) {
  const lines = String(rawContent || "").split(/\r?\n/u);
  const out = [];
  for (let idx = 0; idx < lines.length; idx += 1) {
    const trimmed = lines[idx].trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("#") || /^(?:-{3,}|\*{3,}|_{3,})$/u.test(trimmed)) continue;
    const hanLen = countHanChars(trimmed);
    if (hanLen === 0) continue;
    out.push({
      line: idx + 1,
      text: trimmed,
      hanLen,
      cadenceType: classifyParagraphCadence(trimmed),
    });
  }
  return out;
}

// 计算单个窗口的综合 AIGC 结构与词汇失衡分（基于实测 280 字分段样本校准，0.50 为黄标警戒线）
export function evaluateWindowSlice(paras, exemptTerms = []) {
  const joined = paras.map((p) => p.text).join("\n");
  const totalHan = Math.max(
    paras.reduce((acc, p) => acc + p.hanLen, 0),
    1
  );
  const types = paras.map((p) => p.cadenceType);
  const nPara = paras.length;
  const sCount = types.filter((t) => t === "S").length;
  const aCount = types.filter((t) => t === "A" || t === "M").length;
  const nCount = types.filter((t) => t === "N").length;
  const qCount = types.filter((t) => t === "Q").length;

  const sandwichRatio = sCount / nPara;
  const cadenceEntropy = computeCadenceEntropy(types);

  // 统计连续夹心段与连续动作冒号段的最大连击数
  let maxSandwichStreak = 0;
  let maxActionColonStreak = 0;
  let curS = 0;
  let curA = 0;
  for (const t of types) {
    curS = t === "S" ? curS + 1 : 0;
    curA = t === "A" ? curA + 1 : 0;
    if (curS > maxSandwichStreak) maxSandwichStreak = curS;
    if (curA > maxActionColonStreak) maxActionColonStreak = curA;
  }

  // 统计引号外叙述层的“这/那”与“的”，但以整窗有效汉字为分母，避免高对白段因叙述字数过少产生小分母放大误报
  const dePer100 = Number(((countChar(joined, CH_DE) * 100) / totalHan).toFixed(2));
  const narrationOnly = joined.replace(RE_QUOTE_SPAN, " ");
  const narrHan = countHanChars(narrationOnly);
  const narrDePer100 =
    narrHan >= 80
      ? Number(((countChar(narrationOnly, CH_DE) * 100) / narrHan).toFixed(2))
      : dePer100;
  const demonsPer100 = Number(
    (
      ((countChar(narrationOnly, CH_ZHE_DEM) + countChar(narrationOnly, CH_NA_DEM)) *
        100) /
      totalHan
    ).toFixed(2)
  );

  const quotedMatches = joined.match(RE_QUOTE_SPAN) || [];
  const quotedHan = quotedMatches.reduce((acc, q) => acc + countHanChars(q), 0);
  const quoteCharRatio = Number((quotedHan / totalHan).toFixed(3));

  const sents = joined
    .split(RE_SENT_SPLIT)
    .map((s) => countHanChars(s))
    .filter((len) => len > 0);
  const sentMean =
    sents.length > 0
      ? Number((sents.reduce((a, b) => a + b, 0) / sents.length).toFixed(1))
      : totalHan;
  const paraMean = Number((totalHan / nPara).toFixed(1));

  const periodQuoteMatches = joined.match(RE_PERIOD_BEFORE_QUOTE) || [];
  const periodQuoteCount = periodQuoteMatches.length;

  const rawBricks = measureCompoundBricks(narrationOnly, exemptTerms);
  const brickSamples = rawBricks.samples;
  const brickPer1k = Number(((rawBricks.bricks * 1000) / totalHan).toFixed(2));

  // 双侧“的”字偏离惩罚：重点拦截 <1.20 的去味过猛脱水，仅在引号外叙述层 >3.60 时惩罚欧化定语堆叠
  let dePenalty = 0;
  if (dePer100 < 1.25) {
    dePenalty = (1.25 - dePer100) * 0.055;
  } else if (narrDePer100 > 3.6) {
    dePenalty = (narrDePer100 - 3.6) * 0.035;
  }

  const sExcess = Math.max(0, sandwichRatio - 0.36);
  const demExcess = Math.max(0, demonsPer100 - 1.15);
  const brickExcess = Math.max(0, brickPer1k - 14.0);
  const entDeficit = Math.max(0, 0.9 - cadenceEntropy);
  const paraExcess = Math.max(0, paraMean - 82.0);
  const sentExcess = Math.max(0, sentMean - 38.0);

  const rawScore =
    0.382 +
    dePenalty +
    sExcess * 0.175 +
    (maxSandwichStreak >= 3 ? (maxSandwichStreak - 2) * 0.038 : 0) +
    (maxActionColonStreak >= 6 ? 0.045 : 0) +
    demExcess * 0.048 +
    brickExcess * 0.0032 +
    entDeficit * 0.052 +
    paraExcess * 0.001 +
    sentExcess * 0.0025 +
    periodQuoteCount * 0.045;

  const estimatedRisk = Number(Math.min(0.95, Math.max(0.25, rawScore)).toFixed(4));

  const reasons = [];
  if (periodQuoteCount > 0) reasons.push("period_before_quote");
  if (maxSandwichStreak >= 3 || sandwichRatio >= 0.5) reasons.push("sandwich_overload");
  if (maxActionColonStreak >= 6) reasons.push("action_colon_wall");
  if (nPara >= 4 && cadenceEntropy < 0.8) reasons.push("low_cadence_entropy");
  if (dePer100 < 1.05 && (demonsPer100 > 1.15 || brickPer1k > 14)) {
    reasons.push("de_starvation_rebound");
  }
  if (narrDePer100 > 3.6) reasons.push("excessive_de_density");
  if (demonsPer100 > 1.45) reasons.push("demonstrative_spike");
  if (brickPer1k > 18) reasons.push("compound_modifier_bricks");
  if (paraMean > 90) reasons.push("oversized_paragraph_mean");

  return {
    startLine: paras[0].line,
    endLine: paras[paras.length - 1].line,
    paragraphCount: nPara,
    hanChars: totalHan,
    sequence: types.join(""),
    estimatedRisk,
    dePer100,
    demonsPer100,
    sandwichRatio: Number(sandwichRatio.toFixed(3)),
    maxSandwichStreak,
    maxActionColonStreak,
    cadenceEntropy,
    quoteCharRatio,
    paraMean,
    sentMean,
    brickPer1k,
    brickSamples,
    periodQuoteCount,
    reasons,
  };
}

// 对整章执行滑窗 AIGC 结构与词汇风险扫描（默认 6 段一窗、步长 2 段，贴合 250-350 字检测粒度）
export function scanChapterAigcWindows(rawContent, options = {}) {
  const paras = extractNumberedParagraphs(rawContent);
  const threshold = options.threshold !== undefined ? Number(options.threshold) : 0.5;
  const windowParas = options.windowParas || 6;
  const stride = options.stride || 2;
  const minWindowHan = options.minWindowHan || 180;
  const exemptTerms = options.exemptTerms || [];

  if (paras.length === 0) {
    return {
      pass: true,
      threshold,
      overallRisk: 0,
      maxWindowRisk: 0,
      worstWindow: null,
      chapterCadence: {
        sequence: "",
        cadenceEntropy: 0,
        sandwichRatio: 0,
        maxSandwichStreak: 0,
        maxActionColonStreak: 0,
        demonsPer100Han: 0,
        brickPer1kHan: 0,
      },
      windows: [],
      flaggedWindows: [],
      monotonySpans: [],
      telegraphicSpans: [],
    };
  }

  const chapterEval = evaluateWindowSlice(paras, exemptTerms);
  const windows = [];
  if (paras.length <= windowParas) {
    windows.push(chapterEval);
  } else {
    for (let i = 0; i <= paras.length - windowParas; i += stride) {
      const slice = paras.slice(i, i + windowParas);
      const w = evaluateWindowSlice(slice, exemptTerms);
      if (w.hanChars >= minWindowHan) windows.push(w);
    }
    // 确保章末最后 windowParas 段也被完整覆盖
    if ((paras.length - windowParas) % stride !== 0) {
      const tailSlice = paras.slice(paras.length - windowParas);
      const tailW = evaluateWindowSlice(tailSlice, exemptTerms);
      if (tailW.hanChars >= minWindowHan) windows.push(tailW);
    }
  }

  let worstWindow = null;
  for (const w of windows) {
    if (!worstWindow || w.estimatedRisk > worstWindow.estimatedRisk) {
      worstWindow = w;
    }
  }

  const flaggedWindows = windows.filter((w) => w.estimatedRisk >= threshold);

  // 提取全章级连续句式同构区间（S 连击 >= 4 或 A 连击 >= 8，用于默认审计高置信告警）
  const monotonySpans = [];
  let curType = "";
  let streakStartIdx = 0;
  let streakLen = 0;
  const flushStreak = (endIdx) => {
    if (
      (curType === "S" && streakLen >= 4) ||
      (curType === "A" && streakLen >= 8)
    ) {
      monotonySpans.push({
        kind: curType === "S" ? "sandwich_quote_streak" : "action_colon_streak",
        streak: streakLen,
        startLine: paras[streakStartIdx].line,
        endLine: paras[endIdx].line,
      });
    }
  };
  for (let i = 0; i < paras.length; i += 1) {
    const t = paras[i].cadenceType;
    if (t === curType) {
      streakLen += 1;
    } else {
      if (streakLen > 0) flushStreak(i - 1);
      curType = t;
      streakStartIdx = i;
      streakLen = 1;
    }
  }
  if (streakLen > 0) flushStreak(paras.length - 1);

  // 提取极端“去味反弹”脱水区间（的<0.95 且 叙述层指示词这/那>1.45 且 实词砖块>14）
  const telegraphicSpans = windows.filter(
    (w) => w.dePer100 < 0.95 && w.demonsPer100 > 1.45 && w.brickPer1k > 14
  );

  return {
    pass: flaggedWindows.length === 0,
    threshold,
    overallRisk: chapterEval.estimatedRisk,
    maxWindowRisk: worstWindow ? worstWindow.estimatedRisk : chapterEval.estimatedRisk,
    worstWindow,
    chapterCadence: {
      sequence: chapterEval.sequence,
      cadenceEntropy: chapterEval.cadenceEntropy,
      sandwichRatio: chapterEval.sandwichRatio,
      maxSandwichStreak: chapterEval.maxSandwichStreak,
      maxActionColonStreak: chapterEval.maxActionColonStreak,
      demonsPer100Han: chapterEval.demonsPer100,
      brickPer1kHan: chapterEval.brickPer1k,
    },
    windows,
    flaggedWindows,
    monotonySpans,
    telegraphicSpans,
  };
}
