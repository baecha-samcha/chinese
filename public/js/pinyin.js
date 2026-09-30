// Standard orthographic syllables, grouped by initial (ü stays distinct from u).
const syllables = new Set(
  `
a ai an ang ao e ei en eng er o ou
ba bai ban bang bao bei ben beng bi bian biao bie bin bing bo bu
pa pai pan pang pao pei pen peng pi pian piao pie pin ping po pou pu
ma mai man mang mao me mei men meng mi mian miao mie min ming miu mo mou mu
fa fan fang fei fen feng fo fou fu
da dai dan dang dao de dei den deng di dia dian diao die ding diu dong dou du duan dui dun duo
ta tai tan tang tao te teng ti tian tiao tie ting tong tou tu tuan tui tun tuo
na nai nan nang nao ne nei nen neng ni nian niang niao nie nin ning niu nong nou nu nuan nuo nü nüe
la lai lan lang lao le lei leng li lia lian liang liao lie lin ling liu lo long lou lu luan lun luo lü lüe
ga gai gan gang gao ge gei gen geng gong gou gu gua guai guan guang gui gun guo
ka kai kan kang kao ke kei ken keng kong kou ku kua kuai kuan kuang kui kun kuo
ha hai han hang hao he hei hen heng hong hou hu hua huai huan huang hui hun huo
ji jia jian jiang jiao jie jin jing jiong jiu ju juan jue jun
qi qia qian qiang qiao qie qin qing qiong qiu qu quan que qun
xi xia xian xiang xiao xie xin xing xiong xiu xu xuan xue xun
zha zhai zhan zhang zhao zhe zhei zhen zheng zhi zhong zhou zhu zhua zhuai zhuan zhuang zhui zhun zhuo
cha chai chan chang chao che chen cheng chi chong chou chu chua chuai chuan chuang chui chun chuo
sha shai shan shang shao she shei shen sheng shi shou shu shua shuai shuan shuang shui shun shuo
ran rang rao re ren reng ri rong rou ru ruan rui run ruo
za zai zan zang zao ze zei zen zeng zi zong zou zu zuan zui zun zuo
ca cai can cang cao ce cen ceng ci cong cou cu cuan cui cun cuo
sa sai san sang sao se sen seng si song sou su suan sui sun suo
ya yan yang yao ye yi yin ying yo yong you yu yuan yue yun
wa wai wan wang wei wen weng wo wu
ê m n ng hm hng r
`
    .trim()
    .split(/\s+/),
);
const accents = ["", "\u0304", "\u0301", "\u030c", "\u0300"];
const toneMarks = /[\u0304\u0301\u030c\u0300]/g;
const unmark = (s) =>
  s.normalize("NFD").replace(toneMarks, "").normalize("NFC");
