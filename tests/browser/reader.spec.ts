import { expect, test } from "@playwright/test";

const contestId = "7b27b4b5-b5d1-4d5e-b9f4-0f63c5341ae4";
const printId = "53fec5ec-2519-40ce-aa7b-082b2ba40e41";
const lines = Array.from({ length: 120 }, (_, i) => i === 36 ? '  return "ok"; // done ' + "x".repeat(280) : '// 文件 ' + (i + 1));
const content = lines.join("\n") + "\n";

for (const width of [390, 1280]) {
  test("the independent highlighted reader preserves source and scrolls at width " + width, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.route("**/api/me", route => route.fulfill({ json: { id: "member", name: "甲", email: "reader@example.test" } }));
    await page.route("**/api/workspace?**", route => route.fulfill({ json: { teams: [], contests: [], selectedTeamId: null, contest: { id: contestId, name: "训练" } } }));
    await page.route("**/api/contests/*/prints/*", route => route.fulfill({ json: { filename: "A.cpp", createdAt: 1000, content } }));
    await page.goto(`/contest/${contestId}/print/${printId}`);
    const source = page.getByRole("region", { name: "源码" });
    await expect(source.locator(".hljs-keyword")).toHaveText("return");
    await expect(source.locator(".hljs-string")).toHaveText('"ok"');
    await expect(source.locator(".hljs-comment")).toHaveCount(120);
    expect(await source.locator("code").textContent()).toBe(content);
    expect((await source.locator("[data-lines]").getAttribute("data-lines"))?.split("\n")).toHaveLength(120);
    expect(await source.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
    const selected = await source.locator("code").evaluate(code => {
      const range = document.createRange();
      const keyword = code.querySelector(".hljs-keyword")!;
      const nextLine = Array.from(code.querySelectorAll(".hljs-comment")).find(node => node.textContent === "// 文件 38")!;
      range.setStartBefore(keyword);
      range.setEndAfter(nextLine);
      const selection = window.getSelection()!;
      selection.removeAllRanges(); selection.addRange(range);
      return selection.toString();
    });
    expect(selected).toBe(lines[36].trimStart() + "\n" + lines[37]);
    const found = await page.evaluate(() => {
      window.getSelection()?.removeAllRanges();
      return (window as unknown as Window & { find(query: string): boolean }).find('return "ok"; // done');
    });
    expect(found).toBe(true);
    await expect(page.getByRole("link", { name: "返回列表" })).toHaveAttribute("href", "/contest/" + contestId);
    await expect(page.getByRole("list", { name: "打印件" })).toHaveCount(0);
  });
}

test("opening a print and returning keeps the contest document and its subscription alive", async ({ page }) => {
  const list = "/contest/" + contestId;
  const reader = list + "/print/" + printId;
  const record = { id: printId, filename: "A.cpp", createdAt: 1000 };
  await page.route("**/api/me", route => route.fulfill({ json: { id: "member", name: "甲", email: "reader@example.test" } }));
  await page.route("**/api/workspace?**", route => route.fulfill({ json: { teams: [], contests: [], selectedTeamId: null, contest: { id: contestId, name: "训练" } } }));
  await page.route("**/api/contests/*/prints", route => route.fulfill({ json: { printouts: [record] } }));
  await page.route("**/api/contests/*/prints/*", route => route.fulfill({ json: { ...record, content } }));
  await page.goto(list);
  await page.getByRole("link", { name: "A.cpp" }).waitFor();
  await page.evaluate(() => { document.documentElement.dataset.instance = "original"; });
  await page.getByRole("link", { name: "A.cpp" }).click();
  await expect(page).toHaveURL(new RegExp(reader + "$"));
  await expect(page.getByRole("heading", { name: "A.cpp" })).toBeVisible();
  await page.getByRole("link", { name: "返回列表" }).click();
  await expect(page.getByRole("link", { name: "A.cpp" })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("heading", { name: "A.cpp" })).toBeVisible();
  await page.goForward();
  await expect(page.getByRole("link", { name: "A.cpp" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-instance", "original");
});

test("a contest recovers from an initial network failure without reloading the page", async ({ page }) => {
  let sessionRequests = 0;
  let listRequests = 0;
  await page.route("**/api/me", route => route.fulfill({ json: { id: "member", name: "甲", email: "reader@example.test" } }));
  await page.route("**/api/workspace?**", route => route.fulfill({ json: { teams: [], contests: [], selectedTeamId: null, contest: { id: contestId, name: "训练" } } }));
  await page.route("**/api/notification-session", route => {
    sessionRequests++;
    return sessionRequests === 1 ? route.fulfill({ status: 503 }) : route.fulfill({ json: { id: "reader-session" } });
  });
  await page.route("**/api/contests/*/prints", route => {
    listRequests++;
    return listRequests === 1 ? route.fulfill({ status: 503 }) : route.fulfill({ json: { printouts: [{ id: printId, filename: "A.cpp", createdAt: 1000 }] } });
  });
  // Use the tab-hosted transport so Playwright can intercept its WebSocket.
  await page.addInitScript(() => { Object.defineProperty(window, "SharedWorker", { value: undefined }); });
  await page.routeWebSocket("**/api/notifications", socket => {
    socket.onMessage(() => socket.send(JSON.stringify({ subscribed: [contestId] })));
  });
  await page.goto("/contest/" + contestId);
  await expect(page.getByRole("link", { name: "A.cpp" })).toBeVisible();
  expect(sessionRequests).toBe(2);
});
