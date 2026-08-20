// ===== 강의 클래스 (귀뚫기챌린지 / 봄봄클래스) =====
// ?c=guiddulki (기본) 또는 ?c=bombom 으로 어떤 클래스인지 결정
const CLASSES = {
  guiddulki: { emoji: "🎧", name: "귀뚫기챌린지", data: "lessons-guiddulki.json" },
  bombom: { emoji: "🌸", name: "봄봄클래스", data: "lessons-bombom.json" },
};
const _cparam = new URLSearchParams(location.search).get("c");
const CLS = CLASSES[_cparam] ? _cparam : "guiddulki";
const CFG = CLASSES[CLS];

let lessons = [];
let lesson = null; // 현재 강의
let idx = 0; // 현재 문장 인덱스
let voices = [];
let selectedVoice = null;
let warmedUp = false;
let revealed = false; // 현재 문장 정답 공개 여부
const PROG_KEY = "bombom_progress_v1_" + CLS;

// ===== DOM =====
const lessonSelect = document.getElementById("lessonSelect");
const audioBtn = document.getElementById("audioBtn");
const readAllBtn = document.getElementById("readAllBtn");
const nativeAudio = document.getElementById("nativeAudio");
const progressEl = document.getElementById("progress");
const speakerEl = document.getElementById("speaker");
const koPromptEl = document.getElementById("koPrompt");
const answerForm = document.getElementById("answerForm");
const answerInput = document.getElementById("answerInput");
const hintBtn = document.getElementById("hintBtn");
const checkBtn = document.getElementById("checkBtn");
const resultEl = document.getElementById("result");
const prevBtn = document.getElementById("prevBtn");
const nextBtn = document.getElementById("nextBtn");
const statusEl = document.getElementById("status");
const voiceSelect = document.getElementById("voiceSelect");
const rateInput = document.getElementById("rate");

