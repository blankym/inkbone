// 零第三方依赖 MCP Server（JSON-RPC 2.0 over stdio），完整实现 Tools(9) + Prompts(8) + Resources(11) 三件套
// 自动兼容 NDJSON 与 Content-Length 两种帧协议
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findProjectConfig, loadProjectConfig } from "./config-loader.mjs";
import { auditChapterText } from "./auditor.mjs";
import { compileBoundaryPacket } from "./boundary-compiler.mjs";
import { diagnoseProject } from "./doctor.mjs";
import { normalizeProseText, normalizeFiles } from "./normalizer.mjs";
import { validateEvidenceReview } from "./evidence-validator.mjs";
import { validateLedger, applyChapterSettlement, applyBatchSettlement } from "./ledger-manager.mjs";
import { formatAuditMarkdown, formatDoctorMarkdown } from "./formatter.mjs";
import { analyzeStyleProfile, formatStyleProfileMarkdown } from "./style-profiler.mjs";
import { formatChapterForPlatform, exportChapters } from "./exporter.mjs";
import { collectTextFiles } from "./calibrator.mjs";

const currentFile = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(currentFile), "..");
const pkgPath = path.resolve(rootDir, "package.json");
const SERVER_VERSION = JSON.parse(fs.readFileSync(pkgPath, "utf8")).version || "2.0.0";
const SUPPORTED_PROTOCOL_VERSION = "2024-11-05";

// 8 个阶段提示词清单（暴露为 MCP Prompts，传入 genre 时自动挂载对应流派剧本卡）
const PROMPT_FILES = [
  {
    name: "inkbone/style-architect",
    description: "Stage 0: Define genre register contract, three-tier character voice matrix, and novel.json rules.",
    file: "prompts/00-style-architect.md",
    arguments: [
      { name: "genre", description: "Optional genre pack id (e.g. classical-xianxia, urban-realism)", required: false },
      { name: "premise", description: "Optional novel premise or outline summary", required: false },
    ],
  },
  {
    name: "inkbone/beat-planner",
    description: "Stage 1: Build scene beat sheet and information placement plan before drafting (pauses for approval).",
    file: "prompts/01-beat-planner.md",
    arguments: [
      { name: "genre", description: "Optional genre pack id to attach matching playbook", required: false },
      { name: "chapter", description: "Target chapter number", required: false },
    ],
  },
  {
    name: "inkbone/draft-chapter",
    description: "Stage 2: Render Chinese chapter prose directly from beat sheet with pure genre register and clear subjects.",
    file: "prompts/02-paratactic-renderer.md",
    arguments: [
      { name: "genre", description: "Optional genre pack id to attach matching playbook", required: false },
      { name: "chapter", description: "Target chapter number", required: false },
    ],
  },
  {
    name: "inkbone/targeted-rewriter",
    description: "Stage 4: Perform surgical line-level edits on audit targets and verified review items without rewriting clean prose.",
    file: "prompts/03-targeted-rewriter.md",
    arguments: [
      { name: "genre", description: "Optional genre pack id", required: false },
    ],
  },
  {
    name: "inkbone/evidence-reviewer",
    description: "Stage 3a: Grounded continuity, timeline, physical-logic, and motivation review with verbatim quote enforcement.",
    file: "prompts/04-evidence-reviewer.md",
    arguments: [],
  },
  {
    name: "inkbone/reader-simulator",
    description: "Stage 3b: Dual-persona cold-reader & genre-veteran simulation producing verifiable JSON.",
    file: "prompts/05-reader-simulator.md",
    arguments: [
      { name: "persona", description: "cold or veteran", required: false },
    ],
  },
  {
    name: "inkbone/ledger-importer",
    description: "Stage 6: Reverse-engineer a non-destructive ledger.json from existing chapters without inventing lore.",
    file: "prompts/06-ledger-importer.md",
    arguments: [],
  },
  {
    name: "inkbone/chapter-settler",
    description: "Stage 5: Produce a post-chapter settlement JSON patch to update snapshots, summaries, and foreshadowing.",
    file: "prompts/07-chapter-settler.md",
    arguments: [
      { name: "chapter", description: "Completed chapter number to settle", required: false },
    ],
  },
];

