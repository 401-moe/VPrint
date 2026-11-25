import { expect, test, type Page } from "@playwright/test";

async function register(page: Page, name: string) {
  await page.getByRole("button", { name: "注册", exact: true }).click();
  await page.getByLabel("姓名").fill(name);
  await page.getByLabel("邮箱", { exact: true }).fill(`team-${crypto.randomUUID()}@vprint.example`);
  await page.getByLabel("设置密码", { exact: true }).fill("correct horse battery staple");
  await page.getByRole("button", { name: "创建并进入" }).click();
}

async function createTeam(page: Page, name: string) {
  await page.getByLabel("队伍名称").fill(name);
  await page.getByRole("button", { name: "创建队伍" }).click();
  await expect(page.getByRole("button", { name: `切换队伍，当前为${name}` })).toBeVisible();
}

async function createContest(page: Page, name: string) {
  await page.getByRole("button", { name: "新建比赛" }).click();
  await page.getByLabel("比赛名称").fill(name);
  await page.getByRole("button", { name: "创建比赛" }).click();
  await expect(page.getByRole("list", { name: "比赛" }).getByRole("link", { name: new RegExp(name) })).toBeVisible();
}

async function signOut(page: Page) {
  await page.getByRole("link", { name: "账号设置", exact: true }).click();
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(page.getByRole("button", { name: "注册", exact: true })).toBeVisible();
}

test("an owner creates a team and contests, then a teammate explicitly joins by invitation", async ({ page }) => {
  await page.goto("/login");
  await register(page, "浏览器建队者");
  await page.getByRole("button", { name: "新建队伍" }).click();
  await createTeam(page, "火苗");
  await createContest(page, "周六训练");
  await createContest(page, "周日训练");
  const rows = page.getByRole("list", { name: "比赛" }).getByRole("listitem");
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText("周日训练");

  await page.getByRole("link", { name: "队伍设置" }).click();
  await page.getByRole("button", { name: "邀请队员" }).click();
  const link = page.getByRole("textbox", { name: "邀请链接" });
  await expect(link).toHaveValue(/\/invite\/[a-f0-9]{32}$/);
  const invitation = await link.inputValue();
  await page.keyboard.press("Escape");
  await signOut(page);
  await page.goto(invitation);
  await register(page, "浏览器队友");
  await page.getByRole("button", { name: "加入队伍" }).click();
  await expect(page.getByRole("button", { name: "切换队伍，当前为火苗" })).toBeVisible();
  await expect(rows).toHaveCount(2);
  await page.getByRole("link", { name: "队伍设置" }).click();
  await expect(page.getByRole("button", { name: "退出队伍" })).toBeVisible();
  await expect(page.getByRole("button", { name: "邀请队员" })).toHaveCount(0);
});

test("a multi-team user returns from a deep link to its team and an outsider sees denial", async ({ page }) => {
  await page.goto("/login");
  await register(page, "多队队员");
  await page.getByRole("button", { name: "新建队伍" }).click();
  await createTeam(page, "第一队");
  await createContest(page, "第一队训练");
  const contestPath = await page.getByRole("link", { name: /第一队训练/ }).getAttribute("href");
  expect(contestPath).toMatch(/^\/contest\//);
  await page.getByRole("button", { name: /切换队伍/ }).click();
  await page.getByRole("menuitem", { name: "新建队伍" }).click();
  await createTeam(page, "第二队");
  await page.goto(contestPath!);
  await expect(page.getByRole("heading", { name: "第一队训练" })).toBeVisible();
  await page.getByRole("link", { name: "返回工作台" }).click();
  await expect(page.getByRole("button", { name: "切换队伍，当前为第一队" })).toBeVisible();

  await signOut(page);
  await register(page, "队外队员");
  await expect(page.getByRole("heading", { name: "账号设置", exact: true })).toBeVisible();
  await page.goto(contestPath!);
  await expect(page.getByRole("heading", { name: "无法访问比赛" })).toBeVisible();
  await expect(page.getByRole("link", { name: "返回工作台" })).toBeVisible();
});
