import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  profileText,
  auditChapterText,
  compileBoundaryPacket,
  verifyChapterBoundaries,
  validateEvidenceReview,
  calibrateReference,
  mineOverusedPhrases,
  detectWithZhuque,
  listGenres,
  inferGenreFromTexts,
  diagnoseProject,
  scaffoldProject,
  findProjectConfig,
  loadProjectConfig,
  compileProjectRules,
  checkOutlineCopy,
  parseChineseOrArabicNumber,
  importLedgerFromChapters,
  loadLinguisticsConfig,
  checkCharCountClaims,
  checkOutlineContract,
  normalizeProseText,
  normalizeFiles,
  scanSubjectContinuity,
  collectCharacterNames,
  stripSpokenDialogue,
  computeRuleStats,
  buildBlindPack,
  writeBlindPack,
  scoreBallots,
  signTestPValue,
  saveReview,
  summarizeReviews,
  validateLedger,
  applyChapterSettlement,
  extractCandidateCharacters,
  formatAuditMarkdown,
  buildTargetedRewritePrompt,
  handleMcpMessage,
  MCP_TOOLS,
} from "../src/index.mjs";
import { execFileSync } from "node:child_process";

// 加载外部测试夹具数据以保持测试代码纯英文零中文字符
const currentFile = fileURLToPath(import.meta.url);
const testDir = path.dirname(currentFile);
const rootDir = path.resolve(testDir, "..");
const fixtures = JSON.parse(
  fs.readFileSync(path.resolve(testDir, "fixtures.json"), "utf8")
);
// 基准书的项目级规则：本书口味不在引擎通用层里，测试本书样本时要显式带上
const benchProjectRulesPath = path.resolve(
  rootDir,
  "benchmarks/shoushi-wenxian/project-rules.json"
);
const benchProjectRules = loadProjectConfig(benchProjectRulesPath).rules;
// 作者小说的正文与台账不随公开仓库发布；缺少这些文件时，依赖它们的测试跳过，逻辑由下方自包含测试覆盖
const privateBenchDir = path.resolve(rootDir, "benchmarks/shoushi-wenxian");
const hasPrivateBench = ["ledger.json", "ch001-v4.0-inkbone-v0.4.md", "ch001-v3.2-inkbone-v0.3.md"].every((f) =>
  fs.existsSync(path.join(privateBenchDir, f))
);

// 验证计算语言学探针能准确捕获AI雕花词、破折号、嵌套定语、对称骨架与段尾反问
test("profiler detects AI purple-prose cliches and structural artifacts", () => {
  const result = profileText(fixtures.aiPurpleSample);
  assert.ok(result.metrics.forbiddenClicheCount >= 3);
  assert.ok(result.metrics.emDashPer1kHan > 0);
  assert.ok(result.metrics.nestedDePer1kHan > 0);
  assert.ok(result.metrics.symmetricSkeletonCount >= 1);
  assert.ok(result.metrics.rhetoricalQuestionCount >= 1);
});

// 验证审计器能拒绝高AI特征样本并生成行级靶向手术指令单
test("auditor flags purple-prose sample and emits line-level surgery targets", () => {
  const report = auditChapterText(fixtures.aiPurpleSample, {
    presetName: "qimao-crimson",
    skipLengthGate: true,
    strict: true,
  });
  assert.equal(report.pass, false);
  assert.ok(report.violations.some((v) => v.code === "FORBIDDEN_AI_CLICHE" && v.severity === "warning"));
  assert.ok(report.violationCount >= 3);
  assert.ok(report.surgeryTargets.length >= 1);
});

// 默认模式只让客观错误判失败：三版第一章都没有格式与台账错误，应当通过；strict 模式保留旧的全量门禁
// 不依赖私有基准文件的版本：默认模式只让客观错误判失败，套话只报 warning，strict 模式保留全量门禁
test("severity tiers: warnings do not fail by default, hard errors and strict mode do", () => {
  const plain = auditChapterText(fixtures.aiPurpleSample, {
    presetName: "qimao-crimson",
    skipLengthGate: true,
  });
  assert.equal(plain.pass, true);
  assert.equal(plain.summary.error, 0);
  const cliche = plain.violations.find((v) => v.code === "FORBIDDEN_AI_CLICHE");
  assert.ok(cliche);
  assert.equal(cliche.severity, "warning");

  const missingAnchor = auditChapterText(fixtures.cleanOpening, {
    presetName: "qimao-crimson",
    skipLengthGate: true,
    ledger: fixtures.mockLedger,
    chapterNumber: 3,
  });
  assert.equal(missingAnchor.pass, false);
  const boundary = missingAnchor.violations.find((v) => v.code === "LEDGER_BOUNDARY_VIOLATION");
  assert.equal(boundary.severity, "error");
  assert.ok(boundary.details.missingAnchors.length >= 1);

  const strict = auditChapterText(fixtures.aiPurpleSample, {
    presetName: "qimao-crimson",
    skipLengthGate: true,
    strict: true,
  });
  assert.equal(strict.pass, false);
});

// 用作者小说第 1 章的几个版本做回归（私有文件，公开仓库里会跳过）
test("default mode fails only on hard errors, strict mode keeps the full v0.5 gates", { skip: hasPrivateBench ? false : "private benchmark chapters are not published" }, () => {
  const benchDir = path.resolve(rootDir, "benchmarks/shoushi-wenxian");
  const ledger = JSON.parse(
    fs.readFileSync(path.resolve(benchDir, "ledger.json"), "utf8")
  );
  const read = (f) => fs.readFileSync(path.resolve(benchDir, f), "utf8");
  const withLedger = (file) =>
    auditChapterText(read(file), {
      presetName: "qimao-crimson",
      ledger,
      chapterNumber: 1,
    });

  // B 稿没有格式与台账错误，默认模式通过
  const bLedger = withLedger("ch001-v4.0-inkbone-v0.4.md");
  assert.equal(bLedger.pass, true);
  assert.equal(bLedger.summary.error, 0);
  assert.ok(bLedger.violations.every((v) => typeof v.severity === "string"));

  // A 稿把日期写成了九月下旬，台账要求的日期锚点缺失，属于客观错误
  const aLedger = withLedger("ch001-v3.2-inkbone-v0.3.md");
  assert.equal(aLedger.pass, false);
  const aBoundary = aLedger.violations.find((v) => v.code === "LEDGER_BOUNDARY_VIOLATION");
  assert.equal(aBoundary.severity, "error");
  assert.deepEqual(aBoundary.details.missingAnchors, ledger.chapters[0].requiredAnchors.filter((a) => !read("ch001-v3.2-inkbone-v0.3.md").includes(a)));

  // C 稿不带台账时没有客观错误
  const cPlain = auditChapterText(read("ch001-v6.0-reader-first.md"), {
    presetName: "qimao-crimson",
  });
  assert.equal(cPlain.summary.error, 0);
  assert.equal(cPlain.pass, true);

  // B 稿套话多，默认模式下要以 warning 报出来
  const bReport = auditChapterText(read("ch001-v4.0-inkbone-v0.4.md"), {
    presetName: "qimao-crimson",
    genre: "classical-xianxia",
    projectRules: benchProjectRules,
  });
  const cliche = bReport.violations.find((v) => v.code === "FORBIDDEN_AI_CLICHE");
  assert.ok(cliche && cliche.count >= 10);
  assert.equal(cliche.severity, "warning");

  // strict 模式下，旧 AI 精修版与过度复读版仍被拒
  const v1Report = auditChapterText(read("ch001-v1-ai-refined.md"), {
    presetName: "qimao-crimson",
    skipLengthGate: true,
    strict: true,
  });
  assert.equal(v1Report.pass, false);
  const v2Report = auditChapterText(read("ch001-v2-vernacular.md"), {
    presetName: "qimao-crimson",
    skipLengthGate: true,
    strict: true,
  });
  assert.equal(v2Report.pass, false);
  assert.ok(
    v2Report.violations.some((v) => v.code === "EXCESSIVE_TOPIC_ANCHOR_STUFFING")
  );
});

// 格式残留属于客观错误，默认模式也必须判失败
test("formatting artifacts are hard errors in default mode", () => {
  const report = auditChapterText(fixtures.humanCleanSample + "\n" + fixtures.ledgerNoteSample, {
    presetName: "qimao-crimson",
    skipLengthGate: true,
  });
  assert.equal(report.pass, false);
  assert.ok(report.summary.error >= 1);
});

// 参考区间只输出统计量，样本不足时标为不可靠；audit 能据此标出区间外的指标
test("calibrate builds statistics-only reference and audit compares against it", () => {
  const texts = [fixtures.humanCleanSample, fixtures.aiPurpleSample, fixtures.termStuffingSample];
  const ref = calibrateReference(texts, { label: "fixture" });
  assert.equal(ref.sampleCount, 3);
  assert.equal(ref.reliable, false);
  assert.ok(ref.metrics.mattr50.p10 <= ref.metrics.mattr50.p90);
  const serialized = JSON.stringify(ref);
  assert.equal(serialized.includes(fixtures.humanCleanSample.slice(0, 12)), false);
  const report = auditChapterText(fixtures.humanCleanSample, {
    presetName: "qimao-crimson",
    skipLengthGate: true,
    reference: ref,
  });
  assert.ok(Array.isArray(report.referenceComparison.rows));
  assert.equal(report.referenceComparison.reliable, false);
});

// 套话挖掘：只在 AI 侧多篇重复出现、人类侧罕见的搭配才进入候选
test("phrase miner surfaces phrases overused in AI drafts", () => {
  const ai = [fixtures.aiPurpleSample, fixtures.aiPurpleSample + fixtures.termStuffingSample];
  const human = [fixtures.humanCleanSample, fixtures.cleanOpening];
  const result = mineOverusedPhrases(ai, human, { minAiCount: 2, minRatio: 2 });
  assert.ok(result.candidates.length > 0);
  for (const c of result.candidates) {
    assert.ok(c.aiDocs >= 2);
    assert.ok(c.ratio >= 2);
  }
});

// 验证探针能拦截超长无对白静态设定堆砌段
test("v0.3 auditor catches long static monologue and exposition dialogue droughts", () => {
  const repeatedNarrative = Array.from(
    { length: 12 },
    () => fixtures.humanCleanSample
  ).join("\n");
  const report = auditChapterText(repeatedNarrative, {
    presetName: "qimao-crimson",
    skipLengthGate: true,
  });
  const codes = report.violations.map((v) => v.code);
  assert.ok(codes.includes("EXPOSITION_DIALOGUE_DROUGHT"));
});

