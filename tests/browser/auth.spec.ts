import { expect, test, type Page } from "@playwright/test";

const originalPassword = "correct horse battery staple";
const newPassword = "updated horse battery staple";
const address = () => `member-${crypto.randomUUID()}@vprint.example`;
const button = (page: Page, name: string) => page.getByRole("button", { name, exact: true });
const field = (page: Page, name: string) => page.getByLabel(name, { exact: true });
const heading = (page: Page, name: string) => page.getByRole("heading", { name, exact: true });

async function sentOtp(baseURL: string, email: string, purpose: "登录" | "重置密码") {
  const inbox = new URL("/cdn-cgi/local/explorer/api/local/email/sending", baseURL);
  const list = await fetch(inbox);
  if (!list.ok) throw new Error("Local email capture unavailable: " + list.status);
  const { result } = await list.json() as { result: { messageId: string; to: string[] }[] };
  for (const message of result.filter(message => message.to.includes(email))) {
    inbox.searchParams.set("email_id", message.messageId.replace(/^<|>$/g, ""));
    const response = await fetch(inbox);
    if (!response.ok) throw new Error("Local email detail unavailable: " + response.status);
    const { result: body } = await response.json() as { result: { text: string } };
    if (body.text.startsWith(purpose + "验证码")) return body.text.match(/\b\d{6}\b/)?.[0];
  }
}

async function receiveCode(baseURL: string, email: string, purpose: "登录" | "重置密码") {
  let code: string | undefined;
  await expect.poll(async () => code = await sentOtp(baseURL, email, purpose)).toMatch(/^\d{6}$/);
  return code!;
}

async function memberId(page: Page) {
  const response = await page.request.get("/api/me");
  expect(response.ok()).toBe(true);
  return (await response.json() as { id: string }).id;
}

async function registration(page: Page, email: string) {
  await page.goto("/login");
  await button(page, "注册").click();
  await field(page, "姓名").fill("浏览器队员");
  await field(page, "邮箱").fill(email);
  await field(page, "设置密码").fill(originalPassword);
}

async function signUp(page: Page, email: string) {
  await registration(page, email);
  await button(page, "创建并进入").click();
  await expect(heading(page, "我的队伍")).toBeVisible();
}

async function account(page: Page) {
  await page.getByRole("link", { name: "账号设置", exact: true }).click();
  await expect(heading(page, "账号设置")).toBeVisible();
}

async function signOut(page: Page) {
  if (!new URL(page.url()).pathname.startsWith("/account")) await account(page);
  await button(page, "退出登录").click();
  await expect(heading(page, "登录训练工作区")).toBeVisible();
}
async function signIn(page: Page, email: string, password: string) {
  await field(page, "邮箱").fill(email);
  await field(page, "密码").fill(password);
  await button(page, "登录").click();
}

test("registration isolates credentials and submits autofilled values without a change event", async ({ page }) => {
  await page.goto("/login");
  const email = address();
  await field(page, "邮箱").fill(email);
  await field(page, "密码").fill("only for sign-in");
  const signInForm = page.locator("form").filter({ has: field(page, "密码") });
  const oldForm = await signInForm.elementHandle();
  await button(page, "注册").click();
  expect(await oldForm!.evaluate(form => form.isConnected)).toBe(false);
  const password = field(page, "设置密码");
  await expect(password).toHaveValue("");
  await expect(password).toHaveAttribute("autocomplete", "new-password");
  await expect(field(page, "邮箱")).toHaveValue(email);
  await expect(field(page, "邮箱")).toHaveAttribute("autocomplete", "username");
  await expect(page.getByRole("form", { name: "创建账号" })).toHaveAttribute("method", "post");
  await field(page, "姓名").fill("   ");
  expect(await field(page, "姓名").evaluate((input: HTMLInputElement) => input.validity.patternMismatch)).toBe(true);
  await field(page, "姓名").fill("浏览器队员");

  // Some autofill tools write directly to the input without firing React's change event.
  await password.evaluate((input: HTMLInputElement, value) => { input.value = value; }, originalPassword);
  await button(page, "显示密码").click();
  await expect(password).toHaveAttribute("type", "text");
  await expect(password).toHaveValue(originalPassword);
  await button(page, "显示密码").click();
  await expect(password).toHaveAttribute("type", "password");
  await button(page, "创建并进入").click();
  await expect(heading(page, "我的队伍")).toBeVisible();
  await signOut(page);
  await signIn(page, email, originalPassword);
  await expect(heading(page, "账号设置")).toBeVisible();
});

test("a temporary session lookup failure keeps the requested account page recoverable", async ({ page }) => {
  await signUp(page, address());
  await page.route("**/api/me", route => route.fulfill({ status: 503, body: "" }));
  await page.goto("/account");
  await expect(heading(page, "无法读取登录状态")).toBeVisible();
  await expect(field(page, "密码")).toHaveCount(0);
  await page.unroute("**/api/me");
  await button(page, "重新加载").click();
  await expect(heading(page, "账号设置")).toBeVisible();
});

