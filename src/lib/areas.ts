// JMA area codes for weather forecasts
// Source: https://www.jma.go.jp/bosai/common/const/area.json

export interface AreaInfo {
  code: string;
  nameJa: string;
  nameEn: string;
  region: string;
}

// Major prefecture/area codes used by JMA forecast API
export const JMA_AREAS: AreaInfo[] = [
  // Hokkaido
  { code: "016000", nameJa: "北海道（石狩・空知・後志）", nameEn: "Hokkaido (Sapporo)", region: "Hokkaido" },
  { code: "012000", nameJa: "北海道（渡島・檜山）", nameEn: "Hokkaido (Hakodate)", region: "Hokkaido" },
  { code: "013000", nameJa: "北海道（上川・留萌）", nameEn: "Hokkaido (Asahikawa)", region: "Hokkaido" },
  { code: "014030", nameJa: "北海道（網走・北見・紋別）", nameEn: "Hokkaido (Abashiri)", region: "Hokkaido" },
  { code: "014100", nameJa: "北海道（釧路・根室）", nameEn: "Hokkaido (Kushiro)", region: "Hokkaido" },
  { code: "015000", nameJa: "北海道（胆振・日高）", nameEn: "Hokkaido (Muroran)", region: "Hokkaido" },
  { code: "014020", nameJa: "北海道（十勝）", nameEn: "Hokkaido (Obihiro)", region: "Hokkaido" },
  // Tohoku
  { code: "020000", nameJa: "青森県", nameEn: "Aomori", region: "Tohoku" },
  { code: "030000", nameJa: "岩手県", nameEn: "Iwate", region: "Tohoku" },
  { code: "040000", nameJa: "宮城県", nameEn: "Miyagi", region: "Tohoku" },
  { code: "050000", nameJa: "秋田県", nameEn: "Akita", region: "Tohoku" },
  { code: "060000", nameJa: "山形県", nameEn: "Yamagata", region: "Tohoku" },
  { code: "070000", nameJa: "福島県", nameEn: "Fukushima", region: "Tohoku" },
  // Kanto
  { code: "080000", nameJa: "茨城県", nameEn: "Ibaraki", region: "Kanto" },
  { code: "090000", nameJa: "栃木県", nameEn: "Tochigi", region: "Kanto" },
  { code: "100000", nameJa: "群馬県", nameEn: "Gunma", region: "Kanto" },
  { code: "110000", nameJa: "埼玉県", nameEn: "Saitama", region: "Kanto" },
  { code: "120000", nameJa: "千葉県", nameEn: "Chiba", region: "Kanto" },
  { code: "130000", nameJa: "東京都", nameEn: "Tokyo", region: "Kanto" },
  { code: "140000", nameJa: "神奈川県", nameEn: "Kanagawa", region: "Kanto" },
  // Koshin
  { code: "190000", nameJa: "山梨県", nameEn: "Yamanashi", region: "Koshin" },
  { code: "200000", nameJa: "長野県", nameEn: "Nagano", region: "Koshin" },
  // Hokuriku
  { code: "150000", nameJa: "新潟県", nameEn: "Niigata", region: "Hokuriku" },
  { code: "160000", nameJa: "富山県", nameEn: "Toyama", region: "Hokuriku" },
  { code: "170000", nameJa: "石川県", nameEn: "Ishikawa", region: "Hokuriku" },
  { code: "180000", nameJa: "福井県", nameEn: "Fukui", region: "Hokuriku" },
  // Tokai
  { code: "210000", nameJa: "岐阜県", nameEn: "Gifu", region: "Tokai" },
  { code: "220000", nameJa: "静岡県", nameEn: "Shizuoka", region: "Tokai" },
  { code: "230000", nameJa: "愛知県", nameEn: "Aichi", region: "Tokai" },
  { code: "240000", nameJa: "三重県", nameEn: "Mie", region: "Tokai" },
  // Kinki
  { code: "250000", nameJa: "滋賀県", nameEn: "Shiga", region: "Kinki" },
  { code: "260000", nameJa: "京都府", nameEn: "Kyoto", region: "Kinki" },
  { code: "270000", nameJa: "大阪府", nameEn: "Osaka", region: "Kinki" },
  { code: "280000", nameJa: "兵庫県", nameEn: "Hyogo", region: "Kinki" },
  { code: "290000", nameJa: "奈良県", nameEn: "Nara", region: "Kinki" },
  { code: "300000", nameJa: "和歌山県", nameEn: "Wakayama", region: "Kinki" },
  // Chugoku
  { code: "310000", nameJa: "鳥取県", nameEn: "Tottori", region: "Chugoku" },
  { code: "320000", nameJa: "島根県", nameEn: "Shimane", region: "Chugoku" },
  { code: "330000", nameJa: "岡山県", nameEn: "Okayama", region: "Chugoku" },
  { code: "340000", nameJa: "広島県", nameEn: "Hiroshima", region: "Chugoku" },
  { code: "350000", nameJa: "山口県", nameEn: "Yamaguchi", region: "Chugoku" },
  // Shikoku
  { code: "360000", nameJa: "徳島県", nameEn: "Tokushima", region: "Shikoku" },
  { code: "370000", nameJa: "香川県", nameEn: "Kagawa", region: "Shikoku" },
  { code: "380000", nameJa: "愛媛県", nameEn: "Ehime", region: "Shikoku" },
  { code: "390000", nameJa: "高知県", nameEn: "Kochi", region: "Shikoku" },
  // Kyushu
  { code: "400000", nameJa: "福岡県", nameEn: "Fukuoka", region: "Kyushu" },
  { code: "410000", nameJa: "佐賀県", nameEn: "Saga", region: "Kyushu" },
  { code: "420000", nameJa: "長崎県", nameEn: "Nagasaki", region: "Kyushu" },
  { code: "430000", nameJa: "熊本県", nameEn: "Kumamoto", region: "Kyushu" },
  { code: "440000", nameJa: "大分県", nameEn: "Oita", region: "Kyushu" },
  { code: "450000", nameJa: "宮崎県", nameEn: "Miyazaki", region: "Kyushu" },
  { code: "460100", nameJa: "鹿児島県", nameEn: "Kagoshima", region: "Kyushu" },
  // Okinawa
  { code: "471000", nameJa: "沖縄県（沖縄本島）", nameEn: "Okinawa (Main Island)", region: "Okinawa" },
  { code: "472000", nameJa: "沖縄県（大東島）", nameEn: "Okinawa (Daito)", region: "Okinawa" },
  { code: "473000", nameJa: "沖縄県（宮古島）", nameEn: "Okinawa (Miyako)", region: "Okinawa" },
  { code: "474000", nameJa: "沖縄県（石垣島）", nameEn: "Okinawa (Ishigaki)", region: "Okinawa" },
  // Amami
  { code: "460040", nameJa: "鹿児島県（奄美）", nameEn: "Amami", region: "Kyushu" },
];