// 验证探针能捕获局部专有名词硬复读、8逗号机械动作长链与识海幻境转场套话
test("v0.2 auditor catches local term stuffing, overloaded comma chains, and transition cliches", () => {
  const report = auditChapterText(fixtures.termStuffingSample, {
    presetName: "qimao-crimson",
    skipLengthGate: true,
    strict: true,
  });
  assert.equal(report.pass, false);
  const codes = report.violations.map((v) => v.code);
  assert.ok(codes.includes("PARAGRAPH_TERM_STUFFING"));
  assert.ok(codes.includes("OVERLOADED_ACTION_CHAIN_SENTENCE"));
  assert.ok(codes.includes("FORBIDDEN_AI_CLICHE"));
});

// 验证硬边界编译器能拦截上章结尾重演回声、提前剧透词与废弃旧人名
test("boundary verifier detects echo replay, spoilers, and deprecated terms", () => {
  const echoCheck = verifyChapterBoundaries(
    fixtures.echoOpening,
    fixtures.mockLedger,
    3,
    fixtures.prevChapterTail
  );
  assert.ok(echoCheck.boundaryEchoRatio > 0.3);
  assert.ok(echoCheck.missingAnchors.length > 0);

  const cleanCheck = verifyChapterBoundaries(
    `${fixtures.cleanOpening} ${fixtures.humanCleanSample}`,
    fixtures.mockLedger,
    3,
    fixtures.prevChapterTail
  );
  assert.equal(cleanCheck.boundaryEchoRatio, 0);
  assert.equal(cleanCheck.pass, true);
});

// 验证举证式审稿校验器能拦截伪造原文引文与五感文笔干涉评语
test("evidence validator accepts verbatim quotes and blocks hallucinated or style-meddling reviews", () => {
  const okResult = validateEvidenceReview(
    fixtures.humanCleanSample,
    fixtures.validReview
  );
  assert.equal(okResult.valid, true);

  const badResult = validateEvidenceReview(
    fixtures.humanCleanSample,
    fixtures.hallucinatedReview
  );
  assert.equal(badResult.valid, false);
  const codes = badResult.issues.map((i) => i.code);
  assert.ok(codes.includes("HALLUCINATED_QUOTE_NOT_IN_TEXT"));
  assert.ok(codes.includes("BANNED_STYLE_INTERFERENCE"));
});

// 读者模拟反馈即使不是 warning 也必须附原文引文
test("reader-simulation items require verbatim quotes", () => {
  const ok = validateEvidenceReview(fixtures.humanCleanSample, fixtures.readerReview);
  assert.equal(ok.valid, true);
  const bad = validateEvidenceReview(fixtures.humanCleanSample, fixtures.readerReviewNoQuote);
  assert.equal(bad.valid, false);
  assert.ok(bad.issues.some((i) => i.code === "MISSING_EVIDENCE_QUOTE"));
});

// 验证朱雀检测客户端仅发送单次请求、在本地准确合并相邻分片并命中哈希缓存
test("detector sends single API call, merges segments locally, and hits cache", async () => {
  let callCount = 0;
  const mockFetch = async () => {
    callCount += 1;
    return {
      ok: true,
      json: async () => ({
        status: "success",
        softmax_confidence: 0.25,
        ratio_confidence: 0,
        labels_ratio: { "0": 1, "1": 0, "2": 0 },
        makers_models_usage: { total_tokens: 120 },
        segment_labels: [
          { text: "A", label: 0, conf: 0.3, order: 1, position: [0, 10] },
          { text: "B", label: 0, conf: 0.4, order: 2, position: [10, 10] },
        ],
      }),
    };
  };

  const cacheFile = path.resolve(rootDir, "tmp/test-zhuque-cache.json");
  fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
  if (fs.existsSync(cacheFile)) fs.unlinkSync(cacheFile);

  const first = await detectWithZhuque("# Title\n\nAlpha\n\nBeta", {
    apiKey: "sk-mock",
    fetchImpl: mockFetch,
    cachePath: cacheFile,
  });
  assert.equal(callCount, 1);
  assert.equal(first.cached, false);
  assert.equal(first.pass, true);
  assert.equal(first.segments.length, 1);
  assert.equal(first.segments[0].aigc, 0.35);

  const second = await detectWithZhuque("# Title\n\nAlpha\n\nBeta", {
    apiKey: "sk-mock",
    fetchImpl: mockFetch,
    cachePath: cacheFile,
  });
  assert.equal(callCount, 1);
  assert.equal(second.cached, true);
  fs.unlinkSync(cacheFile);
});

// 验证多题材语域防火墙能分别拦截古风评书儿化串味、现代都市古装串词、客套水词与段首代词连击
test("v1.0 multi-genre register firewall catches register clash, fillers, and pronoun streaks", () => {
  const genres = listGenres();
  assert.ok(genres.length >= 8);

  const xianxiaAudit = auditChapterText(fixtures.xianxiaRegisterClashSample, {
    genre: "classical-xianxia",
    skipLengthGate: true,
  });
  const xCodes = xianxiaAudit.violations.map((v) => v.code);
  assert.ok(xCodes.includes("REGISTER_COLLISION"));
  assert.ok(xCodes.includes("NARRATIVE_FILLER"));
  assert.ok(xCodes.includes("PRONOUN_HEAD_STREAK"));

  const urbanAudit = auditChapterText(fixtures.urbanArchaicLeakSample, {
    genre: "urban-realism",
    skipLengthGate: true,
  });
  assert.ok(urbanAudit.violations.some((v) => v.code === "REGISTER_COLLISION"));
});

// 验证大纲题材自动推断、doctor 一键体检与 init 通用工程脚手架正常工作
test("v1.0 doctor infers genre from text and init scaffolds universal config", () => {
  const inferredUrban = inferGenreFromTexts([fixtures.urbanArchaicLeakSample]);
  assert.equal(inferredUrban.genreId, "urban-realism");

  const tempDir = path.resolve(rootDir, "tmp/test-scaffold-project");
  if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
  const initRes = scaffoldProject(tempDir, {
    genre: "mystery-thriller",
    title: "FogHarbor",
  });
  assert.equal(initRes.genre, "mystery-thriller");
  assert.equal(initRes.created.length, 2);

  const sampleChap = path.resolve(tempDir, "ch01.md");
  fs.writeFileSync(sampleChap, fixtures.xianxiaRegisterClashSample);
  const diag = diagnoseProject([sampleChap], {
    genre: "classical-xianxia",
    skipLengthGate: true,
    projectRules: benchProjectRules,
  });
  assert.equal(diag.totals.chaptersScanned, 1);
  assert.ok(diag.totals.registerCollisions >= 3);
  assert.ok(diag.totals.narrativeFillers >= 2);
  fs.rmSync(tempDir, { recursive: true, force: true });
});

// 验证零背景初读者审读分类要求必须附带真实原文引文
test("v1.0 cold-reader blindspot categories pass quote validation", () => {
  const res = validateEvidenceReview(
    fixtures.humanCleanSample,
    fixtures.coldReaderReview
  );
  assert.equal(res.valid, true);
});

// 验证探针能拦截微动作注水、舞台指示过桥、别扭对白与教科书级境界说明书
test("v1.0 detects micro-bloat clutter, awkward banter dialogue, and textbook tier dumps", () => {
  const audit = auditChapterText(fixtures.bloatAndBanterSample, {
    genre: "classical-xianxia",
    skipLengthGate: true,
    projectRules: benchProjectRules,
  });
  const codes = audit.violations.map((v) => v.code);
  assert.ok(codes.includes("REGISTER_COLLISION"));
  assert.ok(codes.includes("NARRATIVE_FILLER"));
  assert.ok(codes.includes("FORBIDDEN_AI_CLICHE"));
});

// 验证三层规则：本书口味只在带项目规则时生效，题材共性只在对应题材生效，项目可关掉上层规则
test("v1.1 rule layers keep book taste out of the engine and genre taste out of other genres", () => {
  const sample = fixtures.xianxiaRegisterClashSample;
  const countOf = (report, code) =>
    (report.violations.find((v) => v.code === code) || { count: 0 }).count;

  const engineOnly = auditChapterText(sample, {
    genre: "classical-xianxia",
    skipLengthGate: true,
  });
  const withProject = auditChapterText(sample, {
    genre: "classical-xianxia",
    skipLengthGate: true,
    projectRules: benchProjectRules,
  });
  assert.ok(
    countOf(withProject, "REGISTER_COLLISION") > countOf(engineOnly, "REGISTER_COLLISION")
  );
  const projectHits = withProject.violations
    .find((v) => v.code === "REGISTER_COLLISION")
    .hits.filter((h) => h.layer === "project");
  assert.ok(projectHits.length >= 1);

  // 现代网络词只在古代背景题材算串味，都市题材里不报
  const slangUrban = auditChapterText(fixtures.modernSlangSample, {
    genre: "urban-realism",
    skipLengthGate: true,
  });
  const slangXianxia = auditChapterText(fixtures.modernSlangSample, {
    genre: "classical-xianxia",
    skipLengthGate: true,
  });
  assert.equal(countOf(slangUrban, "FORBIDDEN_AI_CLICHE"), 0);
  assert.ok(countOf(slangXianxia, "FORBIDDEN_AI_CLICHE") >= 2);
  assert.ok(
    slangXianxia.violations
      .find((v) => v.code === "FORBIDDEN_AI_CLICHE")
      .hits.every((h) => h.layer === "genre")
  );

  // 项目可以用 disabledRuleIds 关掉题材层规则
  const muted = auditChapterText(fixtures.modernSlangSample, {
    genre: "classical-xianxia",
    skipLengthGate: true,
    projectRules: compileProjectRules({ disabledRuleIds: ["cliche_modern_slang"] }),
  });
  assert.equal(countOf(muted, "FORBIDDEN_AI_CLICHE"), 0);
});

// 验证 novel.json 自下而上发现、rulesFile 与内联 projectRules 合并
test("v1.1 project config is discovered upward and merges rulesFile with inline rules", () => {
  const tempDir = path.resolve(rootDir, "tmp/test-project-config");
  if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
  const chapterDir = path.resolve(tempDir, "chapters/vol1");
  fs.mkdirSync(chapterDir, { recursive: true });
  fs.writeFileSync(
    path.resolve(tempDir, "novel.json"),
    JSON.stringify({
      projectTitle: "T",
      genre: "urban-realism",
      preset: "modern-clean",
      rulesFile: path.relative(tempDir, benchProjectRulesPath),
      projectRules: {
        clicheRules: [{ id: "inline_rule", category: "x", pattern: "zzz" }],
        disabledRuleIds: ["filler_bridge_glue"],
      },
    })
  );
  const found = findProjectConfig(chapterDir);
  assert.equal(found, path.resolve(tempDir, "novel.json"));
  const project = loadProjectConfig(found);
  assert.equal(project.genre, "urban-realism");
  assert.ok(project.rules.clicheRules.some((r) => r.id === "inline_rule"));
  assert.ok(project.rules.clicheRules.length > 1);
  assert.ok(project.rules.registerRules.every((r) => r.layer === "project"));
  assert.ok(project.rules.disabledRuleIds.has("filler_bridge_glue"));
  fs.rmSync(tempDir, { recursive: true, force: true });
});

