// InkBone VS Code / Cursor 扩展入口（零第三方依赖、严格零汉字字面量）
"use strict";

const vscode = require("vscode");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

let corePromise = null;

// 动态加载同仓库的 ESM 核心诊断与导出模块
async function loadCore() {
  if (!corePromise) {
    const diagUrl = pathToFileURL(path.join(__dirname, "diagnostics-core.mjs")).href;
    const inkUrl = pathToFileURL(path.resolve(__dirname, "../../src/index.mjs")).href;
    corePromise = Promise.all([import(diagUrl), import(inkUrl)]).then(([diag, ink]) => ({
      ...diag,
      ...ink,
    }));
  }
  return corePromise;
}

function getSettings() {
  const cfg = vscode.workspace.getConfiguration("inkbone");
  return {
    realtime: cfg.get("realtimeDiagnostics", true),
    genre: cfg.get("genre", "") || undefined,
    variant: cfg.get("variant", "auto"),
    skipLengthGate: cfg.get("skipLengthGate", true),
    defaultPlatform: cfg.get("defaultExportPlatform", "qidian"),
  };
}

function isTargetDocument(doc) {
  if (!doc) return false;
  if (doc.languageId !== "markdown" && doc.languageId !== "plaintext") return false;
  const base = path.basename(doc.fileName || "");
  if (/^(README|CHANGELOG|LICENSE|SKILL\.md)/iu.test(base)) return false;
  return true;
}

function activate(context) {
  const collection = vscode.languages.createDiagnosticCollection("inkbone");
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.command = "inkbone.auditCurrent";
  context.subscriptions.push(collection, statusBar);

  let timer = null;

  async function refreshDocument(doc) {
    if (!isTargetDocument(doc)) {
      statusBar.hide();
      return null;
    }
    const core = await loadCore();
    const settings = getSettings();
    const result = core.buildEditorDiagnostics(doc.getText(), {
      filePath: doc.isUntitled ? null : doc.fileName,
      genre: settings.genre,
      variant: settings.variant,
      skipLengthGate: settings.skipLengthGate,
      lang: "zh",
    });

    const vsDiags = result.diagnostics.map((item) => {
      const range = new vscode.Range(item.line, item.startCol, item.line, item.endCol);
      const severity =
        item.severity === "error"
          ? vscode.DiagnosticSeverity.Error
          : vscode.DiagnosticSeverity.Warning;
      const diag = new vscode.Diagnostic(range, item.message, severity);
      diag.code = item.code;
      diag.source = "inkbone";
      diag._inkboneMeta = item;
      return diag;
    });

    collection.set(doc.uri, vsDiags);
    const errCount = result.report.summary.error || 0;
    const warnCount = result.report.summary.warning || 0;
    const genreLabel = result.report.genre || "general-clean";
    statusBar.text = `InkBone [${genreLabel}]: ${errCount}E / ${warnCount}W`;
    statusBar.show();
    return result;
  }

  function scheduleRefresh(doc) {
    if (!getSettings().realtime) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      refreshDocument(doc).catch(() => {});
    }, 400);
  }

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((doc) => scheduleRefresh(doc)),
    vscode.workspace.onDidChangeTextDocument((evt) => scheduleRefresh(evt.document)),
    vscode.workspace.onDidSaveTextDocument((doc) => {
      refreshDocument(doc).catch(() => {});
    }),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) scheduleRefresh(editor.document);
      else statusBar.hide();
    })
  );

  // 注册行内 Quick Fix：清理残留星号格式，或将书级合法表达一键加入 .inkbone-whitelist
  const codeActionProvider = {
    async provideCodeActions(doc, range, ctx) {
      const core = await loadCore();
      const actions = [];
      for (const diag of ctx.diagnostics || []) {
        if (diag.source !== "inkbone" || !diag._inkboneMeta) continue;
        const proposal = core.computeQuickFixProposal(doc.getText(), diag._inkboneMeta);
        if (!proposal) continue;
        if (proposal.kind === "replace_document") {
          const action = new vscode.CodeAction(proposal.title, vscode.CodeActionKind.QuickFix);
          const edit = new vscode.WorkspaceEdit();
          const lastLine = doc.lineCount - 1;
          const fullRange = new vscode.Range(0, 0, lastLine, doc.lineAt(lastLine).text.length);
          edit.replace(doc.uri, fullRange, proposal.newText);
          action.edit = edit;
          action.diagnostics = [diag];
          actions.push(action);
        } else if (proposal.kind === "append_whitelist" && !doc.isUntitled) {
          const action = new vscode.CodeAction(proposal.title, vscode.CodeActionKind.QuickFix);
          action.command = {
            command: "inkbone._appendWhitelist",
            title: proposal.title,
            arguments: [doc.fileName, proposal.literal],
          };
          action.diagnostics = [diag];
          actions.push(action);
        }
      }
      return actions;
    },
  };

  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      [{ language: "markdown" }, { language: "plaintext" }],
      codeActionProvider,
      { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("inkbone._appendWhitelist", async (fileName, literal) => {
      const wlPath = path.join(path.dirname(fileName), ".inkbone-whitelist");
      fs.appendFileSync(wlPath, `\n${literal}\n`, "utf8");
      const active = vscode.window.activeTextEditor?.document;
      if (active) await refreshDocument(active);
    }),
    vscode.commands.registerCommand("inkbone.auditCurrent", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const res = await refreshDocument(editor.document);
      if (res) {
        vscode.window.showInformationMessage(
          `InkBone audit done: ${res.report.summary.error} error(s), ${res.report.summary.warning} warning(s).`
        );
      }
    }),
    vscode.commands.registerCommand("inkbone.normalizeCurrent", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const core = await loadCore();
      const norm = core.normalizeProseText(editor.document.getText(), {
        stripMarkdownEmphasis: true,
      });
      if (!norm.changed) {
        vscode.window.showInformationMessage("InkBone: chapter formatting is already clean.");
        return;
      }
      const lastLine = editor.document.lineCount - 1;
      const fullRange = new vscode.Range(
        0,
        0,
        lastLine,
        editor.document.lineAt(lastLine).text.length
      );
      await editor.edit((eb) => eb.replace(fullRange, norm.output));
      await refreshDocument(editor.document);
    }),
    vscode.commands.registerCommand("inkbone.copyRewritePrompt", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const res = await refreshDocument(editor.document);
      if (!res) return;
      await vscode.env.clipboard.writeText(res.rewritePrompt.prompt);
      vscode.window.showInformationMessage(
        `InkBone: copied targeted rewrite prompt (${res.rewritePrompt.issueCount} items).`
      );
    }),
    vscode.commands.registerCommand("inkbone.exportChapter", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const core = await loadCore();
      const settings = getSettings();
      const res = core.formatChapterForPlatform(editor.document.getText(), {
        platform: settings.defaultPlatform,
      });
      const outDoc = await vscode.workspace.openTextDocument({
        content: res.output,
        language: "plaintext",
      });
      await vscode.window.showTextDocument(outDoc, vscode.ViewColumn.Beside);
    })
  );

  if (vscode.window.activeTextEditor) {
    scheduleRefresh(vscode.window.activeTextEditor.document);
  }
}

function deactivate() {}

module.exports = { activate, deactivate };
