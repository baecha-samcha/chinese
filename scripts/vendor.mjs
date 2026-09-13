import { mkdir, copyFile } from "node:fs/promises";
await mkdir("public/vendor", { recursive: true });
await copyFile(
  "node_modules/xlsx/dist/xlsx.full.min.js",
  "public/vendor/xlsx.full.min.js",
);
await copyFile("node_modules/xlsx/LICENSE", "public/vendor/xlsx.LICENSE.txt");