// 验证第 2 步核心能力：引号遮蔽、书级字面量白名单、规则密度门槛与必改/提示分级
test("v1.2 quote masking, book whitelist, density gates, and blocking escalation work cleanly", () => {
  // 1. 引号内的修辞/破折号在 narration scope 下不误报，但对白内水词（scope: all）依然拦截
  const quoteReport = auditChapterText(fixtures.quoteMaskingSample, {
    genre: "classical-xianxia",
    skipLengthGate: true,
  });
  assert.equal(
    quoteReport.violations.some((v) => v.code === "RHETORICAL_AI_PATTERN"),
    false
  );
  assert.equal(
    quoteReport.violations.some((v) => v.code === "MECHANICAL_SYMMETRIC_SKELETON"),
    false
  );
  assert.equal(
    quoteReport.violations.some((v) => v.code === "EM_DASH_OVERUSE"),
    false
  );
  assert.ok(quoteReport.violations.some((v) => v.code === "NARRATIVE_FILLER"));

  // 2. not_is 家族密度分级：1-2 次为 advisory（默认通过），>=3 次升为 blocking（error，默认不通过）
  const advReport = auditChapterText(fixtures.rhetoricAdvisorySample, {
    presetName: "qimao-crimson",
    skipLengthGate: true,
  });
  assert.equal(advReport.pass, true);
  assert.equal(advReport.summary.error, 0);
  const advRhet = advReport.violations.find((v) => v.code === "RHETORICAL_AI_PATTERN");
  assert.ok(advRhet && advRhet.severity === "warning" && advRhet.level === "advisory");

  const blkReport = auditChapterText(fixtures.rhetoricBlockingSample, {
    presetName: "qimao-crimson",
    skipLengthGate: true,
  });
  assert.equal(blkReport.pass, false);
  assert.ok(blkReport.summary.error >= 1);
  const blkRhet = blkReport.violations.find((v) => v.code === "RHETORICAL_AI_PATTERN");
  assert.ok(blkRhet && blkRhet.severity === "error" && blkRhet.level === "blocking");

  // 3. 书级白名单（inline whitelistLiterals 与 .inkbone-whitelist 文件）精确遮罩字面量，不误伤其余位置
  const wlRules = compileProjectRules({
    whitelistLiterals: [fixtures.whitelistLiteralText],
    clicheRules: [
      { id: "proj_minhits_rule", category: "test", pattern: fixtures.projectBlockingRulePattern, minHits: 2, level: "blocking" },
    ],
  });
  const wlReport = auditChapterText(fixtures.whitelistSample, {
    presetName: "qimao-crimson",
    skipLengthGate: true,
    projectRules: wlRules,
  });
  const clicheV = wlReport.violations.find((v) => v.code === "FORBIDDEN_AI_CLICHE");
  assert.ok(clicheV && clicheV.count === 1);

  // 单次命中的 minHits:2 规则被密度门槛抑制
  const belowMin = auditChapterText(fixtures.whitelistRuleSample, {
    presetName: "qimao-crimson",
    skipLengthGate: true,
    projectRules: wlRules,
  });
  assert.equal(
    belowMin.violations.some((v) => v.code === "FORBIDDEN_AI_CLICHE"),
    false
  );

  // 文件白名单 .inkbone-whitelist 加载测试
  const tempDir = path.resolve(rootDir, "tmp/test-whitelist-project");
  if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
  fs.mkdirSync(tempDir, { recursive: true });
  fs.writeFileSync(
    path.resolve(tempDir, "novel.json"),
    JSON.stringify({ projectTitle: "WL", genre: "classical-xianxia", preset: "grim-classical" })
  );
  fs.writeFileSync(
    path.resolve(tempDir, ".inkbone-whitelist"),
    `# comment\n${fixtures.whitelistRulePattern}\n`
  );
  const loaded = loadProjectConfig(path.resolve(tempDir, "novel.json"));
  const maskedReport = auditChapterText(fixtures.whitelistRuleSample, {
    genre: "classical-xianxia",
    skipLengthGate: true,
    projectRules: loaded.rules,
  });
  assert.equal(
    maskedReport.violations.some((v) => v.code === "REGISTER_COLLISION"),
    false
  );
  fs.rmSync(tempDir, { recursive: true, force: true });
});

// 验证移植自 oh-story 的修辞探针、尾窗检测、密度探针与退化/工程词泄漏检测
test("v1.2 ported oh-story rhetorical, density, degeneration, and meta-leak checks", () => {
  // 1. 尾窗 600 字外部的普通“没人知道”不触发 trailer_ending，尾窗内高频触发 blocking
  const longPadded =
    fixtures.rhetoricEarlyPreviewChunk.repeat(12) +
    fixtures.rhetoricExtendedSample +
    fixtures.rhetoricExtendedTail;
  const rhetReport = auditChapterText(longPadded, {
    presetName: "qimao-crimson",
    skipLengthGate: true,
  });
  const rhetV = rhetReport.violations.find((v) => v.code === "RHETORICAL_AI_PATTERN");
  assert.ok(rhetV);
  const rhetIds = rhetV.hits.map((h) => h.id);
  assert.ok(rhetIds.includes("rhet_voice_contrast"));
  assert.ok(rhetIds.includes("rhet_negation_parade"));
  assert.ok(rhetIds.includes("rhet_trailer_ending"));
  assert.ok(rhetIds.includes("rhet_trailer_summary"));
  assert.equal(
    rhetV.hits.filter((h) => h.id === "rhet_trailer_ending").length,
    1
  );

  // 跨段「不是/也不是/只是」只给 advisory
  const crossReport = auditChapterText(fixtures.crossParallelSample, {
    presetName: "qimao-crimson",
    skipLengthGate: true,
  });
  const crossV = crossReport.violations.find((v) => v.code === "RHETORICAL_AI_PATTERN");
  assert.ok(crossV && crossV.severity === "warning");

  // 2. 密度探针：动作清单、叙述引号强调、套式反应
  const ticReport = auditChapterText(fixtures.densityTicSample, {
    presetName: "qimao-crimson",
    skipLengthGate: true,
  });
  const ticV = ticReport.violations.find((v) => v.code === "PROSE_DENSITY_TIC");
  assert.ok(ticV && ticV.severity === "warning");
  const ticIds = ticV.hits.map((h) => h.id);
  assert.ok(ticIds.includes("tic_action_list"));
  assert.ok(ticIds.includes("tic_quote_emphasis"));
  assert.ok(ticIds.includes("tic_stock_reaction"));

  // 2b. 感叹号密度与连叠：叙述层高密度 + 一处连叠即报，台词里的！不计入
  const exclReport = auditChapterText(fixtures.exclamationTicSample, {
    presetName: "qimao-crimson",
    skipLengthGate: true,
  });
  const exclV = exclReport.violations.find((v) => v.code === "PROSE_DENSITY_TIC");
  assert.ok(exclV);
  const exclIds = exclV.hits.map((h) => h.id);
  assert.ok(exclIds.includes("tic_exclamation_density"));
  assert.ok(exclIds.includes("tic_exclamation_stack"));
  const exclHits = exclV.hits.find((h) => h.id === "tic_exclamation_density");
  assert.equal(exclHits.hits, 12);
  const cleanTicReport = auditChapterText(fixtures.exclamationCleanSample, {
    presetName: "qimao-crimson",
    skipLengthGate: true,
  });
  const cleanTicHits =
    (cleanTicReport.violations.find((v) => v.code === "PROSE_DENSITY_TIC") || { hits: [] }).hits;
  assert.equal(
    cleanTicHits.some((h) => h.id === "tic_exclamation_density" || h.id === "tic_exclamation_stack"),
    false
  );

  // 3. 退化与工程词泄漏检测：复读、截断、AI 自指、占位符、Tier1 阻断；Tier2 仅提示且跳过引号内台词
  const degenReport = auditChapterText(fixtures.degenerationMetaSample, {
    presetName: "qimao-crimson",
    skipLengthGate: true,
  });
  assert.equal(degenReport.pass, false);
  const degenV = degenReport.violations.find((v) => v.code === "DEGENERATION_DETECTED");
  assert.ok(degenV && degenV.severity === "error");
  const degenIds = degenV.hits.map((h) => h.id);
  assert.ok(degenIds.includes("degen_adjacent_repeat"));
  assert.ok(degenIds.includes("degen_sentence_repeat"));
  assert.ok(degenIds.includes("degen_truncated_ending"));
  assert.ok(degenIds.includes("degen_ai_self_ref"));
  assert.ok(degenIds.includes("degen_bracket_omission"));

  const metaV = degenReport.violations.find((v) => v.code === "ENGINEERING_META_LEAK");
  assert.ok(metaV && metaV.severity === "error");
  assert.ok(metaV.hits.some((h) => h.id === "meta_leak_tier1" && h.level === "blocking"));
  assert.ok(metaV.hits.some((h) => h.id === "meta_leak_tier2" && h.level === "advisory"));

  // 纯对话重复不误报退化，引号内“第6章”不误报 Tier2 工程词
  const exemptReport = auditChapterText(fixtures.degenerationDialogueExemptSample, {
    presetName: "qimao-crimson",
    skipLengthGate: true,
  });
  assert.equal(
    exemptReport.violations.some((v) => v.code === "DEGENERATION_DETECTED"),
    false
  );
  assert.equal(
    exemptReport.violations.some((v) => v.code === "ENGINEERING_META_LEAK"),
    false
  );
});

// 验证抄纲检测（放行显式声明的原话/复沓锚句，拦截照搬细纲叙述）
test("checkOutlineCopy flags copied outline runs while exempting declared anchor lines", () => {
  const badRes = checkOutlineCopy(
    fixtures.outlineCopyBadChapter,
    fixtures.outlineCopyOutline
  );
  assert.equal(badRes.pass, false);
  assert.equal(badRes.overlapCount, 1);
  assert.equal(badRes.hits[0].line, 1);

  const goodRes = checkOutlineCopy(
    fixtures.outlineCopyGoodChapter,
    fixtures.outlineCopyOutline
  );
  assert.equal(goodRes.pass, true);
  assert.equal(goodRes.overlapCount, 0);

  const auditReport = auditChapterText(fixtures.outlineCopyBadChapter, {
    outlineText: fixtures.outlineCopyOutline,
    skipLengthGate: true,
  });
  const outlineViolation = auditReport.violations.find(
    (v) => v.code === "OUTLINE_COPY_DETECTED"
  );
  assert.ok(outlineViolation && outlineViolation.severity === "warning");
  assert.ok(
    auditReport.surgeryTargets.some((t) =>
      t.issues.some((iss) => iss.tag === "outline_copy")
    )
  );
});

