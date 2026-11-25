import { expect, test } from "@playwright/test";
import { cliWorkspace, firstSource, localHostname, runCli, secondSource, waitUserCode, writeSources } from "./cli";

const name = `端到端-${crypto.randomUUID()}`;
const password = "correct horse battery staple";

test("a member authorizes a real CLI and reads its print on phones and desktops", async ({
  page,
  baseURL,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "注册", exact: true }).click();
  await page.getByLabel("姓名").fill("主机队员");
  await page.getByLabel("邮箱").fill(`print-flow-${crypto.randomUUID()}@vprint.example`);
  await page.getByLabel("设置密码").fill(password);
  await page.getByRole("button", { name: "创建并进入" }).click();
  await expect(page.getByRole("heading", { name: "比赛工作台" })).toBeVisible();
  await page.getByRole("button", { name: "新建队伍" }).click();
  await page.getByLabel("队伍名称").fill(name);
  await page.getByRole("button", { name: "创建队伍", exact: true }).click();
  await page.getByRole("button", { name: "新建比赛" }).click();
  await page.getByLabel("比赛名称").fill(name);
  await page.getByRole("button", { name: "创建比赛", exact: true }).click();
  const contest = page.getByRole("list", { name: "比赛" }).getByRole("link", { name: new RegExp(name) });
  await expect(contest).toBeVisible();

  const workspace = await cliWorkspace();
  await writeSources(workspace.directory);
  const activeCli: ReturnType<typeof runCli>[] = [];
  try {
    const login = runCli(["login"], workspace.directory, baseURL!, workspace.credentials);
    activeCli.push(login);
    const code = await waitUserCode(login);
    await page.goto("/device?user_code=" + encodeURIComponent(code));
    await page.getByRole("button", { name: "核对短码" }).click();
    await expect(page.getByRole("definition").filter({ hasText: localHostname })).toBeVisible();
    await page.getByRole("button", { name: "批准登录" }).click();
    await expect(page.getByRole("heading", { name: "已批准主机登录" })).toBeVisible();
    expect(await login.done).toBe(0);
    expect(login.output()).toContain("已登录 ");

    const use = runCli(["use"], workspace.directory, baseURL!, workspace.credentials);
    activeCli.push(use);
    await use.write("1\n");
    expect(await use.done).toBe(0);
    expect(use.output()).toContain("已绑定 " + name + " / " + name);
    async function printCli(filename: string) {
      const printed = runCli([filename], workspace.directory, baseURL!, workspace.credentials);
      activeCli.push(printed);
      expect(await printed.done, printed.output()).toBe(0);
      expect(printed.output()).toContain(filename + " 已打印");
    }
    await printCli(firstSource.filename);

    await page.goto("/");
    await contest.click();
    const firstLink = page.getByRole("link", { name: /solver\.cpp/ });
    await expect(firstLink).toBeVisible();
    await firstLink.click();
    await expect(page.getByRole("region", { name: "源码" })).toContainText(firstSource.content.trimEnd());

    await printCli(secondSource.filename);
    await expect(page.getByText("本场比赛有新打印件")).toBeVisible();
    await expect(page.getByRole("region", { name: "源码" })).toContainText(firstSource.content.trimEnd());
    await expect(page.getByRole("heading", { name: firstSource.filename })).toBeVisible();
    await page.getByRole("link", { name: "返回列表" }).click();
    const secondLink = page.getByRole("link", { name: /reader\.cpp/ });
    await expect(secondLink).toBeVisible();
    await secondLink.click();
    await expect(page.getByRole("region", { name: "源码" })).toContainText(secondSource.content.trimEnd());
    await expect(page.getByRole("heading", { name: secondSource.filename })).toBeVisible();
  } finally {
    for (const cli of activeCli) cli.stop();
    await workspace.close().catch(() => undefined);
  }
});