function vowelIndex(text) {
  const lower = text.toLowerCase();
  for (const vowel of ["a", "e", "ê"]) {
    if (lower.includes(vowel)) return lower.indexOf(vowel);
  }
  if (lower.includes("ou")) return lower.indexOf("ou");
  for (let i = text.length - 1; i >= 0; i--)
    if (/[iouü]/i.test(text[i])) return i;
  return -1;
}
export function markTone(syllable, tone) {
  const text = unmark(typeof syllable === "string" ? syllable : syllable.text);
  const index = vowelIndex(text);
  if (index < 0 || !accents[tone]) return text;
  return (
    text.slice(0, index + 1) +
    accents[tone] +
    text.slice(index + 1)
  ).normalize("NFC");
}
function describe(text) {
  const marks = text.normalize("NFD").match(toneMarks) || [];
  if (marks.length > 1) return null;
  const tone = marks.length ? accents.indexOf(marks[0]) : 0;
  const base = unmark(text);
  // A marked vowel must belong to this syllable at the standard position.
  if (!syllables.has(base.toLowerCase()) || markTone(base, tone) !== text)
    return null;
  return { text, tone, vowelIndex: vowelIndex(base) };
}
// Separator tokens have tone:0 and vowelIndex:-1. Joining text reconstructs
// the NFC input exactly, including whitespace and straight/curly apostrophes.
export function parseSyllables(pinyin, count) {
  const text = pinyin.normalize("NFC");
  const memo = new Map();
  function split(offset, remaining) {
    if (offset === text.length)
      return remaining == null || remaining === 0 ? [] : null;
    if (remaining != null && remaining < 0) return null;
    const key = `${offset}:${remaining}`;
    if (memo.has(key)) return memo.get(key);
    const separator = text.slice(offset).match(/^[\s'’]+/);
    if (separator) {
      const rest = split(offset + separator[0].length, remaining);
      const result = rest && [
        { text: separator[0], tone: 0, vowelIndex: -1 },
        ...rest,
      ];
      memo.set(key, result);
      return result;
    }
    for (let length = Math.min(6, text.length - offset); length > 0; length--) {
      const item = describe(text.slice(offset, offset + length));
      if (!item) continue;
      // Syllabic consonants are standalone interjections, not word endings.
      // Only r may attach directly as an erhua suffix.
      if (
        /^(?:m|n|ng|hm|hng)$/i.test(item.text) &&
        ((offset > 0 && !/[\s'’]/.test(text[offset - 1])) ||
          (offset + length < text.length &&
            !/[\s'’]/.test(text[offset + length])))
      )
        continue;
      const rest = split(
        offset + length,
        remaining == null ? null : remaining - 1,
      );
      if (rest) {
        const result = [item, ...rest];
        memo.set(key, result);
        return result;
      }
    }
    memo.set(key, null);
    return null;
  }
  if (!text.trim()) return null;
  return (
    (Number.isInteger(count) && count > 0 ? split(0, count) : null) ||
    split(0, null)
  );
}
export function toneVariants(pinyin, count, n = 3) {
  if (!Number.isInteger(n) || n <= 0) return [];
  const answer = pinyin.normalize("NFC");
  let parts = parseSyllables(answer, count);
  if (!parts) {
    // Unknown spelling: only touch vowels that already carry a tone mark.
    parts = Array.from(answer, (text) => {
      const marks = text.normalize("NFD").match(toneMarks) || [];
      return {
        text,
        tone: marks.length ? accents.indexOf(marks[0]) : 0,
        vowelIndex: marks.length && /[aeiouüê]/i.test(unmark(text)) ? 0 : -1,
      };
    });
  }
  const indices = parts.flatMap((part, i) => (part.vowelIndex >= 0 ? [i] : []));
  const variants = new Set();
  const texts = parts.map((part) => part.text);
  // Enumerate by Hamming distance, stopping as soon as enough are available.
  function visit(start, left) {
    if (!left) {
      const candidate = texts.join("").normalize("NFC");
      if (candidate !== answer) variants.add(candidate);
      return variants.size >= n;
    }
    // Interleave syllables so short option lists do not always alter only
    // the first syllable. Cycling includes neutral-tone confusions as well.
    for (let delta = 1; delta <= 4; delta++) {
      for (let j = start; j <= indices.length - left; j++) {
        const i = indices[j];
        const tone = (parts[i].tone + delta) % 5;
        texts[i] = markTone(parts[i], tone);
        const done = visit(j + 1, left - 1);
        texts[i] = parts[i].text;
        if (done) return true;
      }
    }
    return false;
  }
  for (let distance = 1; distance <= indices.length; distance++)
    if (visit(0, distance)) break;
  return [...variants];
}
// Numbered-tone input (ni3 hao3, lv4) → tone marks, so an answer can be typed
// without a pinyin keyboard. A digit applies to the letter run right before
// it; 5 or 0 is the neutral tone. Runs without a digit are left as typed.
export function numberedToMarked(text) {
  return text.replace(/([a-zü]+)([0-5])/gi, (_, letters, digit) =>
    markTone(letters, Number(digit) % 5),
  );
}
// Comparison key for grading a typed pinyin answer. Tones stay significant
// (unlike validation.js normalizePinyin, which is for search); only
// presentation differences are dropped: case, Unicode composition, spacing
// and word joining (gěi nǐ = gěinǐ), apostrophes and punctuation, and the
// keyboard spellings v / u: for ü.
export function pinyinAnswerKey(value) {
  let text = String(value ?? "")
    .normalize("NFC")
    .toLowerCase()
    .replace(/u:/g, "ü")
    .normalize("NFD")
    .replace(/v/g, "u\u0308")
    .normalize("NFC");
  if (/[a-zü][0-5]/.test(text)) text = numberedToMarked(text);
  return text.replace(/[\s\p{P}`]/gu, "").normalize("NFC");
}
