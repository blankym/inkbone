import { loadLinguisticsConfig } from "./config-loader.mjs";
import {
  maskWhitelistLiterals,
  maskQuotedText,
  scanParagraphRuleSet,
} from "./rule-engine.mjs";

// 计算数值数组的算术均值
function mean(values) {
  if (values.length === 0) return 0;
  return values.reduce((sum, val) => sum + val, 0) / values.length;
}

// 计算数值数组的总体标准差
function stdDev(values) {
  if (values.length <= 1) return 0;
  const avg = mean(values);
  const variance =
    values.reduce((sum, val) => sum + (val - avg) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

// 将浮点数四舍五入到指定小数位
function roundNum(value, digits = 3) {
  return Number(value.toFixed(digits));
}

// 统计输入字符串中包含的汉字字符数量
export function countHan(text, hanGlobalRegex) {
  const matches = text.match(hanGlobalRegex);
  return matches ? matches.length : 0;
}

// 计算滑动窗口词形词例比（MATTR）以衡量局部词汇熵与换词洁癖
function computeMattr(tokens, windowSize) {
  if (tokens.length === 0) return 0;
  if (tokens.length <= windowSize) {
    return new Set(tokens).size / tokens.length;
  }
  let ratioSum = 0;
  const steps = tokens.length - windowSize + 1;
  for (let i = 0; i < steps; i += 1) {
    const windowSlice = tokens.slice(i, i + windowSize);
    ratioSum += new Set(windowSlice).size / windowSize;
  }
  return ratioSum / steps;
}

// 扫描单个自然段内的专有名词、书名号词条及双字实词局部机械复读现象
function scanParagraphTermStuffing(para, segmenter, cfg) {
  const {
    hanCharGlobal,
    bookTitleTermGlobal,
    clauseSplitterForNgram,
    quantifierNoiseFragment,
    twoCharStopwordSet,
  } = cfg.compiledRegex;

  const bookTitleCounts = new Map();
  bookTitleTermGlobal.lastIndex = 0;
  let titleMatch;
  while ((titleMatch = bookTitleTermGlobal.exec(para.text)) !== null) {
    const term = titleMatch[0];
    bookTitleCounts.set(term, (bookTitleCounts.get(term) || 0) + 1);
  }

  // 切分语法虚词后的连续实词汉字块，零词典提取3-4字复合专有名词频次
  const chunks = para.text
    .split(clauseSplitterForNgram)
    .filter((chunk) => chunk.length >= 3);

  const fourGramCounts = new Map();
  const threeGramCounts = new Map();
  for (const chunk of chunks) {
    const chars = Array.from(chunk);
    for (let i = 0; i <= chars.length - 4; i += 1) {
      const gram4 = chars.slice(i, i + 4).join("");
      if (!quantifierNoiseFragment.test(gram4)) {
        fourGramCounts.set(gram4, (fourGramCounts.get(gram4) || 0) + 1);
      }
    }
    for (let i = 0; i <= chars.length - 3; i += 1) {
      const gram3 = chars.slice(i, i + 3).join("");
      if (!quantifierNoiseFragment.test(gram3)) {
        threeGramCounts.set(gram3, (threeGramCounts.get(gram3) || 0) + 1);
      }
    }
  }

  // 若4字复合词高频复现，剔除其包含的3字子串以免重复统计
  const frequentFourGrams = Array.from(fourGramCounts.entries()).filter(
    ([, count]) => count >= 2
  );
  for (const [gram3] of threeGramCounts) {
    const shadowed = frequentFourGrams.some(
      ([gram4, count4]) =>
        gram4.includes(gram3) && count4 >= (threeGramCounts.get(gram3) || 0)
    );
    if (shadowed) {
      threeGramCounts.delete(gram3);
    }
  }

  const compoundCounts = new Map([...fourGramCounts, ...threeGramCounts]);

  // 统计同一自然段内双字实词的出现频次
  const twoCharCounts = new Map();
  for (const seg of segmenter.segment(para.text)) {
    if (!seg.isWordLike) continue;
    if (
      countHan(seg.segment, hanCharGlobal) === 2 &&
      !twoCharStopwordSet.has(seg.segment)
    ) {
      twoCharCounts.set(
        seg.segment,
        (twoCharCounts.get(seg.segment) || 0) + 1
      );
    }
  }

  return {
    line: para.line,
    hanLen: para.hanLen,
    bookTitleRepeats: Array.from(bookTitleCounts.entries())
      .filter(([, count]) => count >= 2)
      .map(([term, count]) => ({ term, count })),
    compoundRepeats: Array.from(compoundCounts.entries())
      .filter(([, count]) => count >= 3)
      .map(([term, count]) => ({ term, count })),
    twoCharRepeats: Array.from(twoCharCounts.entries())
      .filter(([, count]) => count >= 4)
      .map(([term, count]) => ({ term, count })),
  };
}

// 对输入章节或语料执行全维度计算语言学指纹画像分析
export function profileText(rawContent, customLingConfig = null, ruleOverrides = null) {
  const cfg = customLingConfig || loadLinguisticsConfig();
  const segmenter = new Intl.Segmenter(cfg.locale, { granularity: "word" });
  const {
    hanCharGlobal,
    sentenceDelimiter,
    quoteCharsGlobal,
    dialogueSpanGlobal,
    nonDialogueRhetoricalQuestion,
    nestedDeChainGlobal,
    ledgerBracketNoteGlobal,
    pronounHeadLine,
    clauseSplitterForNgram,
    quantifierNoiseFragment,
  } = cfg.compiledRegex;
  // 套话与对称骨架规则可由调用方按「通用 + 题材 + 项目」三层合并后传入
  const forbiddenCliches =
    ruleOverrides?.forbiddenCliches || cfg.compiledRegex.forbiddenCliches;
  const symmetricSkeletons =
    ruleOverrides?.symmetricSkeletons || cfg.compiledRegex.symmetricSkeletons;
  const whitelistLiterals = ruleOverrides?.whitelistLiterals || [];
  const wlMaskChar = cfg.tokens.whitelistMaskChar || " ";
  const quoteMaskRegexes = cfg.compiledRegex.quoteMaskRegexes || [];
  const quoteMaskChar = cfg.tokens.quoteMaskChar || cfg.tokens.questionMark || "?";
  const unclosedQuoteStart = cfg.compiledRegex.unclosedQuoteStart || null;
  const visibleCharRegex = cfg.compiledRegex.visibleCharGlobal || hanCharGlobal;

  const rawLines = rawContent.split(/\r?\n/u);
  const paragraphs = [];

  // 提取有效正文自然段并记录原始行号
  rawLines.forEach((line, idx) => {
    const trimmed = line.trim();
    if (
      !trimmed ||
      trimmed.startsWith(cfg.tokens.markdownHeadingPrefix) ||
      trimmed === cfg.tokens.markdownRule
    ) {
      return;
    }
    const hanLen = countHan(trimmed, hanCharGlobal);
    if (hanLen > 0) {
      paragraphs.push({
        line: idx + 1,
        text: trimmed,
        hanLen,
      });
    }
  });

  const fullBodyText = paragraphs.map((p) => p.text).join("\n");
  const totalHan = paragraphs.reduce((acc, p) => acc + p.hanLen, 0);

  // 预扫描全章非虚词边界内重复出现的双字与三字实词，弥补ICU对仙侠器物与人名的切碎盲区
  const preChunks = fullBodyText
    .split(clauseSplitterForNgram)
    .filter((chunk) => chunk.length >= 2);
  const docBigramFreq = new Map();
  const docTrigramFreq = new Map();
  for (const chunk of preChunks) {
    const arr = Array.from(chunk);
    for (let i = 0; i + 2 <= arr.length; i += 1) {
      const g2 = arr.slice(i, i + 2).join("");
      if (!quantifierNoiseFragment.test(g2)) {
        docBigramFreq.set(g2, (docBigramFreq.get(g2) || 0) + 1);
      }
    }
    for (let i = 0; i + 3 <= arr.length; i += 1) {
      const g3 = arr.slice(i, i + 3).join("");
      if (!quantifierNoiseFragment.test(g3)) {
        docTrigramFreq.set(g3, (docTrigramFreq.get(g3) || 0) + 1);
      }
    }
  }

  const sentenceRecords = [];
  const paraSentenceCounts = [];
  let currentSingleSentStreak = 0;
  let maxSingleSentParaStreak = 0;

  const longModifierHits = [];
  const nestedDeHits = [];
  const rhetoricalQuestionHits = [];
  const emDashHits = [];
  const bracketNoteHits = [];
  const asteriskHits = [];
  const floatingDialogueHits = [];
  const paragraphStuffingScan = [];
  const dialogueDrySpells = [];
  const pronounStreakSpans = [];
  let currentPronounHeadStreak = 0;
  let maxPronounHeadStreak = 0;
  let pronounStreakStartLine = 1;
  let prevPronounLine = 1;
  let prevParaHadDialogue = false;
  let prevParaEndedWithColon = false;
  let currentDryHan = 0;
  let dryStartLine = paragraphs.length > 0 ? paragraphs[0].line : 1;
  let maxDialogueDrySpellHan = 0;

  // 遍历每个自然段，切分句子并扫描微观句法与禁用模式
  for (const para of paragraphs) {
    const stuffingRecord = scanParagraphTermStuffing(para, segmenter, cfg);
    if (
      stuffingRecord.bookTitleRepeats.length > 0 ||
      stuffingRecord.compoundRepeats.length > 0 ||
      stuffingRecord.twoCharRepeats.length > 0
    ) {
      paragraphStuffingScan.push(stuffingRecord);
    }

    const strippedDialogue = para.text.replace(dialogueSpanGlobal, "");
    const isPureDialoguePara = strippedDialogue.trim().length === 0;
    const hasSpokenDialogue =
      para.text.length - strippedDialogue.length >= 8;

    // 检测连续多个自然段以第三人称代词起头的英文翻译腔句式（触发AIGC高分的核心隐患）
    if (pronounHeadLine && !isPureDialoguePara) {
      if (pronounHeadLine.test(para.text)) {
        if (currentPronounHeadStreak === 0) {
          pronounStreakStartLine = para.line;
        }
        currentPronounHeadStreak += 1;
        prevPronounLine = para.line;
        if (currentPronounHeadStreak > maxPronounHeadStreak) {
          maxPronounHeadStreak = currentPronounHeadStreak;
        }
      } else {
        if (currentPronounHeadStreak >= 3) {
          pronounStreakSpans.push({
            startLine: pronounStreakStartLine,
            endLine: prevPronounLine,
            streak: currentPronounHeadStreak,
          });
        }
        currentPronounHeadStreak = 0;
      }
    }

    // 检测场景开场首句悬空台词（前一段无对白且无冒号引导时，孤立纯引号段缺少说话人挂靠）
    if (
      isPureDialoguePara &&
      !prevParaHadDialogue &&
      !prevParaEndedWithColon
    ) {
      floatingDialogueHits.push({
        line: para.line,
        preview: para.text.slice(0, 36),
      });
    }
    prevParaHadDialogue = hasSpokenDialogue || isPureDialoguePara;
    prevParaEndedWithColon = para.text.endsWith(cfg.tokens.colon);

    if (hasSpokenDialogue) {
      if (currentDryHan > maxDialogueDrySpellHan) {
        maxDialogueDrySpellHan = currentDryHan;
      }
      if (currentDryHan >= 700) {
        dialogueDrySpells.push({
          startLine: dryStartLine,
          endLine: para.line - 1,
          hanSpan: currentDryHan,
        });
      }
      currentDryHan = 0;
      dryStartLine = para.line + 1;
    } else {
      if (currentDryHan === 0) {
        dryStartLine = para.line;
      }
      currentDryHan += para.hanLen;
    }

    const wlParaText = maskWhitelistLiterals(
      para.text,
      whitelistLiterals,
      wlMaskChar
    );

    // 检查非对话区域的破折号代劳结构（遮罩书级白名单、成对引号以及行末未收口对话）
    const emDashScanText =
      quoteMaskRegexes.length > 0
        ? maskQuotedText(wlParaText, quoteMaskRegexes, " ", unclosedQuoteStart)
        : maskWhitelistLiterals(strippedDialogue, whitelistLiterals, wlMaskChar);
    if (emDashScanText.includes(cfg.tokens.emDash)) {
      const count = emDashScanText.split(cfg.tokens.emDash).length - 1;
      emDashHits.push({ line: para.line, count, preview: para.text.slice(0, 40) });
    }

    // 检查非对话段尾修辞反问句
    const rqScanText = maskWhitelistLiterals(
      strippedDialogue,
      whitelistLiterals,
      wlMaskChar
    ).trim();
    if (nonDialogueRhetoricalQuestion.test(rqScanText)) {
      rhetoricalQuestionHits.push({
        line: para.line,
        preview: para.text.slice(-36),
      });
    }

    // 检查嵌套定语链（X的Y的Z）
    nestedDeChainGlobal.lastIndex = 0;
    let nestedMatch;
    while ((nestedMatch = nestedDeChainGlobal.exec(para.text)) !== null) {
      nestedDeHits.push({
        line: para.line,
        matched: nestedMatch[0],
      });
    }

    // 检查账本括号出戏注记与残留星号
    ledgerBracketNoteGlobal.lastIndex = 0;
    let noteMatch;
    while ((noteMatch = ledgerBracketNoteGlobal.exec(para.text)) !== null) {
      bracketNoteHits.push({ line: para.line, matched: noteMatch[0] });
    }
    if (para.text.includes(cfg.tokens.asterisk)) {
      asteriskHits.push({ line: para.line, preview: para.text.slice(0, 40) });
    }

    // 切分段落内句子并统计单句成段连击数
    const cleanPara = para.text.replace(quoteCharsGlobal, "");
    const rawSents = cleanPara
      .split(sentenceDelimiter)
      .map((s) => s.trim())
      .filter((s) => countHan(s, hanCharGlobal) > 0);

    paraSentenceCounts.push(rawSents.length);
    const isDialogueOnlyPara = strippedDialogue.trim().length === 0;
    if (rawSents.length === 1 && !isDialogueOnlyPara && para.hanLen > 14) {
      currentSingleSentStreak += 1;
      if (currentSingleSentStreak > maxSingleSentParaStreak) {
        maxSingleSentParaStreak = currentSingleSentStreak;
      }
    } else if (!isDialogueOnlyPara) {
      currentSingleSentStreak = 0;
    }

    // 逐句提取分句逗号数、左分支长定语与双字实词集合
    for (const sent of rawSents) {
      const sentHan = countHan(sent, hanCharGlobal);
      const clauses = sent.split(cfg.tokens.comma);
      const commaCount = Math.max(0, clauses.length - 1);

      let sentLongMods = 0;
      for (const clause of clauses) {
        const deParts = clause.split(cfg.tokens.deParticle);
        if (deParts.length > 1) {
          for (let i = 0; i < deParts.length - 1; i += 1) {
            const modHan = countHan(deParts[i], hanCharGlobal);
            if (modHan >= cfg.thresholds.longPreModifierMinHan) {
              sentLongMods += 1;
              longModifierHits.push({
                line: para.line,
                clause: clause.slice(0, 36),
                modHan,
              });
            }
          }
        }
      }

      const multiCharWords = new Set();
      for (const seg of segmenter.segment(sent)) {
        if (seg.isWordLike && countHan(seg.segment, hanCharGlobal) >= 2) {
          multiCharWords.add(seg.segment);
        }
      }
      // 补充句内被ICU切碎但全章重复出现的双字或三字专名与器物词
      const sentChunks = sent
        .split(clauseSplitterForNgram)
        .filter((chunk) => chunk.length >= 2);
      for (const sChunk of sentChunks) {
        const sArr = Array.from(sChunk);
        for (let i = 0; i + 2 <= sArr.length; i += 1) {
          const g2 = sArr.slice(i, i + 2).join("");
          if ((docBigramFreq.get(g2) || 0) >= 3) {
            multiCharWords.add(g2);
          }
        }
        for (let i = 0; i + 3 <= sArr.length; i += 1) {
          const g3 = sArr.slice(i, i + 3).join("");
          if ((docTrigramFreq.get(g3) || 0) >= 3) {
            multiCharWords.add(g3);
          }
        }
      }

      sentenceRecords.push({
        line: para.line,
        hanLen: sentHan,
        commaCount,
        clauseCount: clauses.length,
        longMods: sentLongMods,
        multiCharWords,
        preview: sent.slice(0, 32),
      });
    }
  }

  // 统一走带白名单、单行安全引号遮蔽与同段包含去重的规则扫描引擎
  const scanOpts = {
    quoteMaskRegexes,
    quoteMaskChar,
    whitelistLiterals,
    whitelistMaskChar: wlMaskChar,
    visibleCharRegex,
  };
  const clicheHits = scanParagraphRuleSet(paragraphs, forbiddenCliches, scanOpts);
  const symmetricHits = scanParagraphRuleSet(
    paragraphs,
    symmetricSkeletons,
    scanOpts
  );

  // 收尾统计章末最后一段无对白独白跨度与连续代词段首连击
  if (currentPronounHeadStreak >= 3) {
    pronounStreakSpans.push({
      startLine: pronounStreakStartLine,
      endLine: prevPronounLine,
      streak: currentPronounHeadStreak,
    });
  }
  if (currentDryHan > maxDialogueDrySpellHan) {
    maxDialogueDrySpellHan = currentDryHan;
  }
  if (currentDryHan >= 700 && paragraphs.length > 0) {
    dialogueDrySpells.push({
      startLine: dryStartLine,
      endLine: paragraphs[paragraphs.length - 1].line,
      hanSpan: currentDryHan,
    });
  }

  // 扫描全章级 3-4 字复合词与固定短语高频复读（抑制听觉疲劳口癖）
  const chapterChunks = fullBodyText
    .split(clauseSplitterForNgram)
    .filter((chunk) => chunk.length >= 3);
  const chapFourCounts = new Map();
  const chapThreeCounts = new Map();
  for (const chunk of chapterChunks) {
    const chars = Array.from(chunk);
    for (let i = 0; i <= chars.length - 4; i += 1) {
      const g4 = chars.slice(i, i + 4).join("");
      if (!quantifierNoiseFragment.test(g4)) {
        chapFourCounts.set(g4, (chapFourCounts.get(g4) || 0) + 1);
      }
    }
    for (let i = 0; i <= chars.length - 3; i += 1) {
      const g3 = chars.slice(i, i + 3).join("");
      if (!quantifierNoiseFragment.test(g3)) {
        chapThreeCounts.set(g3, (chapThreeCounts.get(g3) || 0) + 1);
      }
    }
  }
  const topChapFour = Array.from(chapFourCounts.entries())
    .filter(([, count]) => count >= 3)
    .sort((a, b) => b[1] - a[1]);
  for (const [g3, c3] of chapThreeCounts) {
    const shadowed = topChapFour.some(
      ([g4, c4]) => g4.includes(g3) && c4 >= c3 - 1
    );
    if (shadowed) {
      chapThreeCounts.delete(g3);
    }
  }
  const topChapThree = Array.from(chapThreeCounts.entries())
    .filter(([, count]) => count >= 6)
    .sort((a, b) => b[1] - a[1]);

  // 全局分词并缝合被ICU切碎的高频双字专名，计算公平的 MATTR-50 与 Hapax 比率
  const rawWordTokens = [];
  for (const seg of segmenter.segment(fullBodyText)) {
    if (!seg.isWordLike) continue;
    const hCount = countHan(seg.segment, hanCharGlobal);
    if (hCount >= 1) {
      rawWordTokens.push({ text: seg.segment, hanLen: hCount });
    }
  }
  const allWordTokens = [];
  const multiWordFreq = new Map();
  let tokIdx = 0;
  while (tokIdx < rawWordTokens.length) {
    const cur = rawWordTokens[tokIdx];
    if (
      cur.hanLen === 1 &&
      tokIdx + 1 < rawWordTokens.length &&
      rawWordTokens[tokIdx + 1].hanLen === 1
    ) {
      const bi = cur.text + rawWordTokens[tokIdx + 1].text;
      if ((docBigramFreq.get(bi) || 0) >= 3) {
        allWordTokens.push(bi);
        multiWordFreq.set(bi, (multiWordFreq.get(bi) || 0) + 1);
        tokIdx += 2;
        continue;
      }
    }
    allWordTokens.push(cur.text);
    if (cur.hanLen >= 2) {
      multiWordFreq.set(cur.text, (multiWordFreq.get(cur.text) || 0) + 1);
    }
    tokIdx += 1;
  }

  let hapaxCount = 0;
  for (const freq of multiWordFreq.values()) {
    if (freq === 1) hapaxCount += 1;
  }
  const hapaxRatio =
    multiWordFreq.size > 0 ? hapaxCount / multiWordFreq.size : 0;

  // 计算话题记忆窗口（前 N 句）内的双字实词锚定复现率
  const memWin = cfg.thresholds.topicMemoryWindow;
  let anchoredSentences = 0;
  const anchorableTotal = Math.max(0, sentenceRecords.length - 1);
  for (let i = 1; i < sentenceRecords.length; i += 1) {
    const currentSet = sentenceRecords[i].multiCharWords;
    let linked = false;
    const startIdx = Math.max(0, i - memWin);
    for (let j = startIdx; j < i; j += 1) {
      for (const word of currentSet) {
        if (sentenceRecords[j].multiCharWords.has(word)) {
          linked = true;
          break;
        }
      }
      if (linked) break;
    }
    if (linked) anchoredSentences += 1;
  }

  // 检测局部机械等长节拍窗口（模拟 Burstiness 平坦度探针）
  const monotonousWindows = [];
  const winSize = cfg.thresholds.monotonousWindowSize;
  for (let i = 0; i <= sentenceRecords.length - winSize; i += 1) {
    const slice = sentenceRecords.slice(i, i + winSize);
    const lengths = slice.map((s) => s.hanLen);
    const localMean = mean(lengths);
    const localCv = localMean > 0 ? stdDev(lengths) / localMean : 0;
    if (localMean >= 18 && localCv <= cfg.thresholds.monotonousMaxCv) {
      monotonousWindows.push({
        startLine: slice[0].line,
        endLine: slice[slice.length - 1].line,
        localCv: roundNum(localCv, 3),
        lengths,
      });
      // 跳过重叠窗口避免重复告警
      i += Math.floor(winSize / 2);
    }
  }

  const sentLengths = sentenceRecords.map((s) => s.hanLen);
  const sentMean = mean(sentLengths);
  const sentSd = stdDev(sentLengths);
  const sentCv = sentMean > 0 ? sentSd / sentMean : 0;

  const totalClauses = sentenceRecords.reduce((acc, s) => acc + s.clauseCount, 0);
  const totalLongMods = sentenceRecords.reduce((acc, s) => acc + s.longMods, 0);
  const flowingCount = sentenceRecords.filter(
    (s) => s.commaCount >= cfg.thresholds.flowingSentenceMinCommas
  ).length;
  const ultraShortCount = sentenceRecords.filter(
    (s) => s.hanLen <= cfg.thresholds.ultraShortSentenceMaxHan
  ).length;

  const deTotal = fullBodyText.split(cfg.tokens.deParticle).length - 1;
  const narrativeEmDashTotal = emDashHits.reduce((acc, h) => acc + h.count, 0);

  return {
    metrics: {
      totalHan,
      paragraphCount: paragraphs.length,
      sentenceCount: sentenceRecords.length,
      sentsPerParaMean: roundNum(mean(paraSentenceCounts), 2),
      maxSingleSentParaStreak,
      paraLenMean: roundNum(mean(paragraphs.map((p) => p.hanLen)), 1),
      sentLenMean: roundNum(sentMean, 1),
      sentLenSD: roundNum(sentSd, 1),
      sentLenCV: roundNum(sentCv, 3),
      flowingSentRatio: roundNum(
        sentenceRecords.length > 0 ? flowingCount / sentenceRecords.length : 0,
        3
      ),
      ultraShortSentRatio: roundNum(
        sentenceRecords.length > 0
          ? ultraShortCount / sentenceRecords.length
          : 0,
        3
      ),
      dePer100Han: roundNum(totalHan > 0 ? (deTotal / totalHan) * 100 : 0, 2),
      longModPerClause: roundNum(
        totalClauses > 0 ? totalLongMods / totalClauses : 0,
        3
      ),
      nestedDePer1kHan: roundNum(
        totalHan > 0 ? (nestedDeHits.length / totalHan) * 1000 : 0,
        2
      ),
      mattr50: roundNum(
        computeMattr(allWordTokens, cfg.thresholds.mattrWindowSize),
        3
      ),
      hapaxRatio: roundNum(hapaxRatio, 3),
      topicAnchorRatio: roundNum(
        anchorableTotal > 0 ? anchoredSentences / anchorableTotal : 0,
        3
      ),
      emDashPer1kHan: roundNum(
        totalHan > 0 ? (narrativeEmDashTotal / totalHan) * 1000 : 0,
        2
      ),
      rhetoricalQuestionCount: rhetoricalQuestionHits.length,
      symmetricSkeletonCount: symmetricHits.length,
      forbiddenClicheCount: clicheHits.length,
      monotonousWindowCount: monotonousWindows.length,
      paragraphStuffingCount: paragraphStuffingScan.length,
      maxPronounHeadStreak,
      maxDialogueDrySpellHan,
      maxSentHan: sentLengths.length > 0 ? Math.max(...sentLengths) : 0,
      maxSentCommas:
        sentenceRecords.length > 0
          ? Math.max(...sentenceRecords.map((s) => s.commaCount))
          : 0,
      floatingDialogueCount: floatingDialogueHits.length,
      formattingArtifactCount: bracketNoteHits.length + asteriskHits.length,
    },
    diagnostics: {
      paragraphs,
      sentences: sentenceRecords.map((s) => ({
        line: s.line,
        hanLen: s.hanLen,
        commaCount: s.commaCount,
        preview: s.preview,
      })),
      floatingDialogueHits,
      paragraphStuffingScan,
      chapterFourGramFreq: topChapFour.map(([term, count]) => ({
        term,
        count,
      })),
      chapterThreeGramFreq: topChapThree.map(([term, count]) => ({
        term,
        count,
      })),
      dialogueDrySpells,
      pronounStreakSpans,
      longModifierHits,
      nestedDeHits,
      rhetoricalQuestionHits,
      emDashHits,
      clicheHits,
      symmetricHits,
      monotonousWindows,
      bracketNoteHits,
      asteriskHits,
    },
  };
}
