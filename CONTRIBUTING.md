# 参与贡献

感谢你改进模型评测工作站。Issue 适合报告可复现的问题、讨论功能需求或澄清使用方式；已经明确范围的改动可以直接提交 Pull Request。

## 本地开发

1. Fork 并克隆仓库。
2. 使用 Node.js 20.12 或更高版本。
3. 运行 `npm install` 安装依赖。
4. 运行 `npm run dev` 启动本地工作站。
5. 提交前运行 `npm run check` 和 `npm run build`。

如果需要调用真实模型，请将密钥写入 `.env.local`，或通过页面顶部的“API 设置”保存在本机。不要提交 `.env.local`、`.model-api-settings.json`、真实 API Key、测试账号或包含敏感数据的 Excel 文件。

## Pull Request

- 一次 Pull Request 聚焦一个清晰的问题。
- 说明改动目的、主要行为变化和验证方式。
- 界面改动请附修改前后的截图或录屏。
- 新增供应商协议时，请同时说明请求格式、鉴权方式、错误处理和模型目录读取方式。
- 不要把生成目录、桌面应用包或本地配置提交到仓库。

提交代码即表示你同意按照项目的 MIT License 发布贡献内容。
