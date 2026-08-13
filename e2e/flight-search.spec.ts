import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function expectNoBlockingAccessibilityViolations(page: Page) {
  const scan = await new AxeBuilder({ page }).analyze();
  const blocking = scan.violations.filter(
    (violation) => violation.impact === "serious" || violation.impact === "critical",
  );
  expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
}

test("initial, result, and coverage dialog states have no blocking accessibility violations", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expectNoBlockingAccessibilityViolations(page);

  await page.getByRole("tab", { name: "精确筛选" }).click();
  await page.getByRole("button", { name: "开始检索" }).click();
  await expect(page.getByRole("heading", { name: "PVG → NRT" })).toBeVisible();
  await expectNoBlockingAccessibilityViolations(page);

  const coverageTrigger = page.getByRole("button", { name: "查看来源规则" });
  await coverageTrigger.click();
  await expect(page.getByRole("dialog", { name: "来源数量不等于可信度" })).toBeVisible();
  await expect(page.getByRole("button", { name: "关闭" })).toBeFocused();
  await expectNoBlockingAccessibilityViolations(page);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "来源数量不等于可信度" })).toBeHidden();
  await expect(coverageTrigger).toBeFocused();
});

test("account entry supports auth recovery and cross-device personal data without overflow", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  const anonymousDialog = page.getByRole("dialog", { name: "登录航探" });
  await expect(anonymousDialog.getByLabel("邮箱")).toBeVisible();
  await anonymousDialog.getByRole("button", { name: "注册", exact: true }).click();
  await expect(anonymousDialog.getByLabel("显示名称")).toBeVisible();
  await anonymousDialog.getByRole("button", { name: "找回密码", exact: true }).click();
  await expect(anonymousDialog.getByRole("button", { name: "发送重置邮件" })).toBeVisible();
  await expectNoBlockingAccessibilityViolations(page);
  await anonymousDialog.getByRole("button", { name: "关闭" }).click();

  await page.route("**/api/auth/get-session", async (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      session: { id: "session-user-a", token: "redacted-in-ui", expiresAt: "2026-08-20T00:00:00.000Z", userId: "user-a", createdAt: "2026-08-13T00:00:00.000Z", updatedAt: "2026-08-13T00:00:00.000Z" },
      user: { id: "user-a", name: "跨设备用户", email: "user@example.test", emailVerified: true, createdAt: "2026-08-13T00:00:00.000Z", updatedAt: "2026-08-13T00:00:00.000Z" },
    }),
  }));
  await page.route("**/api/auth/list-sessions", async (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{ token: "session-redacted", userAgent: "Chrome on test device", ipAddress: "198.51.100.10", createdAt: "2026-08-13T00:00:00.000Z", expiresAt: "2026-08-20T00:00:00.000Z" }]) }));
  await page.route("**/v3/me/notifications", async (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ notifications: { emailEnabled: true, pushEnabled: false, ntfyTopic: null } }) }));
  await page.route("**/v3/me/searches", async (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ searches: [{ id: "history-1", intent: { origin: { code: "PVG" }, destination: { code: "NRT" }, departureDate: "2026-09-01" }, createdAt: "2026-08-13T00:00:00.000Z" }] }) }));
  await page.route("**/v3/me/itineraries", async (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ itineraries: [{ id: "saved-1", name: "MU 521 · 示例航旅", itinerary: { seller: { name: "示例航旅" } }, updatedAt: "2026-08-13T00:00:00.000Z" }] }) }));
  await page.route("**/v3/me/anonymous-migration", async (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ migration: { status: "skipped" } }) }));
  await page.route("**/v2/preferences", async (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ preferences: { preferredAirlines: ["MU"], preferredAirports: ["PVG"] } }) }));
  await page.evaluate(() => localStorage.setItem("flight-lens-owner-token", "anonymous-owner-token-1234"));
  await page.reload();
  await page.getByRole("button", { name: "跨设备用户" }).click();
  const accountDialog = page.getByRole("dialog", { name: "跨设备用户" });
  await expect(accountDialog.getByText("user@example.test · 邮箱已验证")).toBeVisible();
  await expect(accountDialog.getByText("PVG → NRT")).toBeVisible();
  await expect(accountDialog.getByText("MU 521 · 示例航旅")).toBeVisible();
  await expect(accountDialog.getByText("Chrome on test device")).toBeVisible();
  await expect(accountDialog.getByLabel("常用航司")).toHaveValue("MU");
  await expect(accountDialog.getByText("处理此浏览器此前保存的偏好和提醒。选择只会记录一次。")).toBeVisible();
  await accountDialog.getByRole("button", { name: "跳过", exact: true }).click();
  await expect(accountDialog.getByText("处理此浏览器此前保存的偏好和提醒。选择只会记录一次。")).toBeHidden();
  expect(await page.evaluate(() => ({
    owner: localStorage.getItem("flight-lens-owner-token"),
    decision: localStorage.getItem("flight-lens-owner-migration-decision"),
  }))).toEqual({ owner: "anonymous-owner-token-1234", decision: expect.stringMatching(/^skip:[a-f0-9]{64}$/) });
  const box = await accountDialog.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual((await page.viewportSize())!.width);
  await expectNoBlockingAccessibilityViolations(page);
});