export const MCP_PROMPTS = PROMPT_FILES.map(({ name, description, arguments: args }) => ({
  name,
  description,
  arguments: args,
}));

// 11 份只读写作知识库资源（9 份题材剧本卡 + 微技法 + 正反例对照）
const GENRE_PLAYBOOK_IDS = [
  "classical-xianxia",
  "historical-court",
  "wuxia-jianghu",
  "mystery-thriller",
  "urban-realism",
  "scifi-wasteland",
  "light-fantasy",
  "romance-emotional",
  "general-clean",
];

const RESOURCE_ENTRIES = [
  ...GENRE_PLAYBOOK_IDS.map((genreId) => ({
    uri: `inkbone://playbooks/${genreId}`,
    name: `Playbook: ${genreId}`,
    description: `Genre craft playbook, tropes to avoid, props, and chapter hooks for ${genreId}.`,
    mimeType: "text/markdown",
    file: `resources/genre_playbooks/${genreId}.md`,
  })),
  {
    uri: "inkbone://craft/micro-techniques",
    name: "Fiction Craft Micro-Techniques & Revision Lookup",
    description: "Action-reaction beats, 80/20 climax framing, multi-purpose foreshadowing, and 9-symptom troubleshooting table.",
    mimeType: "text/markdown",
    file: "resources/micro_techniques.md",
  },
  {
    uri: "inkbone://craft/bad-vs-good-cases",
    name: "8 Before/After Prose Revision Cases",
    description: "Side-by-side examples of cutting micro-action bloat, late-in/early-out dialogue, and preserving flow.",
    mimeType: "text/markdown",
    file: "resources/bad_vs_good_cases.md",
  },
];

export const MCP_RESOURCES = RESOURCE_ENTRIES.map(({ uri, name, description, mimeType }) => ({
  uri,
  name,
  description,
  mimeType,
}));

