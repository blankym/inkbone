// 零第三方依赖 MCP Server（JSON-RPC 2.0 over stdio），同时兼容 NDJSON 与 Content-Length 两种帧协议
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findProjectConfig, loadProjectConfig } from "./config-loader.mjs";
import { auditChapterText } from "./auditor.mjs";
import { compileBoundaryPacket } from "./boundary-compiler.mjs";
import { diagnoseProject } from "./doctor.mjs";
import { normalizeProseText, normalizeFiles } from "./normalizer.mjs";
import { validateEvidenceReview } from "./evidence-validator.mjs";
import { validateLedger, applyChapterSettlement } from "./ledger-manager.mjs";
import { formatAuditMarkdown, formatDoctorMarkdown } from "./formatter.mjs";

const currentFile = fileURLToPath(import.meta.url);
const pkgPath = path.resolve(path.dirname(currentFile), "..", "package.json");
const SERVER_VERSION = JSON.parse(fs.readFileSync(pkgPath, "utf8")).version || "1.3.0";
const SUPPORTED_PROTOCOL_VERSION = "2024-11-05";

// 暴露给 MCP 客户端的 7 个结构化工具声明与参数 Schema
export const MCP_TOOLS = [
  {
    name: "inkbone_packet",
    description:
      "Compile a spoiler-safe drafting context packet for chapter N from ledger.json (redacts unrevealed fullTruth and locked futureBlueprints, filters closed foreshadowing, and optionally scopes characterSnapshots).",
    inputSchema: {
      type: "object",
      properties: {
        ledgerPath: { type: "string", description: "Path to ledger.json" },
        ledger: { type: "object", description: "Inline ledger object (alternative to ledgerPath)" },
        chapter: { type: "number", description: "Target chapter number (>= 1)" },
        prevPath: { type: "string", description: "Optional path to previous chapter markdown" },
        prevText: { type: "string", description: "Optional inline previous chapter text" },
        activeCharacters: {
          type: "array",
          items: { type: "string" },
          description: "Optional active character list to prune characterSnapshots",
        },
        includeClosedForeshadowing: { type: "boolean" },
      },
      required: ["chapter"],
    },
  },
  {
    name: "inkbone_audit",
    description:
      "Run InkBone deterministic chapter audit (ledger boundaries, genre register, stock phrases, density tics, model degeneration, and subject continuity). Accepts inline text or filePath.",
    inputSchema: {
      type: "object",
      properties: {
        filePath: { type: "string", description: "Path to chapter .md/.txt file" },
        text: { type: "string", description: "Inline chapter prose (alternative to filePath)" },
        genre: { type: "string", description: "Genre pack id (e.g. classical-xianxia, urban-realism)" },
        preset: { type: "string", description: "Optional preset id" },
        ledgerPath: { type: "string", description: "Optional path to ledger.json" },
        chapter: { type: "number", description: "Optional chapter number for ledger boundary verification" },
        prevPath: { type: "string", description: "Optional previous chapter path for echo check" },
        outlinePath: { type: "string", description: "Optional chapter outline path for outline-copy check" },
        characterNames: {
          type: "array",
          items: { type: "string" },
          description: "Optional character names for subject continuity check",
        },
        skipLength: { type: "boolean", description: "Skip chapter word-count gate" },
        strict: { type: "boolean", description: "Fail on warnings/info too" },
        noProject: { type: "boolean", description: "Ignore upward novel.json discovery" },
        format: { type: "string", enum: ["json", "md"], description: "Output format (default md)" },
        lang: { type: "string", enum: ["zh", "en"], description: "Display language for md format (default zh)" },
      },
    },
  },
  {
    name: "inkbone_doctor",
    description:
      "Recursively diagnose a chapter file or novel folder with automatic project config and genre detection.",
    inputSchema: {
      type: "object",
      properties: {
        paths: {
          type: "array",
          items: { type: "string" },
          description: "One or more chapter files or directories",
        },
        genre: { type: "string" },
        ledgerPath: { type: "string" },
        skipLength: { type: "boolean" },
        format: { type: "string", enum: ["json", "md"] },
        lang: { type: "string", enum: ["zh", "en"] },
      },
      required: ["paths"],
    },
  },
  {
    name: "inkbone_normalize",
    description:
      "Deterministically clean stray Markdown emphasis asterisks, divider lines, and ellipses (preserving dialogue em-dashes and whitelisted literals).",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Inline text to normalize" },
        paths: {
          type: "array",
          items: { type: "string" },
          description: "Files or directories to normalize in place (unless checkOnly is true)",
        },
        checkOnly: { type: "boolean", description: "Preview without writing files" },
        stripBold: { type: "boolean", description: "Strip stray **bold** emphasis (default true)" },
        fixEmDash: { type: "boolean", description: "Replace narration em-dashes" },
      },
    },
  },
  {
    name: "inkbone_verify_review",
    description:
      "Verify that every quote in a logic or reader review JSON exists verbatim in the chapter text and block unauthorized style-interference commentary.",
    inputSchema: {
      type: "object",
      properties: {
        chapterPath: { type: "string" },
        chapterText: { type: "string" },
        reviewPath: { type: "string" },
        review: { type: "object" },
      },
    },
  },
  {
    name: "inkbone_check_ledger",
    description:
      "Validate ledger.json health: duplicate/missing chapters, invalid revealChapter order, empty characterNames, empty summaries, and overdue active foreshadowing.",
    inputSchema: {
      type: "object",
      properties: {
        ledgerPath: { type: "string" },
        ledger: { type: "object" },
        currentChapter: { type: "number" },
        overdueThreshold: { type: "number" },
      },
    },
  },
  {
    name: "inkbone_settle",
    description:
      "Non-destructively merge a post-chapter settlement patch (summary, characterSnapshots updates, foreshadowing transitions, knowledge updates) into ledger.json.",
    inputSchema: {
      type: "object",
      properties: {
        ledgerPath: { type: "string", description: "Path to ledger.json to read and update" },
        ledger: { type: "object", description: "Inline ledger object (when dryRun or in-memory)" },
        patch: { type: "object", description: "Settlement JSON patch containing chapterNumber and updates" },
        patchPath: { type: "string", description: "Optional path to settlement JSON patch file" },
        dryRun: { type: "boolean", description: "Preview diff without writing to ledgerPath" },
      },
    },
  },
];

