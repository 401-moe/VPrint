import { expect, test } from "@playwright/test";
async function sentOtp(baseURL: string, email: string) {
  const url = new URL("/cdn-cgi/local/explorer/api/local/email/sending", baseURL);
  const list = await fetch(url);
  if (!list.ok) throw new Error("Local email capture unavailable: " + list.status);
  const { result } = await list.json() as { result: { messageId: string; to: string[] }[] };
  const message = result.find(item => item.to.includes(email));
  if (!message) return undefined;
  url.searchParams.set("email_id", message.messageId.replace(/^<|>$/g, ""));
  const detail = await fetch(url);
  if (!detail.ok) throw new Error("Local email detail unavailable: " + detail.status);
  const body = await detail.json() as { result: { text: string } };
  return body.result.text.match(/\b\d{6}\b/)?.[0];
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

test("a member signs in by email OTP and returns to the original location", async ({ page, baseURL }) => {
  const email = `otp-${crypto.randomUUID()}@vprint.example`;
  const password = "correct horse battery staple";
  await page.goto("/invite/example?next=%2Fdevice%2F123");
  await expect(page.getByRole("button", { name: "登录" })).toBeVisible();

  await page.getByLabel("姓名").fill("浏览器验证码队员");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(password);
  await page.getByRole("button", { name: "创建账号" }).click();
  await expect(page.getByRole("heading", { name: "工作台" })).toBeVisible();
  const memberId = await page.evaluate(async () => {
    const response = await fetch("/api/me");
    return (await response.json()) as { id: string };
  });
  await page.getByRole("button", { name: "退出登录" }).click();
  await expect(page.getByRole("button", { name: "登录" })).toBeVisible();

  await page.getByLabel("邮箱").fill(email);
  await page.getByRole("button", { name: "使用邮箱验证码" }).click();
  await expect(page.getByLabel("邮箱")).toBeFocused();
  await page.getByRole("button", { name: "发送验证码" }).click();
  await expect
    .poll(() => sentOtp(baseURL!, email), { timeout: 10_000, intervals: [100, 250, 500] })
    .toBeDefined();
  const otp = await sentOtp(baseURL!, email);
  expect(otp).toBeDefined();

  await page.getByLabel("验证码").fill(otp === "000000" ? "000001" : "000000");
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

test("a new mailbox owner can sign in with an email OTP first", async ({ page, baseURL }) => {
  const email = `otp-first-${crypto.randomUUID()}@vprint.example`;
  await page.goto("/");
  await page.getByRole("button", { name: "已有账号？去登录" }).click();
  await page.getByRole("button", { name: "使用邮箱验证码" }).click();
  await expect(page.getByLabel("邮箱")).toBeFocused();
  await expect(page.getByLabel("邮箱")).toHaveValue("");

  await page.getByLabel("邮箱").fill(email);
  await page.getByRole("button", { name: "发送验证码" }).click();
  await expect
    .poll(() => sentOtp(baseURL!, email), { timeout: 10_000, intervals: [100, 250, 500] })
    .toBeDefined();
  const otp = await sentOtp(baseURL!, email);
  expect(otp).toBeDefined();

  await page.getByLabel("验证码").fill(otp ?? "");
  await page.getByRole("button", { name: "验证并登录" }).click();
  await expect(page.getByText(email)).toBeVisible();
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const response = await fetch("/api/me");
        return (await response.json()) as { email: string };
      }),
    )
    .toMatchObject({ email });
});
