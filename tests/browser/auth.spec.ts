import { expect, test } from "@playwright/test";
async function sentOtp() {
  const port = process.env.VPRINT_E2E_PORT ?? "8801";
  const response = await fetch(
    `http://127.0.0.1:${port}/cdn-cgi/local/explorer/api/local/email/sending`,
  );
  const body = await response.json();
  if (!response.ok || !Array.isArray(body.result) || body.result.length === 0) {
    throw new Error(`local explorer failed: ${response.status} ${JSON.stringify(body)}`);
  }
  const items = body.result as { messageId?: string }[];
  const message = items.at(-1)?.messageId;
  if (!message) throw new Error(`local sent email has no message ID: ${JSON.stringify(items)}`);
  const messageId = message.replace(/^<|>$/g, "");
  const detail = await fetch(
    `http://127.0.0.1:${port}/cdn-cgi/local/explorer/api/local/email/sending?email_id=${encodeURIComponent(messageId ?? "")}`,
  );
  const detailBody = await detail.json();
  if (!detail.ok) {
    throw new Error(`local email detail failed: ${detail.status} ${JSON.stringify(detailBody)}`);
  }
  return (detailBody.result as { text?: string }).text?.match(/\b\d{6}\b/)?.[0];
}

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

test("a member signs in by email OTP and returns to the original location", async ({ page }) => {
  const email = `otp-${Date.now()}@vprint.example`;
  const password = "correct horse battery staple";
  await page.goto("/invite/example?next=%2Fdevice%2F123");
  await expect(page.getByRole("button", { name: "登录" })).toBeVisible();

  await page.getByLabel("姓名").fill("浏览器验证码队员");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(password);
  await page.getByRole("button", { name: "创建账号" }).click();
  await expect(page.getByRole("heading", { name: "已登录" })).toBeVisible();
  const memberId = await page.evaluate(async () => {
    const response = await fetch("/api/me");
    return (await response.json()) as { id: string };
  });
  await page.getByRole("button", { name: "退出登录" }).click();
  await expect(page.getByRole("button", { name: "登录" })).toBeVisible();

  await page.getByLabel("邮箱").fill(email);
  await page.getByRole("button", { name: "使用邮箱验证码" }).click();
  expect
    .poll(sentOtp, { timeout: 10_000, intervals: [100, 250, 500] })
    .toBeDefined();
  const otp = await sentOtp();
  expect(otp).toBeDefined();

  await page.getByLabel("验证码").fill("000000");
  await page.getByRole("button", { name: "验证并登录" }).click();
  await expect(page.getByRole("alert")).toContainText("Invalid OTP");

  await page.getByLabel("验证码").fill(otp ?? "");
  await page.getByRole("button", { name: "验证并登录" }).click();
  await expect(page.getByText(email)).toBeVisible();
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const response = await fetch("/api/me");
        return (await response.json()) as { id: string };
      }),
    )
    .toEqual(memberId);
  await expect(page).toHaveURL("/invite/example?next=%2Fdevice%2F123");
});
