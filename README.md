# VPrint

VPrint 是 XCPC 队伍做 VP 时用的电子打印服务。比赛主机把当前文件打印到队内比赛，队友用自己的设备按行号阅读这份副本。[设计](DESIGN.md) · [行为规格与验收场景](SPEC.md)

## 本地运行

使用 Node.js 22 和 pnpm 11。在仓库根目录运行：

```sh
pnpm install --frozen-lockfile
pnpm run build
pnpm exec wrangler d1 migrations apply DB --local
pnpm exec wrangler dev
```

启动 Wrangler 前，在本机的 `.dev.vars` 中设置 `BETTER_AUTH_URL=http://127.0.0.1:8787` 和 `BETTER_AUTH_SECRET`。后者使用本地独立生成的随机值，例如用 `openssl rand -hex 32` 生成。浏览器打开 Wrangler 显示的地址即可使用本地数据库。

## 配置公开站点

公开来源是 `https://vprint.401.moe`。Web 页面、CLI、邀请链接和设备码授权均使用这个来源。

- **GitHub 网页登录**　在 GitHub 组织的 Developer settings → OAuth Apps 创建 OAuth App。Homepage URL 填 `https://vprint.401.moe`，Authorization callback URL 填 `https://vprint.401.moe/api/auth/callback/github`。GitHub 的 Enable Device Flow 保持关闭，CLI 的设备码由 VPrint 处理。把 Client ID 配在 Worker 的 `GITHUB_CLIENT_ID`，Client Secret 存入 Worker Secret `GITHUB_CLIENT_SECRET`。[GitHub 配置说明](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app)
- **邮箱验证码**　发件地址为 `noreply@vprint.401.moe`。Worker 通过 `EMAIL` 绑定发信，Cloudflare Email Sending 管理该子域的发信验证记录。[Cloudflare 发信域说明](https://developers.cloudflare.com/email-service/configuration/subdomains/)
- **站点会话**　在公开 Worker 上单独设置 `BETTER_AUTH_SECRET`。更换这个值会影响既有的认证凭证，应在计划轮换时操作。