// 辅助读取台账对象（支持文件路径或内联对象）
function resolveLedgerArg(args) {
  if (args.ledger && typeof args.ledger === "object") {
    return { ledger: args.ledger, ledgerPath: args.ledgerPath ? path.resolve(args.ledgerPath) : null };
  }
  if (typeof args.ledgerPath === "string" && args.ledgerPath.trim()) {
    const abs = path.resolve(args.ledgerPath);
    if (!fs.existsSync(abs)) {
      throw new Error(`Ledger file not found: ${abs}`);
    }
    return { ledger: JSON.parse(fs.readFileSync(abs, "utf8")), ledgerPath: abs };
  }
  throw new Error("Provide either ledgerPath or inline ledger object.");
}

// 执行单个 MCP 工具调用并返回标准 content 响应
function executeToolCall(name, rawArgs = {}) {
  const args = rawArgs && typeof rawArgs === "object" ? rawArgs : {};

  if (name === "inkbone_packet") {
    const { ledger } = resolveLedgerArg(args);
    const prevText =
      typeof args.prevText === "string"
        ? args.prevText
        : typeof args.prevPath === "string" && fs.existsSync(path.resolve(args.prevPath))
          ? fs.readFileSync(path.resolve(args.prevPath), "utf8")
          : "";
    const packet = compileBoundaryPacket(ledger, Number(args.chapter), prevText, {
      activeCharacters: args.activeCharacters,
      includeClosedForeshadowing: Boolean(args.includeClosedForeshadowing),
    });
    return {
      content: [{ type: "text", text: JSON.stringify(packet, null, 2) }],
      structuredContent: packet,
    };
  }

  if (name === "inkbone_audit") {
    let text = typeof args.text === "string" ? args.text : null;
    let project = null;
    let fileName = null;
    if (text === null && typeof args.filePath === "string") {
      const abs = path.resolve(args.filePath);
      if (!fs.existsSync(abs)) throw new Error(`Chapter file not found: ${abs}`);
      text = fs.readFileSync(abs, "utf8");
      fileName = path.basename(abs);
      if (!args.noProject) {
        const cfgPath = findProjectConfig(path.dirname(abs));
        if (cfgPath) project = loadProjectConfig(cfgPath);
      }
    }
    if (text === null) {
      throw new Error("Provide either filePath or text for inkbone_audit.");
    }
    let ledger = null;
    if (typeof args.ledgerPath === "string" && args.ledgerPath.trim()) {
      ledger = JSON.parse(fs.readFileSync(path.resolve(args.ledgerPath), "utf8"));
    } else if (project?.ledgerFile && fs.existsSync(project.ledgerFile)) {
      ledger = JSON.parse(fs.readFileSync(project.ledgerFile, "utf8"));
    }
    const prevText =
      typeof args.prevPath === "string" && fs.existsSync(path.resolve(args.prevPath))
        ? fs.readFileSync(path.resolve(args.prevPath), "utf8")
        : "";
    const outlineText =
      typeof args.outlinePath === "string" && fs.existsSync(path.resolve(args.outlinePath))
        ? fs.readFileSync(path.resolve(args.outlinePath), "utf8")
        : "";

    const report = auditChapterText(text, {
      genre: args.genre || project?.genre || null,
      presetName: args.preset || project?.preset || null,
      projectRules: project ? project.rules : null,
      ledger,
      characterNames: Array.isArray(args.characterNames) ? args.characterNames : undefined,
      chapterNumber: args.chapter != null ? Number(args.chapter) : null,
      previousChapterText: prevText,
      outlineText,
      skipLengthGate: Boolean(args.skipLength),
      strict: Boolean(args.strict),
    });
    const outText =
      args.format === "json"
        ? JSON.stringify(report, null, 2)
        : formatAuditMarkdown(report, { lang: args.lang || "zh", fileName });
    return {
      content: [{ type: "text", text: outText }],
      structuredContent: report,
    };
  }

  if (name === "inkbone_doctor") {
    const targets = Array.isArray(args.paths) ? args.paths : [];
    if (targets.length === 0) {
      throw new Error("paths array with at least one file or directory is required.");
    }
    const firstAbs = path.resolve(targets[0]);
    const startDir =
      fs.existsSync(firstAbs) && fs.statSync(firstAbs).isDirectory()
        ? firstAbs
        : path.dirname(firstAbs);
    const cfgPath = findProjectConfig(startDir);
    const project = cfgPath ? loadProjectConfig(cfgPath) : null;
    let ledger = null;
    if (typeof args.ledgerPath === "string" && args.ledgerPath.trim()) {
      ledger = JSON.parse(fs.readFileSync(path.resolve(args.ledgerPath), "utf8"));
    } else if (project?.ledgerFile && fs.existsSync(project.ledgerFile)) {
      ledger = JSON.parse(fs.readFileSync(project.ledgerFile, "utf8"));
    }
    const diag = diagnoseProject(targets, {
      genre: args.genre || project?.genre || undefined,
      presetName: project?.preset || undefined,
      projectRules: project ? project.rules : null,
      genreSource: !args.genre && project?.genre ? "project" : undefined,
      ledger,
      skipLengthGate: Boolean(args.skipLength),
    });
    const outText =
      args.format === "json"
        ? JSON.stringify(diag, null, 2)
        : formatDoctorMarkdown(diag, { lang: args.lang || "zh" });
    return {
      content: [{ type: "text", text: outText }],
      structuredContent: diag,
    };
  }

  if (name === "inkbone_normalize") {
    const stripBold = args.stripBold !== undefined ? Boolean(args.stripBold) : true;
    const fixEmDash = Boolean(args.fixEmDash);
    if (typeof args.text === "string") {
      const res = normalizeProseText(args.text, {
        stripMarkdownEmphasis: stripBold,
        fixNarrationEmDash: fixEmDash,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(res, null, 2) }],
        structuredContent: res,
      };
    }
    if (Array.isArray(args.paths) && args.paths.length > 0) {
      const res = normalizeFiles(args.paths, {
        check: Boolean(args.checkOnly),
        stripMarkdownEmphasis: stripBold,
        fixNarrationEmDash: fixEmDash,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(res, null, 2) }],
        structuredContent: res,
      };
    }
    throw new Error("Provide either text or paths for inkbone_normalize.");
  }

  if (name === "inkbone_verify_review") {
    const chapterText =
      typeof args.chapterText === "string"
        ? args.chapterText
        : typeof args.chapterPath === "string"
          ? fs.readFileSync(path.resolve(args.chapterPath), "utf8")
          : null;
    const review =
      args.review && typeof args.review === "object"
        ? args.review
        : typeof args.reviewPath === "string"
          ? JSON.parse(fs.readFileSync(path.resolve(args.reviewPath), "utf8"))
          : null;
    if (chapterText === null || review === null) {
      throw new Error("Provide chapterText/chapterPath and review/reviewPath.");
    }
    const validation = validateEvidenceReview(chapterText, review);
    return {
      content: [{ type: "text", text: JSON.stringify(validation, null, 2) }],
      structuredContent: validation,
    };
  }

  if (name === "inkbone_check_ledger") {
    const { ledger } = resolveLedgerArg(args);
    const report = validateLedger(ledger, {
      currentChapter: args.currentChapter,
      overdueThreshold: args.overdueThreshold,
    });
    return {
      content: [{ type: "text", text: JSON.stringify(report, null, 2) }],
      structuredContent: report,
    };
  }

  if (name === "inkbone_settle") {
    const { ledger, ledgerPath } = resolveLedgerArg(args);
    const patch =
      args.patch && typeof args.patch === "object"
        ? args.patch
        : typeof args.patchPath === "string"
          ? JSON.parse(fs.readFileSync(path.resolve(args.patchPath), "utf8"))
          : null;
    if (!patch) {
      throw new Error("Provide either patch object or patchPath for inkbone_settle.");
    }
    const settled = applyChapterSettlement(ledger, patch);
    const wroteFile = Boolean(ledgerPath && !args.dryRun);
    if (wroteFile) {
      fs.writeFileSync(ledgerPath, JSON.stringify(settled.ledger, null, 2) + "\n");
    }
    const payload = {
      wroteFile,
      ledgerPath,
      diff: settled.diff,
      health: validateLedger(settled.ledger, { currentChapter: settled.diff.chapterNumber }),
    };
    return {
      content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      structuredContent: payload,
    };
  }

  throw new Error(`Unknown MCP tool: ${name}`);
}

