import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const pvgNrtRouteName = /浦东国际机场.*PVG.*成田国际机场.*NRT/;

test("a lower list fare never inherits a verified-price badge from the same flight", async ({ page }) => {
  await page.route("**/v1/searches", async (route) => {
    const response = await route.fetch({ url: `http://127.0.0.1:${process.env.PLAYWRIGHT_API_PORT ?? 4000}/v1/searches` });
    const result = await response.json();
    const lowest = result.offers.find((offer: { id: string }) => offer.id === result.lowestComparableOfferId);
    expect(lowest).toBeTruthy();
    result.offers.push({ ...lowest, id: "same-flight-listed-fare", comparable: false,
      seller: { ...lowest.seller, id: "listed-seller", name: "列表价供应商" },
      priceVerificationStatus: "listed_only", incomparabilityReasons: ["PRICE_TAX_UNVERIFIED"],
      totalPrice: { amountMinor: 190000, currency: "CNY" },
      totalPriceCny: { amountMinor: 190000, currency: "CNY" },
    });
    await route.fulfill({ response, json: result });
  });
  await page.goto("/");
  await page.getByRole("tab", { name: "精确筛选" }).click();
  await page.getByRole("button", { name: "开始检索" }).click();
  const card = page.getByRole("article").filter({ hasText: "列表价供应商" });
  await page.getByRole("button", { name: /价格排序，当前低到高/ }).click();
  await page.getByRole("menuitemradio", { name: "低到高" }).click();
  await expect(card.locator(".price")).toContainText("¥1,900");
  await expect(card.locator(".flight-tag")).not.toContainText("最低可核验全价");
  await expect(card.locator(".flight-tag")).not.toContainText("综合推荐");
});

test("animated coverage dialog receives focus and traps keyboard navigation", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "来源", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "来源数量不等于可信度" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "关闭" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(dialog.getByRole("button", { name: "我知道了" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "关闭" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

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
  await expect(page.getByRole("heading", { name: pvgNrtRouteName })).toBeVisible();
  await expect(page.getByText("结论范围", { exact: true })).toHaveCount(0);
  await expect(page.locator('[data-liquid-root="result-summary"] .summary-result-count')).toContainText(/共 \d+ 个航班 · \d+ 个平台报价/);
  await expect(page.locator(".result-toolbar .summary-result-count")).toHaveCount(0);
  await expect(page.locator('[data-liquid-root="result-toolbar"]')).toHaveAttribute("data-glass-state", /active|fallback/);
  await expect(page.locator('[data-liquid-root="result-toolbar"] .glass-surface')).toHaveCount(1);
  const summaryToolbarGap = await page.evaluate(() => {
    const summary = document.querySelector(".result-summary-root")?.getBoundingClientRect();
    const toolbar = document.querySelector(".result-toolbar")?.getBoundingClientRect();
    return summary && toolbar ? Math.round(toolbar.top - summary.bottom) : 0;
  });
  expect(summaryToolbarGap).toBeGreaterThanOrEqual(8);
  const toolbarTint = await page.locator(".result-toolbar-glass-panel").evaluate(
    (element) => getComputedStyle(element).backgroundImage,
  );
  expect(toolbarTint).toContain("linear-gradient");

  await expect(page.getByRole("button", { name: /切换为价格从/ })).toHaveCount(0);
  const priceSortTrigger = page.getByRole("button", { name: /价格排序，当前低到高/ });
  await priceSortTrigger.click();
  const priceSortMenu = page.getByRole("menu", { name: "价格排序" });
  await expect(priceSortMenu).toBeVisible();
  await expect(priceSortMenu.getByRole("menuitemradio", { name: "低到高" })).toHaveAttribute("aria-checked", "true");
  await priceSortMenu.getByRole("menuitemradio", { name: "高到低" }).click();
  await expect(priceSortMenu).toBeHidden();
  await expect(page.getByRole("button", { name: /价格排序，当前高到低/ })).toHaveClass(/selected/);

  const firstFlightActions = page.locator(".flight-meta-actions").first();
  await expect(firstFlightActions.getByRole("button", { name: "收藏机票" })).toBeVisible();
  if ((await page.viewportSize())!.width > 1068) {
    const actionCenters = await firstFlightActions.locator("a, button").evaluateAll((elements) =>
      elements.map((element) => {
        const rect = element.getBoundingClientRect();
        return Math.round(rect.top + rect.height / 2);
      }),
    );
    expect(new Set(actionCenters).size).toBe(1);
    const actionLayout = await page.locator(".flight-meta").first().evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }));
    expect(actionLayout.scrollWidth).toBeLessThanOrEqual(actionLayout.clientWidth);
  }
  await expectNoBlockingAccessibilityViolations(page);

  const coverageTrigger = page.getByRole("button", { name: /本次搜索覆盖：2\/2/ });
  await coverageTrigger.click();
  await expect(page.getByRole("dialog", { name: "来源数量不等于可信度" })).toBeVisible();
  await expect(page.getByRole("button", { name: "关闭" })).toBeFocused();
  await expectNoBlockingAccessibilityViolations(page);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "来源数量不等于可信度" })).toBeHidden();
  await expect(coverageTrigger).toBeFocused();
});

