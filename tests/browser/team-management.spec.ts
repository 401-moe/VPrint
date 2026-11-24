import { expect, test, type Page } from "@playwright/test";

async function register(page: Page, name: string) {
  await page.getByLabel("姓名").fill(name);
  await page.getByLabel("邮箱").fill(`manage-${crypto.randomUUID()}@vprint.example`);
  await page.getByLabel("密码").fill("correct horse battery staple");
  await page.getByRole("button", { name: "创建账号" }).click();
}

test("owners rotate the displayed invitation on removal; voluntary departure preserves it", async ({ page, browser, baseURL }) => {
  await page.goto("/");
  await register(page, "甲");
  await page.getByLabel("队伍名称").fill("队伍管理");
  await page.getByRole("button", { name: "创建队伍" }).click();
  await page.getByRole("button", { name: "队伍设置" }).click();
  const inviteField = page.getByRole("textbox", { name: "邀请链接" });
  const original = await inviteField.inputValue();
  const memberContext = await browser.newContext({ baseURL });
  try {
    const member = await memberContext.newPage();
    await member.goto(original);
    await register(member, "乙");
    await member.getByRole("button", { name: "队伍设置" }).click();
    await expect(member.getByLabel("邀请链接")).toBeHidden();
    await member.getByRole("button", { name: "退出队伍" }).click();
    await expect(member.getByLabel("队伍名称")).toBeEditable();
    await member.goto(original);
    await expect(member.getByRole("heading", { name: "队伍管理" })).toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: "队伍设置" }).click();
    const memberRow = page.getByRole("row").filter({ hasText: "乙" });
    await memberRow.getByRole("button", { name: "移除" }).click();
    await expect(memberRow).toHaveCount(0);
    await expect(inviteField).not.toHaveValue(original);
    const afterRemoval = await inviteField.inputValue();
    await member.goto(original);
    await expect(member.getByText("邀请链接无效。")).toBeVisible();
    await page.getByRole("button", { name: "重置邀请" }).click();
    await expect(inviteField).not.toHaveValue(afterRemoval);
  } finally {
    await memberContext.close();
  }
});

test("owner reviews counts, can cancel a contest deletion, and can dissolve the team", async ({ page }) => {
  await page.goto("/");
  await register(page, "队长");
  await page.getByLabel("队伍名称").fill("决赛队");
  await page.getByRole("button", { name: "创建队伍" }).click();
  await page.getByLabel("比赛名称").fill("决赛");
  await page.getByRole("button", { name: "创建比赛" }).click();
  await page.getByRole("link", { name: "决赛", exact: true }).click();
  await page.getByRole("button", { name: "删除比赛", exact: true }).click();
  const contestDialog = page.getByRole("dialog", { name: "删除比赛" });
  await expect(contestDialog).toContainText("0 份打印件");
  await contestDialog.getByRole("button", { name: "取消" }).click();
  await expect(page.getByRole("heading", { name: "决赛", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "返回队伍" }).click();
  await page.getByRole("button", { name: "队伍设置" }).click();
  await page.getByRole("button", { name: "解散队伍", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "解散队伍" });
  await expect(dialog).toContainText("决赛队");
  await expect(dialog).toContainText("1 场比赛、0 份打印件将永久删除");
  await dialog.getByRole("button", { name: "确认解散队伍" }).click();
  await expect(page.getByLabel("队伍名称")).toBeEditable();
});