// 验证双栏知识台账：到达揭露章前隐藏 fullTruth 并拦截剧透词
test("dual-column knowledgeLedger hides fullTruth and blocks premature spoilers until revealChapter", () => {
  const ledger = fixtures.knowledgeLedgerSample;

  const ch2Packet = compileBoundaryPacket(ledger, 2);
  assert.equal(ch2Packet.knowledgeLedger.length, 1);
  assert.equal(ch2Packet.knowledgeLedger[0].revealed, false);
  assert.equal("fullTruth" in ch2Packet.knowledgeLedger[0], false);
  assert.ok(ch2Packet.characterSnapshots.ChenMo);
  assert.equal(ch2Packet.foreshadowing.length, 1);

  const ch5Packet = compileBoundaryPacket(ledger, 5);
  assert.equal(ch5Packet.knowledgeLedger[0].revealed, true);
  assert.ok(
    ch5Packet.knowledgeLedger[0].fullTruth.includes(fixtures.knowledgeTruthSecret)
  );

  const earlyVerify = verifyChapterBoundaries(
    fixtures.knowledgeSpoilerChapter,
    ledger,
    2
  );
  assert.equal(earlyVerify.pass, false);
  assert.ok(earlyVerify.spoilerHits.includes(fixtures.knowledgeForbiddenTerm));

  const revealVerify = verifyChapterBoundaries(
    fixtures.knowledgeSpoilerChapter,
    ledger,
    5
  );
  assert.equal(revealVerify.pass, true);
  assert.equal(revealVerify.spoilerHits.length, 0);
});

