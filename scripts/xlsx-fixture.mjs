import { readFile, writeFile } from "node:fs/promises";
import XLSX from "xlsx";
const data = JSON.parse(await readFile("fixtures/data.json", "utf8"));
const book = XLSX.utils.book_new();
for (const [name, rows] of Object.entries(data)) {
  const values = rows.map((r) =>
    Object.fromEntries(
      Object.entries(r).map(([k, v]) => [
        k,
        typeof v === "object" ? JSON.stringify(v) : v,
      ]),
    ),
  );
  const sheet = XLSX.utils.json_to_sheet(values);
  sheet["!cols"] = Object.keys(values[0]).map((k) => ({
    wch:
      k === "characters" || k === "questions"
        ? 90
        : k === "explanation"
          ? 60
          : 24,
  }));
  sheet["!autofilter"] = { ref: sheet["!ref"] };
  XLSX.utils.book_append_sheet(book, sheet, name);
}
await writeFile(
  "public/fixtures/sample.xlsx",
  XLSX.write(book, { type: "buffer", bookType: "xlsx" }),
);
const check = XLSX.read(await readFile("public/fixtures/sample.xlsx"), {
  type: "buffer",
});
for (const [kind, rows] of Object.entries(data)) {
  const actual = XLSX.utils.sheet_to_json(check.Sheets[kind], { defval: "" });
  if (actual.length !== rows.length)
    throw Error(`XLSX row count mismatch: ${kind}`);
  for (let i = 0; i < rows.length; i++)
    for (const [k, v] of Object.entries(rows[i]))
      if (actual[i][k] !== (typeof v === "object" ? JSON.stringify(v) : v))
        throw Error(`XLSX value mismatch: ${kind}/${i}/${k}`);
}
console.log("Verified sample.xlsx: 4 sheets, all seed values match.");
