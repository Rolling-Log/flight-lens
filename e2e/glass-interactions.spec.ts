import { expect, test } from "@playwright/test";

test("glass controls retain keyboard navigation and recover after failed sign in", async ({ page }) => {
  let releaseRequest!: () => void;
  const responseGate = new Promise<void>(resolve => { releaseRequest = resolve; });
  let requests = 0;
  await page.route("**/api/auth/sign-in/email", async route => {
    requests++;
    await responseGate;
    await route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid credentials" }) });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "登录航探" });
  const loginTab = dialog.getByRole("tab", { name: "登录", exact: true });
  await loginTab.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "注册", exact: true })).toBeFocused();
  await expect(page.getByLabel("显示名称")).toBeVisible();
  await page.keyboard.press("Home");
  await expect(loginTab).toBeFocused();
  await dialog.getByLabel("邮箱", { exact: true }).fill("glass@example.test");
  await dialog.getByLabel("密码", { exact: true }).fill("test-password-123");
  await dialog.getByRole("button", { name: "登录", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "正在处理…" })).toBeDisabled();
  await expect(loginTab).toBeDisabled();
  await expect.poll(() => requests).toBe(1);
  releaseRequest();
  await expect(dialog.getByRole("status")).toContainText("未完成");
  await expect(dialog.getByRole("button", { name: "登录", exact: true })).toBeEnabled();
  await expect(dialog.getByLabel("邮箱", { exact: true })).toHaveValue("glass@example.test");
  await expect(dialog.getByLabel("密码", { exact: true })).toHaveValue("");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: "登录", exact: true })).toBeFocused();
});

test("glass alert actions keep input and recover after a network error", async ({ page }) => {
  await page.route("**/v2/alerts", async route => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: { alerts: [], delivery: { serverSchedulingConfigured: true } } });
    } else await route.abort("failed");
  });
  await page.goto("/");
  await page.getByRole("button", { name: "开始探索", exact: true }).click();
  await page.getByRole("tab", { name: "精确筛选" }).click();
  await page.getByRole("button", { name: "开始检索" }).click();
  await page.getByRole("button", { name: /价格判断：.*查看详情/ }).click();
  const historyTab = page.getByRole("tab", { name: "历史与判断" });
  await historyTab.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "价格提醒" })).toBeFocused();
  const create = page.getByRole("button", { name: "创建提醒", exact: true });
  await expect(create).toBeDisabled();
  await page.getByLabel("ntfy Topic").fill("glass-state-test");
  await create.click();
  await expect(page.getByRole("dialog", { name: "价格历史与提醒" }).getByRole("status")).toContainText("连接失败");
  await expect(create).toBeEnabled();
  await expect(page.getByLabel("ntfy Topic")).toHaveValue("glass-state-test");
});

test("search grows from its button and closes continuously, without stretching its text", async ({ page }) => {
  await page.goto("/");
  const start = page.getByRole("button", { name: "开始探索", exact: true });
  const dialog = page.getByRole("dialog", { name: "下一站，想去哪里？" });
  const origin = await start.boundingBox();
  // Capture the first painted shell in the click's frame, not after an arbitrary sleep.
  await start.evaluate(button => button.addEventListener("click", () => requestAnimationFrame(() => {
    const host = document.querySelector<HTMLDialogElement>('dialog[aria-labelledby="search-workspace-title"]')!;
    const shape = host.querySelector(".glass-dialog-shape")!;
    (window as typeof window & { morphStart?: unknown }).morphStart = { bounds: shape.getBoundingClientRect().toJSON(), textTransform: getComputedStyle(host.querySelector("h2")!).transform };
  }), { once: true }));
  await start.click();
  await expect(dialog).toBeVisible();
  await expect.poll(() => page.evaluate(() => Boolean((window as typeof window & { morphStart?: unknown }).morphStart))).toBe(true);
  const initial = await page.evaluate(() => (window as typeof window & { morphStart: { bounds: { x: number; y: number; width: number; height: number }; textTransform: string } }).morphStart);
  expect(initial.bounds.width).toBeCloseTo(origin!.width, 0);
  expect(initial.bounds.height).toBeCloseTo(origin!.height, 0);
  expect(initial.bounds.x).toBeCloseTo(origin!.x, 0);
  expect(initial.bounds.y).toBeCloseTo(origin!.y, 0);
  expect(initial.textTransform).toBe("none");
  await expect(dialog).toHaveAttribute("data-motion-state", "settled");
  await expect(dialog.locator(".glass-dialog-shape")).toBeHidden();
  await expect(dialog.locator(".glass-dialog-panel")).toHaveCSS("opacity", "1");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveAttribute("data-motion-state", "closing");
  await expect(dialog).toBeHidden();
  await expect(start).toBeFocused();
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe("hidden");
});

test("opening can be interrupted and reused without a stuck backdrop or lost edits", async ({ page }) => {
  await page.goto("/");
  const start = page.getByRole("button", { name: "开始探索", exact: true });
  const dialog = page.getByRole("dialog", { name: "下一站，想去哪里？" });
  await start.click();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(start).toBeFocused();
  await start.click();
  await dialog.getByRole("textbox").fill("上海去北京，1 位成人。");
  await expect(dialog).toHaveAttribute("data-motion-state", "settled");
  await dialog.getByRole("button", { name: "关闭搜索面板" }).click();
  await expect(dialog).toBeHidden();
  await start.click();
  await expect(dialog.getByRole("textbox")).toHaveValue("上海去北京，1 位成人。");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(dialog).toHaveAttribute("data-motion-state", "settled");
  await expect(dialog.locator(".glass-dialog-shape")).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("account and source sheets share materials and remain scrollable in a short viewport", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: testInfo.project.name.includes("mobile") ? 390 : 1280, height: 540 });
  await page.goto("/");
  await page.getByRole("button", { name: /登录/ }).click();
  const account = page.locator("dialog[open]");
  await expect(account).toHaveAttribute("data-motion-state", "settled");
  const panel = account.locator(".glass-dialog-panel");
  const material = await panel.evaluate(element => ({ fill: getComputedStyle(element).backgroundImage, radius: getComputedStyle(element).borderRadius }));
  const bounds = await panel.boundingBox();
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(540);
  await account.getByRole("tab", { name: "注册", exact: true }).click();
  await expect(account.getByLabel("显示名称")).toBeVisible();
  await expect(account.getByRole("button", { name: "关闭", exact: true })).toBeInViewport();
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  const source = page.getByRole("button", { name: "来源", exact: true });
  if (!await source.isVisible()) await page.getByRole("button", { name: "打开导航" }).click();
  await source.click();
  const coverage = page.getByRole("dialog", { name: "来源数量不等于可信度" });
  await expect(coverage).toHaveAttribute("data-motion-state", "settled");
  expect(await coverage.locator(".glass-dialog-panel").evaluate(element => ({ fill: getComputedStyle(element).backgroundImage, radius: getComputedStyle(element).borderRadius }))).toEqual(material);
  await expect(coverage.getByRole("button", { name: "关闭来源" })).toBeInViewport();
  await coverage.getByRole("button", { name: "我知道了" }).click();
  await expect(coverage).toBeHidden();
});
