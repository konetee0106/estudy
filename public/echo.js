// ===== 상태 =====
let currentSentence = "";
let currentTranslation = "";
let voices = [];
let selectedVoice = null;
let warmedUp = false;

let running = false;
let token = 0; // 정지/재시작 시 예약 콜백 무효화
let timer = null;
let count = 0; // 재생 횟수 (1,2=미리듣기 / 3=영어만 / 4+=영어+한글)
let subtitleMode = "auto"; // auto(점진 공개) | en | ko | both

// ===== DOM =====
const startBtn = document.getElementById("startBtn");
const nextBtn = document.getElementById("nextBtn");
const phaseEl = document.getElementById("phase");
const sentenceEl = document.getElementById("sentence");
const echoEn = document.getElementById("echoEn");
const echoKo = document.getElementById("echoKo");
const statusEl = document.getElementById("status");
const voiceSelect = document.getElementById("voiceSelect");
const rateInput = document.getElementById("rate");

// ===== 음성 (TTS) =====
function loadVoices() {
  voices = window.speechSynthesis
    .getVoices()
    .filter((v) => v.lang.startsWith("en"));
  voiceSelect.innerHTML = "";
  voices.forEach((v, i) => {
    const opt = document.createElement("option");
    opt.value = i;
    opt.textContent = `${v.name} (${v.lang})`;
    voiceSelect.appendChild(opt);
  });
  const preferred = Math.max(
    0,
    voices.findIndex((v) => /en-US/i.test(v.lang))
  );
  voiceSelect.value = preferred;
  selectedVoice = voices[preferred] || null;
}
if ("speechSynthesis" in window) {
  loadVoices();
  window.speechSynthesis.onvoiceschanged = loadVoices;
}
voiceSelect.addEventListener("change", () => {
  selectedVoice = voices[voiceSelect.value] || null;
});
function warmUpSpeech() {
  if (warmedUp || !("speechSynthesis" in window)) return;
  warmedUp = true;
  const u = new SpeechSynthesisUtterance(" ");
  u.volume = 0;
  if (selectedVoice) u.voice = selectedVoice;
  window.speechSynthesis.speak(u);
}

// 한 번 재생하고, 실제 말한 시간(ms)을 onEnd 로 넘김
function speakMeasured(text, myToken, onEnd) {
  if (!("speechSynthesis" in window) || !text) {
    onEnd && onEnd(1500);
    return;
  }
  const synth = window.speechSynthesis;
  synth.cancel();
  setTimeout(() => {
    if (myToken !== token) return;
    const primer = new SpeechSynthesisUtterance("hello");
    primer.volume = 0.05;
    primer.rate = 1;
    if (selectedVoice) primer.voice = selectedVoice;
    primer.lang = selectedVoice ? selectedVoice.lang : "en-US";
    synth.speak(primer);

    const utter = new SpeechSynthesisUtterance(text);
    if (selectedVoice) utter.voice = selectedVoice;
    utter.lang = selectedVoice ? selectedVoice.lang : "en-US";
    utter.rate = parseFloat(rateInput.value) || 0.9;

    let startT = 0;
    utter.onstart = () => {
      startT = Date.now();
    };
    let called = false;
    const done = () => {
      if (called) return;
      called = true;
      const dur = startT ? Date.now() - startT : estimateMs(text);
      onEnd && onEnd(dur);
    };
    utter.onend = done;
    utter.onerror = done;
    synth.speak(utter);
  }, 100);
}

// onstart 가 안 잡히는 브라우저용 대략 추정
function estimateMs(text) {
  const words = text.trim().split(/\s+/).length;
  const rate = parseFloat(rateInput.value) || 0.9;
  return Math.max(1200, (words / (2.5 * rate)) * 1000);
}

// ===== 재생 컨트롤 =====
function updateBtn() {
  if (running) startBtn.textContent = "⏸️ 일시정지";
  else if (count > 0) startBtn.textContent = "▶️ 계속";
  else startBtn.textContent = "▶️ 시작";
  startBtn.classList.toggle("active", running);
}

// 오디오·타이머만 멈춤 (count 는 유지)
function haltAudio() {
  running = false;
  token++;
  clearTimeout(timer);
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
}

function pauseFlow() {
  haltAudio();
  updateBtn();
  setStatus("⏸️ 일시정지 — '계속'을 누르면 다음 문장부터 이어집니다.");
}

