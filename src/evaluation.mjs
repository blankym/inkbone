import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { validateEvidenceReview } from "./evidence-validator.mjs";

// 可复现的伪随机数（mulberry32），用于盲读包的 X/Y 分配
function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function sha256(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

// 从文件名里取第一个阿拉伯数字作为配对键，取不到时用排序位置
function pairKey(filePath, index) {
  const match = path.basename(filePath).match(/\d+/u);
  return match ? String(Number(match[0])) : `#${index + 1}`;
}

// 去掉正文里的 Markdown 标题行，避免标题里的版本号泄露给读者
export function stripHeadings(text) {
  return text
    .split(/\r?\n/u)
    .filter((line) => !/^\s*#/u.test(line))
    .join("\n")
    .replace(/^\s+/u, "");
}

// 把 A、B 两组章节按章号配对，随机分配成 X / Y
export function buildBlindPack(aFiles, bFiles, options = {}) {
  const seed = Number.isFinite(options.seed) ? options.seed : Date.now() % 2147483647;
  const rng = makeRng(seed);
  const mapA = new Map(aFiles.map((f, i) => [pairKey(f, i), f]));
  const mapB = new Map(bFiles.map((f, i) => [pairKey(f, i), f]));
  let keys = [...mapA.keys()].filter((k) => mapB.has(k));
  // 两边各只有一个文件时直接配对
  if (keys.length === 0 && aFiles.length === 1 && bFiles.length === 1) {
    mapA.set("1", aFiles[0]);
    mapB.set("1", bFiles[0]);
    keys = ["1"];
  }
  keys.sort((x, y) => Number(x.replace("#", "")) - Number(y.replace("#", "")));
  // 样本对数大于等于 2 时采用受 seed 控制的半数均衡洗牌，防止小样本盲读包全部落入同侧
  const slots = [];
  if (keys.length === 1) {
    slots.push(rng() < 0.5);
  } else if (keys.length > 1) {
    const half = Math.floor(keys.length / 2);
    for (let i = 0; i < half; i += 1) {
      slots.push(true, false);
    }
    if (keys.length % 2 === 1) {
      slots.push(rng() < 0.5);
    }
    for (let i = slots.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      [slots[i], slots[j]] = [slots[j], slots[i]];
    }
  }
  const pairs = keys.map((key, idx) => {
    const aFile = mapA.get(key);
    const bFile = mapB.get(key);
    const aText = fs.readFileSync(aFile, "utf8");
    const bText = fs.readFileSync(bFile, "utf8");
    const xIsA = slots[idx];
    return {
      pair: `pair-${String(idx + 1).padStart(2, "0")}`,
      chapterKey: key,
      X: xIsA ? "A" : "B",
      Y: xIsA ? "B" : "A",
      sources: { A: aFile, B: bFile },
      hashes: { A: sha256(aText), B: sha256(bText) },
      texts: { A: stripHeadings(aText), B: stripHeadings(bText) },
    };
  });
  const unpairedA = [...mapA.keys()].filter((k) => !mapB.has(k)).map((k) => mapA.get(k));
  const unpairedB = [...mapB.keys()].filter((k) => !mapA.has(k)).map((k) => mapB.get(k));
  const labels = { A: options.labelA || "A", B: options.labelB || "B" };
  return {
    seed,
    labels,
    // 记录两边各由哪个模型、哪个 skill 版本生成，方便按模型或按版本比较
    generation: {
      A: { label: labels.A, model: options.modelA || null },
      B: { label: labels.B, model: options.modelB || null },
    },
    pairs,
    unpaired: { A: unpairedA, B: unpairedB },
  };
}

// 写出盲读包：packet/ 给读者（只有 X/Y 正文和选票），key.json 留给作者
export function writeBlindPack(pack, outDir, options = {}) {
  const packetDir = path.join(outDir, "packet");
  fs.mkdirSync(packetDir, { recursive: true });
  const headingTemplate = options.headingTemplate || "# {{pair}} {{side}}";
  for (const p of pack.pairs) {
    const dir = path.join(packetDir, p.pair);
    fs.mkdirSync(dir, { recursive: true });
    for (const side of ["X", "Y"]) {
      const heading = headingTemplate.replace("{{pair}}", p.pair).replace("{{side}}", side);
      fs.writeFileSync(path.join(dir, `${side}.md`), `${heading}\n\n${p.texts[p[side]]}\n`);
    }
  }
  const ballot = {
    kind: "inkbone-ballot",
    reader: "",
    pairs: pack.pairs.map((p) => ({ pair: p.pair, choice: "", skimX: [], skimY: [], notes: "" })),
  };
  fs.writeFileSync(path.join(packetDir, "ballot.json"), JSON.stringify(ballot, null, 2) + "\n");
  if (options.instructions) {
    fs.writeFileSync(path.join(packetDir, "README.md"), options.instructions);
  }
  const key = {
    kind: "inkbone-blind-key",
    createdAt: new Date().toISOString(),
    seed: pack.seed,
    labels: pack.labels,
    generation: pack.generation || null,
    pairs: pack.pairs.map(({ texts: _t, ...rest }) => rest),
    unpaired: pack.unpaired,
  };
  const keyPath = path.join(outDir, "key.json");
  fs.writeFileSync(keyPath, JSON.stringify(key, null, 2) + "\n");
  return { packetDir, keyPath, pairCount: pack.pairs.length };
}

// 双侧符号检验 p 值（不计平局）
export function signTestPValue(wins, losses) {
  const n = wins + losses;
  if (n === 0) return 1;
  const k = Math.min(wins, losses);
  let logC = 0;
  let tail = 0;
  for (let i = 0; i <= k; i += 1) {
    if (i > 0) logC += Math.log(n - i + 1) - Math.log(i);
    tail += Math.exp(logC - n * Math.LN2);
  }
  return Math.min(1, Math.round(2 * tail * 10000) / 10000);
}

// 汇总读者选票：每组的选择映射回 A/B，统计胜率、平局与跳读引文
export function scoreBallots(key, ballots, options = {}) {
  const byPair = new Map(key.pairs.map((p) => [p.pair, p]));
  const texts = options.texts || null;
  const tally = { A: 0, B: 0, tie: 0, blank: 0 };
  const skim = { A: 0, B: 0 };
  const invalidQuotes = [];
  const perPair = new Map();
  for (const ballot of ballots) {
    for (const entry of ballot.pairs || []) {
      const p = byPair.get(entry.pair);
      if (!p) continue;
      const row = perPair.get(entry.pair) || { pair: entry.pair, A: 0, B: 0, tie: 0 };
      const choice = String(entry.choice || "").trim().toUpperCase();
      if (choice === "X" || choice === "Y") {
        tally[p[choice]] += 1;
        row[p[choice]] += 1;
      } else if (choice === "TIE" || choice === "=" || choice === "SAME") {
        tally.tie += 1;
        row.tie += 1;
      } else {
        tally.blank += 1;
      }
      for (const side of ["X", "Y"]) {
        const quotes = entry[`skim${side}`] || [];
        const version = p[side];
        skim[version] += quotes.length;
        if (texts && texts[entry.pair]) {
          const body = texts[entry.pair][version].replace(/\s+/gu, "");
          for (const q of quotes) {
            if (!body.includes(String(q).replace(/\s+/gu, ""))) {
              invalidQuotes.push({ reader: ballot.reader || "", pair: entry.pair, side, quote: String(q).slice(0, 40) });
            }
          }
        }
      }
      perPair.set(entry.pair, row);
    }
  }
  const decided = tally.A + tally.B;
  return {
    kind: "inkbone-blind-score",
    labels: key.labels,
    generation: key.generation || null,
    ballots: ballots.length,
    tally,
    winRate: {
      A: decided ? Math.round((tally.A / decided) * 1000) / 1000 : null,
      B: decided ? Math.round((tally.B / decided) * 1000) / 1000 : null,
    },
    signTestP: signTestPValue(tally.A, tally.B),
    skimMarks: skim,
    invalidQuotes,
    perPair: [...perPair.values()],
  };
}

// 读回 key.json 对应的原文（去标题后），用于核对选票里的跳读引文
export function loadPairTexts(key) {
  const texts = {};
  for (const p of key.pairs) {
    const entry = {};
    for (const side of ["A", "B"]) {
      const file = p.sources?.[side];
      entry[side] = file && fs.existsSync(file) ? stripHeadings(fs.readFileSync(file, "utf8")) : "";
    }
    texts[p.pair] = entry;
  }
  return texts;
}

// 校验审读 JSON 后存档：<dir>/<章节名>/<时间>-<kind>.json，记录正文哈希，正文改过就能看出来
export function saveReview(chapterPath, reviewPayload, options = {}) {
  const chapterText = fs.readFileSync(chapterPath, "utf8");
  const validation = validateEvidenceReview(chapterText, reviewPayload);
  if (!validation.valid && !options.force) {
    return { saved: false, validation };
  }
  const stem = path.basename(chapterPath).replace(/\.[^.]+$/u, "");
  const baseDir = options.dir || path.join(path.dirname(chapterPath), "_reviews");
  const dir = path.join(baseDir, stem);
  fs.mkdirSync(dir, { recursive: true });
  const savedAt = options.now || new Date();
  const stamp = savedAt.toISOString().replace(/[-:]/gu, "").replace(/\..+$/u, "");
  const kind = options.kind || "review";
  const file = path.join(dir, `${stamp}-${kind}.json`);
  const record = {
    meta: {
      kind,
      // reviewerModel：产出这份审读的模型；writerModel：写这一章正文的模型
      reviewerModel: options.reviewerModel || null,
      writerModel: options.writerModel || null,
      chapterFile: path.resolve(chapterPath),
      chapterSha256: sha256(chapterText),
      savedAt: savedAt.toISOString(),
      validation: { valid: validation.valid, checkedCount: validation.checkedCount, issues: validation.issues.length },
    },
    review: reviewPayload,
  };
  fs.writeFileSync(file, JSON.stringify(record, null, 2) + "\n");
  return { saved: true, file, validation };
}

// 统计存档审读：按章节和类型分组，列出各类别条数，并给出最近两次的变化
export function summarizeReviews(files) {
  const records = [];
  for (const file of files) {
    let data;
    try {
      data = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      continue;
    }
    if (!data || !data.meta || !data.review) continue;
    const counts = {};
    for (const item of data.review.items || []) {
      const key = `${item.category}:${item.severity || "pass"}`;
      counts[key] = (counts[key] || 0) + 1;
    }
    records.push({
      file,
      chapter: path.basename(data.meta.chapterFile || "").replace(/\.[^.]+$/u, ""),
      kind: data.meta.kind,
      savedAt: data.meta.savedAt,
      chapterSha256: data.meta.chapterSha256,
      reviewerModel: data.meta.reviewerModel || null,
      writerModel: data.meta.writerModel || null,
      counts,
    });
  }
  records.sort((a, b) => String(a.savedAt).localeCompare(String(b.savedAt)));
  const groups = new Map();
  for (const r of records) {
    const g = `${r.chapter}|${r.kind}`;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(r);
  }
  const trends = [];
  for (const [g, list] of groups) {
    if (list.length < 2) continue;
    const [prev, last] = list.slice(-2);
    const keys = new Set([...Object.keys(prev.counts), ...Object.keys(last.counts)]);
    const delta = {};
    for (const k of keys) {
      const d = (last.counts[k] || 0) - (prev.counts[k] || 0);
      if (d !== 0) delta[k] = d;
    }
    const [chapter, kind] = g.split("|");
    // 换了审读模型时，条数变化可能来自模型差异，不一定是正文变好或变差
    trends.push({
      chapter,
      kind,
      from: prev.savedAt,
      to: last.savedAt,
      textChanged: prev.chapterSha256 !== last.chapterSha256,
      reviewerChanged: (prev.reviewerModel || null) !== (last.reviewerModel || null),
      writerChanged: (prev.writerModel || null) !== (last.writerModel || null),
      delta,
    });
  }
  return { kind: "inkbone-review-stats", records, trends };
}
