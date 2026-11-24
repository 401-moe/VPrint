import { expect, test } from "@playwright/test";

test("the owner resets an invitation, removes a teammate, and a member can leave", async ({
  page,
}) => {
  const suffix = `${Date.now()}-${crypto.randomUUID()}`;
  const emails = {
    owner: `manage-owner-${suffix}@vprint.example`,
    member: `manage-member-${suffix}@vprint.example`,
    newcomer: `manage-newcomer-${suffix}@vprint.example`,
  };

  await page.goto("/");
  await page.getByLabel("姓名").fill("甲");
  await page.getByLabel("邮箱").fill(emails.owner);
  await page.getByLabel("密码").fill("correct horse battery staple");
  await page.getByRole("button", { name: "创建账号" }).click();
  await page.getByLabel("队伍名称").fill("队伍管理");
  await page.getByRole("button", { name: "创建队伍" }).click();
  await page.getByRole("button", { name: "队伍设置" }).click();
  await expect(page.getByRole("list", { name: "队员" })).toContainText("甲　队长");

  const invitation = await page.getByRole("textbox", { name: "邀请链接" }).inputValue();
  await page.getByRole("button", { name: "退出登录" }).click();
  await page.goto(invitation);
  await page.getByLabel("姓名").fill("乙");
  await page.getByLabel("邮箱").fill(emails.member);
  await page.getByLabel("密码").fill("correct horse battery staple");
  await page.getByRole("button", { name: "创建账号" }).click();
  await page.getByRole("button", { name: "队伍设置" }).click();
  await expect(page.getByLabel("邀请链接")).toBeHidden();
  await page.getByRole("button", { name: "退出队伍" }).click();
  await expect(page.getByRole("heading", { name: "工作台" })).toBeVisible();
  await expect(page.getByLabel("队伍名称")).toBeEditable();

  await page.getByRole("button", { name: "退出登录" }).click();
  await page.getByLabel("邮箱").fill(emails.owner);
  await page.getByLabel("密码").fill("correct horse battery staple");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByRole("button", { name: "队伍设置" }).click();
  await expect(page.getByRole("list", { name: "队员" })).toContainText("甲　队长");
  await page.getByRole("button", { name: "退出登录" }).click();
  await page.goto(invitation);
  await page.getByRole("button", { name: "已有账号？去登录" }).click();
  await page.getByLabel("邮箱").fill(emails.member);
  await page.getByLabel("密码").fill("correct horse battery staple");
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page.getByRole("heading", { name: "队伍管理" })).toBeVisible();
  await page.getByRole("button", { name: "退出登录" }).click();
  await page.getByLabel("邮箱").fill(emails.owner);
  await page.getByLabel("密码").fill("correct horse battery staple");
  await page.getByRole("button", { name: "登录" }).click();
  await page.getByRole("button", { name: "队伍设置" }).click();
  await expect(page.getByRole("list", { name: "队员" })).toContainText("乙　队员");
  await page.getByRole("button", { name: "重置邀请" }).click();
  await expect(page.getByRole("textbox", { name: "邀请链接" })).toHaveValue(
    /\/invite\/[a-f0-9]{32}$/,
  );
  await expect(page.getByRole("textbox", { name: "邀请链接" })).not.toHaveValue(invitation);

  await page.getByRole("button", { name: "退出登录" }).click();
  await page.goto(invitation);
  await page.getByLabel("姓名").fill("丙");
  await page.getByLabel("邮箱").fill(emails.newcomer);
  await page.getByLabel("密码").fill("correct horse battery staple");
  await page.getByRole("button", { name: "创建账号" }).click();
  await expect(page.getByText("邀请链接无效。")).toBeVisible();
  await expect(page.getByRole("heading", { name: "工作台" })).toBeVisible();

  await page.getByRole("button", { name: "退出登录" }).click();
  await page.getByLabel("邮箱").fill(emails.owner);
  await page.getByLabel("密码").fill("correct horse battery staple");
  await page.getByRole("button", { name: "登录" }).click();
  await page.getByRole("button", { name: "队伍设置" }).click();
  await page.getByRole("button", { name: "移除", exact: true }).nth(1).click();
  await expect(page.getByRole("list", { name: "队员" })).not.toContainText("乙");
});
