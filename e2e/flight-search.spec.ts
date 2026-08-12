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

test("V2 history, alert, and anonymous preference controls stay usable", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "精确筛选" }).click();
  await page.getByRole("button", { name: "开始检索" }).click();
  await expect(page.getByRole("heading", { name: "PVG → NRT" })).toBeVisible();

  const panel = page.getByRole("region", { name: "价格历史与提醒" });
  await expect(panel.getByRole("button", { name: "90 天" })).toHaveClass(/selected/);
  await panel.getByRole("button", { name: "30 天" }).click();
  await expect(panel.getByRole("button", { name: "30 天" })).toHaveClass(/selected/);

  await panel.getByRole("tab", { name: "价格提醒" }).click();
  await expect(panel.getByLabel("目标全价（人民币）")).toBeVisible();
  await expect(panel.getByLabel("ntfy Topic")).toBeVisible();

  await panel.getByRole("tab", { name: "偏好" }).click();
  await expect(panel.getByLabel("最低托运行李")).toHaveValue("0");
  await expect(panel.getByLabel("红眼开始")).toHaveValue("00:00");
  await expect(panel.getByRole("button", { name: "保存偏好" })).toBeVisible();
  await expectNoBlockingAccessibilityViolations(page);
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
