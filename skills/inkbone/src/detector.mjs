import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_ZHUQUE_ENDPOINT =
  "https://ai-gateway.edgeone.link/v1/providers/zhuque-text/classify";

// 解析单文件内容中的键值环境变量
function parseEnvFile(filePath) {
  const vars = {};
  if (!fs.existsSync(filePath)) return vars;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/u);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eqIdx = line.indexOf("=");
    if (eqIdx <= 0) continue;
    const key = line.slice(0, eqIdx).trim();
    let val = line.slice(eqIdx + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    vars[key] = val;
  }
  return vars;
}

// 按环境变量与上级目录 .env 文件顺序解析朱雀 API 密钥
export function resolveZhuqueApiKey(options = {}) {
  if (options.apiKey) return options.apiKey;
  if (process.env.ZHUQUE_API_KEY) return process.env.ZHUQUE_API_KEY;
  if (process.env.MAKERS_MODELS_KEY) return process.env.MAKERS_MODELS_KEY;

  let curDir = options.startDir ? path.resolve(options.startDir) : process.cwd();
  for (let depth = 0; depth < 5; depth += 1) {
    const envPath = path.join(curDir, ".env");
    const parsed = parseEnvFile(envPath);
    if (parsed.ZHUQUE_API_KEY) return parsed.ZHUQUE_API_KEY;
    if (parsed.MAKERS_MODELS_KEY) return parsed.MAKERS_MODELS_KEY;
    const parent = path.dirname(curDir);
    if (parent === curDir) break;
    curDir = parent;
  }
  return "";
}

