import { expect, test, type Page } from "@playwright/test";

async function register(page: Page, name: string) {
  await page.getByRole("button", { name: "注册", exact: true }).click();
  await page.getByLabel("姓名").fill(name);
  await page.getByLabel("邮箱").fill(`manage-${crypto.randomUUID()}@vprint.example`);
  await page.getByLabel("设置密码").fill("correct horse battery staple");
  await page.getByRole("button", { name: "创建并进入" }).click();
}

async function createTeam(page: Page, teamName: string) {
  await page.getByRole("button", { name: "新建队伍" }).click();
  await page.getByLabel("队伍名称").fill(teamName);
  await page.getByRole("button", { name: "创建队伍", exact: true }).click();
  await expect(page.getByRole("heading", { name: "比赛工作台" })).toBeVisible();
  await expect(page.getByRole("button", { name: `切换队伍，当前为${teamName}` })).toBeVisible();
}

test("owners preview, confirm, and reset invitation changes", async ({ page }) => {
  await page.goto("/");
  await register(page, "甲");
  await createTeam(page, "邀请管理");
  await page.getByRole("link", { name: "队伍设置" }).click();
  await page.getByRole("button", { name: "邀请队员" }).click();
  const dialog = page.getByRole("dialog");
  const field = dialog.getByRole("textbox", { name: "邀请链接" });
  const previous = await field.inputValue();
  await expect(dialog).toContainText("同一条链接可邀请多人。");
  await dialog.getByRole("button", { name: "重置链接" }).click();
  await dialog.getByRole("button", { name: "取消" }).click();
  await expect(field).toHaveValue(previous);
  await dialog.getByRole("button", { name: "重置链接" }).click();
  await dialog.getByRole("button", { name: "确认重置" }).click();
  await expect(dialog).toContainText("链接已重置，旧链接已失效。");
  await expect(field).not.toHaveValue(previous);
});

test("members use the invitation page and the owner manages membership with confirmations", async ({
  page,
  browser,
  baseURL,
}) => {
  await page.goto("/");
  await register(page, "甲");
  await createTeam(page, "确认管理");
  await page.getByRole("link", { name: "队伍设置" }).click();
  await page.getByRole("button", { name: "邀请队员" }).click();
  const invitation = await page.getByLabel("邀请链接").inputValue();

  const memberContext = await browser.newContext({ baseURL });
  try {
    const member = await memberContext.newPage();
    await member.goto(invitation);
    await register(member, "乙");
    await expect(member.getByRole("heading", { name: "确认管理" })).toBeVisible();
    await member.getByRole("button", { name: "加入队伍" }).click();
    await member.getByRole("link", { name: "队伍设置" }).click();
    await member.getByRole("button", { name: "退出队伍" }).click();
    await member.getByRole("dialog", { name: "退出队伍" }).getByRole("button", { name: "确认" }).click();
    await expect(member.getByText("请先创建队伍或通过邀请链接加入。")).toBeVisible();

    await member.goto(invitation);
    await expect(member.getByRole("heading", { name: "确认管理" })).toBeVisible();
    await member.getByRole("button", { name: "加入队伍" }).click();
    await expect(member.getByRole("heading", { name: "比赛工作台" })).toBeVisible();
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

test("contest deletion uses the row-end menu and both confirmation paths work", async ({ page }) => {
  await page.goto("/");
  await register(page, "队长");
  await createTeam(page, "比赛删除");
  await page.getByRole("button", { name: "新建比赛" }).click();
  await page.getByLabel("比赛名称").fill("确认删除");
  await page.getByRole("button", { name: "创建比赛", exact: true }).click();
  const row = page.locator(".teams-contest-row").filter({ hasText: "确认删除" });
  await row.getByRole("button", { name: "管理比赛 确认删除" }).click();
  await page.getByRole("menuitem", { name: "删除比赛" }).click();
  const dialog = page.getByRole("dialog", { name: "删除比赛" });
  await expect(dialog).toContainText("确认删除");
  await expect(dialog).toContainText("0 份打印件");
  await dialog.getByRole("button", { name: "取消" }).click();
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "管理比赛 确认删除" }).click();
  await page.getByRole("menuitem", { name: "删除比赛" }).click();
  await dialog.getByRole("button", { name: "确认删除" }).click();
  await expect(page.getByText("还没有比赛。新建比赛后，就可以从 CLI 打印。")).toBeVisible();
});
