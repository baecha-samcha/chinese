// Exam scopes are tags on study rows (exam_tags, ids from the exams table),
// separate from source, which records where a row came from. This script
//
//   migration <evidence.json> [--with-schema]
//     prints the SQL that records a PDF-verified exam scope: restores the
//     source of rows the evidence confirms and adds the exam tag to every
//     member row. Rows are matched by id AND content, so a database with
//     different data (e.g. local test fixtures) is left untouched.
//
//   build --dump <d1-export.sql> [--exam 2026-midterm] [--out file]
//     loads a D1 export, applies the repo migrations it has not run yet and
//     writes the rows tagged with the exam to public/data/exam-scope.json,
//     the fixed scope snapshot the practice exam is generated from.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sql = (v) =>
  typeof v === "number" ? String(v) : `'${String(v).replaceAll("'", "''")}'`;
const pairs = (rows) =>
  rows.map(([id, text]) => `(${sql(id)},${sql(text)})`).join(",\n ");
// Table and content column that identify a row together with its id.
const targets = {
  vocabulary: ["vocabulary", "simplified"],
  sentences: ["sentences", "chinese"],
  grammar: ["grammar_rules", "title"],
  culture: ["culture_items", "question"],
};

export function examMigrationSql(evidence, { schema = false } = {}) {
  const { exam } = evidence;
  const out = [];
  if (schema)
    out.push(`-- Exam scopes as tags, separate from source (provenance: 0=교과서, 1=보충자료).
-- exams lists the exam scopes; each study row lists the exams it belongs to
-- in exam_tags, so one row can be in several exams (e.g. midterm and final).
CREATE TABLE exams (
 id TEXT PRIMARY KEY CHECK(id <> '' AND id NOT GLOB '*[^a-z0-9-]*'),
 label TEXT NOT NULL,
 sort_order INTEGER NOT NULL DEFAULT 0
);
ALTER TABLE vocabulary ADD COLUMN exam_tags TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(exam_tags));
ALTER TABLE sentences ADD COLUMN exam_tags TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(exam_tags));
ALTER TABLE grammar_rules ADD COLUMN exam_tags TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(exam_tags));
ALTER TABLE culture_items ADD COLUMN exam_tags TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(exam_tags));`);
  out.push(`-- ${exam.label} (${exam.id}): verified against ${evidence.pdf.file}
-- (sha256 ${evidence.pdf.sha256}). Per-row evidence: scripts/data/exam-${exam.id}.json
INSERT OR IGNORE INTO exams (id,label,sort_order) VALUES (${sql(exam.id)},${sql(exam.label)},${exam.sort_order ?? 0});`);
  // Only a missing source is filled in; a source that is already set is kept.
  for (const [kind, rows] of Object.entries(evidence.sourceRecovery)) {
    const [table, column] = targets[kind];
    for (const source of [0, 1]) {
      const matched = rows.filter((r) => r.source === source);
      if (!matched.length) continue;
      out.push(`UPDATE ${table} SET source=${source}${table === "vocabulary" ? ",updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')" : ""}
WHERE source IS NULL AND (id,${column}) IN (VALUES
 ${pairs(matched.map((r) => [r.id, r[column]]))});`);
    }
  }
  // Appends the tag; existing tags are kept and re-running is a no-op.
  for (const [kind, rows] of Object.entries(evidence.members)) {
    const [table, column] = targets[kind];
    out.push(`UPDATE ${table} SET exam_tags=json_insert(exam_tags,'$[#]',${sql(exam.id)})
WHERE NOT EXISTS (SELECT 1 FROM json_each(exam_tags) WHERE value=${sql(exam.id)})
AND (id,${column}) IN (VALUES
 ${pairs(rows)});`);
  }
  return out.join("\n\n") + "\n";
}

const tagged = (table, columns, order = "id") =>
  `SELECT ${columns} FROM ${table} WHERE EXISTS (SELECT 1 FROM json_each(${table}.exam_tags) WHERE value=?) ORDER BY ${order}`;