// 剥离 Markdown 标题井号并支持按行号截取局部区间以节省 API Token
export function prepareDetectorInput(rawMarkdown, lineRange = null) {
  const allRawLines = rawMarkdown.split(/\r?\n/u);
  let startIdx = 0;
  let endIdx = allRawLines.length - 1;
  if (Array.isArray(lineRange) && lineRange.length === 2) {
    startIdx = Math.max(0, Math.min(allRawLines.length - 1, lineRange[0] - 1));
    endIdx = Math.max(startIdx, Math.min(allRawLines.length - 1, lineRange[1] - 1));
  }

  const cleanLines = [];
  const lineStartOffsets = [];
  let offset = 0;

  for (let idx = startIdx; idx <= endIdx; idx += 1) {
    const cleaned = allRawLines[idx].replace(/^#{1,6}\s+/u, "");
    lineStartOffsets.push({ line: idx + 1, start: offset });
    cleanLines.push(cleaned);
    offset += Array.from(cleaned).length + 1;
  }

  const text = cleanLines.join("\n");

  // 根据字符起止偏移反查对应的原始 Markdown 行号区间
  function mapSpanToLines(startChar, charLen) {
    const endChar = Math.max(startChar, startChar + charLen - 1);
    let startLine = startIdx + 1;
    let endLine = endIdx + 1;
    for (let i = 0; i < lineStartOffsets.length; i += 1) {
      if (lineStartOffsets[i].start <= startChar) {
        startLine = lineStartOffsets[i].line;
      }
      if (lineStartOffsets[i].start <= endChar) {
        endLine = lineStartOffsets[i].line;
      }
    }
    return { startLine, endLine };
  }

  return { text, mapSpanToLines, lineSpan: [startIdx + 1, endIdx + 1] };
}

// 将接口返回的单个微窗口转换为结构化诊断记录
function formatSegment(seg, mapSpanToLines) {
  const pos = Array.isArray(seg.position) ? seg.position : [0, 0];
  const startOffset = Number(pos[0] || 0);
  const length = Number(pos[1] || Array.from(seg.text || "").length);
  const { startLine, endLine } = mapSpanToLines(startOffset, length);
  const compact = String(seg.text || "").replace(/\s+/gu, " ").trim();
  const chars = Array.from(compact);
  const head = chars.slice(0, 26).join("");
  const tail = chars.length > 30 ? chars.slice(-20).join("") : "";

  let category = "human";
  if (seg.label === 1) category = "ai";
  else if (seg.label === 2) category = "suspected_ai";

  return {
    order: seg.order,
    category,
    label: seg.label,
    aigc: Number(Number(seg.conf || 0).toFixed(4)),
    chars: length,
    startLine,
    endLine,
    preview: tail ? `${head} ... ${tail}` : head,
  };
}

// 在本地合并相邻同标签微窗口并计算字符加权置信度，免去二次调用 API 的双倍开销
export function mergeFineWindowsLocally(fineWindows) {
  if (fineWindows.length === 0) return [];
  const merged = [];
  for (const win of fineWindows) {
    const prev = merged[merged.length - 1];
    if (prev && prev.label === win.label) {
      const totalChars = prev.chars + win.chars;
      const weighted =
        totalChars > 0
          ? (prev.aigc * prev.chars + win.aigc * win.chars) / totalChars
          : win.aigc;
      prev.aigc = Number(weighted.toFixed(4));
      prev.chars = totalChars;
      prev.endLine = win.endLine;
      const headPart = prev.preview.split(" ... ")[0];
      const tailParts = win.preview.split(" ... ");
      const tailPart = tailParts[tailParts.length - 1];
      prev.preview = `${headPart} ... ${tailPart}`;
    } else {
      merged.push({
        order: merged.length + 1,
        category: win.category,
        label: win.label,
        aigc: win.aigc,
        chars: win.chars,
        startLine: win.startLine,
        endLine: win.endLine,
        preview: win.preview,
      });
    }
  }
  return merged;
}

// 读取本地磁盘缓存以避免对完全一致的文本重复消耗 Token
function readCacheEntry(cachePath, digest) {
  if (!cachePath || !fs.existsSync(cachePath)) return null;
  try {
    const store = JSON.parse(fs.readFileSync(cachePath, "utf8"));
    return store[digest] || null;
  } catch {
    return null;
  }
}

// 将单次 API 响应写入本地缓存（最多保留最近 100 条哈希记录）
function writeCacheEntry(cachePath, digest, payload) {
  if (!cachePath) return;
  let store = {};
  if (fs.existsSync(cachePath)) {
    try {
      store = JSON.parse(fs.readFileSync(cachePath, "utf8"));
    } catch {
      store = {};
    }
  }
  store[digest] = payload;
  const keys = Object.keys(store);
  if (keys.length > 100) {
    for (const oldKey of keys.slice(0, keys.length - 100)) {
      delete store[oldKey];
    }
  }
  fs.writeFileSync(cachePath, JSON.stringify(store, null, 2) + "\n");
}

// 单请求高性价比朱雀检测：仅发送 1 次 is_merge=false 请求并在本地合成合并报告与缓存
export async function detectWithZhuque(rawMarkdown, options = {}) {
  const threshold =
    typeof options.threshold === "number" ? options.threshold : 0.5;
  const { text, mapSpanToLines, lineSpan } = prepareDetectorInput(
    rawMarkdown,
    options.lineRange || null
  );

  const digest = crypto.createHash("sha256").update(text).digest("hex");
  const cachePath =
    options.cache === false
      ? null
      : options.cachePath || path.resolve(process.cwd(), ".zhuque-cache.json");

  let payload = !options.noCache ? readCacheEntry(cachePath, digest) : null;
  let cached = Boolean(payload);

  if (!payload) {
    const apiKey = resolveZhuqueApiKey(options);
    if (!apiKey) {
      throw new Error("Missing ZHUQUE_API_KEY in environment or .env file.");
    }
    const fetchFn = options.fetchImpl || globalThis.fetch;
    const endpoint = options.endpoint || DEFAULT_ZHUQUE_ENDPOINT;
    const response = await fetchFn(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        is_merge: false,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(
        `Zhuque API HTTP ${response.status}: ${errText.slice(0, 240)}`
      );
    }
    payload = await response.json();
    if (payload.status && payload.status !== "success") {
      throw new Error(`Zhuque API error: ${payload.msg || payload.status}`);
    }
    writeCacheEntry(cachePath, digest, payload);
    cached = false;
  }

  const ratios = payload.labels_ratio || {};
  const humanPct = Number((Number(ratios["0"] || 0) * 100).toFixed(2));
  const aiPct = Number((Number(ratios["1"] || 0) * 100).toFixed(2));
  const suspectedPct = Number((Number(ratios["2"] || 0) * 100).toFixed(2));

  const fineWindows = (payload.segment_labels || []).map((s) =>
    formatSegment(s, mapSpanToLines)
  );
  const mergedSegments = mergeFineWindowsLocally(fineWindows);
  const flaggedWindows = fineWindows.filter((w) => w.aigc >= threshold);
  const pass = mergedSegments.every((s) => s.aigc < threshold);

  return {
    pass,
    cached,
    lineSpan,
    inputChars: Array.from(text).length,
    tokenUsage: payload.makers_models_usage || payload.usage || null,
    threshold,
    humanPct,
    suspectedPct,
    aiPct,
    softmaxConfidence: Number(
      Number(payload.softmax_confidence || 0).toFixed(4)
    ),
    ratioConfidence: Number(
      Number(payload.ratio_confidence || 0).toFixed(4)
    ),
    segments: mergedSegments,
    flaggedWindowCount: flaggedWindows.length,
    flaggedWindows,
    fineWindows,
  };
}
