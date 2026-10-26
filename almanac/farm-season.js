// Reads picking-season windows out of a farm's Jalan "営業期間" (opening period) text.
// Pure, so the scraper and Vitest share it. A window is { fruit, from: [month, day], to: [month, day] };
// fruit is null when the text does not say which fruit the window belongs to.

export const FRUIT_WORDS = {
  Strawberry: ['いちご', 'イチゴ', '苺'],
  Cherry: ['さくらんぼ', 'サクランボ', 'さくらんぼう'],
  Peach: ['もも狩', 'モモ狩', '桃'],
  Grape: ['ぶどう', 'ブドウ', '葡萄', 'シャインマスカット'],
  Apple: ['りんご', 'リンゴ', '林檎'],
  'Japanese Pear': ['なし狩', 'ナシ狩', '梨'],
  Blueberry: ['ブルーベリー'],
  'Mandarin Orange': ['みかん', 'ミカン', '蜜柑'],
  Chestnut: ['栗', 'くり拾', 'クリ拾'],
  Persimmon: ['柿', 'かき狩'],
  Melon: ['メロン'],
  Loquat: ['びわ', 'ビワ', '枇杷'],
};

const PART_START = { 上旬: 1, 初旬: 1, 中旬: 11, 下旬: 21, 末: 21, 頃: 1, ごろ: 1 };
const PART_END = { 上旬: 10, 初旬: 10, 中旬: 20, 下旬: 31, 末: 31, 頃: 31, ごろ: 31 };
const PART = '(上旬|初旬|中旬|下旬|末|頃|ごろ|\\d{1,2}日)?';
// "12月中旬～5月中旬", "7～11月", "2019年9月1日～10月13日", "6月初旬～9月初旬"
const RANGE = new RegExp(`(?:\\d{4}年)?(\\d{1,2})(?:月${PART})?~(?:\\d{4}年|翌年?)?(\\d{1,2})月${PART}`, 'g');
// A segment about closures, or about winter or summer hours, is not a picking season.
const SKIP_SEGMENT = /^[^：:]*(休|定休)/;
const SHOP_SEGMENT = /(道の駅|売店|軽食|食堂|レストラン)/;
const SIDE_ACTIVITY = /(販売|売店|直売|軽食|食堂|レストラン|カフェ|BBQ|バーベキュー|ピザ|体験|イベント)/;
const HOURS_CONTEXT = /(冬期|冬季|夏期|夏季|冬場|夏場)[^~]{0,6}$/;

export function normalise(text) {
  return String(text || '')
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[～〜~−－‐―]+(?=\s*\d)/g, '~')
    .replace(/[～〜]/g, '~')
    .replace(/&#12316;/g, '~')
    .replace(/[（(][月火水木金土日祝・]+[)）]/g, '')
    .replace(/(\d{1,2})\/(\d{1,2})(?!\d)/g, '$1月$2日')
    .replace(/(\d{1,2})月(\d{1,2})(?=\s*[~～〜])/g, '$1月$2日')
    .replace(/\s*([年月日])\s*/g, '$1')
    .replace(/(\d)\s+(?=\d|[年月日])/g, '$1')
    .replace(/(月(?:上旬|初旬|中旬|下旬|末)?)から/g, '$1~')
    .replace(/\s*~\s*/g, '~')
    .replace(/\s+/g, ' ')
    .trim();
}

function dayOf(part, table) {
  if (!part) return null;
  if (part.endsWith('日')) return Number(part.slice(0, -1));
  return table[part];
}

function fruitBefore(text, index) {
  // The nearest fruit word before the range, within the same clause.
  const clause = text.slice(Math.max(0, index - 40), index).split(/[。●■◆★※\n]|<br>/).pop();
  let best = null;
  let bestAt = -1;
  for (const [fruit, words] of Object.entries(FRUIT_WORDS)) {
    for (const w of words) {
      const at = clause.lastIndexOf(w);
      if (at > bestAt) { best = fruit; bestAt = at; }
    }
  }
  return best;
}

