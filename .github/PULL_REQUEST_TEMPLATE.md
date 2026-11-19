## 改动说明

<!-- 简述本次改动解决的问题、涉及的规则层级或模块 -->

## 提交前自检清单

- [ ] **零第三方依赖**：未在 `package.json` 引入外部 `dependencies`
- [ ] **代码零汉字字面量**：JS 源码与测试文件中仅在注释使用中文，正则/词表/提示词放 `configs/*.json` 或 `tests/fixtures.json`
- [ ] **浏览器核纯净性**：`src/core/*.mjs` 未引入 `node:*` 或 `config-loader.mjs`
- [ ] 已运行 `npm run build:skill` 与 `npm run check:skill` 通过
- [ ] 已运行 `npm run build:docs` 与 `npm run check:docs` 通过
- [ ] 已运行 `npm test` 全部通过（且为新规则/新功能补充正反例测试）
- [ ] 未在提交中包含任何受版权保护的人类小说正文
