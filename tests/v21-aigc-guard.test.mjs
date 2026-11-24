// v2.1.0 离线 280 字滑窗 AIGC 结构卫士、新增标点/叙事规则、MCP 第 10 工具与代码零汉字字面量回归测试
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  classifyParagraphCadence,
  computeCadenceEntropy,
  measureCompoundBricks,
  scanChapterAigcWindows,
  checkFilesAigcRisk,
  formatAigcCheckMarkdown,
  auditChapterText,
  MCP_TOOLS,
  handleMcpMessage,
} from "../src/index.mjs";

const currentFile = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(currentFile), "..");
const samplesPath = path.resolve(rootDir, "benchmarks/zhuque-calibration/samples.json");
const calibrationSamples = JSON.parse(fs.readFileSync(samplesPath, "utf8"));

// 剥离 JS 源码中的块注释与行注释（兼容正则字面量内的引号或反引号）
function stripJsComments(source) {
  const withoutBlock = String(source || "").replace(/\/\*[\s\S]*?\*\//gu, (m) =>
    m.replace(/[^\r\n]/gu, " ")
  );
  return withoutBlock
    .split(/\r?\n/u)
    .map((line) => line.replace(/(^|[^:\\])\/\/.*$/u, "$1"))
    .join("\n");
}

// 递归收集指定目录下的全部 .mjs 文件
function listMjsFiles(dirPath) {
  const results = [];
  if (!fs.existsSync(dirPath)) return results;
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...listMjsFiles(full));
    } else if (entry.name.endsWith(".mjs")) {
      results.push(full);
    }
  }
  return results;
}

test("codebase hygiene: zero literal Han characters in .mjs code outside comments", () => {
  const dirs = ["src", "bin", "tests"].map((d) => path.resolve(rootDir, d));
  const files = dirs.flatMap(listMjsFiles);
  assert.ok(files.length >= 25, "should scan all .mjs files");
  const hanRe = /\p{Script=Han}/u;

  for (const fp of files) {
    const raw = fs.readFileSync(fp, "utf8");
    const stripped = stripJsComments(raw);
    const lines = stripped.split(/\r?\n/u);
    lines.forEach((line, idx) => {
      assert.equal(
        hanRe.test(line),
        false,
        `Unexpected literal Han character in ${path.relative(rootDir, fp)}:L${idx + 1}: ${line}`
      );
    });
  }
});

test("paragraph cadence classifier distinguishes N, Q, A, S and multi-colon M", () => {
  // 纯叙述段 N
  assert.equal(classifyParagraphCadence("\u96e8\u6c34\u987a\u7740\u5c4b\u6a90\u5f80\u4e0b\u6ef4\u3002"), "N");
  // 首引号单轮段 Q
  assert.equal(classifyParagraphCadence("\u201c\u5148\u522b\u52a8\u90a3\u53ea\u7bb1\u5b50\u3002\u201d"), "Q");
  // 动作冒号段 A
  assert.equal(
    classifyParagraphCadence("\u6797\u5ddd\u653e\u4e0b\u8336\u676f\uff1a\u201c\u660e\u65e9\u516b\u70b9\u89c1\u3002\u201d"),
    "A"
  );
  // 居中提示语夹心段 S（中间无冒号）
  assert.equal(
    classifyParagraphCadence(
      "\u201c\u4e0d\u6025\uff0c\u201d\u6797\u5ddd\u6263\u4e0a\u8d26\u672c\uff0c\u201c\u7b49\u96e8\u505c\u4e86\u518d\u7b97\u3002\u201d"
    ),
    "S"
  );
  // 多轮冒号复合段 M（中间含冒号，不应误判为夹心段 S）
  assert.equal(
    classifyParagraphCadence(
      "\u6797\u5ddd\u95ee\uff1a\u201c\u51e0\u70b9\u8d70\uff1f\u201d\u5468\u5efa\u56fd\u62ac\u5934\u9053\uff1a\u201c\u73b0\u5728\u5c31\u8d70\u3002\u201d"
    ),
    "M"
  );

  const lowEnt = computeCadenceEntropy(["S", "S", "S", "S", "S", "S"]);
  const highEnt = computeCadenceEntropy(["A", "N", "Q", "S", "A", "N"]);
  assert.equal(lowEnt, 0);
  assert.ok(highEnt > 1.25);
});

test("compound brick detector respects exemptTerms", () => {
  // 连续 7 个实词汉字组成的硬拼名词串
  const phrase = "\u6697\u7ea2\u6a1f\u6728\u65e7\u5323\u7bb1";
  const withoutExempt = measureCompoundBricks(phrase, []);
  assert.equal(withoutExempt.bricks, 1);
  const withExempt = measureCompoundBricks(phrase, [phrase]);
  assert.equal(withExempt.bricks, 0);
});

