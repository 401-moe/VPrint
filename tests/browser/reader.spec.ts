import { expect, test } from "@playwright/test";

const contestId = "7b27b4b5-b5d1-4d5e-b9f4-0f63c5341ae4";
const printId = "53fec5ec-2519-40ce-aa7b-082b2ba40e41";
const teamId = "11111111-1111-4111-8111-111111111111";
const contestPath = `/team/${teamId}/contest/${contestId}`;
const createdAt = Date.UTC(2026, 10, 21, 5, 0);
const workspace = {
  teams: [{ id: teamId, name: "火苗", role: "owner", invitationUrl: "", memberCount: 1, contestCount: 1 }],
  contests: [],
  selectedTeamId: teamId,
  contest: { id: contestId, name: "训练", createdAt, teamId },
};
const lines = Array.from({ length: 120 }, (_, i) =>
  i === 36 ? '  return "ok"; // done ' + "x".repeat(280) : "// 文件 " + (i + 1),
);
const content = lines.join("\n") + "\n";

for (const width of [390, 1280]) {
  test(
    "the independent highlighted reader preserves source and scrolls at width " +
      width,
    async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.route("**/api/me", (route) =>
        route.fulfill({ json: { id: "member", name: "甲", email: "reader@example.test" } }),
      );
      await page.route("**/api/workspace?**", (route) =>
        route.fulfill({ json: workspace }),
      );
      await page.route("**/api/contests/*/prints/*", (route) =>
        route.fulfill({ json: { filename: "A.cpp", createdAt: 1000, content } }),
      );
      await page.goto(`${contestPath}/print/${printId}`);
      await expect(page.getByRole("heading", { name: "A.cpp", exact: true })).toBeVisible();
      await expect(page.getByText("120 行")).toBeVisible();
      const source = page.getByRole("region", { name: "源码" });
      await expect(source.locator(".hljs-keyword")).toHaveText("return");
      await expect(source.locator(".hljs-string")).toHaveText('"ok"');
      await expect(source.locator(".hljs-comment")).toHaveCount(120);
      expect(await source.locator("code").textContent()).toBe(content);
      expect(
        (await source.locator("[data-lines]").getAttribute("data-lines"))?.split("\n"),
      ).toHaveLength(120);
      expect(
        await source.evaluate((el) => el.scrollWidth > el.clientWidth),
      ).toBe(true);
      const selected = await source.locator("code").evaluate((code) => {
        const range = document.createRange();
        const keyword = code.querySelector(".hljs-keyword")!;
        const nextLine = Array.from(code.querySelectorAll(".hljs-comment")).find(
          (node) => node.textContent === "// 文件 38",
        )!;
        range.setStartBefore(keyword);
        range.setEndAfter(nextLine);
        const selection = window.getSelection()!;
        selection.removeAllRanges();
        selection.addRange(range);
        return selection.toString();
      });
      expect(selected).toBe(lines[36].trimStart() + "\n" + lines[37]);
      const found = await page.evaluate(() => {
        window.getSelection()?.removeAllRanges();
        return (
          window as unknown as Window & { find(query: string): boolean }
        ).find('return "ok"; // done');
      });
      expect(found).toBe(true);
      await expect(
        page.getByRole("link", { name: "返回打印列表" }),
      ).toHaveAttribute("href", contestPath);
      await expect(page.getByRole("list", { name: "打印件" })).toHaveCount(0);
    },
  );
}

test("the print list shows languages, duplicate counts, and level navigation", async ({
  page,
}) => {
  const records = [
    { id: printId, filename: "A.cpp", createdAt: Date.UTC(2026, 10, 21, 6, 32, 8), authorName: "甲" },
    { id: "8bbdea0a-7875-43b5-a248-3816ee98d783", filename: "gen.py", createdAt: Date.UTC(2026, 10, 21, 5, 56, 12), authorName: "乙" },
    { id: "4dbcb66d-d124-4ad7-96dc-45c17d478bf1", filename: "A.cpp", createdAt: Date.UTC(2026, 10, 21, 5, 10, 0), authorName: "甲" },
  ];
  await page.route("**/api/me", (route) =>
    route.fulfill({ json: { id: "member", name: "甲", email: "reader@example.test" } }),
  );
  await page.route("**/api/workspace?**", (route) =>
    route.fulfill({ json: workspace }),
  );
  await page.route("**/api/contests/*/prints", (route) =>
    route.fulfill({ json: { printouts: records } }),
  );
  await page.goto(contestPath);
  const list = page.getByRole("region", { name: "打印件列表" });
  await expect(list.getByRole("link", { name: /A\.cpp/ }).first()).toHaveAttribute(
    "href",
    `${contestPath}/print/${printId}`,
  );
  await expect(list.getByText("14:32:08")).toBeVisible();
  await expect(list.getByText("第 2 次打印")).toBeVisible();
  await expect(list.getByText("C++").first()).toBeVisible();
  await expect(list.getByText("Python")).toBeVisible();
  await expect(page.getByRole("link", { name: "返回比赛列表" })).toHaveAttribute(
    "href",
    "/team/" + teamId,
  );
  await expect(page.getByRole("link", { name: "比赛设置" })).toHaveAttribute(
    "href",
    `${contestPath}/settings`,
  );
});

