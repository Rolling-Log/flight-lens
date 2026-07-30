"use client";

import { useMemo, useState } from "react";

type Mode = "agent" | "form";
type SortKey = "recommended" | "price" | "duration";

const flights = [
  {
    id: 1,
    tag: "最低全价",
    airline: "中国东方航空",
    flightNo: "MU521",
    depart: "11:45",
    arrive: "15:55",
    from: "上海浦东 PVG",
    to: "东京成田 NRT",
    duration: "3小时10分",
    stops: "直飞",
    baggage: "含 1 件 23kg 托运行李",
    price: 1864,
    rawPrice: 1740,
    source: "东方航空官网",
    sourceType: "航司直营",
    checked: "刚刚核验",
    score: 97,
  },
  {
    id: 2,
    tag: "综合推荐",
    airline: "全日空",
    flightNo: "NH920",
    depart: "13:05",
    arrive: "17:00",
    from: "上海浦东 PVG",
    to: "东京成田 NRT",
    duration: "2小时55分",
    stops: "直飞",
    baggage: "含 2 件 23kg 托运行李",
    price: 2127,
    rawPrice: 1990,
    source: "携程旅行",
    sourceType: "OTA",
    checked: "1 分钟前核验",
    score: 99,
  },
  {
    id: 3,
    tag: "时间最优",
    airline: "春秋航空",
    flightNo: "9C6217",
    depart: "07:10",
    arrive: "11:05",
    from: "上海浦东 PVG",
    to: "东京成田 NRT",
    duration: "2小时55分",
    stops: "直飞",
    baggage: "仅含 7kg 手提行李",
    price: 1948,
    rawPrice: 1299,
    source: "飞猪旅行",
    sourceType: "OTA",
    checked: "2 分钟前核验",
    score: 90,
  },
];

const coverage = [
  ["航司官网", "28 / 31", "直营价与专属权益"],
  ["综合 OTA", "5 / 6", "携程、去哪儿、飞猪、同程、美团"],
  ["国际比价", "3 / 4", "Skyscanner、Google Flights 等"],
  ["合作分销", "2 / 3", "GDS / NDC 聚合渠道"],
];