// 验证存量章稿无损导入器：中文章号解析、书名号词条抽取与保留已有手写台账
test("importLedgerFromChapters parses Chinese numerals and merges non-destructively", () => {
  const ling = loadLinguisticsConfig();
  const cn = ling.chineseNumerals;
  assert.equal(parseChineseOrArabicNumber("003", cn), 3);
  assert.equal(parseChineseOrArabicNumber(fixtures.importNumerals.chOne, cn), 1);
  assert.equal(parseChineseOrArabicNumber(fixtures.importNumerals.chTen, cn), 10);
  assert.equal(
    parseChineseOrArabicNumber(fixtures.importNumerals.chTwelve, cn),
    12
  );
  assert.equal(
    parseChineseOrArabicNumber(fixtures.importNumerals.chHundredFive, cn),
    105
  );

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "inkbone-import-"));
  try {
    fs.writeFileSync(
      path.join(tmpDir, fixtures.importSamples.ch01File),
      fixtures.importSamples.ch01Content
    );
    fs.writeFileSync(
      path.join(tmpDir, fixtures.importSamples.ch12File),
      fixtures.importSamples.ch12Content
    );
    fs.writeFileSync(
      path.join(tmpDir, fixtures.importSamples.noteFile),
      fixtures.importSamples.noteContent
    );

    const existingLedger = {
      projectTitle: "ImportTestBook",
      chapters: [
        {
          chapterNumber: 1,
          title: "CustomTitle",
          coreSummary: fixtures.importSamples.curatedSummary,
          requiredAnchors: ["A1"],
          futureForbiddenTerms: [],
        },
      ],
    };

    const { ledger, stats } = importLedgerFromChapters(tmpDir, { existingLedger });
    assert.equal(stats.matchedChapters, 2);
    assert.equal(stats.preservedChapters, 1);
    assert.equal(stats.addedChapters, 1);
    assert.deepEqual(stats.skippedFiles, [fixtures.importSamples.noteFile]);
    assert.ok(
      stats.candidateTerms.some(
        (t) => t.term === fixtures.importSamples.importedBookTerm
      )
    );

    assert.equal(ledger.chapters.length, 2);
    assert.equal(
      ledger.chapters[0].coreSummary,
      fixtures.importSamples.curatedSummary
    );
    assert.equal(ledger.chapters[1].chapterNumber, 12);
    assert.ok(Array.isArray(ledger.knowledgeLedger));
    assert.ok(Array.isArray(ledger.foreshadowing));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// 验证排版星号与括号账本注记写入 surgeryTargets，便于直接定位行号
test("FORMATTING_OR_LEDGER_ARTIFACTS registers line-level targets for asterisks and bracket notes", () => {
  const report = auditChapterText(fixtures.formattingSurgerySample, {
    skipLengthGate: true,
  });
  assert.equal(report.pass, false);
  const fmtV = report.violations.find(
    (v) => v.code === "FORMATTING_OR_LEDGER_ARTIFACTS"
  );
  assert.ok(fmtV && fmtV.severity === "error");

  const asteriskTarget = report.surgeryTargets.find(
    (t) => t.line === 3 && t.issues.some((iss) => iss.tag === "markdown_asterisk")
  );
  const bracketTarget = report.surgeryTargets.find(
    (t) => t.line === 5 && t.issues.some((iss) => iss.tag === "ledger_bracket_note")
  );
  assert.ok(asteriskTarget);
  assert.ok(bracketTarget);
});

// 验证 doctor 中文数字章节号匹配、相邻章回放检测以及 init 脚手架新字段
test("diagnoseProject resolves Chinese numerals and adjacent echoes, and scaffoldProject emits full ledger schema", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "inkbone-doc-"));
  try {
    const chDir = path.join(tmpDir, "chapters");
    fs.mkdirSync(chDir, { recursive: true });
    fs.writeFileSync(
      path.join(chDir, fixtures.doctorChainSample.ch1File),
      `# ${fixtures.doctorChainSample.ch1File}\n\n${fixtures.doctorChainSample.ch2EchoTail}`
    );
    fs.writeFileSync(
      path.join(chDir, fixtures.doctorChainSample.ch2File),
      `# ${fixtures.doctorChainSample.ch2File}\n\n${fixtures.doctorChainSample.ch2EchoHead}`
    );

    const ledger = {
      projectTitle: "DoctorChainTest",
      chapters: [
        { chapterNumber: 1, title: "C1", coreSummary: "S1", requiredAnchors: [], futureForbiddenTerms: [] },
        { chapterNumber: 2, title: fixtures.doctorChainSample.ch2Title, coreSummary: fixtures.doctorChainSample.ledgerSummary, requiredAnchors: [], futureForbiddenTerms: [] },
      ],
    };

    const diag = diagnoseProject([chDir], {
      genre: "classical-xianxia",
      ledger,
      skipLengthGate: true,
    });
    assert.equal(diag.chapters.length, 2);
    assert.equal(diag.chapters[0].chapterNumber, 1);
    assert.equal(diag.chapters[1].chapterNumber, 2);
    assert.equal(diag.chapters[1].detectedChapterNumber, 2);
    assert.ok(
      diag.chapters[1].violations.some((v) => v.code === "PREVIOUS_ENDING_ECHO")
    );

    const initDir = path.join(tmpDir, "init-proj");
    scaffoldProject(initDir, { genre: "mystery-thriller", title: "InitTest" });
    const initLedger = JSON.parse(
      fs.readFileSync(path.join(initDir, "ledger.json"), "utf8")
    );
    assert.ok(Array.isArray(initLedger.knowledgeLedger));
    assert.equal(typeof initLedger.characterSnapshots, "object");
    assert.ok(Array.isArray(initLedger.foreshadowing));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// 验证零 Token normalizer：check 模式只读不改、剥离星号/分隔线/省略号、保留对话破折号与白名单
test("normalizer strips emphasis and dividers while respecting dialogue dashes and book whitelist", () => {
  const res = normalizeProseText(fixtures.normalizerSample.raw, {
    stripMarkdownEmphasis: true,
    fixNarrationEmDash: true,
    whitelistLiterals: [fixtures.normalizerSample.whitelistLiteral],
  });
  assert.equal(res.changed, true);
  assert.ok(res.output.includes(fixtures.normalizerSample.expectedCleanCheck));
  assert.equal(res.output.includes("\n---\n"), false);
  assert.ok(res.output.includes(fixtures.normalizerSample.expectedDialogueDash));
  assert.ok(res.output.includes(fixtures.normalizerSample.expectedBoom));
  assert.ok(res.output.includes(fixtures.normalizerSample.expectedColon));
  assert.ok(res.output.includes(fixtures.normalizerSample.whitelistLiteral));

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "inkbone-norm-"));
  try {
    const fileA = path.join(tmpDir, "01.md");
    fs.writeFileSync(fileA, fixtures.normalizerSample.raw);

    const dry = normalizeFiles([tmpDir], {
      check: true,
      stripMarkdownEmphasis: true,
      whitelistLiterals: [fixtures.normalizerSample.whitelistLiteral],
    });
    assert.equal(dry.pass, false);
    assert.equal(dry.filesChanged, 0);
    assert.equal(fs.readFileSync(fileA, "utf8"), fixtures.normalizerSample.raw);

    const written = normalizeFiles([tmpDir], {
      check: false,
      stripMarkdownEmphasis: true,
      whitelistLiterals: [fixtures.normalizerSample.whitelistLiteral],
    });
    assert.equal(written.filesChanged, 1);

    const recheck = normalizeFiles([tmpDir], {
      check: true,
      stripMarkdownEmphasis: true,
      whitelistLiterals: [fixtures.normalizerSample.whitelistLiteral],
    });
    assert.equal(recheck.pass, true);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// 验证字面字数宣称核验与细纲契约轻量检查
test("checkCharCountClaims catches mismatched quote counts and checkOutlineContract detects gaps", () => {
  const badHits = checkCharCountClaims(fixtures.charCountSample.mismatch);
  assert.equal(badHits.length, 1);
  assert.equal(badHits[0].claimed, 4);
  assert.equal(badHits[0].actual, 6);
  assert.equal(badHits[0].quote, fixtures.charCountSample.mismatchToken);

  assert.equal(checkCharCountClaims(fixtures.charCountSample.valid).length, 0);
  assert.equal(
    checkCharCountClaims(fixtures.charCountSample.ellipsisSkip).length,
    0
  );

  const auditMismatch = auditChapterText(fixtures.charCountSample.mismatch, {
    skipLengthGate: true,
  });
  assert.equal(auditMismatch.pass, false);
  assert.ok(
    auditMismatch.violations.some((v) => v.code === "CHAR_COUNT_CLAIM_MISMATCH")
  );

  const goodCheck = checkOutlineContract(fixtures.outlineContractSample.goodOutline);
  assert.equal(goodCheck.pass, true);
  assert.equal(goodCheck.missingFacets.length, 0);

  const badCheck = checkOutlineContract(fixtures.outlineContractSample.badOutline);
  assert.equal(badCheck.pass, false);
  assert.equal(badCheck.placeholderCount, 1);
  assert.ok(badCheck.missingFacets.includes("reader_payoff_or_emotion"));
  assert.ok(badCheck.missingFacets.includes("hook_or_spoiler_fence"));
});

// 验证言情流派防火墙、新增狗血禁词、对话标点卫检与连续纯对话流密度探测
test("romance-emotional genre, dialogue punctuation hygiene, and pure-quote streak tic work cleanly", () => {
  const genres = listGenres();
  assert.ok(genres.length >= 9);
  assert.ok(
    genres.some((g) => g.id === fixtures.romanceAndHygieneSamples.romanceGenreId)
  );

  // 1. 验证 romance-emotional 题材与通用新增狗血套话禁词拦截
  const romanceAudit = auditChapterText(
    fixtures.romanceAndHygieneSamples.romanceClicheText,
    {
      genre: fixtures.romanceAndHygieneSamples.romanceGenreId,
      skipLengthGate: true,
    }
  );
  const romanceCliche = romanceAudit.violations.find(
    (v) => v.code === "FORBIDDEN_AI_CLICHE"
  );
  assert.ok(romanceCliche && romanceCliche.hits.length >= 4);
  const romanceIds = romanceCliche.hits.map((h) => h.id);
  assert.ok(romanceIds.includes("cliche_dangerous_squint"));
  assert.ok(romanceIds.includes("cliche_greasy_overlord"));
  assert.ok(romanceIds.includes("cliche_blood_boil_shiver"));
  assert.ok(romanceIds.includes("cliche_greasy_ceo_talk"));
  assert.ok(romanceIds.includes("cliche_marysue_tears"));

  // 2. 验证对话标点错漏检测：居中冒号误用与句末句号落在引号外，且规范样本零误报
  const badPunct = auditChapterText(
    fixtures.romanceAndHygieneSamples.dialogueBadPunctuation,
    { skipLengthGate: true }
  );
  const punctV = badPunct.violations.find(
    (v) => v.code === "DIALOGUE_PUNCTUATION_ERROR"
  );
  assert.ok(punctV && punctV.severity === "warning" && punctV.count === 2);
  const punctIds = punctV.hits.map((h) => h.id);
  assert.ok(punctIds.includes("dialogue_mid_colon"));
  assert.ok(punctIds.includes("dialogue_outside_period"));

  const goodPunct = auditChapterText(
    fixtures.romanceAndHygieneSamples.dialogueGoodPunctuation,
    { skipLengthGate: true }
  );
  assert.equal(
    goodPunct.violations.some((v) => v.code === "DIALOGUE_PUNCTUATION_ERROR"),
    false
  );

  // 3. 验证连续 8+ 段纯引号无动作锚点的纯对话流密度警告
  const streakAudit = auditChapterText(
    fixtures.romanceAndHygieneSamples.dialogueOnlyStreakText,
    { skipLengthGate: true }
  );
  const ticV = streakAudit.violations.find(
    (v) => v.code === "PROSE_DENSITY_TIC"
  );
  assert.ok(ticV);
  assert.ok(ticV.hits.some((h) => h.id === "tic_dialogue_only_streak" && h.hits >= 8));
});

// 验证工程内所有可执行代码模块除中文注释外不包含任何中文字符字面量
test("all JavaScript source files strictly separate code from Chinese data literals", () => {
  const hanRegex = /\p{Script=Han}/u;
  const collectMjs = (dir) => {
    const out = [];
    for (const entry of fs.readdirSync(dir)) {
      const full = path.join(dir, entry);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) out.push(...collectMjs(full));
      else if (entry.endsWith(".mjs")) out.push(full);
    }
    return out;
  };
  const dirsToScan = ["bin", "src", "tests"];
  for (const dir of dirsToScan) {
    const absDir = path.resolve(rootDir, dir);
    for (const fullPath of collectMjs(absDir)) {
      const rel = path.relative(rootDir, fullPath);
      const lines = fs.readFileSync(fullPath, "utf8").split(/\r?\n/u);
      lines.forEach((line, idx) => {
        // 剥离单行中文注释后检查剩余可执行代码部分是否含汉字
        const codePart = line.replace(/\/\/.*$/u, "");
        assert.equal(
          hanRegex.test(codePart),
          false,
          `Unexpected Chinese literal in ${rel}:${idx + 1}`
        );
      });
    }
  }
  // 校验浏览器页面控制脚本也保持零汉字字面量
  const appLines = fs
    .readFileSync(path.resolve(rootDir, "docs/app.mjs"), "utf8")
    .split(/\r?\n/u);
  appLines.forEach((line, idx) => {
    const codePart = line.replace(/\/\/.*$/u, "");
    assert.equal(
      hanRegex.test(codePart),
      false,
      `Unexpected Chinese literal in docs/app.mjs:${idx + 1}`
    );
  });
});

// 主语歧义：上一句主语是别的角色、下一句无主语动作，应报 SUBJECT_AMBIGUITY；补上主语后不报
test("subject continuity flags an action sentence that reads as another character's", () => {
  const ambiguous = auditChapterText(fixtures.ambiguitySample, {
    skipLengthGate: true,
    ledger: fixtures.continuityLedger,
  });
  const hit = ambiguous.violations.find((v) => v.code === "SUBJECT_AMBIGUITY");
  assert.ok(hit, "expected SUBJECT_AMBIGUITY");
  assert.equal(hit.severity, "warning");
  assert.equal(hit.hits[0].scope, "same-paragraph");
  assert.equal(hit.hits[0].previousActor, fixtures.continuityLedger.characterNames[1]);

  const clear = auditChapterText(fixtures.clearSubjectSample, {
    skipLengthGate: true,
    ledger: fixtures.continuityLedger,
  });
  assert.equal(clear.violations.some((v) => v.code === "SUBJECT_AMBIGUITY"), false);

  // 没有人物名单时不运行
  const noLedger = auditChapterText(fixtures.ambiguitySample, { skipLengthGate: true });
  assert.equal(noLedger.violations.some((v) => v.code === "SUBJECT_AMBIGUITY"), false);
});

// 起头连击：连续三段都用“先写动作、再补主语”开头，应报 OPENING_PATTERN_STREAK
test("opening pattern streak catches three action-then-subject openings in a row", () => {
  const lingConfig = loadLinguisticsConfig();
  const { names, protagonistNames } = collectCharacterNames(fixtures.continuityLedger);
  const paragraphs = fixtures.openingStreakSample
    .split(/\n+/u)
    .filter((s) => s.trim())
    .map((text, i) => ({ line: i * 2 + 1, text, hanLen: text.length }));
  const result = scanSubjectContinuity(paragraphs, lingConfig, { names, protagonistNames });
  assert.equal(result.enabled, true);
  assert.equal(result.openingStreaks.length, 1);
  assert.equal(result.openingStreaks[0].kind, "delayed");
  assert.equal(result.openingStreaks[0].streak, 3);
});

// 规则统计：只在 AI 稿里出现的规则判 ai-marker，人类文本里同样常见的判 taste
test("rule stats separate AI markers from taste rules", () => {
  const stats = computeRuleStats([fixtures.ruleStatsHuman], fixtures.ruleStatsAi);
  const byId = new Map(stats.rules.map((r) => [r.id, r]));
  assert.equal(byId.get("filler_clutter_reaction").verdict, "ai-marker");
  assert.equal(byId.get("filler_clutter_reaction").humanHits, 0);
  assert.equal(byId.get("filler_purpose_handholding").verdict, "taste");
  assert.equal(stats.reliable, false);
});

// 盲读包：读者那份不含版本标签和原标题，key.json 记录对应关系；同一 seed 结果可复现
test("blind pack hides version labels and scoring maps ballots back to versions", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "inkbone-eval-"));
  const dirA = path.join(tmp, "a");
  const dirB = path.join(tmp, "b");
  fs.mkdirSync(dirA);
  fs.mkdirSync(dirB);
  fs.writeFileSync(path.join(dirA, "01-seed.md"), fixtures.evalVersionA);
  fs.writeFileSync(path.join(dirB, "01-seed.md"), fixtures.evalVersionB);
  const files = (d) => fs.readdirSync(d).map((f) => path.join(d, f));
  const pack = buildBlindPack(files(dirA), files(dirB), { seed: 42, labelA: "old-v1", labelB: "new-v2" });
  const again = buildBlindPack(files(dirA), files(dirB), { seed: 42 });
  assert.equal(pack.pairs.length, 1);
  assert.equal(pack.pairs[0].X, again.pairs[0].X);
  const out = writeBlindPack(pack, path.join(tmp, "blind"));
  for (const side of ["X", "Y"]) {
    const body = fs.readFileSync(path.join(out.packetDir, "pair-01", side + ".md"), "utf8");
    assert.equal(body.includes("old-v1") || body.includes("new-v2") || body.includes("v2"), false);
  }
  const key = JSON.parse(fs.readFileSync(out.keyPath, "utf8"));
  assert.equal(key.labels.A, "old-v1");
  const pickB = key.pairs[0].X === "B" ? "X" : "Y";
  const ballots = [1, 2, 3].map((i) => ({
    reader: "r" + i,
    pairs: [{ pair: "pair-01", choice: pickB, skimX: [], skimY: [] }],
  }));
  const score = scoreBallots(key, ballots);
  assert.equal(score.tally.B, 3);
  assert.equal(score.tally.A, 0);
  assert.equal(score.winRate.B, 1);
});

// 符号检验：9 胜 1 负的双侧 p 值约 0.0215
test("sign test p-value matches the binomial reference", () => {
  assert.equal(signTestPValue(9, 1), 0.0215);
  assert.equal(signTestPValue(5, 5), 1);
  assert.equal(signTestPValue(0, 0), 1);
});

// 审读存档：引文真实才存档并记录正文哈希；伪造引文拒绝；统计能给出前后两次的变化
test("review archive stores verified reviews with the chapter hash and reports trends", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "inkbone-review-"));
  const chapter = path.join(tmp, "ch01.md");
  fs.writeFileSync(chapter, fixtures.evalVersionA);
  const first = saveReview(chapter, fixtures.archiveReview, {
    kind: "reader",
    now: new Date("2026-01-01T00:00:00Z"),
  });
  assert.equal(first.saved, true);
  const second = saveReview(
    chapter,
    { items: [fixtures.archiveReview.items[1]] },
    { kind: "reader", now: new Date("2026-01-02T00:00:00Z") }
  );
  assert.equal(second.saved, true);
  const rejected = saveReview(chapter, fixtures.hallucinatedReview, { kind: "logic" });
  assert.equal(rejected.saved, false);
  const record = JSON.parse(fs.readFileSync(first.file, "utf8"));
  assert.equal(record.meta.chapterSha256.length, 64);
  const stats = summarizeReviews([first.file, second.file]);
  assert.equal(stats.records.length, 2);
  assert.equal(stats.trends.length, 1);
  assert.equal(stats.trends[0].delta["reader_skim:warning"], -1);
  assert.equal(stats.trends[0].textChanged, false);
});