// Livedoor Weather compatible city IDs for the tsukumijima API
export const WEATHER_CITY_IDS: Record<string, string> = {
  "Sapporo": "016010",
  "Hakodate": "017010",
  "Asahikawa": "012010",
  "Kushiro": "014010",
  "Obihiro": "014020",
  "Aomori": "020010",
  "Morioka": "030010",
  "Sendai": "040010",
  "Akita": "050010",
  "Yamagata": "060010",
  "Fukushima": "070010",
  "Mito": "080010",
  "Utsunomiya": "090010",
  "Maebashi": "100010",
  "Saitama": "110010",
  "Chiba": "120010",
  "Tokyo": "130010",
  "Yokohama": "140010",
  "Niigata": "150010",
  "Toyama": "160010",
  "Kanazawa": "170010",
  "Fukui": "180010",
  "Kofu": "190010",
  "Nagano": "200010",
  "Gifu": "210010",
  "Shizuoka": "220010",
  "Nagoya": "230010",
  "Tsu": "240010",
  "Otsu": "250010",
  "Kyoto": "260010",
  "Osaka": "270000",
  "Kobe": "280010",
  "Nara": "290010",
  "Wakayama": "300010",
  "Tottori": "310010",
  "Matsue": "320010",
  "Okayama": "330010",
  "Hiroshima": "340010",
  "Shimonoseki": "350020",
  "Tokushima": "360010",
  "Takamatsu": "370000",
  "Matsuyama": "380010",
  "Kochi": "390010",
  "Fukuoka": "400010",
  "Saga": "410010",
  "Nagasaki": "420010",
  "Kumamoto": "430010",
  "Oita": "440010",
  "Miyazaki": "450010",
  "Kagoshima": "460010",
  "Naha": "471010",
};

export function findAreaByName(query: string): AreaInfo | undefined {
  const q = query.toLowerCase();
  return JMA_AREAS.find(
    (a) => a.nameEn.toLowerCase().includes(q) || a.nameJa.includes(query)
  );
}

export function findAreasByRegion(region: string): AreaInfo[] {
  const r = region.toLowerCase();
  return JMA_AREAS.filter((a) => a.region.toLowerCase() === r);
}

export function findWeatherCityId(city: string): string | undefined {
  const q = city.toLowerCase();
  for (const [name, id] of Object.entries(WEATHER_CITY_IDS)) {
    if (name.toLowerCase().includes(q) || q.includes(name.toLowerCase())) {
      return id;
    }
  }
  return undefined;
}

// ─── Tokyo Datum → WGS84 coordinate conversion ─────────────────────────────
// The JMC n-kishou API returns coordinates in Japanese Geodetic Datum (Tokyo Datum).
// This formula (from GSI) converts them to WGS84 for use with Leaflet / Google Maps.
// Typical offset: ~460m in the Tokyo area.
export function tokyoDatumToWGS84(lat: number, lon: number): { lat: number; lon: number } {
  const dLat = -lat * 0.00010695 + lon * 0.000017464 + 0.0046017;
  const dLon = -lat * 0.000046038 - lon * 0.000083043 + 0.010040;
  return { lat: lat + dLat, lon: lon + dLon };
}
