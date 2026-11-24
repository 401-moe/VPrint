import { expect, test } from "@playwright/test";

test("a member signs up, reloads, signs out, fails once, then signs in again", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "VPrint" })).toBeVisible();

  await page.getByLabel("姓名").fill("浏览器队员");
  const email = `member-${crypto.randomUUID()}@vprint.example`;
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill("correct horse battery staple");
  await page.getByRole("button", { name: "创建账号" }).click();
  await expect(page.getByRole("heading", { name: "工作台" })).toBeVisible();
  const memberId = await page.evaluate(async () => {
    const response = await fetch("/api/me");
    return (await response.json()) as { id: string };
  });

  await page.reload();
  await expect(page.getByRole("heading", { name: "工作台" })).toBeVisible();
  await expect(page.getByText(email)).toBeVisible();
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const response = await fetch("/api/me");
        return (await response.json()) as { id: string };
      }),
    )
    .toEqual(memberId);

  await page.getByRole("button", { name: "退出登录" }).click();
  await expect(page.getByText("队员的队内电子打印工作台")).toBeVisible();
  await expect(page.getByRole("button", { name: "登录" })).toBeVisible();

  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill("not the password");
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page.getByRole("alert")).toContainText("Invalid email or password");

  await page.getByLabel("密码").fill("correct horse battery staple");
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page.getByText(email)).toBeVisible();
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const response = await fetch("/api/me");
        return (await response.json()) as { id: string };
      }),
    )
    .toEqual(memberId);
});

test("a failed auth request restores the form for another attempt", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("姓名").fill("网络队员");
  await page.getByLabel("邮箱").fill(`network-${crypto.randomUUID()}@vprint.example`);
  await page.getByLabel("密码").fill("correct horse battery staple");
  await page.route("**/api/auth/sign-up/email", (route) => route.abort());
  await page.getByRole("button", { name: "创建账号" }).click();
  await expect(page.getByRole("alert")).toContainText("网络异常");
  await expect(page.getByRole("button", { name: "创建账号" })).toBeEnabled();
});
