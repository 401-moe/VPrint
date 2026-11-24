# VPrint 产品设计

## 使用场景

一支 XCPC 队伍在做 VP。坐在比赛主机前的队员想请队友一起检查代码，同时继续用主机做题。队员通过 `vprint login` 登录，从终端发起打印。队友用自己的设备打开 Web，找到本队这场比赛的打印件，阅读代码。

## 产品边界

- 产品名为 VPrint，命令行名为 `vprint`。
- VPrint 服务于队伍日常 VP 训练。正式赛事的组织与管理在产品范围之外。
- 队伍创建比赛。「比赛」就是队内用来存放打印件的文件夹，队伍自己决定何时创建、往哪个文件夹打印。
- 用户从命令行发起打印后，VPrint 自动把内容上传到 Web，供同队成员访问。

## 账号与 CLI 授权

VPrint 自建账号体系，同时提供 GitHub 登录。队伍成员身份和队长权限归属于 VPrint 用户。浏览器通过站点会话访问 Web，比赛主机通过 Device Code 流程取得 VPrint API 令牌。

### 建议采用的认证方案

- Web 提供邮箱和密码、邮箱一次性验证码、GitHub 三种登录方式。密码登录启用 Better Auth 的 `emailAndPassword.enabled`。登录方式共用一个 VPrint 用户 ID，队伍和打印历史随该用户保存。[邮箱和密码](https://better-auth.com/docs/authentication/email-password) · [邮箱验证码](https://better-auth.com/docs/plugins/email-otp)
- CLI 注册为公开客户端。使用 `jwt()`、`oauthProvider()` 和 `oauthDeviceAuthorization()`，由 `/oauth2/token` 签发面向 VPrint API 的令牌。CLI 只申请选择队伍和比赛、提交打印所需的权限。Web 管理操作继续使用站点会话。[Better Auth 设备授权](https://better-auth.com/docs/plugins/device-authorization)
- `vprint login` 发起 OAuth Device Code 流程。CLI 在终端显示验证网址和用户短码（`user_code`），自行保管设备码（`device_code`）。队员可在本机、手机或另一台电脑的浏览器打开网址，登录 VPrint，输入或核对短码后确认账号和权限。CLI 用设备码按服务端指定间隔轮询令牌端点，批准后取得绑定其 DPoP 密钥的令牌；服务端要求减速时延长间隔，拒绝或过期后结束轮询。[RFC 8628](https://www.rfc-editor.org/rfc/rfc8628.html)
- 设备授权页提供「在这台比赛主机上保持登录 30 天」，默认关闭。CLI 授权默认有效 8 小时，勾选后有效 30 天。两种期限都从用户批准时算起。CLI 可以在期限内自动续期，但到达原定截止时间后必须重新授权。此选择仅作用于正在授权的 CLI，批准操作所在浏览器的会话期限独立。`vprint logout` 用于提前结束本机 CLI 登录。
- 为 CLI 强制启用 DPoP。CLI 生成并保管签名私钥，换取令牌时提交签名证明。访问 API 时，每个请求都带有对应的证明；若允许续期，刷新令牌也绑定同一密钥。凭证和私钥由当前系统用户保管，训练目录的 `.vprint` 仅保存比赛绑定。[令牌绑定](https://better-auth.com/docs/plugins/oauth-provider/tokens#dpop) · [RFC 9449](https://www.rfc-editor.org/rfc/rfc9449.html)
- VPrint API 逐请求核对签发方、受众、权限范围、令牌绑定的公钥、请求方法和 URL、令牌哈希、证明时效及重复使用，并按当前队伍成员关系授权。采用 Better Auth 的请求校验入口 `verifyAccessTokenRequest`；部署多实例时使用共享的证明重放记录。Web Cookie 的会话保护单独处理。[资源服务器校验](https://better-auth.com/docs/plugins/oauth-provider/resource-server)
- 服务端的令牌绑定与证明校验复用 Better Auth。CLI 负责保管密钥并调用客户端库生成每次请求的签名证明。若采用 TypeScript，可复用 `oauth4webapi` 的 `DPoP()`；具体客户端库随 CLI 技术栈确定。[客户端 DPoP 接口](https://github.com/panva/oauth4webapi/blob/main/docs/functions/DPoP.md)

选型已核对 Better Auth 及 OAuth Provider 1.7.27 的发布包接口。VPrint 尚未实现认证，也未用真实账号联调。

### 账号设置 · 已登录会话

队员在一个列表里查看、退出自己仍有效的 Web 和 CLI 会话。每行显示会话类型、设备信息、登录或授权时间、到期时间和「退出此会话」操作。正在查看设置的浏览器会话标记为「当前会话」。

Web 行显示浏览器和操作系统；CLI 行显示发起 `vprint login` 的主机名和操作系统。设备信息取自对应客户端，只用于帮助用户辨认，缺失时显示已知信息。同一浏览器会话打开多个标签只占一行；同一台电脑上分别登录 Web 和 CLI 则各占一行。CLI 自动续期沿用原行和授权截止时间。

退出只作用于选中的会话。退出 CLI 后，下一次受保护的 API 请求和续期都会被拒绝；本机 `vprint logout` 结束同一条授权。退出 Web 后，该会话的受保护请求需要重新登录，已有的比赛通知订阅随之结束。退出当前会话后回到登录页。过期和已退出的会话从列表移除。服务端按当前用户校验会话归属，并对 CLI 请求校验这一次授权仍然有效。

### 用 GitHub 登录与关联账号

| 用户的情况 | Web 行为 |
| --- | --- |
| 首次用 GitHub，GitHub 身份尚未关联，返回了已验证的邮箱，且 VPrint 中没有这个邮箱 | 授权后先显示账号选择页，展示 GitHub 返回的已验证邮箱。点「创建新账号」才以该邮箱创建 VPrint 用户、关联 GitHub 并登录；点「绑定已有账号」则先登录原 VPrint 账号，可使用不同的邮箱。 |
| GitHub 身份已经关联 | 正常回调后按 GitHub 账号 ID 找回同一个 VPrint 用户。GitHub 用户名改名后仍可进入原队伍。 |
| GitHub 身份尚未关联，但邮箱已有 VPrint 账号 | 选择页提示该邮箱已注册，引导「绑定已有账号」。先用原登录方式（含邮箱验证码）验证目标账号，再确认绑定；同邮箱只保留一个 VPrint 用户。 |
| 选择绑定，或从已登录账号主动发起绑定 | 确认时显示 GitHub 身份和目标 VPrint 账号的邮箱。允许二者邮箱不同，绑定后保留 VPrint 联系邮箱、用户 ID、队伍和角色。若 GitHub 身份已归另一个 VPrint 用户，提示已占用并保留双方原有关系。 |

选择页示例：「创建后，`alex@example.com` 将作为你的 VPrint 登录邮箱。」页面提供「创建新账号」「绑定已有账号」和「取消」。进入页面或取消操作均不新建用户。确认后继续原邀请或设备授权流程，设备授权仍需单独批准。

GitHub 资料页隐藏邮箱也可以注册：授权后通过 GitHub 的邮箱接口取得地址和验证状态。首次登录若缺少可用的已验证邮箱，提示在 GitHub 完成邮箱验证后重试，或改用 VPrint 邮箱验证码登录。邀请在最终加入时重新校验；设备授权在登录后仍须核对短码并批准。[GitHub 提供方实现](https://github.com/better-auth/better-auth/blob/v1.7.27/packages/core/src/social-providers/github.ts)

实现建议：GitHub 提供方启用 `disableImplicitSignUp`，账号关联启用 `disableImplicitLinking`。Better Auth 提供显式注册和已登录用户的 `linkSocial()`；建号前展示邮箱、记住本次选择并接回原流程由 VPrint 衔接。邮箱和 GitHub 账号 ID 取自服务端验证过的授权结果，确认时复核归属；若授权过期或身份发生变化，重新确认。重复提交同一次选择只能产生一个结果。[Better Auth 社交登录](https://www.better-auth.com/docs/concepts/oauth) · [账号关联](https://better-auth.com/docs/concepts/users-accounts#account-linking) · [1.7.27 回调逻辑](https://github.com/better-auth/better-auth/blob/v1.7.27/packages/better-auth/src/api/routes/callback.ts)

## 建队与入队

用户在 Web 创建队伍后成为队长。每支队伍有一个当前有效的邀请链接，队长可以将它发到队群，多位队友登录后可用同一链接加入。队长重置链接后，后续入队须使用新链接，已有队员保留成员身份。

每位队员都可以在 Web 为本队创建比赛、从 CLI 向本队比赛打印、在 Web 查看本队的打印件。

一个账号可以加入多支队伍，角色按队伍分别计算。例如，校队队长加入集训队后，在集训队拥有普通队员权限。

从 Web 首页进入时，只有一支队伍的用户直接看到该队的比赛列表；属于多支队伍的用户默认回到上次访问且仍有权访问的队伍。页头显示当前队名，可在此切换队伍。打开有权访问的比赛链接时，直接进入链接指定的比赛，并显示它所属的队伍。

## 比赛的创建与查找

队员创建比赛时只填写名称，创建时间由系统记录。同一支队伍可以有多个同名比赛，每个都是独立的打印件文件夹。

Web 队内比赛列表和 CLI 的 `vprint use` 都在比赛名旁显示创建时间，并按创建时间从新到旧排列。给较早的比赛补打文件，只会在该场的打印列表顶部新增记录，两处比赛列表都保持原来的顺序。

## 离队、交接与解散

- 普通队员自行退队时，现有邀请链接继续有效。
- 队长移除队员时，系统同时重置该队的邀请链接。被移除者手里的旧链接随即失效，其他队员可以继续训练。
- 队长可以把队长身份转让给一名现有普通队员。转让完成后，新队长接管队伍，原队长成为普通队员，可以留队训练或自行退出。队内比赛和打印历史随队伍保留。
- 只有现任队长可以解散队伍。确认框显示队名、队内比赛总数和打印件总数，并说明此操作永久删除队伍及其全部比赛和打印件。队长确认后执行删除，邀请链接随即失效，原目录绑定无法再向这些比赛打印。

## 删除比赛与打印件

队长可以删除本队的整场比赛。确认框显示所选比赛和将随之删除的打印件数。确认后，该比赛和其中的全部打印件一并删除。队内其他比赛仍可使用。MVP 保留每次打印的记录，不提供单份打印件的删除操作。

## 获取 CLI

首版在 GitHub Releases 发布 Linux、macOS 和原生 Windows 的独立可执行文件。比赛页面提供「安装 CLI」入口，队员从那里选择训练主机对应的下载项。普通用户可将文件保存到自己有权限的目录并运行，无需管理员权限或额外安装语言运行时。Windows 用户可以在 PowerShell 中直接运行 `.\vprint.exe login`。

## 开练与打印

主机上的队员通过 `vprint login` 登录，在训练目录中运行 `vprint use`。只有一支队伍时直接选择比赛，有多支时先选队伍，再从该队的比赛中选择。CLI 回显队名和比赛名，将绑定写入当前目录的 `.vprint`。再次运行 `vprint use` 可以更换这个目录的绑定。在 Web 切换队伍只改变浏览位置，训练目录仍向原先选定的比赛打印。

执行 `vprint A.cpp` 时，CLI 从当前工作目录逐级向上查找，使用遇到的第一份 `.vprint`。整场训练可以共用一个绑定，各题放在子目录里。如果一路都找不到绑定，CLI 提示先运行 `vprint use`，本次不上传文件。

首版只接受 UTF-8 纯文本，按文件内容判断，扩展名不限。每个文件的原始字节数最多为 65,536（64 KiB），恰好达到上限仍可打印。CLI 和服务端均按文件字节数校验。队员可以执行 `vprint A.cpp sample.in notes` 一次传入源码、样例和无扩展名的笔记。每个成功打印的文件在当前比赛中各占一条记录，可以单独打开。

CLI 逐个显示文件名和打印结果。某个文件失败后继续处理其余文件，最后汇总成功数和失败数。所有文件成功时退出状态为 0，只要有一个失败就以非零状态退出。已成功的打印件可立即阅读。

队员每主动打印一次文件，就给当前比赛添加一份独立的打印件。打印件保留当时的文件内容、文件名和打印时间。本地继续改代码时，已经发出的打印件保持原样。再次打印同名文件会新增一条记录，即使内容完全相同也一样。

若上传后回执丢失，CLI 对这次文件打印的自动重试沿用同一个打印请求标识，并为新的 HTTP 请求生成新的 DPoP 证明。服务端若已保存打印件，则返回原打印件，保留原打印时间。队员手动再打印时使用新的打印请求标识。

比赛页面按打印时间列出该场比赛的所有打印件，每份占一行，显示文件名和打印时间。新打印件自动出现在列表顶部。文件名只是打印时的名称，同名记录之间没有版本关系。

## 首版阅读体验

比赛列表和该场比赛的任意打印件阅读页都订阅新件通知。从列表点开打印件时延续订阅，直接打开打印件链接也会订阅。新件到达时，列表自动更新；正在阅读该场打印件的队员看到一条自行消失的 toast，仍停在原文件和阅读位置。阅读页的导航只有「返回列表」。MVP 省去模拟送纸的等待时间。

打印件保留源文件的换行，每个源文件行显示一个行号。队员上下滚动阅读整份代码，遇到超出屏幕宽度的行就横向滚动查看行尾。手机、平板和电脑都按同一套源文件行号对照代码。阅读页不分页，也不提供批注或圈画工具。

源码在 Web 阅读页默认使用彩色语法高亮。采用 Highlight.js 自带的语言规则和 GitHub 浅色主题，按需引入语言模块。阅读页按文件名指定语言，例如将 `.cpp` 和 `.hpp` 按 C++ 显示。样例输入和未识别语言的文件直接展示原文。整份源码作为一个连续文本块高亮，行号单独显示，便于跨行选择和查找。[Highlight.js 官方用法](https://highlightjs.readthedocs.io/en/latest/readme.html) · [GitHub 浅色主题](https://github.com/highlightjs/highlight.js/blob/main/src/styles/github.css)

队员可以用浏览器原生的文本选择、复制和页内查找。跨行复制只带走所选源码，保留缩进和换行。首版不另设「复制全文」或「下载源码」按钮。

行号布局参考 Hydro 的实体打印模板，行号在正文左侧独立对齐。[Hydro 高亮与行号模板](https://github.com/hydro-dev/xcpc-tools/blob/b4faf1f11adb9b1f92db6fbfc55d2de833264a3f/packages/server/client/typst.ts#L103-L128)

## 技术栈提案（Cloudflare Workers 优先）

部署平台优先使用 Cloudflare Workers。首版建议用 Worker、静态资源和 D1 提供应用，并用支持休眠的 Durable Object 承载浏览器共享的 WebSocket。

对外域名为 `https://vprint.401.moe`。Web、API、CLI 默认服务地址、设备验证网址和邀请链接使用同一来源。GitHub OAuth App 的 Homepage URL 使用站点根地址，Authorization callback URL 使用 `https://vprint.401.moe/api/auth/callback/github`。

| 部分 | 建议 | 对应的产品行为 |
| --- | --- | --- |
| Web | React、TypeScript、Vite、Highlight.js、Workers Static Assets | 静态资源直接分发。比赛和阅读页的深链接加载同一应用，API、认证回调和协议发现端点由 Worker 处理。[静态资源路由](https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/) |
| API 与认证 | Hono、Better Auth、D1 原生绑定 | 同源提供登录和打印 API。Better Auth 1.7.27 的适配器可识别 D1。密码和设备授权须在 Workers 环境联调。[适配器源码](https://github.com/better-auth/better-auth/blob/v1.7.27/packages/kysely-adapter/src/dialect.ts) |
| 数据 | D1 | 保存用户、授权、队伍、成员、比赛和打印件。小文本正文和元数据同次写入；列表按比赛及打印时间索引只取元数据，点开详情才读正文 |
| CLI | TypeScript、oauth4webapi、Bun 单文件编译 | 使用库完成 Device Code 和 DPoP，按目标系统发布独立可执行文件 |

64 KiB 的文件上限为 D1 每行 2,000,000 字节的限制留出了元数据空间，正文与记录可一并写入和删除。[D1 平台限制](https://developers.cloudflare.com/d1/platform/limits/)

同一次文件打印以提交人、比赛和打印请求标识建立联合唯一约束，重试返回原打印件。移除队员并重置邀请链接等必须一起完成的业务写入使用带权限条件的 SQL 或 D1 事务批次。Better Auth 的 D1 适配器关闭交互式事务，业务层的批次不能代替对认证插件并发行为的验收。DPoP 证明校验使用 Better Auth 共享重放记录，按实际数据库配置验证跨 Worker 实例生效。[D1 事务批次](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch) · [Better Auth 请求校验](https://better-auth.com/docs/plugins/oauth-provider/resource-server)

**共享通知连接。** 同一浏览器配置下、同源且使用同一登录会话的所有 VPrint 标签页共用一条 WebSocket。比赛列表和阅读页都声明各自关注的比赛，按比赛 ID 去重。新标签打开同场打印件时复用已有订阅，打开其他比赛时在原连接上增加订阅。最后一个关注某场比赛的页面离开后才取消该场订阅；全部比赛页和打印页都离开后释放连接。手机和电脑各自维持连接。

浏览器侧首选原生 SharedWorker 持有连接，各标签通过消息端口共享通知。比赛列表按打印件 ID 合并新记录；阅读页仅提示当前所看比赛的新件。同一浏览器里，同一打印件的到达提示只在正在操作的相关阅读页展示一次。浏览器暂停或网络中断后，恢复连接时重新订阅所有仍打开的比赛，按各场最后已见的记录补齐。[HTML 共享 Worker](https://html.spec.whatwg.org/multipage/workers.html#shared-workers-introduction)

服务端建议按 VPrint 用户组织通知连接。D1 成功保存打印件后，将事件路由给当时的队伍成员；用户对应的 Durable Object 只向订阅该场比赛、会话仍有效的连接发送比赛 ID 和打印件 ID。事件本身不携带正文，读取列表和正文仍校验当前成员身份。登出或移除成员时撤销相应订阅。使用 WebSocket Hibernation API 保存连接的订阅信息，休眠后可恢复。通知发送结果不改变已成功的打印记录。[Cloudflare WebSocket 休眠指南](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)

邮箱验证码选用 Cloudflare Email Sending。Better Auth 负责签发和校验验证码，VPrint 在发信回调里通过 Worker 的邮件绑定投递。面向普通用户邮箱发信需要 Workers Paid 并在 Cloudflare 上配置发信域名。[Cloudflare Email Service](https://developers.cloudflare.com/email-service/) · [Worker 发信接口](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/)

## 首轮技术验收

先在比赛主机运行 `vprint login`，走通 Device Code 授权：终端显示网址和用户短码，队员在浏览器中确认，CLI 轮询取得令牌。随后主机在绑定目录打印 `A.cpp`，队友在比赛页收到新件，点开能读到原文。队员从 Web 的「已登录会话」退出那台主机后，主机保留本地凭证，下一次打印和续期均须被拒绝，比赛列表没有新增记录。浏览器仍可阅读，另一台已授权主机仍可打印。以 S1、S6、S14、S15 和 S26 核对结果。

随后在预览 Worker 和 D1 上验证密码哈希的 CPU 用量、真实邮件收码、GitHub 首次登录与关联、设备码并发兑换、8 小时和 30 天截止。用两台浏览器设备核对通知与退队权限，用同一浏览器的多个标签核对共享连接。用三平台二进制检查终端重启、目录绑定和上传回执丢失后的重试，覆盖无桌面密钥环的 Linux。队长从 Web 删除整场比赛后，验证原目录绑定无法再向该场打印。若 D1 无法满足实测的认证原子性要求，可保持 Worker 接口，通过 Hyperdrive 接 PostgreSQL。[Workers 限额](https://developers.cloudflare.com/workers/platform/limits/) · [Hyperdrive](https://developers.cloudflare.com/hyperdrive/) · [Bun 编译目标](https://bun.com/docs/bundler/executables)

产品行为的验收示例见 [SPEC.md](./SPEC.md)，核心用语见 [GLOSSARY.md](./GLOSSARY.md)。