test("React Bits GlassSurface initializes SVG displacement and keeps its built-in fallback", async ({
  page,
}) => {
  await page.goto("/");
  const navigationGlass = page.locator('.adaptive-navigation [data-liquid-root]');
  await expect(navigationGlass).toHaveCount(3);
  await expect(page.locator(".navigation-bridge, .navigation-seam")).toHaveCount(0);
  await expect(navigationGlass.locator(".liquid-glass-scene")).toHaveCount(3);
  const unitedNavigationGlass = page.locator('[data-liquid-root="navigation-united"]');
  for (const scene of await navigationGlass.locator(".liquid-glass-scene").all()) {
    await expect(scene).toBeEmpty();
    await expect(scene).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  }
  await expect(page.locator('[data-liquid-root="search-primary-action"] .liquid-glass-scene')).toBeEmpty();
  for (const glass of await navigationGlass.all()) {
    await expect(glass).toHaveAttribute("data-glass-state", /active|fallback/);
    if (await glass.getAttribute("data-glass-state") === "active") {
      await expect(glass.locator("canvas")).toHaveCount(0);
      await expect(glass.locator('filter[id^="glass-filter-"]')).toHaveCount(1);
      await expect(glass.locator("feDisplacementMap")).toHaveCount(3);
      await expect(glass.locator(".glass-surface--svg")).toHaveCount(1);
      const backdropFilter = await glass.locator(".glass-surface").evaluate(
        (element) => getComputedStyle(element).backdropFilter,
      );
      if (await glass.getAttribute("data-liquid-root") === "navigation-united") {
        expect(backdropFilter).toContain("glass-filter-");
      } else {
        expect(backdropFilter).toBe("none");
      }
      const boxShadow = await glass.locator(".glass-surface").evaluate(
        (element) => getComputedStyle(element).boxShadow,
      );
      expect(boxShadow).not.toContain("56px");
    }
  }
  await expect(unitedNavigationGlass).toHaveAttribute("data-glass-state", /active|fallback/);

  const joinedNavigation = await page.evaluate(() => {
    const brand = document.querySelector(".brand-nav-root")?.getBoundingClientRect();
    const controls = document.querySelector(".controls-nav-root")?.getBoundingClientRect();
    return { brandRight: brand?.right, controlsLeft: controls?.left };
  });
  expect(joinedNavigation.brandRight).toBe(joinedNavigation.controlsLeft);

  await page.addInitScript(() => {
    Object.defineProperty(CSSStyleDeclaration.prototype, "backdropFilter", {
      configurable: true,
      get: () => "",
      set: () => undefined,
    });
  });
  await page.reload();
  for (const glass of await navigationGlass.all()) {
    await expect(glass).toHaveAttribute("data-glass-state", "fallback");
    await expect(glass).toHaveAttribute("data-glass-fallback", "svg-filter-unsupported");
  }
});

