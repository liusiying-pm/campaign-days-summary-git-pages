# 大促生效日期汇总 · GitHub Pages

这是一个免登录的静态网页，只展示大促日期、地区和配置类型。网页不包含来源 Google 文档中的其他内容。由于免登录访问，GitHub 仓库和 Pages 网站均为公开，任何人都可以查看。

## 网页发布

`.github/workflows/deploy.yml` 会在推送到 `main` 后发布网页，并每天北京时间 10:17 尝试同步日期。GitHub 项目首次创建后，需要在 **Settings → Pages → Build and deployment** 中把来源设为 **GitHub Actions**。

## 自动同步 Google 文档

同步流程只读取来源文档中“**大促生效时间 X 月**”段落里的日期行，并把日期、地区和配置类型提供给网页。没有配置凭据时，网站仍会发布仓库内的日期快照；配置完成后，每日运行会从 Google 文档读取最新数据。

启用自动同步需要：

1. 在 Google Cloud 项目启用 Google Docs API，并创建只读服务账号。
2. 由来源文档所有者或管理员，将服务账号添加为这份文档的查看者。当前连接账号没有更改文档分享权限的能力。
3. 在 GitHub 仓库 **Settings → Secrets and variables → Actions** 新建 Repository secret，名称为 `GOOGLE_SERVICE_ACCOUNT_KEY_JSON`，值为服务账号 JSON 密钥的完整内容。

服务账号只需要 Google Docs 的只读访问。同步时，GitHub Actions Runner 会读取整份来源文档，再只提取日期段；不会发布或复制其他段落。请仅在组织允许的情况下创建并使用服务账号密钥，切勿将密钥放进仓库文件。

## 本地文件

- 网页：`index.html`
- 样式：`assets/styles.css`
- 页面逻辑：`assets/app.js`
- 日期快照：`data/campaign-dates.json`
- Google 文档同步脚本：`scripts/sync-google-doc.mjs`
