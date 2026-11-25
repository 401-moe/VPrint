import { expect, test } from "@playwright/test";

test("device authorization waits for the signed-in member to check the code and choose a duration", async ({ page }) => {
  const decisions: unknown[] = [];
  await page.route("**/api/me", route => route.fulfill({ json: { id: "member", name: "队员", email: "runner@example.test" } }));
  await page.route("**/api/cli/device?*", route => route.fulfill({
    json: { userCode: "BCDF-GHJK", hostname: "主机 07", os: "win32", scope: "offline_access vprint:teams:read vprint:print" },
  }));
  await page.route("**/api/cli/device/decision", route => {
    expect(route.request().headers()["x-vprint-device-decision"]).toBe("1");
    decisions.push(route.request().postDataJSON());
    return route.fulfill({ json: { success: true } });
  });
  await page.goto("/device?user_code=BCDF-GHJK");
  await expect(page.getByLabel("终端短码")).toHaveValue("BCDF-GHJK", { timeout: 2000 });
  await page.getByRole("button", { name: "核对短码" }).click();
  await expect(page.getByText("主机 07")).toBeVisible();
  await expect(page.getByText("runner@example.test")).toBeVisible();
  await expect(page.getByText("选择队伍和比赛、提交打印件")).toBeVisible();
  const remember = page.getByRole("checkbox", { name: "在这台比赛主机上保持登录 30 天" });
  await expect(remember).not.toBeChecked();
  expect(decisions).toEqual([]);
  await remember.check();
  await page.getByRole("button", { name: "批准登录" }).click();
  await expect(page.getByRole("heading", { name: "已批准主机登录" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "已批准主机登录" })).toBeFocused();
  await expect(page.getByText("CLI 会话有效期为 30 天。")).toBeVisible();
  expect(decisions).toEqual([{ userCode: "BCDF-GHJK", approve: true, keepSignedIn: true }]);
});

test("device authorization keeps an invalid code editable and announces the error", async ({ page }) => {
  let requests = 0;
  await page.route("**/api/me", route => route.fulfill({ json: { id: "member", name: "队员", email: "runner@example.test" } }));
  await page.route("**/api/cli/device?*", route => {
    requests++;
    return route.fulfill({ status: 404, json: { error: "user code not found" } });
  });
  await page.goto("/device?user_code=WRONG-CODE");
  const code = page.getByLabel("终端短码");
  await expect(code).toBeFocused();
  await page.getByRole("button", { name: "核对短码" }).click();
  await expect(page.getByRole("alert")).toContainText("短码无效或已过期");
  await expect(code).toHaveAttribute("aria-invalid", "true");
  await code.fill("WRONG-CODE-2");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(code).toHaveAttribute("aria-invalid", "false");
  expect(requests).toBe(1);
});