test("a signed-in login link restores its destination and account settings can retry", async ({ page }) => {
  await signUp(page, address());
  await page.route("**/api/account/sessions", route => route.fulfill({ status: 503, body: "" }));
  await page.goto("/login?next=%2Faccount");
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByRole("alert")).toContainText("读取账号设置失败");
  await expect(button(page, "关联 GitHub")).toHaveCount(0);
  await page.unroute("**/api/account/sessions");
  await button(page, "重新加载").click();
  await expect(button(page, "修改密码")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("password login preserves the member after reload and recovers from a mistyped password", async ({ page }) => {
  const email = address();
  await signUp(page, email);
  const id = await memberId(page);
  await page.reload();
  await expect(heading(page, "我的队伍")).toBeVisible();
  expect(await memberId(page)).toBe(id);
  await signOut(page);
  await signIn(page, email, "not the password");
  await expect(page.getByRole("alert")).toContainText("邮箱或密码不正确");
  await expect(field(page, "密码")).toBeFocused();
  await expect(field(page, "邮箱")).toHaveValue(email);
  await signIn(page, email, originalPassword);
  await expect(heading(page, "账号设置")).toBeVisible();
  expect(await memberId(page)).toBe(id);
});

test("a failed registration request preserves the form for retry", async ({ page }) => {
  const email = address();
  await registration(page, email);
  await page.route("**/api/auth/sign-up/email", route => route.abort());
  await button(page, "创建并进入").click();
  await expect(page.getByRole("alert")).toContainText("网络异常");
  await expect(button(page, "创建并进入")).toBeEnabled();
  await expect(field(page, "邮箱")).toHaveValue(email);
  await page.unroute("**/api/auth/sign-up/email");
  await button(page, "创建并进入").click();
  await expect(heading(page, "我的队伍")).toBeVisible();
});

test("email login verifies the mailbox and preserves the requested invitation", async ({ page, baseURL }) => {
  const email = address();
  await signUp(page, email);
  const id = await memberId(page);
  await signOut(page);
  const invite = "/invite/example?next=%2Fdevice%2F123";
  await page.goto(invite);
  await button(page, "验证码登录").click();
  await field(page, "邮箱").fill(email);
  await button(page, "获取验证码").click();
  const otp = await receiveCode(baseURL!, email, "登录");
  const input = field(page, "邮箱验证码");
  await input.fill(otp === "000000" ? "000001" : "000000");
  await button(page, "验证并登录").click();
  await expect(page.getByRole("alert")).toContainText("验证码不正确");
  await expect(input).toBeFocused();
  await input.fill(otp);
  await button(page, "验证并登录").click();
  await expect(heading(page, "加入队伍")).toBeVisible();
  await expect(page).toHaveURL(invite);
  expect(await memberId(page)).toBe(id);
});

test("changing a password requires the current password and preserves the active browser", async ({ page }) => {
  const email = address();
  await signUp(page, email);
  await account(page);
  await button(page, "修改密码").click();
  await expect(page.getByRole("dialog").locator('input[autocomplete="username"]')).toHaveValue(email);
  await expect(field(page, "当前密码")).toBeFocused();
  await field(page, "当前密码").fill("not the password");
  await field(page, "新密码").fill(newPassword);
  await field(page, "确认新密码").fill(newPassword);
  await button(page, "保存密码").click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(field(page, "当前密码")).toBeFocused();
  await field(page, "当前密码").fill(originalPassword);
  await button(page, "保存密码").click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.reload();
  await expect(heading(page, "账号设置")).toBeVisible();
  await signOut(page);
  await signIn(page, email, newPassword);
  await expect(heading(page, "账号设置")).toBeVisible();
});

test("GitHub binding offers existing account login methods", async ({ page }) => {
  await page.goto("/github/choice?bind=1");
  await expect(heading(page, "登录训练工作区")).toBeVisible();
  await expect(button(page, "注册")).toHaveCount(0);
  await expect(page.getByText("验证已有账号后绑定这个 GitHub 身份。")).toBeVisible();
});

for (const firstPassword of [false, true]) {
  test(firstPassword ? "an OTP-only member sets a first password from account settings"
    : "a signed-out member recovers a forgotten password and returns to the requested page",
  async ({ page, baseURL }) => {
    const email = address();
    if (firstPassword) {
      await page.goto("/login");
      await button(page, "验证码登录").click();
      await field(page, "邮箱").fill(email);
      await button(page, "获取验证码").click();
      await field(page, "邮箱验证码").fill(await receiveCode(baseURL!, email, "登录"));
      await button(page, "验证并登录").click();
      await expect(heading(page, "我的队伍")).toBeVisible();
      await account(page);
      await expect(page.getByText("尚未设置密码，可通过邮箱验证码设置")).toBeVisible();
      await button(page, "设置密码").click();
    } else {
      await signUp(page, email);
      await signOut(page);
      await field(page, "邮箱").fill(email);
      await page.getByRole("link", { name: "忘记密码？" }).click();
    }
    const action = firstPassword ? "设置密码" : "重置密码";
    await expect(heading(page, action)).toBeVisible();
    await expect(field(page, "注册邮箱")).toHaveValue(email);
    await button(page, "获取重置验证码").click();
    const code = await receiveCode(baseURL!, email, "重置密码");
    await expect(page.locator('#reset-password-form input[autocomplete="username"]')).toHaveValue(email);
    await field(page, "邮箱验证码").fill(code === "000000" ? "000001" : "000000");
    await field(page, "新密码").fill(newPassword);
    await field(page, "确认新密码").fill(newPassword);
    await button(page, action).click();
    await expect(page.getByRole("alert")).toContainText("验证码不正确");
    await expect(field(page, "邮箱验证码")).toBeFocused();
    await field(page, "邮箱验证码").fill(code);
    await button(page, action).click();
    await expect(heading(page, "密码已更新")).toBeVisible();
    await button(page, "重新登录").click();
    await expect(field(page, "邮箱")).toHaveValue(email);
    await signIn(page, email, newPassword);
    await expect(heading(page, "账号设置")).toBeVisible();
    await expect(button(page, "修改密码")).toBeVisible();
  });
}
