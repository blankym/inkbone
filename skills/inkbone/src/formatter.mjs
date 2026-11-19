// Node 端报告格式化与精准改稿 Prompt 生成入口：自动加载本地双语文案配置
import { loadMessagesConfig } from "./config-loader.mjs";
import {
  resolveLocaleBundle,
  formatAuditMarkdown as formatAuditMarkdownCore,
  formatDoctorMarkdown as formatDoctorMarkdownCore,
  buildTargetedRewritePrompt as buildTargetedRewritePromptCore,
} from "./core/formatter.mjs";

export { resolveLocaleBundle };

// 将单章审计报告格式化为双语 Markdown
export function formatAuditMarkdown(report, options = {}) {
  return formatAuditMarkdownCore(report, {
    ...options,
    messagesConfig: options.messagesConfig || loadMessagesConfig(options.messagesPath),
  });
}

// 将整书四维体检报告格式化为双语 Markdown
export function formatDoctorMarkdown(diagnosis, options = {}) {
  return formatDoctorMarkdownCore(diagnosis, {
    ...options,
    messagesConfig: options.messagesConfig || loadMessagesConfig(options.messagesPath),
  });
}

// 生成可直接贴入网页大模型聊天框的精准局部改稿 Prompt
export function buildTargetedRewritePrompt(chapterText, auditReport, options = {}) {
  return buildTargetedRewritePromptCore(chapterText, auditReport, {
    ...options,
    messagesConfig: options.messagesConfig || loadMessagesConfig(options.messagesPath),
  });
}