// 打包目录必须自包含：与源文件逐字同步，SKILL.md 里引用的 $SKILL_DIR 路径都能在打包目录里找到，且不再出现相对仓库根目录的旧路径
test("packaged skill directory is self-contained and in sync with sources", async () => {
  const { checkSkill, referencedSkillPaths, DEFAULT_OUT } = await import("../scripts/build-skill.mjs");
  const result = checkSkill(DEFAULT_OUT);
  assert.equal(
    result.inSync,
    true,
    "skills/inkbone is out of date, run npm run build:skill: " +
      JSON.stringify({ missing: result.missing, different: result.different, extra: result.extra })
  );
  const skillMd = fs.readFileSync(path.join(DEFAULT_OUT, "SKILL.md"), "utf8");
  const refs = referencedSkillPaths(skillMd);
  assert.ok(refs.length >= 10);
  for (const rel of refs) {
    assert.ok(fs.existsSync(path.join(DEFAULT_OUT, rel)), "missing packaged path: " + rel);
  }
  assert.equal(/inkbone\/(prompts|resources|configs|bin)\//u.test(skillMd), false);
});

// 模型字段：盲读包记录两边的生成模型；审读存档记录审读模型与写作模型，换了审读模型要在趋势里标出来
test("blind packs and review archives record which model produced each side", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "inkbone-models-"));
  const fileA = path.join(tmp, "a-01.md");
  const fileB = path.join(tmp, "b-01.md");
  fs.writeFileSync(fileA, fixtures.evalVersionA);
  fs.writeFileSync(fileB, fixtures.evalVersionB);
  const pack = buildBlindPack([fileA], [fileB], {
    seed: 3,
    labelA: "skill-v1.1",
    labelB: "skill-v1.1",
    modelA: "model-x",
    modelB: "model-y",
  });
  const out = writeBlindPack(pack, path.join(tmp, "blind"));
  const key = JSON.parse(fs.readFileSync(out.keyPath, "utf8"));
  assert.equal(key.generation.A.model, "model-x");
  assert.equal(key.generation.B.model, "model-y");
  const packetBody = fs.readFileSync(path.join(out.packetDir, "pair-01", "X.md"), "utf8");
  assert.equal(packetBody.includes("model-x") || packetBody.includes("model-y"), false);
  const score = scoreBallots(key, []);
  assert.equal(score.generation.B.model, "model-y");

  const chapter = path.join(tmp, "ch01.md");
  fs.writeFileSync(chapter, fixtures.evalVersionA);
  const first = saveReview(chapter, fixtures.archiveReview, {
    kind: "reader",
    reviewerModel: "model-x",
    writerModel: "model-w",
    now: new Date("2026-02-01T00:00:00Z"),
  });
  const second = saveReview(chapter, fixtures.archiveReview, {
    kind: "reader",
    reviewerModel: "model-y",
    writerModel: "model-w",
    now: new Date("2026-02-02T00:00:00Z"),
  });
  const record = JSON.parse(fs.readFileSync(first.file, "utf8"));
  assert.equal(record.meta.reviewerModel, "model-x");
  assert.equal(record.meta.writerModel, "model-w");
  const stats = summarizeReviews([first.file, second.file]);
  assert.equal(stats.trends[0].reviewerChanged, true);
  assert.equal(stats.trends[0].writerChanged, false);
});

// 直角引号专名与真对白隔离：行内专名引号不打断主语连续性，真对白仍正常剥离
test("corner-quote term highlights do not break subject continuity or dialogue drought detection", () => {
  const ling = loadLinguisticsConfig();
  const termOnly = stripSpokenDialogue(fixtures.cornerQuoteIsolationSample.termParagraph.split("\n")[0], ling);
  assert.equal(termOnly.hasSpokenDialogue, false);

  const spoken = stripSpokenDialogue(fixtures.cornerQuoteIsolationSample.spokenDialogueLine, ling);
  assert.equal(spoken.hasSpokenDialogue, true);

  const standalone = stripSpokenDialogue(fixtures.cornerQuoteIsolationSample.standaloneDialogueLine, ling);
  assert.equal(standalone.isPureDialogue, true);

  const audit = auditChapterText(fixtures.cornerQuoteIsolationSample.termParagraph, {
    skipLengthGate: true,
    ledger: fixtures.continuityLedger,
  });
  assert.equal(audit.violations.some((v) => v.code === "SUBJECT_AMBIGUITY"), true);
});