test("account entry supports auth recovery and cross-device personal data without overflow", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "查看来源覆盖" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "来源", exact: true })).toHaveCount(1);
  const avatarFile = page.getByLabel("选择头像图片");
  await avatarFile.setInputFiles({
    name: "avatar.png",
    mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"),
  });
  await expect(page.getByRole("button", { name: "更换头像" }).getByAltText("个人头像")).toBeVisible();
  await page.getByRole("button", { name: "登录", exact: true }).click();
  const anonymousDialog = page.locator(".account-modal-auth");
  await expect(anonymousDialog.getByLabel("邮箱")).toBeVisible();
  const loginBox = await anonymousDialog.boundingBox();
  await anonymousDialog.getByRole("tab", { name: "注册", exact: true }).click();
  await expect(anonymousDialog.getByLabel("显示名称")).toBeVisible();
  const registerBox = await anonymousDialog.boundingBox();
  await anonymousDialog.getByRole("tab", { name: "找回密码", exact: true }).click();
  await expect(anonymousDialog.getByRole("button", { name: "发送重置邮件" })).toBeVisible();
  const forgotBox = await anonymousDialog.boundingBox();
  expect(registerBox).toEqual(loginBox);
  expect(forgotBox).toEqual(loginBox);
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
  const modeTabs = page.getByRole("tablist", { name: "搜索方式" });
  await expect(modeTabs).toHaveAttribute("data-mode", "form");
  const modeTabsBox = await modeTabs.boundingBox();
  const searchShellBox = await page.locator(".search-shell").boundingBox();
  expect(modeTabsBox).not.toBeNull();
  expect(searchShellBox).not.toBeNull();
  expect(Math.abs(
    modeTabsBox!.x + modeTabsBox!.width / 2 -
    (searchShellBox!.x + searchShellBox!.width / 2),
  )).toBeLessThan(1);
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
  await expect(page.getByRole("heading", { name: pvgNrtRouteName })).toBeVisible();

  const card = page.getByRole("region", { name: "现在买贵不贵" });
  const detailTrigger = card.getByRole("button", { name: "价格判断：夯，查看详情" });
  await expect(detailTrigger).toBeVisible();
  await detailTrigger.click();
  const drawer = page.getByRole("dialog", { name: "价格历史与提醒" });
  const priceBackdrop = page.locator(".price-drawer-backdrop");
  await expect(priceBackdrop).toHaveAttribute("data-motion-engine", "gsap-transform-map");
  await expect(priceBackdrop).toHaveAttribute("data-motion-state", "settled");
  await expect(priceBackdrop.locator(".liquid-morph")).toHaveCount(1);
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

  const navSwitcher = page.locator(".nav-switcher");
  const navSelectionMotion = await page.locator(".nav-selection").evaluate((element) => {
    const style = getComputedStyle(element);
    return { duration: style.transitionDuration, timing: style.transitionTimingFunction };
  });
  expect(navSelectionMotion).toEqual({
    duration: "0.25s",
    timing: "cubic-bezier(0.77, 0, 0.175, 1)",
  });
  await expect(page.getByRole("button", { name: "价格中心", exact: true })).toHaveCount(0);
  await expect(navSwitcher).toHaveAttribute("data-active", "results");

  const adaptiveNavigation = page.locator(".adaptive-navigation");
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect(adaptiveNavigation).toHaveAttribute("data-split", "true");
  await page.waitForTimeout(600);
  await expect(page.locator(".controls-nav-root")).toHaveCSS("position", "absolute");
  const utilityRowWidths = await page
    .locator(".adaptive-navigation.is-split .nav-switcher button, .adaptive-navigation.is-split .source-nav-button, .adaptive-navigation.is-split .account-entry")
    .evaluateAll((elements) => elements.map((element) => Math.round(element.getBoundingClientRect().width)));
  expect(new Set(utilityRowWidths).size).toBe(1);
  await expect(page.locator('[data-liquid-root^="result-"][data-liquid-root$="-status"]')).toHaveCount(2);
  const capsuleWidths = await page.evaluate(() => ({
    navigation: document.querySelector(".controls-nav-root")?.getBoundingClientRect().width,
    price: document.querySelector('[data-liquid-root="result-price-status"]')?.getBoundingClientRect().width,
    coverage: document.querySelector('[data-liquid-root="result-coverage-status"]')?.getBoundingClientRect().width,
    shortlist: document.querySelector(".shortlist-fab-root")?.getBoundingClientRect().width,
  }));
  expect(new Set(Object.values(capsuleWidths)).size).toBe(1);
  await expect(page.locator(".shortlist-fab > svg")).toHaveCSS("color", "rgb(0, 102, 204)");
  await page.evaluate(() => window.scrollTo(0, Math.max(0, window.scrollY - 180)));
  await expect(adaptiveNavigation).toHaveAttribute("data-split", "true");
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(adaptiveNavigation).toHaveAttribute("data-split", "false");

  await page.getByRole("button", { name: "加入心选" }).first().click();
  const shortlistTrigger = page.getByRole("button", { name: "打开心选，当前 1 个方案" });
  await expect(shortlistTrigger).toBeVisible();
  await shortlistTrigger.click();
  const shortlist = page.getByRole("dialog", { name: "心选方案" });
  await expect(shortlist).toBeVisible();
  await expect(shortlist.locator(".shortlist-airport-route")).toContainText(pvgNrtRouteName);
  await expect(shortlist.getByText("¥2,388", { exact: true })).toBeVisible();
  await shortlist.getByRole("button", { name: /从心选移除/ }).click();
  await expect(shortlist.getByText("还没有心选方案", { exact: true })).toBeVisible();
});

