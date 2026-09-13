import { readLocal, writeLocal, el, button, toast } from "./utils.js";
export function speechAvailable() {
  return (
    "speechSynthesis" in window &&
    "SpeechSynthesisUtterance" in window &&
    speechSynthesis.getVoices().some((v) => /^zh[-_]/i.test(v.lang))
  );
}
export function speakChinese(text, slow = false) {
  if (!speechAvailable()) {
    toast(
      "중국어 음성을 사용할 수 없습니다. 기기의 중국어 TTS 음성을 설치하세요.",
    );
    return false;
  }
  speechSynthesis.cancel();
  const settings = readLocal("ch.speech", { normal: 0.9, slow: 0.6 });
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "zh-CN";
  utterance.voice =
    speechSynthesis.getVoices().find((v) => /^zh[-_]CN$/i.test(v.lang)) ||
    speechSynthesis.getVoices().find((v) => /^zh[-_]/i.test(v.lang));
  utterance.rate = Math.max(
    0.3,
    Math.min(1.5, Number(slow ? settings.slow : settings.normal) || 0.8),
  );
  utterance.onerror = () =>
    toast("음성을 재생하지 못했습니다. 병음 학습을 계속할 수 있습니다.");
  speechSynthesis.speak(utterance);
  return true;
}
export function speechControls(text) {
  return el(
    "div",
    { class: "row" },
    button("🔊 보통", () => speakChinese(text)),
    button("🐢 느리게", () => speakChinese(text, true)),
  );
}
export function speechSettings() {
  const value = readLocal("ch.speech", { normal: 0.9, slow: 0.6 });
  const box = el(
    "details",
    { class: "settings" },
    el("summary", {}, "발음 속도 설정"),
  );
  for (const [key, label] of [
    ["normal", "보통"],
    ["slow", "느리게"],
  ]) {
    const input = el("input", {
      type: "number",
      min: 0.3,
      max: 1.5,
      step: 0.1,
      value: value[key],
      onChange: () => {
        value[key] = Math.max(0.3, Math.min(1.5, Number(input.value) || 0.6));
        writeLocal("ch.speech", value);
      },
    });
    box.append(el("label", {}, label, input));
  }
  return box;
}