test("precise filters expose baggage allowance and custom red-eye controls", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "精确筛选" }).click();
  await expect(page.getByLabel("最低托运行李额度")).toHaveValue("0");
  await page.getByLabel("最低托运行李额度").selectOption("30");
  await expect(page.getByLabel("最低托运行李额度")).toHaveValue("30");
  await expect(page.getByLabel("红眼开始时间")).toHaveValue("00:00");
  await expect(page.getByLabel("最早起飞")).toBeVisible();
  await page.getByLabel("最早起飞").fill("08:00");
  await expect(page.getByLabel("最早起飞")).toHaveValue("08:00");
  await page.getByLabel("红眼开始时间").fill("23:00");
  await page.getByLabel("红眼结束时间").fill("07:00");

  const request = page.waitForRequest((item) => item.method() === "POST" && item.url().endsWith("/v1/searches"));
  await page.getByRole("button", { name: "开始检索" }).click();
  const body = (await request).postDataJSON();
  expect(body.minimumCheckedBaggageKg).toBe(30);
  expect(body.redEyeWindow).toEqual({ start: "23:00", end: "07:00" });
});

test("compact price judgment and its history and alert drawer stay usable", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "精确筛选" }).click();
  await page.getByRole("button", { name: "开始检索" }).click();
  await expect(page.getByRole("heading", { name: "PVG → NRT" })).toBeVisible();

  const card = page.getByRole("region", { name: "现在买贵不贵" });
  await expect(card.locator(".price-level-summary > b")).toHaveText("夯");
  await expect(card.getByText("典型区间 ¥2,700–¥3,300")).toBeVisible();
  const detailTrigger = card.getByRole("button", { name: "查看详情" });
  await detailTrigger.click();
  const drawer = page.getByRole("dialog", { name: "价格历史与提醒" });
  await expect(drawer.getByRole("button", { name: "90 天" })).toHaveClass(/selected/);
  await drawer.getByRole("button", { name: "30 天" }).click();
  await expect(drawer.getByRole("button", { name: "30 天" })).toHaveClass(/selected/);
  await expect(drawer.getByText("外部市场历史", { exact: true })).toBeVisible();
  await expect(drawer.getByText("本站观测", { exact: true })).toBeVisible();

  await drawer.getByRole("tab", { name: "价格提醒" }).click();
  await expect(drawer.getByLabel("目标可核验全价（人民币）")).toBeVisible();
  await expect(drawer.getByLabel("ntfy Topic")).toBeVisible();
  await expect(drawer.getByText(/尚未配置服务端调度/)).toBeVisible();
  await expectNoBlockingAccessibilityViolations(page);
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(detailTrigger).toBeFocused();
});

