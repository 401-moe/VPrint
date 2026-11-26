import { expect, test, type Page } from "@playwright/test";

async function register(page: Page, name: string) {
  await page.getByRole("button", { name: "注册", exact: true }).click();
  await page.getByLabel("姓名").fill(name);
  await page.getByLabel("邮箱", { exact: true }).fill(`team-${crypto.randomUUID()}@vprint.example`);
  await page.getByLabel("设置密码", { exact: true }).fill("correct horse battery staple");
  await page.getByRole("button", { name: "创建并进入" }).click();
}

async function createTeam(page: Page, name: string) {
  await page.getByRole("button", { name: "新建队伍" }).first().click();
  await page.getByLabel("队伍名称").fill(name);
  await page.getByRole("button", { name: "创建队伍" }).click();
  await expect(page.getByRole("heading", { name: "比赛列表" })).toBeVisible();
  await expect(page.getByRole("link", { name })).toBeVisible();
}

async function createContest(page: Page, name: string) {
  await page.getByRole("button", { name: "新建比赛" }).first().click();
  await page.getByLabel("比赛名称").fill(name);
  await page.getByRole("button", { name: "创建比赛" }).click();
  await expect(
    page.getByRole("list", { name: "比赛" }).getByRole("link", { name: new RegExp(name) }),
  ).toBeVisible();
}

async function signOut(page: Page) {
  await page.goto("/account");
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(page.getByRole("button", { name: "注册", exact: true })).toBeVisible();
}

test("an owner creates a team and contests, then a teammate explicitly joins by invitation", async ({
  page,
}) => {
  await page.goto("/login");
  await register(page, "浏览器建队者");
  await createTeam(page, "火苗");
  await createContest(page, "周六训练");
  await createContest(page, "周日训练");
  const rows = page.getByRole("list", { name: "比赛" }).getByRole("listitem");
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText("周日训练");

  await page.getByRole("link", { name: "队伍设置" }).click();
  await expect(page.getByRole("heading", { name: "队伍设置" })).toBeVisible();
  const link = page.getByRole("textbox", { name: "邀请链接" });
  await expect(link).toHaveValue(/\/invite\/[a-f0-9]{32}$/);
  const invitation = await link.inputValue();

  await signOut(page);
  await page.goto(invitation);
  await register(page, "浏览器队友");
  await page.getByRole("button", { name: "加入队伍" }).click();
  await expect(page.getByRole("heading", { name: "比赛列表" })).toBeVisible();
  await expect(rows).toHaveCount(2);

  await page.getByRole("link", { name: "队伍设置" }).click();
  await expect(page.getByRole("button", { name: "退出队伍" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "邀请链接" })).toHaveCount(0);
});

test("a multi-team user returns from a deep link to its team and an outsider sees denial", async ({
  page,
}) => {
  await page.goto("/login");
  await register(page, "多队队员");
  await createTeam(page, "第一队");
  await createContest(page, "第一队训练");
  const firstTeamPath = new URL(page.url()).pathname;
  const contestPath = await page
    .getByRole("link", { name: /第一队训练/ })
    .getAttribute("href");
  expect(contestPath).toMatch(new RegExp(`^${firstTeamPath}/contest/[a-f0-9-]+$`));

  await page.getByRole("link", { name: "所有队伍", exact: true }).click();
  await expect(page.getByRole("heading", { name: "我的队伍" })).toBeVisible();
  await createTeam(page, "第二队");
  const secondTeamPath = new URL(page.url()).pathname;
  const mismatchedPath = contestPath!.replace(firstTeamPath, secondTeamPath);
  for (const suffix of ["", "/settings", `/print/${crypto.randomUUID()}`]) {
    await page.goto(mismatchedPath + suffix);
    await expect(page.getByRole("heading", { name: "无法访问比赛" })).toBeVisible();
    await expect(page.getByRole("link", { name: "第一队训练" })).toHaveCount(0);
  }

  await page.goto(contestPath!);
  await expect(page.getByRole("heading", { name: "打印列表" })).toBeVisible();
  await page.getByRole("link", { name: "返回比赛列表" }).click();
  await expect(page.getByRole("heading", { name: "比赛列表" })).toBeVisible();
  await expect(page.getByRole("link", { name: "第一队", exact: true })).toBeVisible();

  await signOut(page);
  await register(page, "队外队员");
  await expect(page.getByRole("heading", { name: "账号设置", exact: true })).toBeVisible();
  await page.goto(contestPath!);
  await expect(page.getByRole("heading", { name: "无法访问比赛" })).toBeVisible();
  await expect(page.getByRole("link", { name: "返回所有队伍" })).toBeVisible();
});