// 멈춘 지점에서 다음 사이클로 이어감
function resumeFlow() {
  stopSnippet(); // 드래그 반복 재생 중이었으면 정지
  running = true;
  token++;
  updateBtn();
  runCycle(token);
}

// ===== 드래그한 부분만 반복 재생 =====
const tipEl = document.getElementById("tip");
let snippetOn = false;
let snippetTimer = null;

function stopSnippet() {
  snippetOn = false;
  clearTimeout(snippetTimer);
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  if (tipEl) tipEl.classList.remove("show");
}

function startSnippet(text, rect) {
  haltAudio(); // 본 재생 정지 (count 유지)
  updateBtn();
  snippetOn = true;
  loopSnippet(text);
  showTip("🔁 이 부분 반복 재생 중 — 멈추려면 ESC 또는 '계속'", rect);
}

function loopSnippet(text) {
  if (!snippetOn || !("speechSynthesis" in window)) return;
  const synth = window.speechSynthesis;
  synth.cancel();
  setTimeout(() => {
    if (!snippetOn) return;
    const primer = new SpeechSynthesisUtterance("hello");
    primer.volume = 0.05;
    primer.rate = 1;
    if (selectedVoice) primer.voice = selectedVoice;
    primer.lang = selectedVoice ? selectedVoice.lang : "en-US";
    synth.speak(primer);

    const utter = new SpeechSynthesisUtterance(text);
    if (selectedVoice) utter.voice = selectedVoice;
    utter.lang = selectedVoice ? selectedVoice.lang : "en-US";
    utter.rate = parseFloat(rateInput.value) || 0.9;
    const again = () => {
      if (!snippetOn) return;
      snippetTimer = setTimeout(() => loopSnippet(text), 900); // 0.9초 쉬고 반복
    };
    utter.onend = again;
    utter.onerror = again;
    synth.speak(utter);
  }, 80);
}

// 영어 문장에서 드래그 → 그 부분만 반복
echoEn.addEventListener("mouseup", () => setTimeout(handleEchoSelection, 10));
function handleEchoSelection() {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed) return;
  const text = sel.toString().trim();
  if (!text) return;
  const range = sel.getRangeAt(0);
  if (!echoEn.contains(range.commonAncestorContainer)) return;
  warmUpSpeech();
  startSnippet(text, range.getBoundingClientRect());
}

function showTip(text, rect) {
  tipEl.textContent = text;
  tipEl.classList.add("show");
  const margin = 8;
  const tipW = Math.min(420, window.innerWidth - margin * 2);
  tipEl.style.maxWidth = tipW + "px";
  let left = rect.left + rect.width / 2 - tipW / 2;
  left = Math.max(margin, Math.min(left, window.innerWidth - tipW - margin));
  let top = rect.bottom + 10;
  if (top + tipEl.offsetHeight > window.innerHeight - margin) {
    top = Math.max(margin, rect.top - tipEl.offsetHeight - 10);
  }
  tipEl.style.left = left + "px";
  tipEl.style.top = top + "px";
}
function hideTip() {
  tipEl.classList.remove("show");
}
document.addEventListener("mousedown", (e) => {
  if (!tipEl.contains(e.target)) hideTip();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") stopSnippet();
});
window.addEventListener("scroll", hideTip, true);

function showPreview() {
  sentenceEl.style.display = "none";
  phaseEl.style.display = "block";
}
function showSentence(withKorean) {
  phaseEl.style.display = "none";
  sentenceEl.style.display = "block";
  echoEn.style.display = "block";
  echoEn.textContent = currentSentence;
  echoKo.textContent = withKorean ? currentTranslation : "";
  echoKo.style.display = withKorean ? "block" : "none";
}
// 자막 버튼으로 강제 표시 (영문만/한글만/영문+한글)
function showModeView() {
  phaseEl.style.display = "none";
  sentenceEl.style.display = "block";
  const showEn = subtitleMode !== "ko";
  const showKo = subtitleMode !== "en";
  echoEn.textContent = showEn ? currentSentence : "";
  echoEn.style.display = showEn ? "block" : "none";
  echoKo.textContent = showKo ? currentTranslation : "";
  echoKo.style.display = showKo ? "block" : "none";
}
// 현재 상태에 맞춰 자막 즉시 반영 (버튼 눌렀을 때)
function applySubtitle() {
  if (!currentSentence) return; // 아직 문장 없음
  if (subtitleMode === "auto") return; // 자동은 runCycle이 처리
  showModeView();
}

