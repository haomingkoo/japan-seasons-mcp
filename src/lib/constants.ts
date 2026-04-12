// Canonical source of truth for flower and fruit season data used by MCP tools.
// The frontend (public/index.html) has its own richer FLOWER_TYPES with UI fields
// (color, sectionBg, etc). Keep these in sync manually — months must always match.

export const FLOWER_SEASON_MONTHS: Record<string, number[]> = {
  plum:      [1, 2, 3],
  nanohana:  [2, 3, 4],
  wisteria:  [4, 5],
  iris:      [5, 6],
  hydrangea: [6, 7],
  lavender:  [6, 7],
  sunflower: [7, 8],
  cosmos:    [9, 10],
};

export const FLOWER_META: Record<string, { emoji: string; season: string; ja: string }> = {
  plum:      { emoji: "🌸", season: "January–March",               ja: "梅" },
  nanohana:  { emoji: "🌼", season: "February–April",              ja: "菜の花" },
  wisteria:  { emoji: "💜", season: "April–May",                   ja: "藤" },
  iris:      { emoji: "🌺", season: "May–June",                    ja: "菖蒲" },
  hydrangea: { emoji: "💙", season: "June–July",                   ja: "紫陽花" },
  lavender:  { emoji: "🪻", season: "June–July (peak July, Hokkaido)", ja: "ラベンダー" },
  sunflower: { emoji: "🌻", season: "July–August",                 ja: "ひまわり" },
  cosmos:    { emoji: "🌷", season: "September–October",           ja: "コスモス" },
};

export const FESTIVAL_TYPE_META: Record<string, { emoji: string; name: string }> = {
  fireworks: { emoji: "🎆", name: "Fireworks" },
  matsuri:   { emoji: "🏮", name: "Festival" },
  winter:    { emoji: "❄️",  name: "Winter Event" },
};

export const MO = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"] as const;

// Geographic bounds for Japan — used to validate user-supplied coordinates
export const JAPAN_BOUNDS = { lat: { min: 20, max: 46 }, lon: { min: 122, max: 154 } } as const;

// Total number of Japanese prefectures (fixed by law since 1972)
export const JAPAN_PREFECTURE_COUNT = 47;

export const FRUITS = [
  { name: "Strawberry",      ja: "いちご",   emoji: "🍓", months: [12,1,2,3,4,5],  peak: [2,3,4],    regions: ["Tochigi","Nagano","Chiba","Ibaraki","Hokkaido"], note: "Kyushu (Fukuoka) season ends ~April; May is Kanto & northern only" },
  { name: "Cherry",          ja: "さくらんぼ", emoji: "🍒", months: [5,6,7],         peak: [6],        regions: ["Yamagata","Hokkaido","Nagano","Aomori"],         note: "Yamagata produces 70% of Japan's cherries" },
  { name: "Plum (Ume)",      ja: "梅",       emoji: "🫐", months: [6,7],           peak: [6,7],      regions: ["Wakayama","Gunma","Nagano"],                     note: "Harvested green for umeshu and umeboshi" },
  { name: "Peach",           ja: "もも",     emoji: "🍑", months: [7,8,9],         peak: [7,8],      regions: ["Yamanashi","Fukushima","Okayama","Nagano"],      note: "Yamanashi is the top peach prefecture" },
  { name: "Blueberry",       ja: "ブルーベリー",emoji: "🫐", months: [7,8],          peak: [7,8],      regions: ["Tokyo (Higashimurayama)","Nagano","Chiba"],      note: "Small farms mostly near Tokyo suburbs" },
  { name: "Watermelon",      ja: "スイカ",   emoji: "🍉", months: [7,8],           peak: [7],        regions: ["Kumamoto","Chiba","Yamagata"],                   note: "Kumamoto produces Japan's best watermelons" },
  { name: "Grape",           ja: "ぶどう",   emoji: "🍇", months: [8,9,10],        peak: [9],        regions: ["Yamanashi","Nagano","Okayama"],                  note: "Shine Muscat and Kyoho are most sought-after" },
  { name: "Japanese Pear",   ja: "なし",     emoji: "🍐", months: [8,9,10],        peak: [8,9],      regions: ["Chiba","Tochigi","Fukushima","Tottori"],         note: "Tottori is most famous — Nijisseiki variety" },
  { name: "Apple",           ja: "りんご",   emoji: "🍎", months: [9,10,11,12],    peak: [10,11],    regions: ["Aomori","Nagano","Iwate"],                       note: "Aomori produces 60% of Japan's apples" },
  { name: "Chestnut",        ja: "栗",       emoji: "🌰", months: [9,10],          peak: [9,10],     regions: ["Ibaraki","Kumamoto","Ehime"],                    note: "Ibaraki Kuri is Japan's most famous variety" },
  { name: "Persimmon",       ja: "柿",       emoji: "🍊", months: [10,11,12],      peak: [10,11],    regions: ["Nara","Wakayama","Fukuoka"],                     note: "Hachiya and Fuyu varieties dominate" },
  { name: "Mandarin Orange", ja: "みかん",   emoji: "🍊", months: [10,11,12,1,2],  peak: [11,12],    regions: ["Ehime","Wakayama","Shizuoka"],                   note: "Ehime is Japan's top mikan prefecture" },
  { name: "Amaou Strawberry", ja: "あまおう", emoji: "🍓", months: [11,12,1,2,3,4], peak: [2,3],      regions: ["Fukuoka","Saga","Kumamoto"],                     note: "Amaou variety from Fukuoka — most premium" },
  { name: "Kiwi",            ja: "キウイ",   emoji: "🥝", months: [11,12],         peak: [11,12],    regions: ["Ehime","Kanagawa","Fukuoka"],                    note: "Harvested Nov–Dec; stored and sold through winter" },
];
