import { readLocal, writeLocal } from "./utils.js";
export async function api(path, options = {}) {
  const response = await fetch(`/api/${path}`, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await response.json();
  if (!response.ok)
    throw Error(
      data.error || data.errors?.join(", ") || `요청 실패 (${response.status})`,
    );
  return data;
}
export async function loadStudy() {
  try {
    const [vocabulary, sentences, grammar, culture, components, exams] =
      await Promise.all(
        [
          "vocabulary",
          "sentences",
          "grammar",
          "culture",
          "components",
          "exams",
        ].map((k) => api(k)),
      );
    const data = { vocabulary, sentences, grammar, culture, components, exams };
    writeLocal("ch.dataset", data);
    return { ...data, cached: false };
  } catch (e) {
    const cached = readLocal("ch.dataset", null);
    if (cached) return { ...cached, cached: true };
    throw e;
  }
}
