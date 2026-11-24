import { expect, test } from "@playwright/test";

test("a signed-in owner creates a team and a contest, then a teammate joins by invitation", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("姓名").fill("浏览器建队者");
  const suffix = crypto.randomUUID();
  await page.getByLabel("邮箱").fill(`team-owner-${suffix}@vprint.example`);
  await page.getByLabel("密码").fill("correct horse battery staple");
  await page.getByRole("button", { name: "创建账号" }).click();
  await expect(page.getByRole("heading", { name: "工作台" })).toBeVisible();

  await page.getByLabel("队伍名称").fill("火苗");
  await page.getByRole("button", { name: "创建队伍" }).click();
  await expect(page.getByRole("heading", { name: "火苗" })).toBeVisible();
  await expect(page.getByText("队长")).toBeVisible();
  await page.getByRole("button", { name: "队伍设置" }).click();
  await expect(page.getByRole("textbox", { name: "邀请链接" })).toHaveValue(
    /\/invite\/[a-f0-9]{32}$/,
  );

  await page.getByLabel("比赛名称").fill("周六训练");
  await page.getByRole("button", { name: "创建比赛" }).click();
  await expect(page.getByRole("list", { name: "比赛" })).toContainText("周六训练");
  await page.getByLabel("比赛名称").fill("周日训练");
  await page.getByRole("button", { name: "创建比赛" }).click();
  await expect(page.getByRole("list", { name: "比赛" }).getByRole("listitem")).toHaveCount(2);
  await expect(page.getByRole("list", { name: "比赛" }).getByRole("listitem").first()).toContainText(
    "周日训练",
  );

  const invitation = await page.getByRole("textbox", { name: "邀请链接" }).inputValue();
  await page.getByRole("button", { name: "退出登录" }).click();
  await page.goto(invitation);
  await page.getByLabel("姓名").fill("浏览器队友");
  await page.getByLabel("邮箱").fill(`team-member-${suffix}@vprint.example`);
  await page.getByLabel("密码").fill("correct horse battery staple");
  await page.getByRole("button", { name: "创建账号" }).click();
  await expect(page.getByRole("heading", { name: "火苗" })).toBeVisible();
  await expect(page.getByText("队员")).toBeVisible();
  await expect(page.getByRole("list", { name: "比赛" })).toContainText("周六训练");
});