test("creating a team succeeds when remembering its selection fails", async ({ page }) => {
  await page.goto("/login");
  await register(page, "建队者");
  let creations = 0;
  page.on("request", request => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/teams") creations++;
  });
  await page.route("**/api/teams/*/selection", route => route.fulfill({ status: 503 }));
  const preference = page.waitForResponse("**/api/teams/*/selection");
  await createTeam(page, "只创建一次");
  expect((await preference).status()).toBe(503);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("link", { name: "所有队伍", exact: true }).click();
  await expect(page.getByRole("list", { name: "队伍" }).getByRole("listitem")).toHaveCount(1);
  expect(creations).toBe(1);
});

test("a long account name leaves the narrow header and its links usable", async ({ page }) => {
  const name = "竞赛队员".repeat(8);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/login");
  await register(page, name);
  await createTeam(page, "小屏幕上的队伍");
  const header = page.getByRole("banner");
  const account = header.getByRole("link", { name, exact: true });
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    const accountBox = await account.boundingBox();
    const navBox = await header.getByRole("navigation").boundingBox();
    expect(navBox!.x + navBox!.width).toBeLessThanOrEqual(accountBox!.x);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
  await account.click();
  await expect(page.getByRole("heading", { name: "账号设置" })).toBeVisible();
});

test("back during team creation dismisses the dialog and keeps the chosen page", async ({ page }) => {
  await page.goto("/login");
  await register(page, "建队者");
  await createTeam(page, "原队伍");
  const original = page.url();
  await page.getByRole("link", { name: "返回所有队伍" }).click();
  await page.getByRole("button", { name: "新建队伍" }).click();
  await page.getByLabel("队伍名称").fill("后台创建的新队");

  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/teams", async route => { await gate; await route.continue(); });
  const request = page.waitForRequest("**/api/teams");
  const response = page.waitForResponse("**/api/teams");
  await page.getByRole("button", { name: "创建队伍" }).click();
  await request;
  try {
    await page.goBack();
    await expect(page).toHaveURL(original);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  } finally {
    release();
  }
  expect((await response).status()).toBe(201);
  await expect(page.getByRole("link", { name: "原队伍", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "返回所有队伍" }).click();
  await expect(page.getByRole("list").getByRole("link", { name: /后台创建的新队/ })).toBeVisible();
});

test("visiting subpages remembers a team once and marks the last visit on the overview", async ({ page }) => {
  await page.goto("/login");
  await register(page, "多队队员");
  const writes: string[] = [];
  page.on("request", request => {
    if (request.method() === "PUT" && request.url().endsWith("/selection")) writes.push(new URL(request.url()).pathname);
  });
  await createTeam(page, "甲队");
  const first = new URL(page.url()).pathname;
  await createContest(page, "周末");
  await page.getByRole("link", { name: /周末/ }).click();
  await page.getByRole("link", { name: "比赛设置" }).click();
  await page.getByRole("link", { name: "返回打印列表" }).click();
  await page.getByRole("link", { name: "返回比赛列表" }).click();
  await page.getByRole("link", { name: "队伍设置" }).click();
  await page.getByRole("link", { name: "所有队伍", exact: true }).click();
  await expect(page.getByRole("link", { name: /甲队.*最近访问/ })).toBeVisible();
  await createTeam(page, "乙队");
  const second = new URL(page.url()).pathname;
  await page.getByRole("link", { name: "返回所有队伍" }).click();
  await expect(page.getByRole("link", { name: /乙队.*最近访问/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("link", { name: /乙队.*最近访问/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /甲队.*最近访问/ })).toHaveCount(0);
  await page.getByRole("link", { name: /乙队.*最近访问/ }).click();
  await expect(page.getByRole("heading", { name: "比赛列表" })).toBeVisible();
  expect(writes).toEqual([first, second].map(path => path.replace("/team/", "/api/teams/") + "/selection"));
});

for (const kind of ["team", "contest"] as const) {
  test(`a pending ${kind} rename preserves newer input`, async ({ page }) => {
    await page.goto("/login");
    await register(page, "队长");
    await createTeam(page, "原队");
    if (kind === "contest") {
      await createContest(page, "原比赛");
      await page.getByRole("link", { name: /原比赛/ }).click();
    }
    const label = kind === "team" ? "队伍" : "比赛";
    await page.getByRole("link", { name: label + "设置" }).click();
    const field = page.getByLabel(label + "名称", { exact: true });
    const save = page.getByRole("button", { name: "保存名称" });
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const endpoint = `**/api/${kind}s/*`;
    await page.route(endpoint, async route => { await gate; await route.continue(); }, { times: 1 });
    await field.fill("第一版");
    const request = page.waitForRequest(r => r.method() === "PATCH");
    await save.click();
    await request;
    try {
      await field.fill("第二版");
    } finally {
      release();
    }
    const breadcrumb = page.getByRole("banner").getByRole("link", { name: "第一版", exact: true });
    await expect(breadcrumb).toBeVisible();
    await expect(field).toHaveValue("第二版");
    await save.click();
    await expect(page.getByRole("banner").getByRole("link", { name: "第二版", exact: true })).toBeVisible();
    await page.reload();
    await expect(field).toHaveValue("第二版");
    await expect(save).toBeDisabled();
  });
}