// 处理单条 JSON-RPC 2.0 消息并返回响应对象（通知类消息返回 null）
export function handleMcpMessage(msg) {
  if (!msg || typeof msg !== "object" || msg.jsonrpc !== "2.0") {
    return {
      jsonrpc: "2.0",
      id: msg?.id ?? null,
      error: { code: -32600, message: "Invalid JSON-RPC 2.0 request." },
    };
  }

  const { id, method, params } = msg;
  const isNotification = id === undefined || id === null;

  if (method === "notifications/initialized" || method === "notifications/cancelled") {
    return null;
  }

  if (method === "initialize") {
    const requestedVersion = params?.protocolVersion || SUPPORTED_PROTOCOL_VERSION;
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: requestedVersion,
        capabilities: {
          tools: { listChanged: false },
        },
        serverInfo: {
          name: "inkbone",
          version: SERVER_VERSION,
        },
      },
    };
  }

  if (method === "ping") {
    return { jsonrpc: "2.0", id, result: {} };
  }

  if (method === "tools/list") {
    return {
      jsonrpc: "2.0",
      id,
      result: { tools: MCP_TOOLS },
    };
  }

  if (method === "tools/call") {
    const toolName = params?.name;
    if (!toolName || typeof toolName !== "string") {
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32602, message: "Missing required params.name for tools/call." },
      };
    }
    try {
      const result = executeToolCall(toolName, params?.arguments || {});
      return { jsonrpc: "2.0", id, result };
    } catch (err) {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          isError: true,
          content: [{ type: "text", text: `Error: ${err.message}` }],
        },
      };
    }
  }

  if (isNotification) return null;
  return {
    jsonrpc: "2.0",
    id,
    error: { code: -32601, message: `Method not found: ${method}` },
  };
}

