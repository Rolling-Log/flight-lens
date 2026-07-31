import { expect, test } from "@playwright/test";

test("agent input becomes an editable search and exposes source limits", async ({
  page,
}) => {
  await page.goto("/");

  await page.getByRole("button", { name: "开始检索" }).click();
  await expect(page.getByText("请确认已解析条件")).toBeVisible();

  await page.getByRole("button", { name: "打开完整表单修改" }).click();
  await expect(page.getByLabel("出发地 IATA")).toHaveValue("PVG");
  await expect(page.getByLabel("目的地 IATA")).toHaveValue("NRT");
  await expect(page.getByLabel("总预算（人民币）")).toHaveValue("3000");
  await expect(page.getByLabel("最早起飞")).toHaveValue("06:00");
  await expect(page.getByLabel("最晚起飞")).toHaveValue("22:00");

  await page.getByRole("button", { name: "开始检索" }).click();

  await expect(page.getByRole("heading", { name: "PVG → NRT" })).toBeVisible();
  await expect(page.getByText("¥2,388").first()).toBeVisible();
  await expect(page.getByText("示例航旅", { exact: true })).toBeVisible();
  await expect(page.getByAltText("Powered by Skyscanner")).toBeVisible();
  await expect(page.getByText("2/2", { exact: true })).toBeVisible();
  await expect(page.getByText("+1", { exact: true }).first()).toBeVisible();

  for (const label of [
    "最低全价",
    "综合推荐",
    "最短耗时",
    "最少中转",
    "最佳行李",
    "最宽松退改",
  ]) {
    await expect(page.getByRole("button", { name: label })).toBeVisible();
  }

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
