// Shared helpers for the self-hosted CJK rare-component fallback font.
//
// Why this exists: decomposition data can reference any CJK Unified Ideograph,
// including ones outside the Basic Multilingual Plane (CJK Extension B and
// beyond, e.g. 𠂇 U+20087). Neither the system fonts most visitors have
// installed nor common web CJK fonts (Noto Sans SC/CJK) include those
// characters, so they render as tofu. HanaMin (bundled via the
// @vp-tw/cjk-web-fonts-hanamin package) is one of the few freely
// redistributable fonts with full coverage of CJK Ext B-F, split into
// unicode-range-chunked woff2 files so a browser only ever downloads the
// specific ~200KB chunk that covers a character actually in use.
//
// `scripts/data/hanamin-blocks.json` is a manifest of every HanaMinB chunk
// file and the unicode ranges it covers (regenerate with
// `node scripts/generate-hanamin-manifest.mjs` if the font package is
// upgraded). `scripts/data/cjk-fallback-known.json` is the maintained list of
// characters this project's vocabulary data is currently known to need the
// fallback for - see README for how to refresh it against production D1 data.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { leaves } from "../public/js/validation.js";

const dataDir = fileURLToPath(new URL("./data/", import.meta.url));

export function loadBlockManifest() {
  return JSON.parse(readFileSync(`${dataDir}hanamin-blocks.json`, "utf8"));
}

export function loadKnownRareChars() {
  return JSON.parse(readFileSync(`${dataDir}cjk-fallback-known.json`, "utf8"));
}

// A character needs the fallback font once it's outside the Basic
// Multilingual Plane: every ordinary simplified/traditional hanzi and every
// common Kangxi radical/CJK stroke used as a decomposition component lives in
// the BMP, so this is a reliable, data-driven signal rather than a per-char
// allowlist.
export const needsFallback = (ch) => ch.codePointAt(0) >= 0x10000;

// Every decomposition-leaf value plus each character's own glyph, deduped.
export function rareCharsInVocabulary(vocabulary) {
  const found = new Set();
  for (const v of vocabulary || [])
    for (const c of v.characters || []) {
      if (needsFallback(c.char)) found.add(c.char);
      if (!c.decomposition) continue;
      for (const leaf of leaves(c.decomposition))
        if (needsFallback(leaf.value)) found.add(leaf.value);
    }
  return found;
}

export function blockFileFor(ch, manifest = loadBlockManifest()) {
  const cp = ch.codePointAt(0);
  const hit = manifest.find((b) =>
    b.ranges.some(([a, z]) => cp >= a && cp <= z),
  );
  return hit ? hit.file : null;
}
