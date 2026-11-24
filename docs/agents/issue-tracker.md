# GitHub Issues

VPrint 的规格和实施工单发布到 [401-moe/VPrint](https://github.com/401-moe/VPrint/issues)。使用 `gh` 操作 GitHub，在仓库外运行时显式指定 `--repo 401-moe/VPrint`。

- **读取规格或工单**　用 `gh issue view <number> --json number,title,body,labels,comments,state` 读取正文及讨论。用 `gh issue list` 按状态或标签筛选。
- **发布规格**　用 `gh issue create --title "…" --body-file <file>` 提交完整正文。标签按[分流标签表](triage-labels.md)选择。
- **发布实施工单**　先发布前置工单，再发布依赖它的工单。使用 `gh issue create --parent <number> --label ready-for-agent --title "…" --body-file <file>` 创建原生子工单。正文描述队员能够完成的操作，并列出可复验的验收条件。
- **记录阻塞关系**　通过 `gh api repos/401-moe/VPrint/issues/<blocker> --jq .id` 取得前置工单的数据库 ID。在依赖方调用 `gh api --method POST repos/401-moe/VPrint/issues/<dependent>/dependencies/blocked_by -F issue_id=<database-id>`。同一端点的 GET 结果可用于核对前置工单。
- **挑选可开工的工单**　从规格的原生子工单中选择仍开放、带有 `ready-for-agent` 标签、无人认领且没有开放前置工单的一项。分流标签说明由谁实施，原生阻塞关系决定何时能开工。

**PRs as a request surface: no.**
