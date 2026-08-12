const LABELS = { ctrip: "携程", qunar: "去哪儿", tongcheng: "同程", fliggy: "飞猪" };
const STATES = {
  success: "已取到报价", empty: "无符合航班", login_required: "需要登录",
  captcha_required: "需要验证", page_changed: "页面待适配", unavailable: "页面不可用",
  timeout: "加载超时",
};

chrome.runtime.sendMessage({ type: "FLIGHT_LENS_STATUS" }).then((response) => {
  const lastRun = response?.payload;
  if (!lastRun) return;
  document.querySelector("#status").textContent = `上次检索：${new Date(lastRun.at).toLocaleString("zh-CN")}`;
  const container = document.querySelector("#sources");
  for (const result of lastRun.results || []) {
    const row = document.createElement("div");
    const states = result.journeys.map((journey) => STATES[journey.state] || journey.state);
    row.innerHTML = `<b>${LABELS[result.platform] || result.platform}</b><span>${states.join(" / ")}</span>`;
    container.append(row);
  }
});
