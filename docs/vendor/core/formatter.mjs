// 纯内存报告格式化与精准改稿 Prompt 生成模块（零文件系统依赖，供 Node CLI、MCP 与浏览器共用）

// 解析指定语言的本地化词典（默认回退至配置 defaultLang 或 zh）
export function resolveLocaleBundle(messagesConfig, lang = null) {
  const locales = messagesConfig?.locales || {};
  const fallbackKey = messagesConfig?.defaultLang || "zh";
  const key = lang && locales[lang] ? lang : locales[fallbackKey] ? fallbackKey : Object.keys(locales)[0];
  return {
    lang: key || "en",
    bundle: locales[key] || {},
  };
}

// 模板占位符简单替换（例如 {files}、{genre}）
function interpolate(template, vars = {}) {
  let out = String(template || "");
  for (const [k, v] of Object.entries(vars)) {
    out = out.split(`{${k}}`).join(String(v ?? ""));
  }
  return out;
}

// 格式化单章审计报告为人类可读 Markdown（支持中英双语）
export function formatAuditMarkdown(report, options = {}) {
  const { bundle } = resolveLocaleBundle(options.messagesConfig, options.lang);
  const s = bundle.reportStrings || {};
  const vLabels = bundle.violationLabels || {};
  const remedies = bundle.remedies || {};
  const sevLabels = bundle.severityLabels || {};
  const mLabels = bundle.metricLabels || {};

  const statusText = report.pass ? s.statusPass || "PASS" : s.statusFail || "FAIL";
  const sum = report.summary || { error: 0, warning: 0, info: 0 };
  const m = report.metrics || {};

  const lines = [
    s.auditTitle || "# InkBone Audit Report",
    "",
    `- **${s.genreLabel || "Genre"}**: \`${report.genre || "general-clean"}\` | **${s.presetLabel || "Preset"}**: \`${report.preset || "default"}\` | **Status**: ${statusText} (${report.mode || "default"})`,
    `- **${s.totalsLabel || "Summary"}**: ${s.hardErrors || "Errors"}: ${sum.error} | ${s.warnings || "Warnings"}: ${sum.warning} | ${s.infos || "Info"}: ${sum.info}`,
  ];

  if (options.fileName) {
    lines.splice(2, 0, `- **${s.tableFile || "File"}**: \`${options.fileName}\``);
  }

  // 关键语言学指标概览
  lines.push(
    "",
    s.sectionMetrics || "## Metrics",
    `- ${mLabels.totalHan || "Han"}: ${m.totalHan ?? 0} | ${mLabels.paragraphCount || "Paragraphs"}: ${m.paragraphCount ?? 0} | ${mLabels.sentLenMean || "Mean Sent"}: ${m.sentLenMean ?? 0} | ${mLabels.sentLenCV || "CV"}: ${m.sentLenCV ?? 0} | ${mLabels.mattr50 || "MATTR-50"}: ${m.mattr50 ?? 0} | ${mLabels.dePer100Han || "De/100"}: ${m.dePer100Han ?? 0}`
  );

  const targets = report.surgeryTargets || [];
  const actionableViolations = (report.violations || []).filter(
    (v) => v.severity !== "info" || options.includeInfo
  );

  if (targets.length === 0 && actionableViolations.length === 0) {
    lines.push("", s.noIssues || "No issues detected.");
    return lines.join("\n");
  }

  if (targets.length > 0) {
    lines.push("", s.sectionTargets || "## Line Targets");
    for (const target of targets) {
      const desc = target.issues
        .map((i) => {
          const badge = i.level === "blocking" ? `${s.blockTag || "[BLOCK]"} ` : "";
          return `${badge}\`${i.tag}\` (${i.detail})`;
        })
        .join("; ");
      lines.push(`- **${s.linePrefix || "L"}${target.line}${s.lineSuffix || ""}**: ${desc}`);
    }
  }

  if (actionableViolations.length > 0) {
    lines.push("", s.sectionViolations || "## Chapter Findings");
    for (const v of actionableViolations) {
      const sevTag = sevLabels[v.severity] || v.severity;
      const title = vLabels[v.code] || v.code;
      const remedy = remedies[v.code] || v.remedy || "";
      const suffix = remedy ? ` — ${s.remedyPrefix || ""}${remedy}` : "";
      lines.push(`- **[${sevTag}] ${title}** (\`${v.code}\`)${suffix}`);
    }
  }

  return lines.join("\n");
}

