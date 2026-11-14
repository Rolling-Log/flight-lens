import { expect, test } from "@playwright/test";

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Aircraft presentation is desktop only");
});

test("hero opens the full search workspace, preserves edits and restores focus", async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const start = page.getByRole("button", { name: "开始探索", exact: true });
  const dialog = page.getByRole("dialog", { name: "下一站，想去哪里？" });
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("heading", { name: /让远方，\s*更近一点。/ })).toBeVisible();
  await expect(page.locator(".hero-media")).toHaveAttribute("data-playing", "false");
  const scene = page.locator(".hero-media");
  const animationStates = () => scene.evaluate(element => element.getAnimations({ subtree: true }).map(animation => animation.playState));
  expect(await animationStates()).toEqual(expect.arrayContaining(["paused"]));
  expect((await animationStates()).every(state => state === "paused")).toBe(true);
  await expect(page.locator(".cinema-hero")).toHaveCSS("overflow", "hidden");
  const navigation = await page.locator(".adaptive-navigation").boundingBox();
  expect(navigation!.x).toBeGreaterThanOrEqual(0);
  expect(navigation!.x + navigation!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  const discoverBounds = await page.getByRole("link", { name: "了解航探", exact: true }).boundingBox();
  const searchBounds = await start.boundingBox();
  expect(searchBounds!.width).toBe(discoverBounds!.width);
  expect(searchBounds!.height).toBe(discoverBounds!.height);
  for (const glass of await page.locator(".hero-action-glass").all()) {
    // Safari uses the translucent blur material instead of SVG refraction.
    await expect(glass).toHaveAttribute("data-glass-state", /^(active|fallback)$/);
    await expect(glass.locator(".liquid-glass-panel")).not.toHaveCSS("backdrop-filter", "none");
  }
  await page.screenshot({ path: `outputs/hero-quality-2026-11-13/${testInfo.project.name}-hero.png`, fullPage: true });
  await start.click();
  await expect(dialog).toBeVisible();
  await page.getByLabel("直接说出完整需求，解析后可在表单中检查").fill("下个月上海去广州，经济舱。");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(start).toBeFocused();
  await start.click();
  await expect(page.getByLabel("直接说出完整需求，解析后可在表单中检查")).toHaveValue("下个月上海去广州，经济舱。");
  await page.getByRole("tab", { name: "精确筛选" }).click();
  await page.getByLabel("总预算（人民币）").fill("1600");
  await page.getByRole("button", { name: "关闭搜索面板" }).click();
  await start.click();
  await expect(page.getByLabel("总预算（人民币）")).toHaveValue("1600");
  // Escape dismisses airport suggestions before it dismisses the workspace.
  await page.getByLabel("出发地", { exact: true }).focus();
  await expect(page.getByRole("listbox")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox")).toBeHidden();
  await expect(dialog).toBeVisible();
  await dialog.evaluate(element => { element.scrollTop = 0; element.querySelector(".search-shell")!.scrollTop = 0; });
  await expect(dialog.getByRole("button", { name: "开始检索" })).toBeInViewport();
  await page.screenshot({ path: `outputs/hero-quality-2026-11-13/${testInfo.project.name}-form.png` });
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("unavailable aircraft model keeps the local cover and search usable", async ({ page }) => {
  await page.route("**/hero/boeing-707.glb", route => route.abort());
  await page.goto("/");
  await expect(page.getByRole("button", { name: "播放飞机动画" })).toHaveText("静态背景");
  await expect(page.getByRole("button", { name: "播放飞机动画" })).toBeDisabled();
  await expect(page.locator(".hero-loading")).toBeHidden();
  await expect(page.locator(".hero-fallback")).toHaveCSS("background-image", /boeing-707-poster/);
  await page.getByRole("button", { name: "开始探索", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "下一站，想去哪里？" })).toBeVisible();
});

test("slow aircraft loading gives feedback without blocking search and ends after rendering", async ({ page }, testInfo) => {
  test.setTimeout(60000);
  let releaseModel!: () => void;
  const gate = new Promise<void>(resolve => { releaseModel = resolve; });
  await page.route("**/hero/boeing-707.glb", async route => { await gate; await route.continue(); });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const loading = page.locator(".hero-loading");
  await expect(loading).toBeVisible();
  await expect(loading).toContainText("正在准备飞行画面");
  expect(await loading.evaluate(element => getComputedStyle(element.querySelector(".hero-loading-orbit")!, "::before").animationName)).toBe("hero-loading-turn");
  await page.screenshot({ path: testInfo.outputPath("hero-loading.png") });
  await page.getByRole("button", { name: "开始探索", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "下一站，想去哪里？" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(await loading.evaluate(element => getComputedStyle(element.querySelector(".hero-loading-orbit")!, "::before").animationName)).toBe("none");
  releaseModel();
  await expect(page.locator(".hero-aircraft-3d")).toHaveAttribute("data-ready", "true", { timeout: 30000 });
  await expect(loading).toBeHidden();
  await expect(page.locator(".hero-fallback")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("hero-glass-ready.png") });
});

test("WebGL drag returns to flight and preserves user pause", async ({ page }, testInfo) => {
  test.setTimeout(60000);
  await page.setViewportSize({ width: 1463, height: 661 });
  await page.goto("/");
  const aircraft = page.locator(".hero-aircraft-3d");
  await expect(aircraft).toHaveAttribute("data-ready", "true", { timeout: 30000 });
  await page.getByRole("button", { name: "暂停飞机动画" }).click();
  const time = await aircraft.getAttribute("data-flight-time");
  const bounds = await aircraft.boundingBox();
  await page.mouse.move(bounds!.width * .52, bounds!.height * .66);
  await page.mouse.down();
  await page.mouse.move(bounds!.width * .60, bounds!.height * .59, { steps: 10 });
  await expect(aircraft).toHaveAttribute("data-motion", "drag");
  expect(await aircraft.evaluate(el => getComputedStyle(el, "::after").content)).toBe("none");
  await expect.poll(async () => Number(await aircraft.getAttribute("data-rotation-offset"))).toBeGreaterThan(.1);
  await page.screenshot({ path: testInfo.outputPath("aircraft-drag-surface.png") });
  expect(await aircraft.getAttribute("data-flight-time")).toBe(time);
  await page.mouse.up();
  await expect(aircraft).toHaveAttribute("data-motion", "flight");
  await expect.poll(async () => Number(await aircraft.getAttribute("data-rotation-offset"))).toBeLessThan(.001);
  expect(await aircraft.getAttribute("data-flight-time")).toBe(time);
  await expect(page.locator(".hero-media")).toHaveAttribute("data-playing", "false");
  await page.getByRole("button", { name: "播放飞机动画" }).click();
  await expect.poll(async () => Number(await aircraft.getAttribute("data-flight-time"))).toBeGreaterThan(Number(time));
  const phase = await aircraft.getAttribute("data-fan-phase");
  await expect.poll(() => aircraft.getAttribute("data-fan-phase")).not.toBe(phase);
  await page.mouse.move(bounds!.width * .52, bounds!.height * .62);
  await page.mouse.down();
  await expect(aircraft).toHaveAttribute("data-motion", "drag");
  const visibleMotion = await page.evaluate(async () => {
    const host = document.querySelector<HTMLElement>(".hero-aircraft-3d")!;
    const canvas = host.querySelector("canvas")!;
    const gl = canvas.getContext("webgl2")!;
    const dpr = canvas.width / canvas.clientWidth;
    const centers: { x: number; y: number }[] = JSON.parse(host.dataset.fanCenters!);
    const readFans = () => new Promise<Uint8Array[]>(resolve => requestAnimationFrame(() => {
      resolve(centers.map(point => {
        const pixels = new Uint8Array(32 * 32 * 4);
        gl.readPixels(Math.round(point.x * dpr) - 16, Math.round((canvas.clientHeight - point.y) * dpr) - 16, 32, 32, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        return pixels;
      }));
    }));
    const first = await readFans();
    const cloud = document.querySelector(".hero-clouds-foreground i")!;
    const cloudStart = cloud.getBoundingClientRect().x;
    await new Promise(resolve => setTimeout(resolve, 420));
    const second = await readFans();
    return {
      fans: second.map((pixels, index) => {
        let change = 0;
        for (let i = 0; i < pixels.length; i++) if (i % 4 !== 3) change += Math.abs(pixels[i] - first[index][i]);
        return change / (pixels.length * .75);
      }),
      cloudTravel: Math.abs(cloud.getBoundingClientRect().x - cloudStart),
    };
  });
  for (const difference of visibleMotion.fans) expect(difference).toBeGreaterThan(3);
  expect(visibleMotion.cloudTravel).toBeGreaterThan(30);
  await page.mouse.up();
  await expect(aircraft).toHaveAttribute("data-motion", "flight");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator(".hero-media")).toHaveAttribute("data-playing", "false");
  await expect(page.getByRole("button", { name: "播放飞机动画" })).toBeDisabled();
  await aircraft.focus();
  await page.keyboard.down("ArrowLeft");
  await expect(aircraft).toHaveAttribute("data-motion", "drag");
  expect(await aircraft.evaluate(el => getComputedStyle(el, "::after").content)).toContain("方向键旋转");
  await page.keyboard.up("ArrowLeft");
  await expect(aircraft).toHaveAttribute("data-motion", "flight");
  await expect(aircraft).toHaveAttribute("data-rotation-offset", "0.00000");
});

test("daylight keeps the aircraft centered through the close and distant views", async ({ page }, testInfo) => {
  test.setTimeout(60000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (/THREE.*(Error|INVALID)|VALIDATE_STATUS|shader error/i.test(message.text())) errors.push(message.text()); });
  await page.setViewportSize({ width: 1463, height: 661 });
  await page.goto("/");
  const aircraft = page.locator(".hero-aircraft-3d");
  await expect(aircraft).toHaveAttribute("data-ready", "true", { timeout: 30000 });
  const initialBounds = JSON.parse((await aircraft.getAttribute("data-aircraft-bounds"))!);
  expect(initialBounds.y + initialBounds.height).toBeLessThan(650);
  expect(initialBounds.width).toBeGreaterThan(1060);
  for (const phase of [0, 6, 12, 18]) {
    if (phase) await page.waitForFunction(t => Number(document.querySelector<HTMLElement>(".hero-aircraft-3d")!.dataset.flightTime) >= t, phase, { timeout: 20000 });
    const center = await page.evaluate(() => new Promise<number>(resolve => requestAnimationFrame(() => {
      const canvas = document.querySelector<HTMLCanvasElement>(".hero-aircraft-3d canvas")!;
      const gl = canvas.getContext("webgl2")!;
      const pixels = new Uint8Array(canvas.width * canvas.height * 4);
      gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      let area = 0, weightedX = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        const alpha = pixels[i + 3];
        area += alpha;
        weightedX += ((i / 4) % canvas.width) * alpha;
      }
      resolve(weightedX / area / canvas.width);
    })));
    expect(center, `visual center at phase ${phase}`).toBeGreaterThan(.46);
    expect(center, `visual center at phase ${phase}`).toBeLessThan(.54);
    if (phase === 0) await page.screenshot({ path: testInfo.outputPath("aircraft-daylight.png") });
    if (phase === 12) {
      const farBounds = JSON.parse((await aircraft.getAttribute("data-aircraft-bounds"))!);
      expect(initialBounds.width / farBounds.width).toBeGreaterThan(1.2);
    }
  }
  expect(errors).toEqual([]);
  await page.getByRole("button", { name: "开始探索", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "下一站，想去哪里？" })).toBeVisible();
});
