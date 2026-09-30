// Renders the app icon PNGs (favicon, PWA, Apple touch) from the SVG sources
// in public/icons with Playwright's Chromium. Run after editing an icon SVG:
//   node scripts/icons.mjs
import { chromium } from "@playwright/test";
import { readFile } from "node:fs/promises";
const outputs = [
  ["icon.svg", "icon-192.png", 192],
  ["icon.svg", "icon-512.png", 512],
  ["icon-maskable.svg", "icon-maskable-512.png", 512],
  ["icon-maskable.svg", "apple-touch-icon.png", 180],
];
const browser = await chromium.launch();
for (const [src, out, size] of outputs) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  const svg = (await readFile(`public/icons/${src}`)).toString("base64");
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}</style><img src="data:image/svg+xml;base64,${svg}" width="${size}" height="${size}" style="display:block">`,
  );
  await page.screenshot({ path: `public/icons/${out}`, omitBackground: true });
  await page.close();
}
await browser.close();
