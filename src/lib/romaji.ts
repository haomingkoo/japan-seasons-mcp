// Hiragana/Katakana → Romaji converter
// Handles all standard kana including digraphs (きょ→kyo, etc.)

const HIRAGANA: Record<string, string> = {
  // Vowels
  "あ":"a","い":"i","う":"u","え":"e","お":"o",
  // K
  "か":"ka","き":"ki","く":"ku","け":"ke","こ":"ko",
  "が":"ga","ぎ":"gi","ぐ":"gu","げ":"ge","ご":"go",
  // S
  "さ":"sa","し":"shi","す":"su","せ":"se","そ":"so",
  "ざ":"za","じ":"ji","ず":"zu","ぜ":"ze","ぞ":"zo",
  // T
  "た":"ta","ち":"chi","つ":"tsu","て":"te","と":"to",
  "だ":"da","ぢ":"di","づ":"du","で":"de","ど":"do",
  // N
  "な":"na","に":"ni","ぬ":"nu","ね":"ne","の":"no",
  // H
  "は":"ha","ひ":"hi","ふ":"fu","へ":"he","ほ":"ho",
  "ば":"ba","び":"bi","ぶ":"bu","べ":"be","ぼ":"bo",
  "ぱ":"pa","ぴ":"pi","ぷ":"pu","ぺ":"pe","ぽ":"po",
  // M
  "ま":"ma","み":"mi","む":"mu","め":"me","も":"mo",
  // Y
  "や":"ya","ゆ":"yu","よ":"yo",
  // R
  "ら":"ra","り":"ri","る":"ru","れ":"re","ろ":"ro",
  // W
  "わ":"wa","ゐ":"wi","ゑ":"we","を":"wo",
  // N
  "ん":"n",
  // Small
  "ぁ":"a","ぃ":"i","ぅ":"u","ぇ":"e","ぉ":"o",
  "ゃ":"ya","ゅ":"yu","ょ":"yo",
  "っ":"",  // handled separately as double consonant
  // Long vowel
  "ー":"-",
};

// Digraphs (きょ→kyo, etc.)
const DIGRAPHS: Record<string, string> = {
  "きゃ":"kya","きゅ":"kyu","きょ":"kyo",
  "しゃ":"sha","しゅ":"shu","しょ":"sho",
  "ちゃ":"cha","ちゅ":"chu","ちょ":"cho",
  "にゃ":"nya","にゅ":"nyu","にょ":"nyo",
  "ひゃ":"hya","ひゅ":"hyu","ひょ":"hyo",
  "みゃ":"mya","みゅ":"myu","みょ":"myo",
  "りゃ":"rya","りゅ":"ryu","りょ":"ryo",
  "ぎゃ":"gya","ぎゅ":"gyu","ぎょ":"gyo",
  "じゃ":"ja","じゅ":"ju","じょ":"jo",
  "びゃ":"bya","びゅ":"byu","びょ":"byo",
  "ぴゃ":"pya","ぴゅ":"pyu","ぴょ":"pyo",
};

// Build katakana map from hiragana (offset 0x60)
const KATAKANA: Record<string, string> = {};
const KATA_DIGRAPHS: Record<string, string> = {};
for (const [k, v] of Object.entries(HIRAGANA)) {
  const kata = String.fromCharCode(k.charCodeAt(0) + 0x60);
  KATAKANA[kata] = v;
}
for (const [k, v] of Object.entries(DIGRAPHS)) {
  const kata = Array.from(k).map(c => String.fromCharCode(c.charCodeAt(0) + 0x60)).join("");
  KATA_DIGRAPHS[kata] = v;
}
// Special katakana
KATAKANA["ヴ"] = "vu";
KATAKANA["ー"] = "-";

export function toRomaji(kana: string): string {
  if (!kana) return "";
  let result = "";
  let i = 0;

  while (i < kana.length) {
    // Check for digraphs (2 characters)
    if (i + 1 < kana.length) {
      const pair = kana.slice(i, i + 2);
      if (DIGRAPHS[pair]) { result += DIGRAPHS[pair]; i += 2; continue; }
      if (KATA_DIGRAPHS[pair]) { result += KATA_DIGRAPHS[pair]; i += 2; continue; }
    }

    const ch = kana[i];

    // っ/ッ = double next consonant
    if (ch === "っ" || ch === "ッ") {
      // Find next consonant
      if (i + 1 < kana.length) {
        const next = HIRAGANA[kana[i + 1]] ?? KATAKANA[kana[i + 1]] ?? "";
        if (next.length > 0 && next[0] !== "a" && next[0] !== "i" && next[0] !== "u" && next[0] !== "e" && next[0] !== "o" && next[0] !== "n") {
          result += next[0]; // double the consonant
        }
      }
      i++;
      continue;
    }

    // Regular kana
    if (HIRAGANA[ch]) { result += HIRAGANA[ch]; i++; continue; }
    if (KATAKANA[ch]) { result += KATAKANA[ch]; i++; continue; }

    // Non-kana characters (kanji, latin, symbols) — pass through
    result += ch;
    i++;
  }

  return result;
}

/**
 * Convert a Japanese spot name to a searchable romanized form.
 * Uses kana reading if available, otherwise returns the original name.
 */
export function romanizeName(name: string, kanaReading: string): string {
  if (!kanaReading) return name;
  const romaji = toRomaji(kanaReading);
  // Capitalize first letter of each word
  return romaji
    .split(/[\s　]+/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
