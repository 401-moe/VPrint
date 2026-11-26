import { expect, test, type Page } from "@playwright/test";

async function expectCopy(page: Page, label: string, expected: string, successText = "复制成功") {
  const button = page.getByRole("button", { name: label, exact: true });
  const success = button.locator(".vp-copy-success");
  const width = await button.evaluate((element) => getComputedStyle(element).width);
  await button.click();
  await expect(success).toHaveCSS("opacity", "1");
  await expect(success).toHaveText(successText);
  await expect(success.locator("svg")).toBeVisible();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(expected);
  expect(await button.evaluate((element) => getComputedStyle(element).width)).toBe(width);
  await expect(success).toHaveCSS("opacity", "0");
}

async function register(page: Page, name: string) {
  await page.getByRole("button", { name: "注册", exact: true }).click();
  await page.getByLabel("姓名").fill(name);
  await page.getByLabel("邮箱").fill(`manage-${crypto.randomUUID()}@vprint.example`);
  await page.getByLabel("设置密码").fill("correct horse battery staple");
  await page.getByRole("button", { name: "创建并进入" }).click();
}

async function createTeam(page: Page, teamName: string) {
  await page.getByRole("button", { name: "新建队伍" }).first().click();
  await page.getByLabel("队伍名称").fill(teamName);
  await page.getByRole("button", { name: "创建队伍", exact: true }).click();
  await expect(page.getByRole("heading", { name: "比赛列表" })).toBeVisible();
  await expect(page.getByRole("link", { name: teamName })).toBeVisible();
}

test("owners preview, confirm, and reset invitation changes on team settings", async ({
  page,
}) => {
  await page.goto("/login");
  await register(page, "甲");
  await createTeam(page, "邀请管理");
  await page.getByRole("link", { name: "队伍设置" }).click();
  await expect(page.getByRole("heading", { name: "队伍设置" })).toBeVisible();

  const field = page.getByRole("textbox", { name: "邀请链接" });
  const previous = await field.inputValue();
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await expectCopy(page, "复制链接", previous);
  await expect(page.getByText("同一条链接可邀请多人。")).toBeVisible();

  await page.getByRole("button", { name: "重置链接" }).click();
  const dialog = page.getByRole("dialog", { name: "重置邀请链接？" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "取消" }).click();
  await expect(field).toHaveValue(previous);

  await page.getByRole("button", { name: "重置链接" }).click();
  await dialog.getByRole("button", { name: "确认重置" }).click();
  await expect(page.getByText("链接已重置，旧链接已失效。")).toBeVisible();
  await expect(field).not.toHaveValue(previous);
});

test("members use the invitation page and the owner manages membership with confirmations", async ({
  page,
  browser,
  baseURL,
}) => {
  await page.goto("/login");
  await register(page, "甲");
  await createTeam(page, "确认管理");
  await page.getByRole("link", { name: "队伍设置" }).click();
  const invitation = await page.getByLabel("邀请链接").inputValue();

  const memberContext = await browser.newContext({ baseURL });
  try {
    const member = await memberContext.newPage();
    await member.goto(invitation);
    await register(member, "乙");
    await expect(member.getByRole("heading", { name: "确认管理" })).toBeVisible();

    let releaseJoin!: () => void;
    const navigationFinished = new Promise<void>((resolve) => {
      releaseJoin = resolve;
    });
    await member.route(
      "**/api/team-invitations/*/join",
      async (route) => {
        await navigationFinished;
        await route.continue();
      },
      { times: 1 },
    );
    try {
      await member.getByRole("button", { name: "加入队伍" }).click();
      await member.getByRole("link", { name: "所有队伍", exact: true }).click();
      await expect(member.getByRole("heading", { name: "我的队伍" })).toBeVisible();
    } finally {
      releaseJoin();
    }

    await member.getByRole("link", { name: /确认管理/ }).click();
    await expect(member.getByRole("heading", { name: "比赛列表" })).toBeVisible();

    await member.getByRole("link", { name: "队伍设置" }).click();
    await member.getByRole("button", { name: "退出队伍" }).click();
    await member
      .getByRole("dialog", { name: "退出队伍" })
      .getByRole("button", { name: "确认" })
      .click();
    await expect(member.getByRole("heading", { name: "我的队伍" })).toBeVisible();
    await expect(member.getByText("你还没有加入队伍。")).toBeVisible();

    await member.goto(invitation);
    await member.getByRole("button", { name: "加入队伍" }).click();
    await expect(member.getByRole("heading", { name: "比赛列表" })).toBeVisible();
  } finally {
    await memberContext.close();
  }

  await page.reload();
  const memberRow = page.locator(".teams-member-row").filter({ hasText: "乙" });
  await expect(memberRow).toBeVisible();
  await memberRow.getByRole("button", { name: "管理队员 乙" }).click();
  await page.getByRole("menuitem", { name: "移除队员" }).click();
  const removeDialog = page.getByRole("dialog", { name: "移除队员" });
  await expect(removeDialog).toContainText("并重置邀请链接");
  await removeDialog.getByRole("button", { name: "取消" }).click();
  await expect(memberRow).toBeVisible();

  await memberRow.getByRole("button", { name: "管理队员 乙" }).click();
  await page.getByRole("menuitem", { name: "移除队员" }).click();
  await removeDialog.getByRole("button", { name: "确认" }).click();
  await expect(memberRow).toHaveCount(0);
});

test("contest settings allow renaming and owner deletion confirmation", async ({
  page,
}) => {
  await page.goto("/login");
  await register(page, "队长");
  await createTeam(page, "比赛管理");
  await page.getByRole("button", { name: "新建比赛" }).first().click();
  await page.getByLabel("比赛名称").fill("初版训练名");
  await page.getByRole("button", { name: "创建比赛", exact: true }).click();
  await page.getByRole("link", { name: /初版训练名/ }).click();
  await expect(page.getByRole("heading", { name: "打印列表" })).toBeVisible();

  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await expect(page.getByRole("button", { name: "复制打印命令" })).toHaveText("");
  await expectCopy(page, "复制打印命令", "vprint A.cpp", "");
  await page.getByRole("link", { name: "比赛设置" }).click();
  await expect(page.getByRole("heading", { name: "比赛设置" })).toBeVisible();
  const [, , teamId, , contestId] = new URL(page.url()).pathname.split("/");
  await expectCopy(page, "复制命令", `vprint use --team ${teamId} --contest ${contestId}`);
  await page.getByLabel("比赛名称").fill("确认删除");
  await page.getByRole("button", { name: "保存名称" }).click();
  await expect(page.getByText("比赛管理 · 确认删除")).toBeVisible();

  await page.getByRole("button", { name: "删除比赛" }).click();
  const dialog = page.getByRole("dialog", { name: "删除比赛" });
  await expect(dialog).toContainText("确认删除");
  await expect(dialog).toContainText("0 份打印件");
  await dialog.getByRole("button", { name: "取消" }).click();
  await expect(dialog).toHaveCount(0);

  await page.getByRole("button", { name: "删除比赛" }).click();
  await dialog.getByRole("button", { name: "确认删除" }).click();
  await expect(page.getByRole("heading", { name: "比赛列表" })).toBeVisible();
  await expect(
    page.getByText("还没有比赛。新建比赛后，就可以从 CLI 打印。"),
  ).toBeVisible();
});