// 跨中文分卷排序：第一卷/第二卷/第三卷按章号而非字典序排列，跨卷衔接回声不漏检
test("doctor sorts chapters numerically across Chinese volume directories and checks cross-volume echoes", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "inkbone-vol-order-"));
  try {
    const v1Dir = path.join(tmpDir, fixtures.volumeOrderSample.vol1);
    const v2Dir = path.join(tmpDir, fixtures.volumeOrderSample.vol2);
    const v3Dir = path.join(tmpDir, fixtures.volumeOrderSample.vol3);
    fs.mkdirSync(v1Dir, { recursive: true });
    fs.mkdirSync(v2Dir, { recursive: true });
    fs.mkdirSync(v3Dir, { recursive: true });

    fs.writeFileSync(
      path.join(v1Dir, fixtures.volumeOrderSample.ch1File),
      `# ${fixtures.volumeOrderSample.ch1File}\n\n${fixtures.doctorChainSample.ch2EchoTail}`
    );
    fs.writeFileSync(
      path.join(v2Dir, fixtures.volumeOrderSample.ch2File),
      `# ${fixtures.volumeOrderSample.ch2File}\n\n${fixtures.doctorChainSample.ch2EchoHead}`
    );
    fs.writeFileSync(
      path.join(v3Dir, fixtures.volumeOrderSample.ch3File),
      `# ${fixtures.volumeOrderSample.ch3File}\n\n${fixtures.volumeOrderSample.ch3Body}`
    );

    const diag = diagnoseProject([tmpDir], {
      genre: "classical-xianxia",
      skipLengthGate: true,
    });
    assert.deepEqual(
      diag.chapters.map((c) => c.detectedChapterNumber),
      [1, 2, 3]
    );
    assert.ok(
      diag.chapters[1].violations.some((v) => v.code === "PREVIOUS_ENDING_ECHO")
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// 括号账本注记：兼容纯中文数字与较长前置说明
test("ledgerBracketNote catches Chinese numerals and long prefixes", () => {
  for (const sample of fixtures.chineseLedgerBracketSamples) {
    const report = auditChapterText(sample, { skipLengthGate: true });
    assert.equal(report.pass, false);
    assert.ok(
      report.violations.some((v) => v.code === "FORMATTING_OR_LEDGER_ARTIFACTS")
    );
  }
});

// normalizer 在同行先去加粗后，仍保留 HTML 注释与书级白名单里的斜体星号
test("normalizer preserves italics inside HTML comments and whitelisted literals after bold stripping", () => {
  const res = normalizeProseText(fixtures.normalizerProtectSample.raw, {
    stripMarkdownEmphasis: true,
    whitelistLiterals: [fixtures.normalizerProtectSample.whitelistLiteral],
  });
  assert.equal(res.output, fixtures.normalizerProtectSample.expected);
});

// profiler 跳过 Frontmatter/代码块/HTML 注释，尊重星号白名单，且词频疲劳豁免主角别名
test("profiler skips frontmatter/comments/codeblocks, respects whitelist on asterisks, and auditor exempts protagonist aliases", () => {
  const prof = profileText(fixtures.frontmatterSkipSample);
  assert.equal(prof.metrics.totalHan, 8);
  assert.equal(prof.metrics.forbiddenClicheCount, 0);

  const wlReport = auditChapterText(fixtures.normalizerSample.whitelistLiteral, {
    skipLengthGate: true,
    projectRules: compileProjectRules({
      whitelistLiterals: [fixtures.normalizerSample.whitelistLiteral],
    }),
  });
  assert.equal(
    wlReport.violations.some((v) => v.code === "FORMATTING_OR_LEDGER_ARTIFACTS"),
    false
  );

  const aliasAudit = auditChapterText(fixtures.aliasExemptSample.text, {
    presetName: "qimao-crimson",
    skipLengthGate: true,
    ledger: {
      protagonist: {
        name: fixtures.aliasExemptSample.protagonistName,
        alias: fixtures.aliasExemptSample.alias,
      },
    },
  });
  assert.equal(
    aliasAudit.violations.some((v) => v.code === "CHAPTER_TERM_FATIGUE"),
    false
  );
});

// 历史权谋与传统武侠扩展规则：拦下“皇后殿下”、陈旧“虎躯一震”与“悦来客栈/熟牛肉/女儿红”模板
test("historical-court and wuxia-jianghu catch stale genre tropes and title anachronisms", () => {
  const hist = auditChapterText(fixtures.historicalWuxiaGenreSample.historical, {
    genre: "historical-court",
    skipLengthGate: true,
  });
  const histReg = hist.violations.find((v) => v.code === "REGISTER_COLLISION");
  const histCli = hist.violations.find((v) => v.code === "FORBIDDEN_AI_CLICHE");
  assert.ok(histReg && histReg.hits.some((h) => h.id === "reg_historical_title_anachronism"));
  assert.ok(histCli && histCli.hits.some((h) => h.id === "cliche_historical_overlord"));

  const wuxia = auditChapterText(fixtures.historicalWuxiaGenreSample.wuxia, {
    genre: "wuxia-jianghu",
    skipLengthGate: true,
  });
  const wuxiaCli = wuxia.violations.find((v) => v.code === "FORBIDDEN_AI_CLICHE");
  assert.ok(wuxiaCli && wuxiaCli.hits.filter((h) => h.id === "cliche_wuxia_inn_template").length >= 3);
});

// 压测补洞回归：全角作者注记、引号前置句号外漏、脱离时辰的非法刻数以及边界加粗拆词匹配
test("audit catches bracket author notes, post-tagged outside periods, standalone ke durations, and bold-split boundaries", () => {
  const s = fixtures.faultRegressionSample;

  const metaHit = auditChapterText(s.metaBracketNote, { skipLengthGate: true });
  assert.equal(metaHit.pass, false);
  assert.ok(
    metaHit.violations.some((v) => v.code === "ENGINEERING_META_LEAK" && v.hits.some((h) => h.level === "blocking"))
  );

  const jadeClean = auditChapterText(s.jadeSlipCleanNote, { skipLengthGate: true });
  assert.equal(
    jadeClean.violations.some((v) => v.code === "ENGINEERING_META_LEAK"),
    false
  );

  const punctHit = auditChapterText(s.outsidePeriodPostTag, { skipLengthGate: true });
  const punctViol = punctHit.violations.find((v) => v.code === "DIALOGUE_PUNCTUATION_ERROR");
  assert.ok(punctViol && punctViol.count >= 2);

  const termClean = auditChapterText(s.endQuotedTermClean, { skipLengthGate: true });
  assert.equal(
    termClean.violations.some((v) => v.code === "DIALOGUE_PUNCTUATION_ERROR"),
    false
  );

  const keHist = auditChapterText(s.impossibleKeDuration, { genre: "historical-court", skipLengthGate: true });
  assert.ok(
    keHist.violations.some((v) => v.code === "REGISTER_COLLISION" && v.hits.some((h) => h.id === "reg_pseudo_classical_time"))
  );
  const keXian = auditChapterText(s.impossibleKeDuration, { genre: "classical-xianxia", skipLengthGate: true });
  assert.ok(
    keXian.violations.some((v) => v.code === "REGISTER_COLLISION" && v.hits.some((h) => h.id === "reg_impossible_ke_count"))
  );

  const boldAnchorRes = verifyChapterBoundaries(s.boundaryBoldAnchorText, s.boundaryLedger, 1);
  assert.equal(boldAnchorRes.pass, true);
  assert.deepEqual(boldAnchorRes.missingAnchors, []);

  const boldSpoilerRes = verifyChapterBoundaries(s.boundaryBoldSpoilerText, s.boundaryLedger, 1);
  assert.equal(boldSpoilerRes.pass, false);
  assert.deepEqual(boldSpoilerRes.spoilerHits, s.boundaryLedger.chapters[0].futureForbiddenTerms);
});

// 连载隔离补洞回归：未到揭露章时，packet 的 futureBlueprints 也会联动脱敏禁止词
test("compileBoundaryPacket redacts locked knowledge terms inside futureBlueprints until revealChapter", () => {
  const sample = fixtures.packetRedactionSample;
  const ch1Packet = compileBoundaryPacket(sample.ledger, 1);
  assert.equal(ch1Packet.futureBlueprints.length, 2);
  assert.equal(ch1Packet.futureBlueprints[0].chapterNumber, 4);
  assert.equal(ch1Packet.futureBlueprints[0].title.includes(sample.secretB), false);
  assert.equal(ch1Packet.futureBlueprints[0].coreSummary.includes(sample.secretA), false);
  assert.equal(ch1Packet.futureBlueprints[0].coreSummary.includes(sample.secretB), false);
  assert.ok(ch1Packet.futureBlueprints[0].coreSummary.includes("[REDACTED]"));

  const ch4Packet = compileBoundaryPacket(sample.ledger, 4);
  assert.equal(ch4Packet.knowledgeLedger[0].revealed, true);
  assert.ok(ch4Packet.knowledgeLedger[0].fullTruth.includes(sample.secretA));
});

// 浏览器静态试跑目录必须与核心引擎和 JSON 配置保持严格同步，且支持纯内存无文件系统运行
test("packaged docs directory is self-contained and in sync with sources", async () => {
  const { checkDocs } = await import("../scripts/build-docs.mjs");
  const sync = checkDocs();
  assert.equal(
    sync.inSync,
    true,
    "docs/vendor is out of date, run npm run build:docs: " +
      JSON.stringify({ missing: sync.missing, different: sync.different, extra: sync.extra })
  );

  // 确保 core 模块完全不引入 node: 内置模块或 config-loader
  const coreDir = path.resolve(rootDir, "docs/vendor/core");
  for (const entry of fs.readdirSync(coreDir)) {
    const code = fs.readFileSync(path.join(coreDir, entry), "utf8");
    assert.equal(/from\s+["']node:/u.test(code), false, `node import found in ${entry}`);
    assert.equal(code.includes("config-loader.mjs"), false, `config-loader import found in ${entry}`);
  }
});

// 纯内存核心入口：不依赖本地文件加载，供浏览器静态试跑台复用
test("core browser-safe engine runs from pure JSON configs without filesystem access", async () => {
  const { compileLinguisticsConfig, compileGenresConfig, compileSeverityConfig } = await import(
    "../docs/vendor/core/config-compiler.mjs"
  );
  const { auditChapterText: auditCore } = await import("../docs/vendor/core/auditor.mjs");
  const { normalizeProseText: normalizeCore } = await import("../docs/vendor/core/normalizer.mjs");
  const ling = compileLinguisticsConfig(
    JSON.parse(fs.readFileSync(path.resolve(rootDir, "docs/vendor/configs/zh-linguistics.json"), "utf8"))
  );
  const genres = compileGenresConfig(
    JSON.parse(fs.readFileSync(path.resolve(rootDir, "docs/vendor/configs/genres.json"), "utf8"))
  );
  const presets = JSON.parse(
    fs.readFileSync(path.resolve(rootDir, "docs/vendor/configs/presets.json"), "utf8")
  );
  const severity = compileSeverityConfig(
    JSON.parse(fs.readFileSync(path.resolve(rootDir, "docs/vendor/configs/severity.json"), "utf8"))
  );
  const samples = JSON.parse(
    fs.readFileSync(path.resolve(rootDir, "docs/samples.json"), "utf8")
  );

  for (const preset of samples.auditPresets) {
    const res = auditCore(preset.text, {
      genre: preset.genre,
      skipLengthGate: true,
      characterNames: preset.characters.split(/[,，\s]+/u).filter(Boolean),
      ledger: preset.protagonist ? { protagonist: { name: preset.protagonist } } : undefined,
      linguisticsConfig: ling,
      genresConfig: genres,
      presetsConfig: presets,
      severityConfig: severity,
    });
    assert.ok(res.surgeryTargets.length > 0, `expected findings for preset ${preset.id}`);
  }

  const norm = normalizeCore(samples.auditPresets[1].text, {
    lingConfig: ling,
    stripMarkdownEmphasis: true,
  });
  assert.equal(norm.changed, true);
});

// 四个扩展题材包规则回归：悬疑、都市、科幻、轻小说各自准确命中题材套路
test("expanded genre packs catch mystery, urban, scifi, and light-fantasy tropes cleanly", () => {
  const s = fixtures.expandedGenrePackSamples;
  const mys = auditChapterText(s.mysteryBad, { genre: "mystery-thriller", skipLengthGate: true });
  assert.ok(mys.violations.some((v) => v.code === "FORBIDDEN_AI_CLICHE" && v.hits.some((h) => h.id === "cliche_mystery_trope")));
  assert.ok(mys.violations.some((v) => v.code === "REGISTER_COLLISION" && v.hits.some((h) => h.id === "reg_omniscient_spoiler_tell")));

  const urb = auditChapterText(s.urbanBad, { genre: "urban-realism", skipLengthGate: true });
  const urbCli = urb.violations.find((v) => v.code === "FORBIDDEN_AI_CLICHE");
  assert.ok(urbCli && urbCli.hits.some((h) => h.id === "cliche_urban_trope") && urbCli.hits.some((h) => h.id === "cliche_urban_reaction"));

  const sci = auditChapterText(s.scifiBad, { genre: "scifi-wasteland", skipLengthGate: true });
  assert.ok(sci.violations.some((v) => v.code === "FORBIDDEN_AI_CLICHE" && v.hits.some((h) => h.id === "cliche_scifi_lecture")));

  const lgt = auditChapterText(s.lightBad, { genre: "light-fantasy", skipLengthGate: true });
  assert.ok(lgt.violations.some((v) => v.code === "FORBIDDEN_AI_CLICHE" && v.hits.some((h) => h.id === "cliche_light_system_bloat")));
});

// 盲读包平衡洗牌：多对样本下 X=A 与 X=B 严格各占一半且同一 seed 可复现
test("buildBlindPack balances X/Y side assignments across multiple pairs reproducibly", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "inkbone-bal-"));
  try {
    const dirA = path.join(tmp, "a");
    const dirB = path.join(tmp, "b");
    fs.mkdirSync(dirA);
    fs.mkdirSync(dirB);
    const aFiles = [];
    const bFiles = [];
    for (let i = 1; i <= 4; i += 1) {
      const af = path.join(dirA, `0${i}-s.md`);
      const bf = path.join(dirB, `0${i}-s.md`);
      fs.writeFileSync(af, fixtures.evalVersionA);
      fs.writeFileSync(bf, fixtures.evalVersionB);
      aFiles.push(af);
      bFiles.push(bf);
    }
    const p1 = buildBlindPack(aFiles, bFiles, { seed: 20261118 });
    const p2 = buildBlindPack(aFiles, bFiles, { seed: 20261118 });
    assert.deepEqual(
      p1.pairs.map((p) => p.X),
      p2.pairs.map((p) => p.X)
    );
    assert.equal(p1.pairs.filter((p) => p.X === "A").length, 2);
    assert.equal(p1.pairs.filter((p) => p.X === "B").length, 2);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// 未配置题材的多文件目录如果混放不同题材，doctor 给出 mixedGenreFiles 提示；同题材不误报
test("diagnoseProject warns on mixed-genre unconfigured folders without breaking explicit runs", async () => {
  const { formatDoctorMarkdown } = await import("../src/index.mjs");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "inkbone-mix-"));
  try {
    fs.writeFileSync(path.join(tmp, "ch01.md"), fixtures.mixedDoctorFolderSample.xianxiaText);
    fs.writeFileSync(path.join(tmp, "ch02.md"), fixtures.mixedDoctorFolderSample.urbanText);
    const diag = diagnoseProject([tmp], { skipLengthGate: true });
    assert.ok(Array.isArray(diag.genre.mixedGenreFiles));
    assert.equal(diag.genre.mixedGenreFiles.length, 1);
    const mdEn = formatDoctorMarkdown(diag, { lang: "en" });
    assert.ok(mdEn.includes("Mixed genres detected in unconfigured folder"));
    const mdZh = formatDoctorMarkdown(diag, { lang: "zh" });
    assert.ok(mdZh.includes("ch02.md -> urban-realism"));
    assert.ok(diag.hints.some((h) => h.code === "SUBJECT_CONTINUITY_DISABLED"));

    const explicitDiag = diagnoseProject([tmp], { genre: "classical-xianxia", skipLengthGate: true });
    assert.deepEqual(explicitDiag.genre.mixedGenreFiles, []);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// CLI 版本与分层帮助检查：--version 与 package.json 严格一致，--help 与 --help-all 正常退出
test("CLI --version matches package.json and layered --help / --help-all work", () => {
  const pkg = JSON.parse(fs.readFileSync(path.resolve(rootDir, "package.json"), "utf8"));
  const binPath = path.resolve(rootDir, "bin/inkbone.mjs");
  const verOut = execFileSync(process.execPath, [binPath, "--version"], { encoding: "utf8" }).trim();
  assert.equal(verOut, `inkbone ${pkg.version}`);

  const helpOut = execFileSync(process.execPath, [binPath, "--help"], { encoding: "utf8" });
  assert.ok(helpOut.includes(`InkBone CLI ${pkg.version}`));
  assert.ok(helpOut.includes("inkbone mcp"));
  assert.ok(helpOut.includes("--help-all"));

  const helpAllOut = execFileSync(process.execPath, [binPath, "--help-all"], { encoding: "utf8" });
  assert.ok(helpAllOut.includes("inkbone eval-pack"));
  assert.ok(helpAllOut.includes("inkbone rule-stats"));
});

// 台账健康体检：准确捕获重复章号、章号断档、空摘要、揭露章倒置、空角色名单与逾期伏笔
test("validateLedger catches duplicates, gaps, invalid revealChapter, empty names, and overdue foreshadowing", () => {
  const report = validateLedger(fixtures.v13Features.ledgerHealthBad, { overdueThreshold: 20 });
  assert.equal(report.pass, false);
  const codes = new Set(report.issues.map((i) => i.code));
  assert.ok(codes.has("DUPLICATE_CHAPTER_NUMBER"));
  assert.ok(codes.has("CHAPTER_NUMBER_GAP"));
  assert.ok(codes.has("EMPTY_CHAPTER_SUMMARY"));
  assert.ok(codes.has("INVALID_REVEAL_CHAPTER"));
  assert.ok(codes.has("EMPTY_CHARACTER_NAMES"));
  assert.ok(codes.has("OVERDUE_FORESHADOWING"));
  assert.ok(codes.has("MISSING_PROTAGONIST"));
  assert.equal(report.stats.activeForeshadowingCount, 1);
  assert.equal(report.stats.overdueForeshadowingCount, 1);
});

// 写后结算与 packet 瘦身：无损合并摘要/角色快照/伏笔跃迁，packet 过滤已收伏笔并按出场角色裁剪快照
test("applyChapterSettlement merges chapter patch cleanly and compileBoundaryPacket prunes snapshots and closed foreshadowing", () => {
  const base = fixtures.v13Features.settlementBaseLedger;
  const patch = fixtures.v13Features.settlementPatch;
  const { ledger: updated, diff } = applyChapterSettlement(base, patch);

  assert.equal(diff.chapterUpdated, true);
  assert.ok(diff.addedCharacters.includes(fixtures.v13Features.minedCharB));
  assert.ok(diff.resolvedForeshadowing.includes("fs_token"));
  assert.ok(diff.addedForeshadowing.includes("fs_seal"));
  assert.equal(updated.characterSnapshots[fixtures.v13Features.minedCharA].lastUpdatedChapter, 4);

  // 未修改原始对象
  assert.equal(base.foreshadowing[0].status, "planted");

  // packet 按 activeCharacters 裁剪快照、过滤已回收伏笔、并在到期章给出 dueForeshadowing
  const pktBeforeSettle = compileBoundaryPacket(base, 4, "");
  assert.equal(pktBeforeSettle.foreshadowing.length, 1);
  assert.equal(pktBeforeSettle.foreshadowing[0].id, "fs_token");
  assert.equal(pktBeforeSettle.dueForeshadowing.length, 1);
  assert.equal(pktBeforeSettle.omittedCharacterSnapshotsCount, 1);

  const pktAfterSettle = compileBoundaryPacket(updated, 4, "");
  assert.equal(pktAfterSettle.foreshadowing.length, 1);
  assert.equal(pktAfterSettle.foreshadowing[0].id, "fs_seal");
});

// 存量书稿候选人名挖掘：import-ledger --auto-characters 自动填充 characterNames 并激活主语歧义检测
test("extractCandidateCharacters and import-ledger autoPopulateCharacters activate subject continuity checks", () => {
  const { characterMiningChapters, minedCharA, minedCharB } = fixtures.v13Features;
  const candidates = extractCandidateCharacters(characterMiningChapters);
  const candNames = candidates.map((c) => c.name);
  assert.ok(candNames.includes(minedCharA));
  assert.ok(candNames.includes(minedCharB));

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "inkbone-chars-"));
  try {
    const ch1Path = path.join(tmp, "ch01.md");
    const ch2Path = path.join(tmp, "ch02.md");
    fs.writeFileSync(ch1Path, characterMiningChapters[0]);
    fs.writeFileSync(ch2Path, characterMiningChapters[1]);
    const imported = importLedgerFromChapters([tmp], { autoPopulateCharacters: true });
    assert.ok(imported.ledger.characterNames.includes(minedCharA));
    assert.ok(imported.ledger.characterNames.includes(minedCharB));
    assert.ok(imported.stats.autoPopulatedCharacters.length >= 2);

    const audited = auditChapterText(characterMiningChapters[0], {
      skipLengthGate: true,
      ledger: imported.ledger,
    });
    assert.ok(audited.violations.some((v) => v.code === "SUBJECT_AMBIGUITY"));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// 6 个垂直题材包 v1.3 补厚规则正反例回归：坏例必中，干净正例零误报
test("v1.3 expanded 6 genre packs catch new tropes and fillers with zero false positives on clean prose", () => {
  const s = fixtures.v13Features.sixGenreV13;
  const cases = [
    ["wuxia-jianghu", s.wuxiaBad, s.wuxiaClean, ["REGISTER_COLLISION", "FORBIDDEN_AI_CLICHE", "NARRATIVE_FILLER"]],
    ["mystery-thriller", s.mysteryBad, s.mysteryClean, ["REGISTER_COLLISION", "FORBIDDEN_AI_CLICHE", "NARRATIVE_FILLER"]],
    ["urban-realism", s.urbanBad, s.urbanClean, ["REGISTER_COLLISION", "FORBIDDEN_AI_CLICHE", "NARRATIVE_FILLER"]],
    ["scifi-wasteland", s.scifiBad, s.scifiClean, ["FORBIDDEN_AI_CLICHE", "NARRATIVE_FILLER"]],
    ["light-fantasy", s.lightBad, s.lightClean, ["REGISTER_COLLISION", "FORBIDDEN_AI_CLICHE", "NARRATIVE_FILLER"]],
    ["romance-emotional", s.romanceBad, s.romanceClean, ["REGISTER_COLLISION", "NARRATIVE_FILLER"]],
  ];
  for (const [genre, badText, cleanText, expectedCodes] of cases) {
    const badRes = auditChapterText(badText, { genre, skipLengthGate: true });
    for (const code of expectedCodes) {
      assert.ok(
        badRes.violations.some((v) => v.code === code),
        `expected ${code} for ${genre} bad sample`
      );
    }
    const cleanRes = auditChapterText(cleanText, { genre, skipLengthGate: true });
    const badHitOnClean = cleanRes.violations.filter((v) =>
      ["REGISTER_COLLISION", "FORBIDDEN_AI_CLICHE", "NARRATIVE_FILLER"].includes(v.code)
    );
    assert.equal(
      badHitOnClean.length,
      0,
      `unexpected false positive on clean ${genre}: ${JSON.stringify(badHitOnClean)}`
    );
  }
});

// 双语格式化与精准改稿 Prompt 生成：输出包含行号与原句切片，且支持 zh / en 双语
test("formatAuditMarkdown and buildTargetedRewritePrompt render structured output in zh and en", () => {
  const report = auditChapterText(fixtures.aiPurpleSample, {
    genre: "classical-xianxia",
    skipLengthGate: true,
  });
  const mdZh = formatAuditMarkdown(report, { lang: "zh", fileName: "ch01.md" });
  const mdEn = formatAuditMarkdown(report, { lang: "en", fileName: "ch01.md" });
  assert.ok(mdZh.includes("ch01.md"));
  assert.ok(mdZh.includes("FORBIDDEN_AI_CLICHE"));
  assert.ok(mdEn.includes("# InkBone Audit Report"));

  const built = buildTargetedRewritePrompt(fixtures.aiPurpleSample, report, { lang: "zh" });
  assert.equal(built.hasIssues, true);
  assert.ok(built.issueCount > 0);
  assert.ok(built.prompt.includes("L1:"));
});

// 零依赖 MCP Server 协议与工具调用单元测试（内存分发 + 真实 stdio NDJSON 管道）
test("zero-dependency MCP server handles initialize, tools/list, tools/call, and stdio framing", () => {
  const initReply = handleMcpMessage({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2024-11-05" },
  });
  assert.equal(initReply.result.serverInfo.name, "inkbone");

  const listReply = handleMcpMessage({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  assert.equal(listReply.result.tools.length, MCP_TOOLS.length);
  assert.ok(listReply.result.tools.some((t) => t.name === "inkbone_audit"));
  assert.ok(listReply.result.tools.some((t) => t.name === "inkbone_settle"));

  const auditReply = handleMcpMessage({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: {
      name: "inkbone_audit",
      arguments: {
        text: fixtures.aiPurpleSample,
        genre: "classical-xianxia",
        skipLength: true,
        format: "md",
        lang: "zh",
      },
    },
  });
  assert.equal(auditReply.result.isError, undefined);
  assert.ok(auditReply.result.content[0].text.includes("FORBIDDEN_AI_CLICHE"));

  const ledgerReply = handleMcpMessage({
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: {
      name: "inkbone_check_ledger",
      arguments: { ledger: fixtures.v13Features.ledgerHealthBad },
    },
  });
  assert.equal(ledgerReply.result.structuredContent.pass, false);

  const missingMethod = handleMcpMessage({ jsonrpc: "2.0", id: 5, method: "unknown/method" });
  assert.equal(missingMethod.error.code, -32601);

  // 真实 stdio 管道端到端握手与工具列表验证
  const binPath = path.resolve(rootDir, "bin/inkbone.mjs");
  const ndjsonInput = [
    JSON.stringify({ jsonrpc: "2.0", id: 10, method: "initialize", params: {} }),
    JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    JSON.stringify({ jsonrpc: "2.0", id: 11, method: "ping" }),
  ].join("\n") + "\n";
  const stdout = execFileSync(process.execPath, [binPath, "mcp"], {
    input: ndjsonInput,
    encoding: "utf8",
  });
  const replies = stdout
    .trim()
    .split(/\r?\n/u)
    .map((line) => JSON.parse(line));
  assert.equal(replies.length, 2);
  assert.equal(replies[0].id, 10);
  assert.equal(replies[1].id, 11);
});
