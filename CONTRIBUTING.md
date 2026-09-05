# 贡献指南 / Contributing

感谢关注「合租账本 HeZu」!欢迎任何形式的贡献:Issue 反馈、功能建议、文档改进、代码 PR。

## 项目原则

1. **零依赖、零构建**:核心就是一个 `index.html`,用浏览器直接打开即可运行。请勿引入运行时依赖或构建步骤
2. **数据不出本地**:无后端、无追踪;新增功能不得向任何服务器发送数据
3. **安全底线**:一切外部数据入口(导入/分享链接/历史/存储)必须经过 `sanitizeState` 消毒;任何用户输入渲染必须经过 `esc()` 转义
4. **双语同步**:所有 UI 文案走 `I18N` 字典,改动需同时维护 zh 与 en

## 开发流程

```bash
# 运行测试(提交前必须全部通过)
node test/test.js

# 重新生成 PWA 图标(仅当 icons 相关改动)
node tools/gen-icons.js
```

- 核心计算逻辑(分摊/结算/消毒/编解码)放在 `index.html` 内联脚本的 **渲染标记之前**,保证 `test/test.js` 可以脱离 DOM 测试
- 新功能请同步在 `test/test.js` 补充断言
- 每个版本发布时:更新 `APP_VERSION` 常量、`sw.js` 的 `CACHE` 版本、README

## 提交规范

- commit message 用中文简述 + 类型前缀:`feat:` / `fix:` / `docs:` / `test:` / `chore:`
- 一个 PR 聚焦一件事
