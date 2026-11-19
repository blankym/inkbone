#!/usr/bin/env node
// 基于完全原创公开样本运行可复现的基线 vs InkBone 修订对比，生成 benchmarks/public-report.md
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { auditChapterText } from "../src/index.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");
const pairsPath = path.resolve(rootDir, "benchmarks/eval-set/public-pairs.json");
const outPath = path.resolve(rootDir, "benchmarks/public-report.md");

function summarizeAudit(report) {
  const targetHits = (report.surgeryTargets || []).reduce(
    (acc, t) => acc + (t.issues ? t.issues.length : 0),
    0
  );
  return {
    pass: report.pass,
    errors: report.summary.error,
    warnings: report.summary.warning,
    targetHits,
    han: report.metrics.totalHan,
  };
}

export function generatePublicBenchmarkReport() {
  const data = JSON.parse(fs.readFileSync(pairsPath, "utf8"));
  const rows = [];

  for (const pair of data.pairs || []) {
    const opts = {
      genre: pair.genre,
      skipLengthGate: true,
      characterNames: pair.characterNames || [],
      ledger: pair.protagonist ? { protagonist: { name: pair.protagonist } } : undefined,
    };
    const base = summarizeAudit(auditChapterText(pair.aiBaseline, opts));
    const rev = summarizeAudit(auditChapterText(pair.inkboneRevised, opts));
    rows.push({
      seedId: pair.seedId,
      title: pair.title,
      genre: pair.genre,
      base,
      rev,
    });
  }

  const totalBaseErrors = rows.reduce((a, r) => a + r.base.errors, 0);
  const totalRevErrors = rows.reduce((a, r) => a + r.rev.errors, 0);
  const totalBaseWarnings = rows.reduce((a, r) => a + r.base.warnings, 0);
  const totalRevWarnings = rows.reduce((a, r) => a + r.rev.warnings, 0);
  const totalBaseHits = rows.reduce((a, r) => a + r.base.targetHits, 0);
  const totalRevHits = rows.reduce((a, r) => a + r.rev.targetHits, 0);

  const lines = [
    "# InkBone Public Deterministic Evaluation Report",
    "",
    "Reproducible comparison on 4 original open-seed pairs (`benchmarks/eval-set/public-pairs.json`, zero copyrighted prose). Run `node scripts/run-public-eval.mjs` to regenerate.",
    "",
    "| Seed | Genre | Baseline Errors / Warnings / Line Hits | InkBone Revised Errors / Warnings / Line Hits |",
    "| :--- | :--- | :---: | :---: |",
    ...rows.map(
      (r) =>
        `| ${r.title} (\`${r.seedId}\`) | \`${r.genre}\` | ${r.base.errors} / ${r.base.warnings} / ${r.base.targetHits} | ${r.rev.errors} / ${r.rev.warnings} / ${r.rev.targetHits} |`
    ),
    `| **Total (4 genres)** | — | **${totalBaseErrors} / ${totalBaseWarnings} / ${totalBaseHits}** | **${totalRevErrors} / ${totalRevWarnings} / ${totalRevHits}** |`,
    "",
  ];

  const markdown = lines.join("\n");
  fs.writeFileSync(outPath, markdown, "utf8");
  return {
    outPath,
    rows,
    totals: {
      baseErrors: totalBaseErrors,
      revErrors: totalRevErrors,
      baseWarnings: totalBaseWarnings,
      revWarnings: totalRevWarnings,
      baseHits: totalBaseHits,
      revHits: totalRevHits,
    },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const res = generatePublicBenchmarkReport();
  console.log(JSON.stringify(res, null, 2));
}
