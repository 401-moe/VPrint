import { expect, test, type Page } from "@playwright/test";

const readingLink = (page: Page) => page.getByRole("link", { name: "阅读体验", includeHidden: true });

const sampleRegion = (page: Page) => page.getByRole("region", { name: "A.cpp 示例代码" });
const printStatus = (page: Page) => page.locator("[data-print-status]");
const runButton = (page: Page) => page.getByRole("button", { name: "运行打印演示" });
const receivedPanel = (page: Page) => page.locator(".try-received");

async function expectDelivered(page: Page) {
  await expect(page.locator(".try-panel")).toHaveAttribute("data-phase", "received");
  await expect(printStatus(page)).toHaveText("已送达");
  await expect(page.locator(".try-received")).toBeVisible();
}

async function layout(page: Page) {
  return page.evaluate(() => {
    const panel = document.querySelector(".try-panel")!;
    const received = document.querySelector(".try-received")!;
    const scroller = document.scrollingElement!;
    return {
      panelHeight: panel.getBoundingClientRect().height,
      pageHeight: scroller.scrollHeight,
      scrollTop: scroller.scrollTop,
      receivedVisible: received.checkVisibility(),
    };
  });
}

test.describe("public homepage", () => {
  test.use({ javaScriptEnabled: false });

  test("a guest can read the headline and sample and reach the workspace", async ({ page }) => {
    await page.goto("/");
    const heading = page.getByRole("heading", { level: 1 });
    await expect(heading).toContainText("少一次传文件");
    await expect(heading).toContainText("多一个人想题");
    await expect(page.getByRole("link", { name: "进入工作区" })).toHaveAttribute("href", "/workspace");
    await expect(page.getByRole("link", { name: "开始一场训练" }).first()).toHaveAttribute("href", "/workspace");
    await expect(readingLink(page)).toHaveAttribute("href", "#shared-reading");
    // The navigation links are hidden below the desktop breakpoint, so only a
    // desktop viewport can follow the anchor; both projects still check the href.
    if (test.info().project.name === "desktop") {
      await readingLink(page).click();
      await expect(page).toHaveURL(/#shared-reading$/);
      await expect(page.locator("#shared-reading")).toBeInViewport();
    }
    await expect(sampleRegion(page).first()).toContainText("return dist[u];");
    await expect(sampleRegion(page).first()).toBeVisible();
    await expect(runButton(page)).toBeHidden();
    // The production page must not ship the prototype switcher or its variant hooks.
    await expect(page.locator(".proto-picker, [data-variant], [data-active], .direction-start")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "登录训练工作区" })).toHaveCount(0);
  });
});

test.describe("public homepage with JavaScript", () => {
  test.use({ javaScriptEnabled: true });

  test("a printout arrives in a single reader without shifting the page", async ({ page }) => {
    await page.goto("/");
    const panel = page.locator(".try-panel");
    await expect(panel).toHaveAttribute("data-phase", "idle");
    await expect(printStatus(page)).toHaveText("待接收");
    await expect(page.locator(".try-empty")).toBeVisible();
    await expect(receivedPanel(page)).toBeHidden();
    await expect(runButton(page)).toBeEnabled();

    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const before = await layout(page);
    await runButton(page).click();
    await expect(printStatus(page)).toHaveText("正在传递");
    await expect(runButton(page)).toBeDisabled();
    await expectDelivered(page);
    await expect(page.locator(".try-empty")).toBeHidden();
    await expect(runButton(page)).toBeEnabled();
    await expect(receivedPanel(page).locator(".reader-window")).toHaveCount(1);
    await expect(sampleRegion(page)).toHaveCount(1);
    await expect(sampleRegion(page)).toContainText("return dist[u];");

    const after = await layout(page);
    expect(after.panelHeight).toBeCloseTo(before.panelHeight, 2);
    expect(after.pageHeight).toBe(before.pageHeight);
    expect(after.scrollTop).toBe(before.scrollTop);
    expect(after.receivedVisible).toBe(true);

    await runButton(page).click();
    await expectDelivered(page);
    await expect(receivedPanel(page).locator(".reader-window")).toHaveCount(1);
    await expect(sampleRegion(page)).toHaveCount(1);
    expect((await layout(page)).pageHeight).toBe(after.pageHeight);
    await expect(runButton(page)).toBeEnabled();
  });

  test("a single run delivers the printout under reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await expect(runButton(page)).toBeEnabled();
    await runButton(page).click();
    await expectDelivered(page);
    await expect(page.locator(".try-empty")).toBeHidden();
    await expect(receivedPanel(page).locator(".reader-window")).toBeVisible();
    await expect(sampleRegion(page)).toHaveCount(1);
  });

  test("copying the login command writes the exact command to the clipboard", async ({ page }) => {
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/");
    const command = page.locator(".command").filter({ hasText: "vprint login" });
    await expect(command).toHaveCount(1);
    const button = command.getByRole("button");
    await expect(button).toBeEnabled();
    await button.click();
    await expect(command.getByRole("status")).toHaveText("已复制命令");
    await expect(button).toHaveAttribute("aria-label", "已复制 vprint login");
    await expect(button).toBeEnabled();
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe("vprint login");
    await expect(command.locator("code")).toHaveText("$ vprint login");
  });
});
