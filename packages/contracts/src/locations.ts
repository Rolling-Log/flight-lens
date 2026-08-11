export type LocationOption = {
  kind: "city" | "airport";
  code: string;
  cityCode: string;
  cityNameZh: string;
  cityNameEn: string;
  pinyin: string;
  airportNameZh?: string;
  airportNameEn?: string;
  airportCodes: string[];
  aliases: string[];
};

type CityDefinition = Omit<LocationOption, "kind" | "code" | "airportNameZh" | "airportNameEn"> & {
  airports: Array<{ code: string; nameZh: string; nameEn: string; aliases?: string[] }>;
};

const CITIES: CityDefinition[] = [
  { cityCode: "BJS", cityNameZh: "北京", cityNameEn: "Beijing", pinyin: "beijing", airportCodes: ["PEK", "PKX"], aliases: ["帝都"], airports: [{ code: "PEK", nameZh: "首都国际机场", nameEn: "Beijing Capital" }, { code: "PKX", nameZh: "大兴国际机场", nameEn: "Beijing Daxing" }] },
  { cityCode: "SHA", cityNameZh: "上海", cityNameEn: "Shanghai", pinyin: "shanghai", airportCodes: ["PVG", "SHA"], aliases: ["沪"], airports: [{ code: "PVG", nameZh: "浦东国际机场", nameEn: "Shanghai Pudong" }, { code: "SHA", nameZh: "虹桥国际机场", nameEn: "Shanghai Hongqiao" }] },
  { cityCode: "CTU", cityNameZh: "成都", cityNameEn: "Chengdu", pinyin: "chengdu", airportCodes: ["CTU", "TFU"], aliases: ["蓉城"], airports: [{ code: "CTU", nameZh: "双流国际机场", nameEn: "Chengdu Shuangliu" }, { code: "TFU", nameZh: "天府国际机场", nameEn: "Chengdu Tianfu" }] },
  { cityCode: "CAN", cityNameZh: "广州", cityNameEn: "Guangzhou", pinyin: "guangzhou", airportCodes: ["CAN"], aliases: ["羊城"], airports: [{ code: "CAN", nameZh: "白云国际机场", nameEn: "Guangzhou Baiyun" }] },
  { cityCode: "SZX", cityNameZh: "深圳", cityNameEn: "Shenzhen", pinyin: "shenzhen", airportCodes: ["SZX"], aliases: [], airports: [{ code: "SZX", nameZh: "宝安国际机场", nameEn: "Shenzhen Bao'an" }] },
  { cityCode: "XIY", cityNameZh: "西安", cityNameEn: "Xi'an", pinyin: "xian", airportCodes: ["XIY"], aliases: ["西安咸阳"], airports: [{ code: "XIY", nameZh: "咸阳国际机场", nameEn: "Xi'an Xianyang" }] },
  { cityCode: "NNG", cityNameZh: "南宁", cityNameEn: "Nanning", pinyin: "nanning", airportCodes: ["NNG"], aliases: [], airports: [{ code: "NNG", nameZh: "吴圩国际机场", nameEn: "Nanning Wuxu" }] },
  { cityCode: "CKG", cityNameZh: "重庆", cityNameEn: "Chongqing", pinyin: "chongqing", airportCodes: ["CKG"], aliases: [], airports: [{ code: "CKG", nameZh: "江北国际机场", nameEn: "Chongqing Jiangbei" }] },
  { cityCode: "HGH", cityNameZh: "杭州", cityNameEn: "Hangzhou", pinyin: "hangzhou", airportCodes: ["HGH"], aliases: [], airports: [{ code: "HGH", nameZh: "萧山国际机场", nameEn: "Hangzhou Xiaoshan" }] },
  { cityCode: "NKG", cityNameZh: "南京", cityNameEn: "Nanjing", pinyin: "nanjing", airportCodes: ["NKG"], aliases: [], airports: [{ code: "NKG", nameZh: "禄口国际机场", nameEn: "Nanjing Lukou" }] },
  { cityCode: "WUH", cityNameZh: "武汉", cityNameEn: "Wuhan", pinyin: "wuhan", airportCodes: ["WUH"], aliases: [], airports: [{ code: "WUH", nameZh: "天河国际机场", nameEn: "Wuhan Tianhe" }] },
  { cityCode: "CSX", cityNameZh: "长沙", cityNameEn: "Changsha", pinyin: "changsha", airportCodes: ["CSX"], aliases: [], airports: [{ code: "CSX", nameZh: "黄花国际机场", nameEn: "Changsha Huanghua" }] },
  { cityCode: "KMG", cityNameZh: "昆明", cityNameEn: "Kunming", pinyin: "kunming", airportCodes: ["KMG"], aliases: [], airports: [{ code: "KMG", nameZh: "长水国际机场", nameEn: "Kunming Changshui" }] },
  { cityCode: "XMN", cityNameZh: "厦门", cityNameEn: "Xiamen", pinyin: "xiamen", airportCodes: ["XMN"], aliases: [], airports: [{ code: "XMN", nameZh: "高崎国际机场", nameEn: "Xiamen Gaoqi" }] },
  { cityCode: "TAO", cityNameZh: "青岛", cityNameEn: "Qingdao", pinyin: "qingdao", airportCodes: ["TAO"], aliases: [], airports: [{ code: "TAO", nameZh: "胶东国际机场", nameEn: "Qingdao Jiaodong" }] },
  { cityCode: "TSN", cityNameZh: "天津", cityNameEn: "Tianjin", pinyin: "tianjin", airportCodes: ["TSN"], aliases: [], airports: [{ code: "TSN", nameZh: "滨海国际机场", nameEn: "Tianjin Binhai" }] },
  { cityCode: "CGO", cityNameZh: "郑州", cityNameEn: "Zhengzhou", pinyin: "zhengzhou", airportCodes: ["CGO"], aliases: [], airports: [{ code: "CGO", nameZh: "新郑国际机场", nameEn: "Zhengzhou Xinzheng" }] },
  { cityCode: "SYX", cityNameZh: "三亚", cityNameEn: "Sanya", pinyin: "sanya", airportCodes: ["SYX"], aliases: [], airports: [{ code: "SYX", nameZh: "凤凰国际机场", nameEn: "Sanya Phoenix" }] },
  { cityCode: "HAK", cityNameZh: "海口", cityNameEn: "Haikou", pinyin: "haikou", airportCodes: ["HAK"], aliases: [], airports: [{ code: "HAK", nameZh: "美兰国际机场", nameEn: "Haikou Meilan" }] },
  { cityCode: "URC", cityNameZh: "乌鲁木齐", cityNameEn: "Urumqi", pinyin: "wulumuqi urumqi", airportCodes: ["URC"], aliases: [], airports: [{ code: "URC", nameZh: "天山国际机场", nameEn: "Urumqi Tianshan" }] },
  { cityCode: "HKG", cityNameZh: "香港", cityNameEn: "Hong Kong", pinyin: "xianggang hongkong", airportCodes: ["HKG"], aliases: [], airports: [{ code: "HKG", nameZh: "香港国际机场", nameEn: "Hong Kong International" }] },
  { cityCode: "TYO", cityNameZh: "东京", cityNameEn: "Tokyo", pinyin: "dongjing tokyo", airportCodes: ["HND", "NRT"], aliases: [], airports: [{ code: "HND", nameZh: "羽田机场", nameEn: "Tokyo Haneda" }, { code: "NRT", nameZh: "成田国际机场", nameEn: "Tokyo Narita" }] },
  { cityCode: "OSA", cityNameZh: "大阪", cityNameEn: "Osaka", pinyin: "daban osaka", airportCodes: ["KIX", "ITM"], aliases: [], airports: [{ code: "KIX", nameZh: "关西国际机场", nameEn: "Kansai International" }, { code: "ITM", nameZh: "伊丹机场", nameEn: "Osaka Itami" }] },
  { cityCode: "SEL", cityNameZh: "首尔", cityNameEn: "Seoul", pinyin: "shouer seoul", airportCodes: ["ICN", "GMP"], aliases: ["汉城"], airports: [{ code: "ICN", nameZh: "仁川国际机场", nameEn: "Seoul Incheon" }, { code: "GMP", nameZh: "金浦国际机场", nameEn: "Seoul Gimpo" }] },
  { cityCode: "SIN", cityNameZh: "新加坡", cityNameEn: "Singapore", pinyin: "xinjiapo singapore", airportCodes: ["SIN"], aliases: [], airports: [{ code: "SIN", nameZh: "樟宜机场", nameEn: "Singapore Changi" }] },
  { cityCode: "BKK", cityNameZh: "曼谷", cityNameEn: "Bangkok", pinyin: "mangu bangkok", airportCodes: ["BKK", "DMK"], aliases: [], airports: [{ code: "BKK", nameZh: "素万那普机场", nameEn: "Bangkok Suvarnabhumi" }, { code: "DMK", nameZh: "廊曼国际机场", nameEn: "Bangkok Don Mueang" }] },
  { cityCode: "LON", cityNameZh: "伦敦", cityNameEn: "London", pinyin: "lundun london", airportCodes: ["LHR", "LGW"], aliases: [], airports: [{ code: "LHR", nameZh: "希思罗机场", nameEn: "London Heathrow" }, { code: "LGW", nameZh: "盖特威克机场", nameEn: "London Gatwick" }] },
  { cityCode: "NYC", cityNameZh: "纽约", cityNameEn: "New York", pinyin: "niuyue newyork", airportCodes: ["JFK", "EWR", "LGA"], aliases: [], airports: [{ code: "JFK", nameZh: "肯尼迪国际机场", nameEn: "New York JFK" }, { code: "EWR", nameZh: "纽瓦克机场", nameEn: "Newark Liberty" }, { code: "LGA", nameZh: "拉瓜迪亚机场", nameEn: "New York LaGuardia" }] },
];