export default function Home() {
  const [mode, setMode] = useState<Mode>("agent");
  const [tripType, setTripType] = useState("往返");
  const [query, setQuery] = useState(
    "8月下旬上海去东京，往返 5 天，1 个人，预算 3000 元。不要红眼航班，直飞优先，必须含 1 件托运行李。",
  );
  const [sort, setSort] = useState<SortKey>("recommended");
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [showCoverage, setShowCoverage] = useState(false);
  const [error, setError] = useState("");

  const sortedFlights = useMemo(() => {
    const copy = [...flights];
    if (sort === "price") return copy.sort((a, b) => a.price - b.price);
    if (sort === "duration") return copy.sort((a, b) => a.duration.localeCompare(b.duration));
    return copy.sort((a, b) => b.score - a.score);
  }, [sort]);

  function runSearch() {
    if (mode === "agent" && !query.trim()) {
      setError("先告诉我你想去哪里，以及大概什么时候出发。");
      return;
    }
    setError("");
    setLoading(true);
    window.setTimeout(() => {
      setLoading(false);
      setSearched(true);
      window.setTimeout(() => {
        document.getElementById("results")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 80);
    }, 950);
  }

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#top" aria-label="航探首页">
          <span className="brand-mark">航</span>
          <span>航探 <small>Flight Lens</small></span>
        </a>
        <nav aria-label="主导航">
          <a className="active" href="#search">找机票</a>
          <a href="#coverage">数据覆盖</a>
          <a href="#principles">如何推荐</a>
        </nav>
        <button className="ghost-button" onClick={() => setShowCoverage(true)}>
          覆盖状态 <span className="live-dot" /> 38 个来源
        </button>
      </header>

      <section className="hero" id="top">
        <div className="eyebrow"><span /> 中国航线优先的透明比价工具</div>
        <h1>看见真正的最低价，<br /><em>也看懂它为什么便宜。</em></h1>
        <p className="hero-copy">
          同时核对航司官网、国内 OTA 与国际比价渠道。统一比较含税费、行李和必要服务后的可支付总价，并明确标注来源。
        </p>

        <div className="search-shell" id="search">
          <div className="mode-tabs" role="tablist" aria-label="搜索方式">
            <button className={mode === "agent" ? "selected" : ""} onClick={() => setMode("agent")} role="tab" aria-selected={mode === "agent"}>
              <span className="spark">✦</span> 对话找票
            </button>
            <button className={mode === "form" ? "selected" : ""} onClick={() => setMode("form")} role="tab" aria-selected={mode === "form"}>
              精确筛选
            </button>
          </div>

          {mode === "agent" ? (
            <div className="agent-panel">
              <label htmlFor="flight-query">直接说出你的完整需求</label>
              <textarea
                id="flight-query"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                aria-describedby={error ? "query-error" : undefined}
              />
              <div className="prompt-row">
                <button onClick={() => setQuery("下周五北京到成都，周日回来，2 个成人，早班机优先，含托运行李，预算 2500 元。")}>周末往返</button>
                <button onClick={() => setQuery("国庆前后从广州出发，去东南亚任意免签目的地，玩 4–6 天，总价 2000 元内。")}>去哪儿都行</button>
                <button onClick={() => setQuery("9 月上海飞东京，日期可前后浮动 3 天，直飞，不坐红眼航班，含 23kg 行李。")}>灵活日期</button>
              </div>
              {error && <p className="field-error" id="query-error">{error}</p>}
            </div>
          ) : (
            <div className="form-panel">
              <div className="trip-switch" aria-label="行程类型">
                {["单程", "往返", "多城市"].map((item) => (
                  <button key={item} className={tripType === item ? "selected" : ""} onClick={() => setTripType(item)}>{item}</button>
                ))}
              </div>
              <div className="form-grid">
                <label>出发地<input defaultValue="上海 SHA" aria-label="出发地" /></label>
                <button className="swap" aria-label="交换出发地和目的地">⇄</button>
                <label>目的地<input defaultValue="东京 TYO" aria-label="目的地" /></label>
                <label>出发日期<input type="date" defaultValue="2026-08-24" aria-label="出发日期" /></label>
                <label>返程日期<input type="date" defaultValue="2026-08-29" aria-label="返程日期" disabled={tripType === "单程"} /></label>
                <label>乘机人 / 舱位<select defaultValue="1成人 · 经济舱" aria-label="乘机人和舱位"><option>1成人 · 经济舱</option><option>2成人 · 经济舱</option><option>1成人 · 公务舱</option></select></label>
              </div>
              <div className="filter-chips">
                {["直飞优先", "含托运行李", "拒绝红眼", "日期 ±3 天", "附近机场", "可退改"].map((item, index) => (
                  <label key={item}><input type="checkbox" defaultChecked={index < 4} />{item}</label>
                ))}
              </div>
            </div>
          )}

          <div className="search-footer">
            <div className="search-promise">
              <span className="shield">✓</span>
              <span><strong>比较可支付总价</strong><small>不把裸票价伪装成最低价</small></span>
            </div>
            <button className="primary-button" onClick={runSearch} disabled={loading}>
              {loading ? <><span className="spinner" /> 正在核对 38 个来源</> : <>开始全网比价 <span>→</span></>}
            </button>
          </div>
        </div>

        <div className="trust-row">
          <span>重点覆盖</span>
          {["携程", "去哪儿", "飞猪", "同程", "航司官网", "Skyscanner"].map((item) => <b key={item}>{item}</b>)}
          <button onClick={() => setShowCoverage(true)}>查看全部来源 +</button>
        </div>
      </section>

      <section className={`results-section ${searched ? "revealed" : ""}`} id="results" aria-live="polite">
        <div className="section-heading">
          <div>
            <div className="eyebrow"><span /> 示例搜索结果</div>
            <h2>上海 → 东京</h2>
            <p>2026年8月24日 · 1位成人 · 经济舱 · 已按“含 23kg 行李”统一价格口径</p>
          </div>
          <div className="demo-badge">演示数据 · 尚未接入实时出票接口</div>
        </div>

        <div className="result-layout">
          <div className="result-main">
            <div className="price-insight">
              <div><span>本次最低全价</span><strong>¥1,864</strong><small>往返含税 · 来自东方航空官网</small></div>
              <div className="insight-copy"><b>价格判断：值得关注</b><p>比同日期中位价低约 14%。若行程确定，建议在核验余票后尽快决策。</p></div>
              <div className="confidence"><span>价格可信度</span><strong>高</strong><small>3 个来源交叉核验</small></div>
            </div>

            <div className="result-toolbar">
              <div className="sort-tabs">
                {([["recommended", "综合推荐"], ["price", "最低全价"], ["duration", "总耗时"]] as const).map(([key, label]) => (
                  <button key={key} className={sort === key ? "selected" : ""} onClick={() => setSort(key)}>{label}</button>
                ))}
              </div>
              <span>共 46 个可比方案</span>
            </div>

            <div className="flight-list">
              {sortedFlights.map((flight) => (
                <article className="flight-card" key={flight.id}>
                  <div className="flight-tag">{flight.tag}</div>
                  <div className="flight-primary">
                    <div className="airline">
                      <span className="airline-logo">{flight.airline.slice(0, 1)}</span>
                      <div><b>{flight.airline}</b><small>{flight.flightNo} · 经济舱</small></div>
                    </div>
                    <div className="time"><strong>{flight.depart}</strong><small>{flight.from}</small></div>
                    <div className="route-line"><span>{flight.duration}</span><i /><small>{flight.stops}</small></div>
                    <div className="time"><strong>{flight.arrive}</strong><small>{flight.to}</small></div>
                    <div className="price">
                      <small>可支付总价</small>
                      <strong>¥{flight.price.toLocaleString()}</strong>
                      <span>裸票价 ¥{flight.rawPrice.toLocaleString()}</span>
                    </div>
                  </div>
                  <div className="flight-meta">
                    <div><span className="bag">▣</span>{flight.baggage}</div>
                    <div className="source"><span>{flight.sourceType}</span><b>{flight.source}</b><small>{flight.checked}</small></div>
                    <button onClick={() => setExpanded(expanded === flight.id ? null : flight.id)} aria-expanded={expanded === flight.id}>
                      {expanded === flight.id ? "收起价格构成" : "查看价格构成"} <span>⌄</span>
                    </button>
                  </div>
                  {expanded === flight.id && (
                    <div className="price-breakdown">
                      <span>基础票价 <b>¥{flight.rawPrice}</b></span>
                      <span>税费与燃油 <b>¥124</b></span>
                      <span>满足条件的行李 / 服务 <b>已计入</b></span>
                      <span>最终应付 <b>¥{flight.price}</b></span>
                      <p>请前往 {flight.source} 再次核验实时库存与最终支付页。航探不售票、不代收款。</p>
                    </div>
                  )}
                </article>
              ))}
            </div>
          </div>

          <aside className="coverage-card" id="coverage">
            <div className="aside-title"><div><span className="radar">◎</span><b>本次检索覆盖</b></div><strong>92%</strong></div>
            <div className="coverage-progress"><i /></div>
            <p>已返回 38 个来源；3 个来源响应超时，已避免把缺失结果计作“无票”。</p>
            <ul>
              {coverage.map(([name, amount, copy]) => (
                <li key={name}><span><b>{name}</b><small>{copy}</small></span><strong>{amount}</strong></li>
              ))}
            </ul>
            <button onClick={() => setShowCoverage(true)}>查看来源与异常明细</button>
            <div className="adversarial-note">
              <b>对抗式检查</b>
              <p>发现春秋航空裸票价更低，但补齐托运行李后不再是最低价，已自动降权。</p>
            </div>
          </aside>
        </div>
      </section>

      <section className="principles" id="principles">
        <div className="section-heading">
          <div><div className="eyebrow"><span /> 推荐不是黑箱</div><h2>最低价必须经得起追问</h2></div>
        </div>
        <div className="principle-grid">
          <article><span>01</span><h3>同口径再比较</h3><p>统一税费、行李、支付手续费、机场与中转风险，拒绝用不可购买的“起价”制造错觉。</p></article>
          <article><span>02</span><h3>每个结论可追溯</h3><p>展示来源平台、核验时间、价格构成与覆盖缺口。没有证据时，不宣称“全网最低”。</p></article>
          <article><span>03</span><h3>主动寻找反例</h3><p>用附近机场、日期浮动、拆票与官网会员价挑战当前答案，同时显式标注新风险。</p></article>
        </div>
      </section>

      <footer>
        <div className="brand"><span className="brand-mark">航</span><span>航探 <small>Flight Lens</small></span></div>
        <p>只负责搜索与解释，不售票、不代收款。最终价格与规则以来源平台支付页为准。</p>
        <span>产品验证原型 · 2026</span>
      </footer>

      {showCoverage && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setShowCoverage(false)}>
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="coverage-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowCoverage(false)} aria-label="关闭">×</button>
            <div className="eyebrow"><span /> 来源透明度</div>
            <h2 id="coverage-title">不是“接得越多”就越可信</h2>
            <p>首版会把每个来源分成四种状态：实时 API、授权合作、浏览器核验、暂不可用。只有实际返回且价格口径完整的来源才计入覆盖率。</p>
            <div className="source-table">
              <div><b>航司直营</b><span>国航、东航、南航、海航、春秋、吉祥及主要国际航司官网</span><em>优先级最高</em></div>
              <div><b>国内 OTA</b><span>携程、去哪儿、飞猪、同程、美团等</span><em>需商务 / API 授权</em></div>
              <div><b>国际比价</b><span>Google Flights、Skyscanner、KAYAK 等</span><em>补充国际航线</em></div>
              <div><b>分销网络</b><span>GDS、NDC 聚合商与航旅服务商</span><em>覆盖与稳定性底座</em></div>
            </div>
            <div className="modal-warning"><b>重要边界</b><p>公开网页不等于可以稳定、合法地批量抓取。正式上线前必须为每个 Connector 建立授权依据、限流策略、价格审计与降级方案。</p></div>
            <button className="primary-button" onClick={() => setShowCoverage(false)}>我知道了</button>
          </section>
        </div>
      )}
    </main>
  );
}