export function parseSeasonWindows(raw) {
  const out = [];
  const segments = String(raw || '').split(' / ');
  for (const [i, segment] of segments.entries()) {
    // "9月～11月 / 休業": the next line says this period is closed.
    if (/^(休業|休園|お休み|定休)$/.test((segments[i + 1] || '').trim())) continue;
    const text = normalise(segment);
    if (SKIP_SEGMENT.test(text)) continue;
    if (SHOP_SEGMENT.test(text) && !text.includes('狩')) continue;
    out.push(...segmentWindows(text));
  }
  return out;
}

function startsWithFruit(text) {
  const t = text.trimStart();
  for (const [fruit, words] of Object.entries(FRUIT_WORDS)) if (words.some((w) => t.startsWith(w))) return fruit;
  return null;
}

function firstFruit(text) {
  let best = null;
  let bestAt = Infinity;
  for (const [fruit, words] of Object.entries(FRUIT_WORDS)) {
    for (const w of words) {
      const at = text.indexOf(w);
      if (at >= 0 && at < bestAt) { best = fruit; bestAt = at; }
    }
  }
  return best;
}

const CLOSED_AFTER = /^[^0-9]{0,8}(?<!無)(休|お休み|閉園)/;
const OTHER_ACTIVITY = /(狩|掘|堀|販売|体験|売店)/;
const SHOP_CONTEXT = /(販売|売店|直売|軽食|食堂|レストラン|カフェ|道の駅)/;
const MAX_WINDOW_DAYS = 300;
const MONTH_LEN = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const ordinal = (m, d) => MONTH_LEN.slice(0, m - 1).reduce((a, b) => a + b, 0) + Math.min(d, MONTH_LEN[m - 1]);
const spanDays = (f, t) => ((ordinal(...t) - ordinal(...f) + 365) % 365) + 1;

function segmentWindows(text) {
  const out = [];
  const matches = [...text.matchAll(RANGE)];
  matches.forEach((m, i) => {
    const [whole, m1, p1, m2, p2] = m;
    const from = Number(m1);
    const to = Number(m2);
    if (!(from >= 1 && from <= 12 && to >= 1 && to <= 12)) return;
    const before = text.slice(Math.max(0, m.index - 10), m.index);
    if (HOURS_CONTEXT.test(before)) return;
    const end = m.index + whole.length;
    const after = text.slice(end, matches[i + 1]?.index ?? end + 30);
    if (CLOSED_AFTER.test(after) || /^\s*(販売|売店|直売)/.test(after)) return;
    // "カフェ：4月～10月" or "4月から8月はピザ作り体験" is about something other than picking.
    const lead = text.slice(Math.max(0, m.index - 12), m.index);
    if (SIDE_ACTIVITY.test(lead) && !lead.includes('狩')) return;
    const tail = after.slice(0, 12);
    if (/^(は|の|に)/.test(tail) && SIDE_ACTIVITY.test(tail) && !tail.includes('狩') && !firstFruit(tail)) return;
    const d1 = dayOf(p1, PART_START) ?? 1;
    const d2 = dayOf(p2, PART_END) ?? 31;
    if (d1 < 1 || d1 > 31 || d2 < 1 || d2 > 31) return;
    // A year-round span is the farm's business hours, not a picking season.
    if (spanDays([from, d1], [to, d2]) > MAX_WINDOW_DAYS) return;

    // "8～10月：ブドウ狩り" names the fruit after the range; "いちご狩り 1月～5月" names it before.
    let fruit = /^\s*\S?/.test(after) ? startsWithFruit(after) : null;
    const label = fruit ? null : /^\s*[：:（(]\s*(.{0,14})/.exec(after);
    if (label) {
      fruit = firstFruit(label[1]);
      if (!fruit && OTHER_ACTIVITY.test(label[1])) return;
    }
    fruit ??= fruitBefore(text, m.index);
    if (!fruit) {
      fruit = firstFruit(after);
      if (!fruit && SHOP_CONTEXT.test(after.slice(0, 16) + before)) return;
    }
    out.push({ fruit, from: [from, d1], to: [to, d2] });
  });
  return out;
}