export const locationOptions: LocationOption[] = CITIES.flatMap((city) => [
  { kind: "city", code: city.cityCode, cityCode: city.cityCode, cityNameZh: city.cityNameZh, cityNameEn: city.cityNameEn, pinyin: city.pinyin, airportCodes: city.airportCodes, aliases: city.aliases },
  ...city.airports.map((airport) => ({ kind: "airport" as const, code: airport.code, cityCode: city.cityCode, cityNameZh: city.cityNameZh, cityNameEn: city.cityNameEn, pinyin: city.pinyin, airportNameZh: airport.nameZh, airportNameEn: airport.nameEn, airportCodes: [airport.code], aliases: [...city.aliases, ...(airport.aliases ?? [])] })),
]);

function normalized(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("zh-CN").replace(/[\s'’-]+/g, "");
}

export function locationLabel(location: LocationOption): string {
  return location.kind === "city"
    ? `${location.cityNameZh}（所有机场） ${location.code}`
    : `${location.cityNameZh} · ${location.airportNameZh} ${location.code}`;
}

export function searchLocations(query: string, limit = 8): LocationOption[] {
  const needle = normalized(query);
  if (!needle) return locationOptions.filter((item) => item.kind === "city").slice(0, limit);
  return locationOptions
    .map((item) => {
      const fields = [item.code, item.cityCode, item.cityNameZh, item.cityNameEn, item.pinyin, item.airportNameZh, item.airportNameEn, ...item.aliases].filter(Boolean).map((value) => normalized(String(value)));
      const exactCode = normalized(item.code) === needle;
      const starts = fields.some((field) => field.startsWith(needle));
      const includes = fields.some((field) => field.includes(needle));
      return { item, score: exactCode ? 0 : starts ? 1 : includes ? 2 : 99 };
    })
    .filter((entry) => entry.score < 99)
    .sort((left, right) => left.score - right.score || Number(right.item.kind === "city") - Number(left.item.kind === "city"))
    .slice(0, limit)
    .map((entry) => entry.item);
}

export function resolveLocation(kind: "city" | "airport", code: string): LocationOption | undefined {
  return locationOptions.find((item) => item.kind === kind && item.code === code.toUpperCase());
}

export function airportCodesForLocation(location: { kind: "city" | "airport"; code: string }): string[] {
  return resolveLocation(location.kind, location.code)?.airportCodes ?? (location.kind === "airport" ? [location.code] : []);
}
