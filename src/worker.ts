import { createRemoteJWKSet, jwtVerify } from "jose";
import {
  validateRow,
  normalizePinyin,
  identity,
  kinds,
} from "../public/js/validation.js";
interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  LOCAL_DEV?: string | boolean;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
}
const tables: Record<string, string> = {
  vocabulary: "vocabulary",
  sentences: "sentences",
  grammar: "grammar_rules",
  culture: "culture_items",
};
const columns: Record<string, string[]> = {
  vocabulary: [
    "simplified",
    "traditional",
    "pinyin",
    "pinyin_normalized",
    "meaning",
    "korean_hanja_reading",
    "characters",
    "source",
  ],
  sentences: [
    "korean",
    "chinese",
    "tokens",
    "explanation",
    "source",
    "pinyin",
    "category",
  ],
  grammar: [
    "title",
    "explanation",
    "correct_examples",
    "wrong_examples",
    "tags",
    "questions",
  ],
  culture: ["category", "question", "answer", "distractors", "explanation"],
};
const jsonFields = [
  "characters",
  "tokens",
  "correct_examples",
  "wrong_examples",
  "tags",
  "questions",
  "distractors",
];
const keys = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
function decode(r: Record<string, unknown>) {
  for (const f of jsonFields)
    if (typeof r[f] === "string") r[f] = JSON.parse(r[f] as string);
  return r;
}
async function rows(env: Env, kind: string) {
  return (
    await env.DB.prepare(`SELECT * FROM ${tables[kind]} ORDER BY id DESC`).all()
  ).results.map(decode);
}
async function isAdmin(req: Request, env: Env) {
  const host = new URL(req.url).hostname;
  if (
    (env.LOCAL_DEV === "true" || env.LOCAL_DEV === true) &&
    ["127.0.0.1", "localhost", "[::1]"].includes(host)
  )
    return true;
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return false;
  try {
    const issuer = `https://${env.ACCESS_TEAM_DOMAIN.replace(/^https:\/\//, "").replace(/\/$/, "")}`;
    if (!keys.has(issuer))
      keys.set(
        issuer,
        createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`)),
      );
    const cookie = req.headers
      .get("Cookie")
      ?.split(";")
      .map((c) => c.trim())
      .find((c) => c.startsWith("CF_Authorization="))
      ?.slice("CF_Authorization=".length);
    await jwtVerify(
      req.headers.get("Cf-Access-Jwt-Assertion") || cookie || "",
      keys.get(issuer)!,
      { issuer, audience: env.ACCESS_AUD, algorithms: ["RS256"] },
    );
    return true;
  } catch {
    return false;
  }
}
async function body(req: Request) {
  if (!req.headers.get("Content-Type")?.includes("application/json"))
    throw new HttpError(415, "JSON 요청이 필요합니다.");
  const reader = req.body?.getReader();
  if (!reader) throw new HttpError(400, "본문 없음");
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 2_000_000) {
      await reader.cancel();
      throw new HttpError(413, "최대 요청 크기는 2 MB입니다.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new HttpError(400, "JSON 형식 오류");
  }
}
function statement(
  env: Env,
  kind: string,
  data: Record<string, any>,
  id?: number,
) {
  if (kind === "vocabulary")
    data = { ...data, pinyin_normalized: normalizePinyin(data.pinyin) };
  const cols = columns[kind],
    values = cols.map((c) =>
      jsonFields.includes(c) ? JSON.stringify(data[c]) : data[c],
    );
  return id
    ? env.DB.prepare(
        `UPDATE ${tables[kind]} SET ${cols.map((c) => `${c}=?`).join(",")}${kind === "vocabulary" ? ",updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')" : ""} WHERE id=?`,
      ).bind(...values, id)
    : env.DB.prepare(
        `INSERT INTO ${tables[kind]} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`,
      ).bind(...values);
}
async function digest(value: unknown) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(JSON.stringify(value)),
      ),
    ),
  ]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
}
async function api(req: Request, env: Env) {
  const url = new URL(req.url),
    path = url.pathname,
    method = req.method;
  if (path === "/api/admin/session" && method === "GET")
    return json({ authenticated: await isAdmin(req, env) });
  if (method !== "GET") {
    if (!(await isAdmin(req, env)))
      throw new HttpError(
        401,
        "관리자 인증이 필요합니다. Cloudflare Access 설정을 확인하세요.",
      );
    if (req.headers.get("Origin") !== url.origin)
      throw new HttpError(403, "동일 출처 요청만 허용됩니다.");
  }
  if (path === "/api/components" && method === "GET")
    // depth: how many "children[" hops cc.path is from the decomposition root —
    // a cheap proxy for how big/abstract a component usually is (a direct child
    // of some character sits at depth 1; something nested further is smaller),
    // so the client can favor distractors at the same visual level as the answer.
    return json(
      (
        await env.DB.prepare(
          "SELECT c.value,c.stroke_count,c.shape_group,cc.position,COUNT(*) AS frequency,MIN((LENGTH(cc.path)-LENGTH(REPLACE(cc.path,'children[','')))/9) AS depth FROM components c JOIN character_components cc ON cc.component_value=c.value GROUP BY c.value,cc.position",
        ).all()
      ).results,
    );
  if (path === "/api/export" && method === "GET") {
    if (!(await isAdmin(req, env)))
      throw new HttpError(401, "관리자 인증 필요");
    const data: Record<string, unknown> = { version: 1 };
    for (const k of kinds) data[k] = await rows(env, k);
    return json(data);
  }
  if (
    ["/api/import/preview", "/api/import"].includes(path) &&
    method === "POST"
  ) {
    const b = await body(req);
    if (
      !kinds.includes(b.kind) ||
      !Array.isArray(b.rows) ||
      b.rows.length < 1 ||
      b.rows.length > 500
    )
      throw new HttpError(400, "유형을 선택하고 1~500개 행을 전달하세요.");
    const existing = await rows(env, b.kind);
    const seen = [...existing];
    const preview = b.rows.map((r: any) => {
      const v = validateRow(b.kind, r, seen);
      if (v.status !== "ERROR") seen.push({ ...v.data, id: 0 });
      return v;
    });
    const revision = await digest(existing);
    const fingerprint = await digest({ kind: b.kind, rows: b.rows, revision });
    if (path.endsWith("/preview"))
      return json({ rows: preview, fingerprint, revision });
    if (b.fingerprint !== fingerprint)
      throw new HttpError(
        409,
        "미리보기 이후 데이터가 변경되었습니다. 다시 검증하세요.",
      );
    if (preview.some((r: any) => r.status === "ERROR"))
      throw new HttpError(422, "오류 행을 수정한 뒤 다시 검증하세요.");
    if (
      !["keep", "overwrite", "both"].includes(b.policy) ||
      (b.policies &&
        (!Array.isArray(b.policies) ||
          b.policies.length !== b.rows.length ||
          b.policies.some(
            (p: any) => !["keep", "overwrite", "both"].includes(p),
          )))
    )
      throw new HttpError(400, "중복 정책 오류");
    const plans: { data: any; id?: number }[] = [];
    const pending = new Map<string, number>();
    let skipped = 0;
    for (let i = 0; i < preview.length; i++) {
      const data = preview[i].data,
        key = identity(b.kind, data),
        policy = b.policies?.[i] || b.policy;
      const matches = existing.filter((r) => identity(b.kind, r) === key),
        previous = pending.get(key);
      if (policy === "keep" && (matches.length || previous !== undefined)) {
        skipped++;
        continue;
      }
      if (policy === "overwrite" && previous !== undefined) {
        plans[previous].data = data;
        continue;
      }
      pending.set(key, plans.length);
      plans.push({
        data,
        ...(policy === "overwrite" && matches.length
          ? { id: Number(matches[0].id) }
          : {}),
      });
    }
    const writes = plans.map((p) => statement(env, b.kind, p.data, p.id));
    if (writes.length) await env.DB.batch(writes);
    return json({ written: writes.length, skipped });
  }
  const match = path.match(
    /^\/api\/(vocabulary|sentences|grammar|culture)(?:\/(\d+))?$/,
  );
  if (!match) throw new HttpError(404, "API를 찾을 수 없습니다.");
  const [, kind, idText] = match,
    id = idText ? Number(idText) : undefined;
  if (id !== undefined && (!Number.isSafeInteger(id) || id < 1))
    throw new HttpError(400, "ID 오류");
  if (method === "GET") {
    if (id) {
      const row = await env.DB.prepare(
        `SELECT * FROM ${tables[kind]} WHERE id=?`,
      )
        .bind(id)
        .first();
      if (!row) throw new HttpError(404, "항목 없음");
      return json(decode(row));
    }
    if (kind === "vocabulary" && url.searchParams.get("q")) {
      const q = url.searchParams.get("q")!.slice(0, 200),
        like = `%${q.replace(/[!%_]/g, "!$&")}%`,
        norm = `%${normalizePinyin(q).replace(/[!%_]/g, "!$&")}%`;
      return json(
        (
          await env.DB.prepare(
            "SELECT * FROM vocabulary WHERE simplified LIKE ? ESCAPE '!' OR traditional LIKE ? ESCAPE '!' OR pinyin LIKE ? ESCAPE '!' OR pinyin_normalized LIKE ? ESCAPE '!' OR meaning LIKE ? ESCAPE '!' OR korean_hanja_reading LIKE ? ESCAPE '!' ORDER BY id DESC",
          )
            .bind(like, like, like, norm, like, like)
            .all()
        ).results.map(decode),
      );
    }
    return json(await rows(env, kind));
  }
  if (method === "DELETE" && id) {
    const result = await env.DB.prepare(
      `DELETE FROM ${tables[kind]} WHERE id=?`,
    )
      .bind(id)
      .run();
    if (!result.meta.changes) throw new HttpError(404, "항목 없음");
    return json({ deleted: id });
  }
  if ((method === "POST" && !id) || (method === "PUT" && id)) {
    const b = await body(req),
      v = validateRow(kind, b);
    if (v.status === "ERROR") return json(v, 422);
    if (
      id &&
      !(await env.DB.prepare(`SELECT id FROM ${tables[kind]} WHERE id=?`)
        .bind(id)
        .first())
    )
      throw new HttpError(404, "항목 없음");
    const result = await statement(env, kind, v.data, id).run();
    return json(
      { id: id || result.meta.last_row_id, warnings: v.warnings },
      id ? 200 : 201,
    );
  }
  throw new HttpError(405, "지원하지 않는 메서드");
}
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    let response: Response;
    try {
      const p = new URL(req.url).pathname;
      if (p.startsWith("/api/")) response = await api(req, env);
      else if (
        (p === "/admin" || p.startsWith("/admin/")) &&
        !(await isAdmin(req, env))
      )
        response = new Response(
          "관리자 인증이 필요합니다. Cloudflare Access로 로그인하세요. 로컬 개발은 README의 .dev.vars 설정을 확인하세요.",
          {
            status: 401,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          },
        );
      else response = await env.ASSETS.fetch(req);
    } catch (e) {
      if (e instanceof HttpError)
        response = json({ error: e.message }, e.status);
      else {
        console.error(
          "Request failed",
          e instanceof Error ? e.message : "Unknown error",
        );
        response = json(
          { error: "서버 처리 오류. 잠시 후 다시 시도하세요." },
          500,
        );
      }
    }
    const headers = new Headers(response.headers);
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Referrer-Policy", "same-origin");
    headers.set("X-Frame-Options", "DENY");
    headers.set(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    );
    if (new URL(req.url).pathname.startsWith("/admin"))
      headers.set("Cache-Control", "no-store");
    return new Response(response.body, { status: response.status, headers });
  },
};