// 格式化整书四维体检报告为 Markdown（支持中英双语与实用引导提示）
export function formatDoctorMarkdown(diagnosis, options = {}) {
  const { bundle } = resolveLocaleBundle(options.messagesConfig, options.lang);
  const s = bundle.reportStrings || {};
  const vLabels = bundle.violationLabels || {};
  const remedies = bundle.remedies || {};
  const hintMap = bundle.hintMessages || {};

  const lines = [
    s.doctorTitle || "# InkBone Doctor Report",
    "",
    `- **${s.genreLabel || "Genre Pack"}**: \`${diagnosis.genre.id}\` (${diagnosis.genre.title}) [${diagnosis.genre.source}]`,
    `- **${s.presetLabel || "Preset"}**: \`${diagnosis.genre.defaultPreset}\``,
    `- **${s.formulaLabel || "Register Formula"}**: ${diagnosis.genre.registerFormula}`,
  ];

  if (diagnosis.genre.mixedGenreFiles && diagnosis.genre.mixedGenreFiles.length > 0) {
    const filesStr = diagnosis.genre.mixedGenreFiles
      .map((m) => `${m.file} -> ${m.inferredGenre}`)
      .join(", ");
    const mixedMsg = hintMap.MIXED_GENRE_DETECTED
      ? interpolate(hintMap.MIXED_GENRE_DETECTED, { files: filesStr })
      : `Warning: Mixed genres detected in unconfigured folder (${filesStr}); pass \`--genre\` or add \`novel.json\` per book.`;
    lines.push(`- ${mixedMsg}`);
  }

  for (const hint of diagnosis.hints || []) {
    const text = hintMap[hint.code] || hint.detail || hint.code;
    lines.push(`- ${text}`);
  }

  if (diagnosis.incremental?.active) {
    const incTpl =
      bundle.incrementalNote ||
      "Incremental mode ({mode}): scanned {scanned} of {total} chapter(s).";
    lines.push(
      `- ${interpolate(incTpl, {
        mode: diagnosis.incremental.mode,
        scanned: diagnosis.incremental.scannedCount,
        total: diagnosis.incremental.totalDiscovered,
      })}`
    );
  }

  const t = diagnosis.totals;
  lines.push(
    `- **${s.totalsLabel || "Totals"}**: ${t.chaptersScanned} ${s.chaptersUnit || "chapter(s)"} | ${s.hardErrors || "Hard Errors"}: ${t.hardErrors} | ${s.regClash || "Register Clash"}: ${t.registerCollisions} | ${s.fillers || "Fillers"}: ${t.narrativeFillers} | ${s.cliches || "AI Cliches"}: ${t.aiCliches} | ${s.rhetTics || "Rhet/Tics"}: ${t.rhetoricalPatterns + t.densityTics} | ${s.degeneration || "Degeneration"}: ${t.degenerationErrors} | ${s.metaLeaks || "Meta Leaks"}: ${t.metaLeaks} | ${s.proStreaks || "Pronoun Streaks"}: ${t.pronounStreaks}`,
    "",
    `| ${s.tableFile || "File"} | ${s.tableHan || "Han"} | ${s.tableErrors || "Errors"} | ${s.tableReg || "RegClash"} | ${s.tableFillers || "Fillers"} | ${s.tableCliches || "Cliches"} | ${s.tableRhet || "Rhet/Tics"} | ${s.tablePro || "ProStreak"} |`,
    `| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |`
  );

  for (const ch of diagnosis.chapters) {
    const rhetTics = ch.counts.rhetoricalPatterns + ch.counts.densityTics;
    lines.push(
      `| ${ch.file} | ${ch.totalHan} | ${ch.summary.error} | ${ch.counts.registerCollisions} | ${ch.counts.narrativeFillers} | ${ch.counts.aiCliches} | ${rhetTics} | ${ch.maxPronounHeadStreak} |`
    );
  }

  for (const ch of diagnosis.chapters) {
    if (ch.surgeryTargets.length === 0 && ch.summary.error === 0) continue;
    lines.push("", `## ${ch.file}`);
    for (const v of ch.violations) {
      if (v.severity === "error") {
        const label = vLabels[v.code] ? `${vLabels[v.code]} (${v.code})` : v.code;
        const desc = v.details ? JSON.stringify(v.details) : remedies[v.code] || v.remedy || "";
        lines.push(`- **${s.errorTag || "[ERROR]"} ${label}**: ${desc}`);
      }
    }
    for (const target of ch.surgeryTargets.slice(0, 25)) {
      const desc = target.issues
        .map((i) => {
          const badge = i.level === "blocking" ? `${s.blockTag || "[BLOCK]"} ` : "";
          return `${badge}\`${i.tag}\` (${i.detail})`;
        })
        .join("; ");
      lines.push(`- **${s.linePrefix || "L"}${target.line}${s.lineSuffix || ""}**: ${desc}`);
    }
  }

  return lines.join("\n");
}