// ===== 음성 (TTS) =====
function loadVoices() {
  voices = window.speechSynthesis.getVoices().filter((v) => v.lang.startsWith("en"));
  voiceSelect.innerHTML = "";
  voices.forEach((v, i) => {
    const opt = document.createElement("option");
    opt.value = i;
    opt.textContent = `${v.name} (${v.lang})`;
    voiceSelect.appendChild(opt);
  });
  const preferred = Math.max(0, voices.findIndex((v) => /en-US/i.test(v.lang)));
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
function speak(text, onEnd) {
  if (!("speechSynthesis" in window) || !text) {
    onEnd && onEnd();
    return;
  }
  const synth = window.speechSynthesis;
  synth.cancel();
  setTimeout(() => {
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
    utter.onend = () => onEnd && onEnd();
    utter.onerror = () => onEnd && onEnd();
    synth.speak(utter);
  }, 100);
}

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function setStatus(text, kind = "") {
  statusEl.textContent = text;
  statusEl.className = "status" + (kind ? " " + kind : "");
}

// ===== 강의 로드 =====
async function loadLessons() {
  try {
    const res = await fetch(CFG.data);
    lessons = await res.json();
  } catch {
    lessons = [];
  }
  if (!lessons.length) {
    setStatus("강의 데이터를 불러오지 못했습니다.", "error");
    return;
  }
  lessonSelect.innerHTML = "";
  lessons.forEach((l) => {
    const opt = document.createElement("option");
    opt.value = l.day;
    opt.textContent = `${l.day}일차 — ${l.titleKo || l.title}`;
    lessonSelect.appendChild(opt);
  });

  // 이전 진행 복원
  let day = lessons[0].day,
    startIdx = 0;
  try {
    const p = JSON.parse(localStorage.getItem(PROG_KEY) || "null");
    if (p && lessons.some((l) => l.day === p.day)) {
      day = p.day;
      startIdx = p.idx || 0;
    }
  } catch {}
  lessonSelect.value = day;
  selectLesson(day, startIdx);
}

function selectLesson(day, startIdx = 0) {
  stopAll();
  lesson = lessons.find((l) => l.day === day) || null;
  idx = 0;
  if (!lesson) return;
  idx = Math.min(Math.max(0, startIdx), lesson.lines.length - 1);
  // 원어민 음원 준비
  if (lesson.audio) {
    nativeAudio.src = lesson.audio;
    audioBtn.style.display = "";
  } else {
    audioBtn.style.display = "none";
  }
  render();
}

// ===== 문장 렌더 =====
function render() {
  if (!lesson) return;
  const line = lesson.lines[idx];
  revealed = false;
  progressEl.textContent = `${lesson.day}일차 · ${idx + 1} / ${lesson.lines.length}`;

  if (line.speaker) {
    speakerEl.style.display = "";
    speakerEl.textContent = "🗣️ " + line.speaker;
  } else {
    speakerEl.style.display = "none";
  }
  koPromptEl.textContent = line.ko || "(번역 없음)";
  answerInput.value = "";
  answerInput.disabled = false;
  checkBtn.disabled = false;
  resultEl.classList.remove("show");
  resultEl.innerHTML = "";
  prevBtn.disabled = idx === 0;
  nextBtn.disabled = false;
  answerInput.focus();
  saveProgress();
  setStatus("한글을 영어로 옮겨 적고 '정답 확인'을 누르세요.");
}

function saveProgress() {
  if (!lesson) return;
  localStorage.setItem(PROG_KEY, JSON.stringify({ day: lesson.day, idx }));
}

// ===== 정답 확인(채점) =====
async function checkAnswer() {
  if (!lesson) return;
  const line = lesson.lines[idx];
  const answer = answerInput.value.trim();

  // 정답(강의 원문)은 즉시 공개
  revealed = true;
  renderResult(answer, line, null); // 먼저 원문+듣기 표시
  warmUpSpeech();
  speak(line.en); // 정답 영어 자동 읽어줌

  if (!answer) {
    setStatus("정답을 확인했어요. 소리 내어 따라 말해보세요.");
    return;
  }
  // 답을 썼으면 AI 첨삭
  setStatus("첨삭 중…");
  try {
    const res = await fetch("/api/bombom-grade", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ko: line.ko, answer, reference: line.en }),
    });
    if (res.ok) {
      const data = await res.json();
      renderResult(answer, line, data);
    }
    setStatus("확인 완료! '다음 ▶'으로 계속하세요.");
  } catch {
    setStatus("확인 완료! (첨삭은 생략) '다음 ▶'으로 계속하세요.");
  }
}

function renderResult(answer, line, grade) {
  let html = "";
  if (answer) {
    html += `<div class="result-block"><div class="label">✍️ 내가 쓴 답</div><div class="result-line">${esc(
      answer
    )}</div></div>`;
  }
  html += `<div class="result-block"><div class="label">✅ 강의 원문</div>
    <div class="result-line bombom-answer">${esc(line.en)}
      <button class="icon-btn spk" data-text="${esc(line.en)}" title="듣기">🔊</button>
    </div></div>`;
  if (grade) {
    const badge = grade.same
      ? `<span class="match-badge ok">👍 잘 썼어요</span>`
      : `<span class="match-badge no">✍️ 다듬어 봐요</span>`;
    html += `<div class="result-block"><div class="label">📝 첨삭 ${badge} <span class="reveal-note">${
      Number.isFinite(grade.score) ? "점수 " + grade.score + "점" : ""
    }</span></div><div class="result-line feedback-text">${esc(grade.feedback || "")}</div></div>`;
  }
  resultEl.innerHTML = html;
  resultEl.classList.add("show");
  resultEl.querySelectorAll(".spk").forEach((b) => {
    b.addEventListener("click", () => {
      warmUpSpeech();
      speak(b.dataset.text);
    });
  });
}

// ===== 이동 =====
function go(delta) {
  if (!lesson) return;
  const n = idx + delta;
  if (n < 0 || n >= lesson.lines.length) {
    if (n >= lesson.lines.length) setStatus("🎉 이 강의의 마지막 문장이에요!");
    return;
  }
  stopSpeak();
  idx = n;
  render();
}
prevBtn.addEventListener("click", () => go(-1));
nextBtn.addEventListener("click", () => go(1));