// Rows of every study table that carry the exam tag, in the exam-scope.json shape.
export function selectExamScope(db, examId) {
  const exam = db.prepare("SELECT id,label FROM exams WHERE id=?").get(examId);
  if (!exam) throw Error(`등록되지 않은 시험 범위: ${examId}`);
  const all = (query, json = []) =>
    db
      .prepare(query)
      .all(examId)
      .map((r) => {
        const row = { ...r };
        for (const f of json) row[f] = JSON.parse(row[f]);
        return row;
      });
  return {
    exam: { id: exam.id, label: exam.label },
    vocabulary: all(
      tagged("vocabulary", "id,simplified,pinyin,meaning,source"),
    ),
    sentences: all(tagged("sentences", "id,chinese,korean,source,tokens"), [
      "tokens",
    ]),
    grammar: all(
      tagged("grammar_rules", "id,title,explanation,correct_examples"),
      ["correct_examples"],
    ),
    culture: all(
      tagged("culture_items", "id,category,question,answer,explanation"),
    ),
  };
}

// Runs the repo migrations a D1 export has not recorded yet, like
// `wrangler d1 migrations apply` would on that database.
export function applyPendingMigrations(db, dir = join(root, "migrations")) {
  const done = new Set(
    db
      .prepare("SELECT name FROM d1_migrations")
      .all()
      .map((r) => r.name),
  );
  const applied = [];
  for (const name of readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    if (done.has(name)) continue;
    db.exec(readFileSync(join(dir, name), "utf8"));
    db.prepare("INSERT INTO d1_migrations (name) VALUES (?)").run(name);
    applied.push(name);
  }
  return applied;
}

async function main([command, ...args]) {
  const option = (name, fallback) => {
    const i = args.indexOf(`--${name}`);
    return i < 0 ? fallback : args[i + 1];
  };
  if (command === "migration") {
    const evidence = JSON.parse(readFileSync(args[0], "utf8"));
    process.stdout.write(
      examMigrationSql(evidence, { schema: args.includes("--with-schema") }),
    );
  } else if (command === "build") {
    const dump = option("dump");
    if (!dump) throw Error("--dump <D1 export .sql> 가 필요합니다.");
    const examId = option("exam", "2026-midterm");
    const out = option("out", join(root, "public/data/exam-scope.json"));
    const { DatabaseSync } = await import("node:sqlite");
    const text = readFileSync(dump, "utf8");
    const db = new DatabaseSync(":memory:");
    db.exec(text);
    const applied = applyPendingMigrations(db);
    const scope = selectExamScope(db, examId);
    const sha256 = createHash("sha256").update(text).digest("hex");
    const body = {
      vocabulary: scope.vocabulary,
      sentences: scope.sentences,
      grammar: scope.grammar,
      culture: scope.culture,
    };
    const result = {
      exam: scope.exam,
      version: `${examId}@${createHash("sha256").update(JSON.stringify(body)).digest("hex").slice(0, 12)}`,
      provenance: {
        file: basename(dump),
        sha256,
        migrationsApplied: applied,
        note: `exam_tags에 ${examId}가 있는 행. 범위 근거: scripts/data/exam-${examId}.json`,
      },
      ...body,
    };
    writeFileSync(out, JSON.stringify(result, null, 2) + "\n");
    console.log(
      `${out}: ${Object.entries(body)
        .map(([k, v]) => `${k} ${v.length}`)
        .join(
          ", ",
        )}${applied.length ? ` (적용한 migration: ${applied.join(", ")})` : ""}`,
    );
  } else {
    console.error(
      "usage: node scripts/exam-scope.mjs migration <evidence.json> [--with-schema]\n       node scripts/exam-scope.mjs build --dump <export.sql> [--exam id] [--out file]",
    );
    process.exitCode = 2;
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url))
  await main(process.argv.slice(2));