test("agent input becomes an editable search and exposes source limits", async ({
  page,
}) => {
  await page.goto("/");

  await page.getByRole("button", { name: "开始检索" }).click();
  await expect(page.getByText("请确认已解析条件")).toBeVisible();

  await page.getByRole("button", { name: "打开完整表单修改" }).click();
  await expect(page.getByLabel("出发地", { exact: true })).toHaveValue(/PVG/);
  await expect(page.getByLabel("目的地", { exact: true })).toHaveValue(/NRT/);
  await expect(page.getByLabel("总预算（人民币）")).toHaveValue("3000");
  await expect(page.getByLabel("最早起飞")).toHaveValue("");
  await expect(page.getByLabel("最晚起飞")).toHaveValue("");

  await page.getByRole("button", { name: "开始检索" }).click();

  await expect(page.getByRole("heading", { name: "PVG → NRT" })).toBeVisible();
  await expect(page.getByText("¥2,388").first()).toBeVisible();
  await expect(page.getByText("示例航旅", { exact: true })).toBeVisible();
  await expect(page.getByAltText("Powered by Skyscanner")).toBeVisible();
  await expect(
    page.getByText("Sandbox 来源 · 不代表可购买库存", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("2/2", { exact: true })).toBeVisible();
  await expect(page.getByText("+1", { exact: true }).first()).toBeVisible();
  await expect(
    page.getByText("共 2 个航班 · 2 个平台报价 · 1 个不符合条件的报价已隐藏"),
  ).toBeVisible();
  await expect(page.getByText("超预算示例", { exact: true })).toHaveCount(0);

  for (const label of [
    "价格",
    "综合推荐",
    "最短耗时",
    "最少中转",
    "最佳行李",
  ]) {
    await expect(page.getByRole("button", { name: label, exact: true })).toBeVisible();
  }
  await expect(page.getByRole("button", { name: "最宽松退改" })).toHaveCount(0);
  await expect(page.getByText("最低可核验全价", { exact: true })).toBeVisible();
  await expect(page.getByText("最低分开购买价", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "价格", exact: true }).click();
  await expect(page.getByRole("button", { name: "切换为价格从高到低" })).toBeVisible();
  await expect(page.locator("article").first()).toContainText("示例航旅");
  await page.getByRole("button", { name: "切换为价格从高到低" }).click();
  await expect(page.getByRole("button", { name: "切换为价格从低到高" })).toBeVisible();
  await expect(page.locator("article").first()).toContainText("示例航空");

  const recommended = page
    .locator("article")
    .filter({ has: page.getByText("示例航空", { exact: true }) });
  await expect(recommended).toBeVisible();

  const handoff = recommended.getByRole("link", {
    name: "去 Google Flights 重新选择",
  });
  await expect(handoff).toHaveAttribute(
    "href",
    /https:\/\/www\.google\.com\/travel\/flights/,
  );
  await expect(recommended.getByText("抓取时来源展示价")).toBeVisible();

  await recommended.getByRole("button", { name: /查看价格构成/ }).click();
  await expect(
    recommended.getByText(
      "此链接返回带本次条件的 Google Flights 结果页，不是该售卖方的精确报价落点；请重新选择相同行程并核验最终价格。",
    ),
  ).toBeVisible();
  await expect(recommended.getByText(/MU 523/).first()).toBeVisible();
  await expect(recommended.getByText(/MU 524/).first()).toBeVisible();
  await expect(
    recommended.getByText(
      "请在来源平台再次核验库存和最终支付页。航探不售票、不代收款。",
    ),
  ).toBeVisible();
});

test("an incomplete dialogue pre-fills known fields and leaves the missing date visible", async ({
  page,
}) => {
  await page.goto("/");
  const query = page.getByLabel("直接说出完整需求，解析后可在表单中检查");
  await query.fill("下个月广州飞新加坡，单程，1 位成人。");
  await page.getByRole("button", { name: "开始检索" }).click();

  await expect(
    page.getByRole("alert").getByText("请确认下个月的具体出发日期。"),
  ).toBeVisible();
  await expect(page.getByLabel("出发地", { exact: true })).toHaveValue(/CAN/);
  await expect(page.getByLabel("目的地", { exact: true })).toHaveValue(/SIN/);
  await expect(page.getByLabel("出发日期")).toHaveValue("");
  await expect(page.getByText(/2 项推断 · 1 项待确认 · 本地解析/)).toBeVisible();
});

test("form edits remain authoritative after switching back to agent mode", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "开始检索" }).click();
  await expect(page.getByText("请确认已解析条件")).toBeVisible();

  await page.getByRole("button", { name: "打开完整表单修改" }).click();
  await page.getByLabel("目的地", { exact: true }).fill("HND");
  await page.getByLabel("目的地", { exact: true }).press("Enter");
  await page.getByLabel("出发地附近机场").check();

  await page.getByRole("tab", { name: "对话找票" }).click();
  await expect(page.getByText(/PVG → HND/)).toBeVisible();
  await expect(page.locator(".agent-review").getByText(/1 位成人/)).toBeVisible();

  const searchRequest = page.waitForRequest((request) =>
    request.method() === "POST" && request.url().endsWith("/v1/searches"),
  );
  await page.getByRole("button", { name: "确认条件并检索" }).click();
  const body = (await searchRequest).postDataJSON();

  expect(body.destination.code).toBe("HND");
  expect(body.adults).toBe(1);
  expect(body.flexibleDays).toBe(0);
  expect(body.includeNearbyAirports).toBe(true);
});

test("location combobox supports Chinese and pinyin with keyboard selection", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "精确筛选" }).click();
  const origin = page.getByLabel("出发地", { exact: true });
  const destination = page.getByLabel("目的地", { exact: true });
  await origin.fill("北京");
  await expect(page.getByRole("option", { name: /北京.*所有机场/ }).first()).toBeVisible();
  await origin.press("Enter");
  await expect(origin).toHaveValue(/北京.*BJS/);
  await destination.fill("chengdu");
  await destination.press("Enter");
  await expect(destination).toHaveValue(/成都.*CTU/);
  const searchRequest = page.waitForRequest((request) => request.method() === "POST" && request.url().endsWith("/v1/searches"));
  await page.getByRole("button", { name: "开始检索" }).click();
  const body = (await searchRequest).postDataJSON();
  expect(body.origin).toMatchObject({ kind: "city", code: "BJS" });
  expect(body.destination).toMatchObject({ kind: "city", code: "CTU" });

  await origin.fill("咸阳机场");
  await origin.press("Enter");
  await expect(origin).toHaveValue(/咸阳国际机场.*XIY/);
  await destination.fill("吴圩机场");
  await destination.press("Enter");
  await expect(destination).toHaveValue(/吴圩国际机场.*NNG/);
});