// ===== 힌트: 영어 듣기 =====
hintBtn.addEventListener("click", () => {
  if (!lesson) return;
  warmUpSpeech();
  speak(lesson.lines[idx].en);
  setStatus("🔊 정답 영어를 들려드려요. 듣고 영작해보세요.");
});

// ===== 입력 =====
answerInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    if (typeof answerForm.requestSubmit === "function") answerForm.requestSubmit();
    else answerForm.dispatchEvent(new Event("submit", { cancelable: true }));
  }
});
answerForm.addEventListener("submit", (e) => {
  e.preventDefault();
  checkAnswer();
});

// ===== 강의 선택 =====
lessonSelect.addEventListener("change", () => {
  selectLesson(parseInt(lessonSelect.value, 10), 0);
});

// ===== 원어민 음원 재생/정지 =====
audioBtn.addEventListener("click", () => {
  if (!lesson || !lesson.audio) return;
  if (nativeAudio.paused) {
    window.speechSynthesis && window.speechSynthesis.cancel();
    nativeAudio.play().then(() => {}).catch(() => setStatus("음원을 재생할 수 없습니다.", "error"));
    audioBtn.textContent = "⏸️ 음원 정지";
    audioBtn.classList.add("active");
    setStatus("🎧 원어민 음원 재생 중…");
  } else {
    nativeAudio.pause();
    audioBtn.textContent = "🎧 원어민 음원";
    audioBtn.classList.remove("active");
  }
});
nativeAudio.addEventListener("ended", () => {
  audioBtn.textContent = "🎧 원어민 음원";
  audioBtn.classList.remove("active");
});

// ===== 영어 전체 읽기 (문장 순차 TTS) =====
let readingAll = false;
function readAllFrom(i) {
  if (!readingAll || !lesson || i >= lesson.lines.length) {
    readingAll = false;
    readAllBtn.textContent = "🔊 영어 전체 읽기";
    readAllBtn.classList.remove("active");
    return;
  }
  idx = i;
  render();
  revealed = true;
  speak(lesson.lines[i].en, () => {
    if (!readingAll) return;
    setTimeout(() => readAllFrom(i + 1), 500);
  });
}
readAllBtn.addEventListener("click", () => {
  if (!lesson) return;
  if (readingAll) {
    readingAll = false;
    stopSpeak();
    readAllBtn.textContent = "🔊 영어 전체 읽기";
    readAllBtn.classList.remove("active");
    return;
  }
  warmUpSpeech();
  readingAll = true;
  readAllBtn.textContent = "⏸️ 읽기 정지";
  readAllBtn.classList.add("active");
  readAllFrom(0);
});

// ===== 정지 유틸 =====
function stopSpeak() {
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
}
function stopAll() {
  readingAll = false;
  stopSpeak();
  if (nativeAudio) {
    nativeAudio.pause();
    audioBtn.textContent = "🎧 원어민 음원";
    audioBtn.classList.remove("active");
  }
  readAllBtn.textContent = "🔊 영어 전체 읽기";
  readAllBtn.classList.remove("active");
}

// 질문하기 위젯 컨텍스트
window.getAskContext = function () {
  if (!lesson) return "";
  const line = lesson.lines[idx];
  return `봄봄클래스 ${lesson.day}일차. 한글: ${line.ko} / 강의 원문: ${line.en}`;
};

// ===== 클래스별 제목/네비 설정 =====
(function applyClass() {
  document.title = CFG.name;
  const h1 = document.querySelector("header h1");
  if (h1) h1.textContent = `${CFG.emoji} ${CFG.name}`;
  // 현재 클래스에 해당하는 네비 링크 활성화
  document.querySelectorAll('.nav a[href^="bombom.html"]').forEach((a) => {
    const c = new URL(a.href, location.href).searchParams.get("c") || "guiddulki";
    a.classList.toggle("active", c === CLS);
  });
})();

// ===== 시작 =====
loadLessons();
