import { expect, test } from "@playwright/test";

test.describe("public homepage", () => {
  test.use({ javaScriptEnabled: false });

  test("a guest can read a printout and find the workspace without JavaScript", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("递给队友");
    await expect(page.getByRole("link", { name: "进入训练工作区" })).toHaveAttribute("href", "/login");
    await page.getByRole("link", { name: "试读打印件" }).click();
    await expect(page.getByRole("heading", { name: "队友收到的打印件" })).toBeInViewport();
    await expect(page.getByRole("region", { name: "A.cpp 示例源码" })).toContainText("return a;");
    await expect(page.getByRole("heading", { name: "登录训练工作区" })).toHaveCount(0);
  });
});