// 基于单章审计结果，确定性拼装可直接粘贴至任意大模型聊天框的“精准局部改稿 Prompt”
export function buildTargetedRewritePrompt(chapterText, auditReport, options = {}) {
  const { bundle } = resolveLocaleBundle(options.messagesConfig, options.lang);
  const rp = bundle.rewritePrompt || {};
  const s = bundle.reportStrings || {};
  const vLabels = bundle.violationLabels || {};
  const remedies = bundle.remedies || {};
  const sevLabels = bundle.severityLabels || {};

  const targets = auditReport?.surgeryTargets || [];
  const actionableViolations = (auditReport?.violations || []).filter(
    (v) => v.severity === "error" || v.severity === "warning"
  );

  if (targets.length === 0 && actionableViolations.length === 0) {
    return {
      hasIssues: false,
      issueCount: 0,
      prompt: rp.emptyNotice || "No issues found.",
    };
  }

  const rawLines = String(chapterText || "").split(/\r?\n/u);
  const parts = [rp.header || "Revise only the flagged lines below."];

  const genreLabel = options.genreTitle || auditReport?.genre || "general-clean";
  parts.push("", interpolate(rp.genreLine || "Genre: {genre}", { genre: genreLabel }));
  if (rp.rulesBlock) {
    parts.push("", rp.rulesBlock);
  }

  parts.push("", rp.issuesHeading || "### Flagged Issues");

  let issueCount = 0;
  for (const target of targets) {
    const lineText = (rawLines[target.line - 1] || "").trim();
    const issueDesc = target.issues
      .map((i) => {
        const badge = i.level === "blocking" ? `${s.blockTag || "[BLOCK]"} ` : "";
        return `${badge}${i.tag}: ${i.detail}`;
      })
      .join(" | ");
    parts.push(
      `- ${s.linePrefix || "L"}${target.line}${s.lineSuffix || ""}: ${issueDesc}${lineText ? `  => "${lineText.slice(0, 60)}"` : ""}`
    );
    issueCount += target.issues.length;
  }

  for (const v of actionableViolations) {
    const sev = sevLabels[v.severity] || v.severity;
    const label = vLabels[v.code] || v.code;
    const rem = remedies[v.code] || v.remedy || "";
    parts.push(`- [${sev}] ${label} (${v.code})${rem ? ` — ${rem}` : ""}`);
    issueCount += 1;
  }

  parts.push("", rp.chapterHeading || "### Chapter Text", "```markdown");
  rawLines.forEach((line, idx) => {
    parts.push(`L${idx + 1}: ${line}`);
  });
  parts.push("```");

  return {
    hasIssues: true,
    issueCount,
    prompt: parts.join("\n"),
  };
}