test("agent input becomes an editable search and exposes source limits", async ({
  page,
}) => {
  await page.goto("/");

  await page.getByRole("button", { name: "开始检索" }).click();
  await expect(page.getByText("请确认已解析条件")).toBeVisible();

  const editParsedSearch = page.getByRole("button", { name: "打开完整表单修改" });
  await expect(editParsedSearch).toHaveCSS("white-space", "nowrap");
  await editParsedSearch.click();
  await expect(page.getByLabel("出发地", { exact: true })).toHaveValue(/PVG/);
  await expect(page.getByLabel("目的地", { exact: true })).toHaveValue(/NRT/);
  await expect(page.getByLabel("总预算（人民币）")).toHaveValue("3000");
  await expect(page.getByLabel("最早起飞")).toHaveValue("");
  await expect(page.getByLabel("最晚起飞")).toHaveValue("");

  await page.getByRole("button", { name: "开始检索" }).click();

  await expect(page.getByRole("heading", { name: pvgNrtRouteName })).toBeVisible();
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
    "综合推荐",
    "最短耗时",
    "最少中转",
    "最佳行李",
  ]) {
    await expect(page.getByRole("button", { name: label, exact: true })).toBeVisible();
  }
  const priceMenuTrigger = page.getByRole("button", { name: /价格排序，当前低到高/ });
  await expect(priceMenuTrigger).toBeVisible();
  await expect(page.getByRole("button", { name: "最宽松退改" })).toHaveCount(0);
  await expect(page.getByText("最低可核验全价", { exact: true })).toBeVisible();
  await expect(page.getByText("最低分开购买价", { exact: true })).toBeVisible();
  await priceMenuTrigger.click();
  await page.getByRole("menuitemradio", { name: "低到高" }).click();
  await expect(page.locator("article").first()).toContainText("示例航旅");
  await page.getByRole("button", { name: /价格排序，当前低到高/ }).click();
  await page.getByRole("menuitemradio", { name: "高到低" }).click();
  await expect(page.getByRole("button", { name: /价格排序，当前高到低/ })).toBeVisible();
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

  await recommended.getByRole("button", { name: "查看报价详情" }).click();
  const detail = page.getByRole("region", { name: pvgNrtRouteName });
  await expect(
    detail.getByText(
      "此链接返回带本次条件的 Google Flights 结果页，不是该售卖方的精确报价落点；请重新选择相同行程并核验最终价格。",
    ),
  ).toBeVisible();
  await expect(detail.getByText(/MU 523/).first()).toBeVisible();
  await expect(detail.getByText(/MU 524/).first()).toBeVisible();
  await expect(
    detail.getByText(
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
  await expect(page.locator(".agent-review .airport-route")).toContainText(/浦东国际机场.*PVG.*羽田机场.*HND/);
  await expect(page.locator(".agent-review").getByText(/1 位成人/)).toBeVisible();

  const searchRequest = page.waitForRequest((request) =>
    request.method() === "POST" && request.url().endsWith("/v1/searches"),
  );
  await page.getByRole("button", { name: "确认并检索" }).click();
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

  await expect(page.getByRole("heading", { name: /北京.*BJS.*成都.*CTU/ })).toBeVisible();
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await page.getByRole("tab", { name: "精确筛选" }).click();
  const nextOrigin = page.getByLabel("出发地", { exact: true });
  const nextDestination = page.getByLabel("目的地", { exact: true });
  await nextOrigin.fill("咸阳机场");
  await nextOrigin.press("Enter");
  await expect(nextOrigin).toHaveValue(/咸阳国际机场.*XIY/);
  await nextDestination.fill("吴圩机场");
  await nextDestination.press("Enter");
  await expect(nextDestination).toHaveValue(/吴圩国际机场.*NNG/);
});