// 启动基于标准输入输出的 MCP 服务器，自动探测 Content-Length 帧与 NDJSON 行帧
export function startMcpServer(inputStream = process.stdin, outputStream = process.stdout) {
  let buffer = Buffer.alloc(0);
  let framingMode = null;

  const sendResponse = (payload) => {
    if (!payload) return;
    const json = JSON.stringify(payload);
    if (framingMode === "content-length") {
      const byteLen = Buffer.byteLength(json, "utf8");
      outputStream.write(`Content-Length: ${byteLen}\r\n\r\n${json}`);
    } else {
      outputStream.write(`${json}\n`);
    }
  };

  const processMessageText = (rawText) => {
    const trimmed = rawText.trim();
    if (!trimmed) return;
    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      sendResponse({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Parse error: invalid JSON." },
      });
      return;
    }
    const reply = handleMcpMessage(parsed);
    if (reply) sendResponse(reply);
  };

  const drainBuffer = () => {
    while (buffer.length > 0) {
      const prefix = buffer.subarray(0, Math.min(buffer.length, 32)).toString("utf8");
      if (/^Content-Length:/i.test(prefix)) {
        framingMode = "content-length";
        const headerEnd = buffer.indexOf("\r\n\r\n");
        if (headerEnd === -1) return;
        const headerText = buffer.subarray(0, headerEnd).toString("utf8");
        const lenMatch = headerText.match(/Content-Length:\s*(\d+)/i);
        if (!lenMatch) {
          buffer = buffer.subarray(headerEnd + 4);
          continue;
        }
        const contentLen = Number(lenMatch[1]);
        const totalLen = headerEnd + 4 + contentLen;
        if (buffer.length < totalLen) return;
        const body = buffer.subarray(headerEnd + 4, totalLen).toString("utf8");
        buffer = buffer.subarray(totalLen);
        processMessageText(body);
      } else {
        const nlIdx = buffer.indexOf("\n");
        if (nlIdx === -1) return;
        if (!framingMode) framingMode = "ndjson";
        const line = buffer.subarray(0, nlIdx).toString("utf8");
        buffer = buffer.subarray(nlIdx + 1);
        processMessageText(line);
      }
    }
  };

  inputStream.on("data", (chunk) => {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, "utf8");
    buffer = Buffer.concat([buffer, buf]);
    drainBuffer();
  });

  inputStream.on("end", () => {
    if (buffer.length > 0 && framingMode !== "content-length") {
      processMessageText(buffer.toString("utf8"));
      buffer = Buffer.alloc(0);
    }
  });
}
