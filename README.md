# VPrint

VPrint 是 XCPC 队伍做 VP 时用的电子打印服务。比赛主机把当前文件打印到队内比赛，队友用自己的设备按行号阅读这份副本。[设计](DESIGN.md) · [行为规格与验收场景](SPEC.md)

## 本地运行

使用 Node.js 22 和 pnpm 11。在仓库根目录运行：

```sh
pnpm install --frozen-lockfile
pnpm run build
pnpm exec wrangler d1 migrations apply DB --local
pnpm run dev
```

启动 Wrangler 前，在本机的 `.dev.vars` 中设置 `BETTER_AUTH_URL=http://127.0.0.1:8787` 和 `BETTER_AUTH_SECRET`。后者使用本地独立生成的随机值，例如用 `openssl rand -hex 32` 生成。浏览器打开 Wrangler 显示的地址即可使用本地数据库。

## 在比赛目录打印

运行 `vprint login` 授权本机，然后在训练目录运行 `vprint use` 选择队伍和比赛。在该目录或其子目录执行 `vprint A.cpp`，终端会显示当前比赛、当前时间、文件名、字节数和上次修改时间。看到 `确认打印？ [Y/n]` 后，按回车、`y` 或 `Y` 打印，按 `n` 或 `N` 取消。

每次只接受一个文件。脚本使用 `vprint -y A.cpp` 或 `vprint A.cpp --yes`，同样会显示打印信息。

## 配置公开站点

公开来源是 `https://vprint.401.moe`。Web 页面、CLI、邀请链接和设备码授权均使用这个来源。

- **GitHub 网页登录**　在 GitHub 组织的 Developer settings → OAuth Apps 创建 OAuth App。Homepage URL 填 `https://vprint.401.moe`，Authorization callback URL 填 `https://vprint.401.moe/api/auth/callback/github`。GitHub 的 Enable Device Flow 保持关闭，CLI 的设备码由 VPrint 处理。把 Client ID 配在 Worker 的 `GITHUB_CLIENT_ID`，Client Secret 存入 Worker Secret `GITHUB_CLIENT_SECRET`。[GitHub 配置说明](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app)
- **邮箱验证码**　发件地址为 `noreply@vprint.401.moe`。Worker 通过 `EMAIL` 绑定发信，Cloudflare Email Sending 管理该子域的发信验证记录。[Cloudflare 发信域说明](https://developers.cloudflare.com/email-service/configuration/subdomains/)
- **站点会话**　在公开 Worker 上单独设置 `BETTER_AUTH_SECRET`。更换这个值会影响既有的认证凭证，应在计划轮换时操作。

## PR 预览

Cloudflare Workers Builds 对功能分支运行 `npx wrangler preview`。从 PR 的 Cloudflare 检查打开预览链接，使用测试邮箱和密码注册。预览域名为 `<分支标识>.vprint-pr.401.moe`，设备授权和队伍邀请链接留在当前预览。GitHub 登录和验证码发信仅在生产站配置。

各 PR 共用测试数据库 `vprint-pr-previews`，每个预览有自己的通知 Durable Object 命名空间。会话密钥通过 `wrangler preview base-config secret put BETTER_AUTH_SECRET` 单独设置。新增数据库迁移时，先在预览库运行：

```sh
pnpm exec wrangler d1 migrations apply PREVIEW_DB --remote --config wrangler.preview-migrations.jsonc
```