test("zhuque calibration pairs separate green vs yellow windows and trigger v2.1 rules", () => {
  assert.ok(calibrationSamples.pairs.length >= 3);

  for (const pair of calibrationSamples.pairs) {
    const greenScan = scanChapterAigcWindows(pair.green.text, { threshold: 0.5 });
    assert.equal(
      greenScan.pass,
      true,
      `${pair.id} green window should pass (<0.50), got ${greenScan.maxWindowRisk}`
    );
    assert.ok(greenScan.maxWindowRisk <= pair.green.expectedMaxRiskMax);

    const greenAudit = auditChapterText(pair.green.text, {
      genre: pair.genre,
      skipLengthGate: true,
      aigcGuard: true,
    });
    assert.equal(greenAudit.summary.error, 0);
    assert.equal(
      greenAudit.summary.warning,
      0,
      `${pair.id} green prose should trigger 0 warnings under --aigc-guard, got: ${JSON.stringify(greenAudit.violations.filter((v) => v.severity === "warning"))}`
    );

    const yellowScan = scanChapterAigcWindows(pair.yellow.text, { threshold: 0.5 });
    assert.ok(
      yellowScan.maxWindowRisk >= pair.yellow.expectedMaxRiskMin,
      `${pair.id} yellow window risk ${yellowScan.maxWindowRisk} should be >= ${pair.yellow.expectedMaxRiskMin}`
    );
    for (const reason of pair.yellow.expectedReasons || []) {
      const allReasons = yellowScan.windows.flatMap((w) => w.reasons);
      assert.ok(
        allReasons.includes(reason),
        `${pair.id} yellow window should include reason ${reason}, got ${allReasons.join(",")}`
      );
    }

    const yellowAudit = auditChapterText(pair.yellow.text, {
      genre: pair.genre,
      skipLengthGate: true,
      aigcGuard: true,
    });
    assert.ok(
      yellowAudit.summary.warning >= 1,
      `${pair.id} yellow prose must trigger >=1 warning`
    );

    if (pair.yellow.expectedRuleIds) {
      const hitRuleIds = new Set(
        yellowAudit.surgeryTargets.flatMap((t) => t.issues.map((i) => i.tag))
      );
      for (const expectedId of pair.yellow.expectedRuleIds) {
        assert.ok(
          hitRuleIds.has(expectedId),
          `${pair.id} expected rule tag ${expectedId} in surgeryTargets, got ${Array.from(hitRuleIds).join(",")}`
        );
      }
    }
  }
});

test("default audit keeps cadence telemetry as info while --aigc-guard escalates to warning", () => {
  const sssPair = calibrationSamples.pairs[0];
  const defaultAudit = auditChapterText(sssPair.yellow.text, {
    genre: sssPair.genre,
    skipLengthGate: true,
  });
  assert.equal(defaultAudit.summary.warning, 0);
  const monotonyInfo = defaultAudit.violations.find(
    (v) => v.code === "CADENCE_TEMPLATE_MONOTONY"
  );
  assert.ok(monotonyInfo);
  assert.equal(monotonyInfo.severity, "info");
  assert.equal(typeof defaultAudit.metrics.cadenceEntropy, "number");

  const guardedAudit = auditChapterText(sssPair.yellow.text, {
    genre: sssPair.genre,
    skipLengthGate: true,
    aigcGuard: true,
  });
  assert.ok(guardedAudit.summary.warning >= 2);
  assert.ok(guardedAudit.violations.some((v) => v.code === "AIGC_WINDOW_RISK"));
});

test("MCP server exposes 10 tools including inkbone_aigc_check on v2.1.0", () => {
  assert.equal(MCP_TOOLS.length, 10);
  assert.ok(MCP_TOOLS.some((t) => t.name === "inkbone_aigc_check"));

  const initReply = handleMcpMessage({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2024-11-05" },
  });
  assert.equal(initReply.result.serverInfo.version, "2.1.0");

  const sssPair = calibrationSamples.pairs[0];
  const callReply = handleMcpMessage({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: {
      name: "inkbone_aigc_check",
      arguments: {
        text: sssPair.yellow.text,
        format: "md",
      },
    },
  });
  assert.equal(callReply.result.structuredContent.pass, false);
  assert.match(callReply.result.content[0].text, /InkBone Offline AIGC Window Guard/);
});

test("CLI version and aigc-check command work end-to-end", () => {
  const cliPath = path.resolve(rootDir, "bin/inkbone.mjs");
  const verOut = execFileSync(process.execPath, [cliPath, "--version"], {
    encoding: "utf8",
  }).trim();
  assert.equal(verOut, "inkbone 2.1.0");

  const evalSeedDir = path.resolve(rootDir, "benchmarks/eval-set");
  if (fs.existsSync(evalSeedDir)) {
    const batch = checkFilesAigcRisk([samplesPath.replace("samples.json", "")]);
    assert.equal(batch.filesScanned, 0);
    const md = formatAigcCheckMarkdown(batch);
    assert.match(md, /Scanned/);
  }
});