test("opening a print and returning keeps the contest document and its subscription alive", async ({
  page,
}) => {
  const list = contestPath;
  const reader = list + "/print/" + printId;
  const records = Array.from({ length: 48 }, (_, i) => ({
    id: i === 20 ? printId : crypto.randomUUID(),
    filename: i === 20 ? "A.cpp" : `file-${i}.in`,
    createdAt: 1000 - i,
  }));
  await page.route("**/api/me", (route) =>
    route.fulfill({ json: { id: "member", name: "甲", email: "reader@example.test" } }),
  );
  await page.route("**/api/workspace?**", (route) =>
    route.fulfill({ json: workspace }),
  );
  await page.route("**/api/contests/*/prints", (route) =>
    route.fulfill({ json: { printouts: records } }),
  );
  await page.route("**/api/contests/*/prints/*", (route) =>
    route.fulfill({ json: { ...records[20], content } }),
  );
  await page.goto(list);
  const link = page.getByRole("link", { name: /A\.cpp/ });
  await link.scrollIntoViewIfNeeded();
  const scroll = await page.evaluate(() => {
    document.documentElement.dataset.instance = "original";
    return window.scrollY;
  });
  expect(scroll).toBeGreaterThan(0);
  await link.click();
  await expect(page).toHaveURL(new RegExp(reader + "$"));
  await expect(page.getByRole("heading", { name: "A.cpp" })).toBeVisible();
  await page.goBack();
  await expect(link).toBeFocused();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(scroll);
  await page.goForward();
  await page.getByRole("link", { name: "返回打印列表" }).click();
  await expect(link).toBeFocused();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(scroll);
  await expect(page.locator("html")).toHaveAttribute("data-instance", "original");
});

test("a contest recovers from an initial network failure without reloading the page", async ({
  page,
}) => {
  let sessionRequests = 0;
  let listRequests = 0;
  await page.route("**/api/me", (route) =>
    route.fulfill({ json: { id: "member", name: "甲", email: "reader@example.test" } }),
  );
  await page.route("**/api/workspace?**", (route) =>
    route.fulfill({ json: workspace }),
  );
  await page.route("**/api/notification-session", (route) => {
    sessionRequests++;
    return sessionRequests === 1
      ? route.fulfill({ status: 503 })
      : route.fulfill({ json: { id: "reader-session" } });
  });
  await page.route("**/api/contests/*/prints", (route) => {
    listRequests++;
    return listRequests === 1
      ? route.fulfill({ status: 503 })
      : route.fulfill({
          json: { printouts: [{ id: printId, filename: "A.cpp", createdAt: 1000 }] },
        });
  });
  // Use the tab-hosted transport so Playwright can intercept its WebSocket.
  await page.addInitScript(() => {
    Object.defineProperty(window, "SharedWorker", { value: undefined });
  });
  await page.routeWebSocket("**/api/notifications", (socket) => {
    socket.onMessage(() =>
      socket.send(JSON.stringify({ subscribed: [contestId] })),
    );
  });
  await page.goto(contestPath);
  await expect(page.getByRole("link", { name: /A\.cpp/ })).toBeVisible();
  expect(sessionRequests).toBe(2);
});

test("retired top-level contest links return HTTP 404", async ({ request }) => {
  const oldPath = `/contest/${contestId}`;
  for (const suffix of ["", "/settings", `/print/${printId}`]) {
    const response = await request.get(oldPath + suffix, { maxRedirects: 0 });
    expect(response.status()).toBe(404);
  }
});