// 暴露给 MCP 客户端的 9 个结构化工具声明与参数 Schema
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
      "Run InkBone deterministic chapter audit (ledger boundaries, deceased-character guard, genre register, Traditional/Simplified script variant, stock phrases, density tics, degeneration, and subject continuity).",
    inputSchema: {
      type: "object",
      properties: {
        filePath: { type: "string", description: "Path to chapter .md/.txt file" },
        text: { type: "string", description: "Inline chapter prose (alternative to filePath)" },
        genre: { type: "string", description: "Genre pack id (e.g. classical-xianxia, urban-realism)" },
        preset: { type: "string", description: "Optional preset id" },
        variant: { type: "string", enum: ["auto", "zh-hans", "zh-hant"], description: "Script variant (default auto)" },
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
        goldenThree: { type: "boolean", description: "Enable Golden-Three opening retention pacing check" },
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
      "Recursively diagnose a chapter file or novel folder with automatic project config, genre detection, and optional incremental --chapters filtering.",
    inputSchema: {
      type: "object",
      properties: {
        paths: {
          type: "array",
          items: { type: "string" },
          description: "One or more chapter files or directories",
        },
        genre: { type: "string" },
        variant: { type: "string", enum: ["auto", "zh-hans", "zh-hant"] },
        chapters: { type: "string", description: "Optional chapter filter spec (e.g. 40-45,48)" },
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
  {
    name: "inkbone_style_profile",
    description:
      "Compute a copyright-safe statistical style profile (quantiles, nearest preset, and suggested customGates for novel.json) from sample texts or directories without outputting any source prose.",
    inputSchema: {
      type: "object",
      properties: {
        texts: { type: "array", items: { type: "string" }, description: "Inline sample texts" },
        paths: { type: "array", items: { type: "string" }, description: "Files or directories of sample prose" },
        label: { type: "string" },
        format: { type: "string", enum: ["json", "md"] },
        lang: { type: "string", enum: ["zh", "en"] },
      },
    },
  },
  {
    name: "inkbone_export",
    description:
      "Clean Markdown artifacts and format chapter(s) for major Chinese web-fiction platforms (qidian, fanqie, qimao, jjwxc) with length checks.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Inline single chapter text" },
        paths: { type: "array", items: { type: "string" }, description: "Chapter files or directories to export" },
        platform: { type: "string", enum: ["qidian", "fanqie", "qimao", "jjwxc"] },
        indent: { type: "boolean", description: "Apply full-width two-space paragraph indentation" },
        outDir: { type: "string", description: "Optional output directory for per-chapter .txt files" },
        mergeOut: { type: "string", description: "Optional output file for merged volume .txt" },
        docxOut: { type: "string", description: "Optional output file for submission .docx" },
        zipOut: { type: "string", description: "Optional output file for bundled .zip" },
        outlinePath: { type: "string", description: "Optional outline markdown path to prepend in .docx" },
        bookTitle: { type: "string", description: "Optional book title heading for .docx" },
        checkOnly: { type: "boolean", description: "Dry-run length and formatting check without writing files" },
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
      customGates: project?.customGates || null,
      variant: args.variant || project?.variant || "auto",
      projectRules: project ? project.rules : null,
      ledger,
      characterNames: Array.isArray(args.characterNames) ? args.characterNames : undefined,
      chapterNumber: args.chapter != null ? Number(args.chapter) : null,
      previousChapterText: prevText,
      outlineText,
      skipLengthGate: Boolean(args.skipLength),
      goldenThree: Boolean(args.goldenThree),
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
      customGates: project?.customGates || null,
      variant: args.variant || project?.variant || "auto",
      chapterFilter: args.chapters || undefined,
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
    const isBatch = Array.isArray(patch) || Array.isArray(patch?.patches);
    const settled = isBatch
      ? applyBatchSettlement(ledger, patch)
      : applyChapterSettlement(ledger, patch);
    const wroteFile = Boolean(ledgerPath && !args.dryRun);
    if (wroteFile) {
      fs.writeFileSync(ledgerPath, JSON.stringify(settled.ledger, null, 2) + "\n");
    }
    const latestChap = isBatch
      ? Math.max(...(settled.batchDiff.chapters || [0]))
      : settled.diff.chapterNumber;
    const payload = {
      wroteFile,
      ledgerPath,
      ...(isBatch ? { batchDiff: settled.batchDiff } : { diff: settled.diff }),
      health: validateLedger(settled.ledger, {
        currentChapter: latestChap > 0 ? latestChap : undefined,
      }),
    };
    return {
      content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      structuredContent: payload,
    };
  }

  if (name === "inkbone_style_profile") {
    let texts = Array.isArray(args.texts) ? args.texts.filter((t) => typeof t === "string") : [];
    if (texts.length === 0 && Array.isArray(args.paths) && args.paths.length > 0) {
      const files = collectTextFiles(args.paths);
      texts = files.map((f) => fs.readFileSync(f, "utf8"));
    }
    if (texts.length === 0) {
      throw new Error("Provide either texts array or paths for inkbone_style_profile.");
    }
    const profile = analyzeStyleProfile(texts, { label: args.label || "" });
    const outText =
      args.format === "json"
        ? JSON.stringify(profile, null, 2)
        : formatStyleProfileMarkdown(profile, { lang: args.lang || "zh" });
    return {
      content: [{ type: "text", text: outText }],
      structuredContent: profile,
    };
  }

  if (name === "inkbone_export") {
    const platform = args.platform || "qidian";
    if (typeof args.text === "string") {
      const res = formatChapterForPlatform(args.text, {
        platform,
        indent: args.indent,
      });
      return {
        content: [{ type: "text", text: res.output }],
        structuredContent: res,
      };
    }
    if (Array.isArray(args.paths) && args.paths.length > 0) {
      const res = exportChapters(args.paths, {
        platform,
        indent: args.indent,
        outDir: args.outDir,
        mergeOut: args.mergeOut,
        docxOut: args.docxOut,
        zipOut: args.zipOut,
        outlinePath: args.outlinePath,
        bookTitle: args.bookTitle,
        check: Boolean(args.checkOnly),
      });
      return {
        content: [{ type: "text", text: JSON.stringify(res, null, 2) }],
        structuredContent: res,
      };
    }
    throw new Error("Provide either text or paths for inkbone_export.");
  }

  throw new Error(`Unknown MCP tool: ${name}`);
}

// 组装指定 MCP Prompt（如附带合法 genre 参数，自动拼接对应流派剧本卡）
function executePromptGet(name, rawArgs = {}) {
  const entry = PROMPT_FILES.find((p) => p.name === name);
  if (!entry) {
    throw new Error(`Unknown MCP prompt: ${name}`);
  }
  const promptPath = path.resolve(rootDir, entry.file);
  if (!fs.existsSync(promptPath)) {
    throw new Error(`Prompt file missing: ${entry.file}`);
  }
  const promptBody = fs.readFileSync(promptPath, "utf8");
  const args = rawArgs && typeof rawArgs === "object" ? rawArgs : {};
  const messages = [
    {
      role: "user",
      content: { type: "text", text: promptBody },
    },
  ];

  // 附加上下文参数说明与可选对应流派剧本卡
  const contextParts = [];
  if (args.chapter != null && String(args.chapter).trim()) {
    contextParts.push(`Target chapter: ${args.chapter}`);
  }
  if (typeof args.persona === "string" && args.persona.trim()) {
    contextParts.push(`Reader persona focus: ${args.persona}`);
  }
  if (typeof args.premise === "string" && args.premise.trim()) {
    contextParts.push(`Premise:\n${args.premise}`);
  }
  if (typeof args.genre === "string" && GENRE_PLAYBOOK_IDS.includes(args.genre)) {
    const pbPath = path.resolve(rootDir, `resources/genre_playbooks/${args.genre}.md`);
    if (fs.existsSync(pbPath)) {
      contextParts.push(
        `Attached Genre Playbook (${args.genre}):\n\n${fs.readFileSync(pbPath, "utf8")}`
      );
    }
  }
  if (contextParts.length > 0) {
    messages.push({
      role: "user",
      content: { type: "text", text: contextParts.join("\n\n---\n\n") },
    });
  }

  return {
    description: entry.description,
    messages,
  };
}

// 读取指定的 MCP Resource 只读 Markdown 内容
function executeResourceRead(uri) {
  const entry = RESOURCE_ENTRIES.find((r) => r.uri === uri);
  if (!entry) {
    throw new Error(`Unknown MCP resource URI: ${uri}`);
  }
  const absPath = path.resolve(rootDir, entry.file);
  if (!fs.existsSync(absPath)) {
    throw new Error(`Resource file missing: ${entry.file}`);
  }
  return {
    contents: [
      {
        uri: entry.uri,
        mimeType: entry.mimeType,
        text: fs.readFileSync(absPath, "utf8"),
      },
    ],
  };
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
          prompts: { listChanged: false },
          resources: { subscribe: false, listChanged: false },
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
    return { jsonrpc: "2.0", id, result: { tools: MCP_TOOLS } };
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

  if (method === "prompts/list") {
    return { jsonrpc: "2.0", id, result: { prompts: MCP_PROMPTS } };
  }

  if (method === "prompts/get") {
    const promptName = params?.name;
    if (!promptName || typeof promptName !== "string") {
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32602, message: "Missing required params.name for prompts/get." },
      };
    }
    try {
      const result = executePromptGet(promptName, params?.arguments || {});
      return { jsonrpc: "2.0", id, result };
    } catch (err) {
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32602, message: err.message },
      };
    }
  }

  if (method === "resources/list") {
    return { jsonrpc: "2.0", id, result: { resources: MCP_RESOURCES } };
  }

  if (method === "resources/read") {
    const uri = params?.uri;
    if (!uri || typeof uri !== "string") {
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32602, message: "Missing required params.uri for resources/read." },
      };
    }
    try {
      const result = executeResourceRead(uri);
      return { jsonrpc: "2.0", id, result };
    } catch (err) {
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32602, message: err.message },
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
