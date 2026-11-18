// 主语连续性检查：找出省略主语后可能被读成别人动作的句子，以及连续多段同一种起头方式
// 只在提供了人物名单（台账 characterNames / protagonist）时运行；所有中文词表都在 zh-linguistics.json 的 subjectContinuity 里
import { stripSpokenDialogue } from "./rule-engine.mjs";

// 把配置里的词表编译成按长度降序的数组，保证长名字优先匹配
function sortByLengthDesc(list) {
  return [...new Set((list || []).filter(Boolean))].sort((a, b) => b.length - a.length);
}

// 返回文本开头匹配到的第一个词（允许前面有空白），否则返回 null
function leadingToken(text, tokens) {
  const trimmed = text.replace(/^\s+/u, "");
  for (const token of tokens) {
    if (trimmed.startsWith(token)) return token;
  }
  return null;
}

// 判断文本里是否出现任一词
function containsAny(text, tokens) {
  for (const token of tokens) {
    if (text.includes(token)) return token;
  }
  return null;
}

// 从台账收集人物名与主角名（含别名字段）
export function collectCharacterNames(ledger, extraNames = []) {
  const names = [...(ledger?.characterNames || []), ...extraNames];
  const protagonist = new Set();
  const p = ledger?.protagonist;
  if (p && typeof p === "object") {
    for (const [key, value] of Object.entries(p)) {
      if (typeof value !== "string") continue;
      if (key === "name" || /alias/iu.test(key)) {
        protagonist.add(value);
        names.push(value);
      }
    }
  }
  return { names: sortByLengthDesc(names), protagonistNames: protagonist };
}

// 对单句做分类：开头是人名 / 代词 / 先动作后补主语 / 无主语动作 / 其他
function classifySentence(sentence, ctx) {
  const clauses = sentence.split(ctx.clauseSplitter).filter((c) => c.trim().length > 0);
  const first = clauses[0] || "";
  const leadName = leadingToken(sentence, ctx.names);
  if (leadName) return { kind: "name", actor: leadName, clauseIndex: 0 };
  const leadPronoun = leadingToken(sentence, ctx.pronouns);
  if (leadPronoun) return { kind: "pronoun", actor: null };
  const firstHasRef = containsAny(first, ctx.names) || containsAny(first, ctx.pronouns);
  if (!firstHasRef && leadingToken(first, ctx.actionLeads)) {
    // 先写动作、再补主语：首个小句以动作开头且没有人名，随后某个小句以人名起头
    for (let i = 1; i < Math.min(clauses.length, ctx.maxDelayedClauses + 1); i += 1) {
      const name = leadingToken(clauses[i], ctx.names);
      if (name) return { kind: "delayed", actor: name, clauseIndex: i };
      if (containsAny(clauses[i], ctx.names) || containsAny(clauses[i], ctx.pronouns)) break;
    }
  }
  const anyRef = containsAny(sentence, ctx.names) || containsAny(sentence, ctx.pronouns);
  if (!anyRef && leadingToken(sentence, ctx.actionLeads)) {
    return { kind: "subjectless", actor: null };
  }
  return { kind: "other", actor: null };
}

// 逐段逐句扫描主语连续性
export function scanSubjectContinuity(paragraphs, lingConfig, options = {}) {
  const sc = lingConfig.subjectContinuity || {};
  const names = sortByLengthDesc(options.names || []);
  const result = { enabled: false, ambiguityHits: [], openingStreaks: [] };
  if (names.length === 0 || !paragraphs || paragraphs.length === 0) return result;
  result.enabled = true;

  const protagonistNames = options.protagonistNames || new Set();
  const ctx = {
    names,
    pronouns: sortByLengthDesc(sc.pronouns || []),
    actionLeads: sortByLengthDesc(sc.actionLeads || []),
    clauseSplitter: new RegExp(sc.clauseSplitter || "[,，;；:：]", "u"),
    maxDelayedClauses: sc.maxDelayedClauses || 4,
  };
  const sentenceSplitter = new RegExp(`(?<=[${sc.sentenceEndChars || "。！？!?…"}])`, "u");
  const maxSame = sc.maxSameOpening || 3;
  const streakKinds = new Set(sc.streakKinds || ["delayed", "subjectless", "protagonist"]);

  let prevActor = null;
  let prevActorText = "";
  let prevActorPara = -1;
  const maxActorClause = sc.maxActorClauseIndex ?? 2;
  let streakKind = null;
  let streakLines = [];
  const flushStreak = () => {
    if (streakKind && streakLines.length >= maxSame) {
      result.openingStreaks.push({
        kind: streakKind,
        startLine: streakLines[0].line,
        endLine: streakLines[streakLines.length - 1].line,
        streak: streakLines.length,
        samples: streakLines.slice(0, 3).map((s) => s.preview),
      });
    }
  };

  paragraphs.forEach((para, paraIdx) => {
    const dialogueInfo = stripSpokenDialogue(para.text, lingConfig, " ");
    const hasDialogue = dialogueInfo.hasSpokenDialogue;
    const narration = dialogueInfo.narration.trim();
    if (!/\p{Script=Han}/u.test(narration)) {
      // 纯对白段：重置主语链，不打断起头方式的连击计数
      prevActor = null;
      return;
    }
    const sentences = narration
      .split(sentenceSplitter)
      .map((s) => s.trim())
      .filter((s) => /\p{Script=Han}/u.test(s));

    sentences.forEach((sentence, idx) => {
      const cls = classifySentence(sentence, ctx);
      if (idx === 0) {
        // 起头方式连击：只统计每段第一句
        let kind = cls.kind;
        if (kind === "name") kind = protagonistNames.has(cls.actor) ? "protagonist" : "other";
        if (streakKinds.has(kind) && kind === streakKind) {
          streakLines.push({ line: para.line, preview: sentence.slice(0, 24) });
        } else {
          flushStreak();
          streakKind = streakKinds.has(kind) ? kind : null;
          streakLines = streakKind ? [{ line: para.line, preview: sentence.slice(0, 24) }] : [];
        }
      }
      if (cls.kind === "subjectless" && prevActor && !protagonistNames.has(prevActor)) {
        result.ambiguityHits.push({
          line: para.line,
          scope: prevActorPara === paraIdx ? "same-paragraph" : "next-paragraph",
          previousActor: prevActor,
          previous: prevActorText.slice(0, 40),
          current: sentence.slice(0, 40),
        });
        // 同一个主语只报第一处，避免一串无主语句被重复报出
        prevActor = null;
      }
      if ((cls.kind === "name" || cls.kind === "delayed") && cls.clauseIndex <= maxActorClause) {
        prevActor = cls.actor;
        prevActorText = sentence;
        prevActorPara = paraIdx;
      } else if (cls.kind === "pronoun") {
        prevActor = null;
      }
    });
    // 含对白的段落结束后不把主语带到下一段
    if (hasDialogue) prevActor = null;
  });
  flushStreak();
  return result;
}