// 한 번 재생 → 다음 예약
function runCycle(myToken) {
  if (myToken !== token || !running) return;
  count++;

  if (subtitleMode !== "auto") {
    // 자막 버튼이 켜져 있으면 처음부터 그 자막을 보여준다
    showModeView();
    setStatus(
      count <= 2
        ? "🎧 잘 들으세요."
        : "🔊 듣고, 소리가 끝나면 따라 읽어보세요."
    );
  } else if (count <= 4) {
    showPreview(); // 아직 지문 없음
    if (count <= 2) {
      setStatus(`🎧 잘 들으세요 (${count}/2) — 아직 지문은 안 보여드려요.`);
    } else {
      setStatus("🎧 지문 없이 소리로만 따라 읽어보세요.");
    }
  } else if (count === 5) {
    showSentence(false); // 영어만
    setStatus("👀 이제 문장을 보면서 따라 읽어보세요.");
  } else {
    showSentence(true); // 영어 + 한글
    setStatus("🔊 듣고, 소리가 끝나면 따라 읽어보세요.");
  }

  speakMeasured(currentSentence, myToken, (spokenMs) => {
    if (myToken !== token || !running) return;
    let gap;
    if (count <= 2) {
      gap = 1000; // 미리듣기: 1초 텀
    } else {
      gap = spokenMs + 2000; // 말한 시간 + 2초 → 따라 읽는 시간
      setStatus("🗣️ 지금 따라 읽어보세요!");
    }
    timer = setTimeout(() => {
      if (myToken !== token || !running) return;
      runCycle(myToken);
    }, gap);
  });
}

function recentEcho() {
  if (typeof History === "undefined") return [];
  return History.recent("echo", 30);
}

async function fetchSentence() {
  setStatus("문장을 준비하는 중…");
  try {
    const res = await fetch("/api/sentence", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recent: recentEcho(),
        theme: typeof getTheme === "function" ? getTheme() : undefined,
        level: typeof getLevel === "function" ? getLevel() : undefined,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `서버 오류 (${res.status})`);
    }
    const data = await res.json();
    currentSentence = (data.sentence || "").trim();
    currentTranslation = (data.translation || "").trim();
    if (typeof History !== "undefined") History.add("echo", currentSentence);
    return true;
  } catch (err) {
    setStatus("오류: " + err.message, "error");
    return false;
  }
}

// 흐름 시작 (useNew=true 면 새 문장부터, count 초기화)
async function beginFlow(useNew) {
  stopSnippet();
  haltAudio();
  warmUpSpeech();
  if (useNew || !currentSentence) {
    startBtn.disabled = true;
    nextBtn.disabled = true;
    const ok = await fetchSentence();
    startBtn.disabled = false;
    nextBtn.disabled = false;
    if (!ok) return;
  }
  running = true;
  token++;
  count = 0;
  updateBtn();
  runCycle(token);
}

startBtn.addEventListener("click", () => {
  if (running) {
    pauseFlow(); // 재생 중 → 일시정지
  } else if (count > 0 && currentSentence) {
    resumeFlow(); // 멈춘 상태 → 다음 문장부터 이어감
  } else {
    beginFlow(false); // 처음 시작
  }
});

nextBtn.addEventListener("click", () => beginFlow(true));

// 자막 버튼 (자동/영문만/한글만/영문+한글)
const subtitleBar = document.getElementById("subtitleBar");
subtitleBar.querySelectorAll("button").forEach((b) => {
  b.addEventListener("click", () => {
    subtitleMode = b.dataset.sub;
    subtitleBar
      .querySelectorAll("button")
      .forEach((x) => x.classList.toggle("active", x === b));
    if (subtitleMode === "auto") {
      // 자동으로 되돌리면: 문장이 떠 있으면 현재 진행 단계에 맞춰 다시 표시
      if (currentSentence) {
        if (count >= 6 || count === 0) showSentence(true);
        else if (count === 5) showSentence(false);
        else showPreview();
      }
    } else {
      applySubtitle(); // 즉시 자막 반영
    }
  });
});

function setStatus(text, kind = "") {
  statusEl.textContent = text;
  statusEl.className = "status" + (kind ? " " + kind : "");
}

// 질문하기 위젯에 현재 문장 전달
window.getAskContext = function () {
  if (!currentSentence) return "";
  let c = "Repeat-after-me sentence: " + currentSentence;
  if (currentTranslation) c += "\nKorean: " + currentTranslation;
  return c;
};
