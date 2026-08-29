// ===== 강의 클래스 (귀뚫기챌린지 / 봄봄클래스) =====
const CLASSES = {
  guiddulki: { emoji: "🎧", name: "귀뚫기챌린지", data: "lessons-guiddulki.json" },
  bombom: { emoji: "🌸", name: "봄봄클래스", data: "lessons-bombom.json" },
};
const _cparam = new URLSearchParams(location.search).get("c");
const CLS = CLASSES[_cparam] ? _cparam : "guiddulki";
const CFG = CLASSES[CLS];
const PROG_KEY = "bombom_progress_v2_" + CLS;

let lessons = [];
let lesson = null;
let idx = 0; // 한 문장씩 모드의 현재 문장
let mode = "view"; // view | write | study
let viewMode = "blank"; // blank | en | both | ko  (전체 보기 토글, 기본=빈자막)
let voices = [];
let selectedVoice = null;
let femaleVoice = null;
let maleVoice = null;
let genderMap = {}; // 현재 강의의 화자 → "male"/"female"
let warmedUp = false;
let listeningAll = false;

// 화자 이름 → 성별
const MALE_NAMES = new Set(["jinsu", "minsu", "kevin", "daniel", "eric", "husband"]);
const FEMALE_NAMES = new Set(["alice", "amy", "ms. johnson", "mom", "wife"]);
// 음성 이름으로 성별 추정
const FEMALE_PAT =
  /zira|hazel|susan|female|woman|samantha|victoria|karen|moira|tessa|fiona|serena|aria|jenny|michelle|catherine|linda|heera|eva|sonia|zoe|emma|clara|natasha/i;
const MALE_PAT =
  /david|mark|george|male|\bman\b|daniel|alex|fred|guy|ryan|eric|james|paul|tom|william|richard|oliver|thomas|brian|liam|william/i;

// ===== DOM =====
const lessonSelect = document.getElementById("lessonSelect");
const doneBtn = document.getElementById("doneBtn");
const audioBtn = document.getElementById("audioBtn");
const listenAllBtn = document.getElementById("listenAllBtn");
const viewBtn = document.getElementById("viewBtn");
const writeBtn = document.getElementById("writeBtn");
const studyBtn = document.getElementById("studyBtn");
const viewModeBar = document.getElementById("viewModeBar");
const nativeAudio = document.getElementById("nativeAudio");
const progressEl = document.getElementById("progress");
const viewSection = document.getElementById("viewSection");
const writeSection = document.getElementById("writeSection");
const studySection = document.getElementById("studySection");
const passageEl = document.getElementById("passage");
const writeListEl = document.getElementById("writeList");
const writeRevealBtn = document.getElementById("writeRevealBtn");
// 한 문장씩
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
  pickGenderVoices();
}
if ("speechSynthesis" in window) {
  loadVoices();
  window.speechSynthesis.onvoiceschanged = loadVoices;
}
voiceSelect.addEventListener("change", () => {
  selectedVoice = voices[voiceSelect.value] || null;
  pickGenderVoices(); // 억양(언어)에 맞춰 남/여 음성 재선택
});

// 대화문용 남/여 음성 — 선택된 음성과 같은 언어 안에서만 찾는다
function pickGenderVoices() {
  const lang = selectedVoice ? selectedVoice.lang : "en-US";
  femaleVoice = voices.find((v) => v.lang === lang && FEMALE_PAT.test(v.name)) || null;
  maleVoice = voices.find((v) => v.lang === lang && MALE_PAT.test(v.name)) || null;
}
// 성별 → {voice, pitch}. 같은 억양의 남/여 음성이 없으면 음높이로 구분
function voiceForGender(gender) {
  if (gender === "female") return { voice: femaleVoice || selectedVoice, pitch: 1.25 };
  if (gender === "male") return { voice: maleVoice || selectedVoice, pitch: 0.78 };
  return { voice: selectedVoice, pitch: 1 };
}
// 강의의 화자별 성별 지도 (아는 이름은 매핑, 애매한 역할은 상대 화자와 다르게 배정)
function buildGenderMap(lesson) {
  const map = {};
  const distinct = [];
  for (const l of lesson.lines) {
    if (!l.speaker || l.speaker in map) continue;
    const k = l.speaker.toLowerCase();
    map[l.speaker] = MALE_NAMES.has(k) ? "male" : FEMALE_NAMES.has(k) ? "female" : null;
    distinct.push(l.speaker);
  }
  let male = Object.values(map).filter((v) => v === "male").length;
  let female = Object.values(map).filter((v) => v === "female").length;
  distinct.forEach((sp) => {
    if (map[sp]) return;
    let g;
    if (male > female) g = "female";
    else if (female > male) g = "male";
    else g = distinct.indexOf(sp) % 2 === 0 ? "male" : "female";
    map[sp] = g;
    if (g === "male") male++;
    else female++;
  });
  return map;
}
function warmUpSpeech() {
  if (warmedUp || !("speechSynthesis" in window)) return;
  warmedUp = true;
  const u = new SpeechSynthesisUtterance(" ");
  u.volume = 0;
  if (selectedVoice) u.voice = selectedVoice;
  window.speechSynthesis.speak(u);
}
// primer=true 면 앞잘림 방지용 "hello"를 먼저 재생.
// gender("male"/"female"/"")에 따라 대화문 화자별 남/여 음성으로 읽는다.
function speak(text, onEnd, primer = true, gender = "") {
  if (!("speechSynthesis" in window) || !text) {
    onEnd && onEnd();
    return;
  }
  const gv = voiceForGender(gender);
  const voice = gv.voice || selectedVoice;
  const lang = voice ? voice.lang : "en-US";
  const synth = window.speechSynthesis;
  synth.cancel();
  setTimeout(() => {
    if (primer) {
      const p = new SpeechSynthesisUtterance("hello");
      p.volume = 0.05;
      p.rate = 1;
      if (voice) p.voice = voice;
      p.lang = lang;
      p.pitch = gv.pitch || 1;
      synth.speak(p);
    }
    const utter = new SpeechSynthesisUtterance(text);
    if (voice) utter.voice = voice;
    utter.lang = lang;
    utter.rate = parseFloat(rateInput.value) || 0.9;
    utter.pitch = gv.pitch || 1;
    // 모바일에서 onend/onerror 가 여러 번 발생하는 버그 대비 → 콜백은 딱 한 번만
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      onEnd && onEnd();
    };
    utter.onend = finish;
    utter.onerror = finish;
    synth.speak(utter);
  }, 100);
}
// 현재 강의에서 화자의 성별
function genderOf(speaker) {
  return (speaker && genderMap[speaker]) || "";
}
function stopSpeak() {
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
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

// ===== 공부 완료 표시 (클래스별로 저장) =====
const DONE_KEY = "bombom_done_" + CLS;
let doneSet = new Set();
try {
  doneSet = new Set(JSON.parse(localStorage.getItem(DONE_KEY) || "[]"));
} catch {}
function saveDone() {
  localStorage.setItem(DONE_KEY, JSON.stringify([...doneSet]));
}
function applyOptionLabel(opt, l) {
  const done = doneSet.has(l.day);
  opt.textContent = (done ? "✅ " : "") + `${l.day}일차 — ${l.titleKo || l.title}`;
  opt.style.color = done ? "#16a34a" : ""; // 데스크톱에서 초록색 (모바일은 ✅로 구분)
}
function refreshOption(day) {
  const opt = lessonSelect.querySelector(`option[value="${day}"]`);
  const l = lessons.find((x) => x.day === day);
  if (opt && l) applyOptionLabel(opt, l);
}
function updateDoneBtn() {
  if (!lesson) return;
  const done = doneSet.has(lesson.day);
  doneBtn.textContent = done ? "✅ 완료함 (취소)" : "⬜ 공부 완료";
  doneBtn.classList.toggle("active", done);
  doneBtn.title = `완료 ${doneSet.size} / ${lessons.length}강`;
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
    applyOptionLabel(opt, l);
    lessonSelect.appendChild(opt);
  });

  let day = lessons[0].day;
  try {
    const p = JSON.parse(localStorage.getItem(PROG_KEY) || "null");
    if (p && lessons.some((l) => l.day === p.day)) {
      day = p.day;
      idx = p.idx || 0;
      if (["view", "write", "study"].includes(p.mode)) mode = p.mode;
    }
  } catch {}
  lessonSelect.value = day;
  selectLesson(day);
}

function selectLesson(day) {
  stopAll();
  lesson = lessons.find((l) => l.day === day) || null;
  if (!lesson) return;
  genderMap = buildGenderMap(lesson);
  idx = Math.min(Math.max(0, idx), lesson.lines.length - 1);
  // 원어민 음원
  if (lesson.audio) {
    nativeAudio.src = lesson.audio;
    audioBtn.style.display = "";
  } else {
    audioBtn.style.display = "none";
  }
  progressEl.textContent = `${lesson.day}일차 · ${lesson.titleKo || ""} (${lesson.lines.length}문장)`;
  updateDoneBtn();
  renderView();
  renderWrite();
  renderStudy();
  setMode(mode);
}

// 공부 완료 표시 토글
doneBtn.addEventListener("click", () => {
  if (!lesson) return;
  if (doneSet.has(lesson.day)) doneSet.delete(lesson.day);
  else doneSet.add(lesson.day);
  saveDone();
  refreshOption(lesson.day);
  updateDoneBtn();
});

// ===== 모드 전환 =====
function setMode(m) {
  mode = m;
  stopListenAll();
  stopSpeak();
  viewSection.style.display = m === "view" ? "" : "none";
  writeSection.style.display = m === "write" ? "" : "none";
  studySection.style.display = m === "study" ? "" : "none";
  viewModeBar.style.display = m === "view" ? "" : "none";
  viewBtn.classList.toggle("active", m === "view");
  writeBtn.classList.toggle("active", m === "write");
  studyBtn.classList.toggle("active", m === "study");
  saveProgress();
  if (m === "view") setStatus("전체 영문 보기 — 위 토글로 영어/한글을 바꾸고, 문장을 드래그하면 그 부분을 읽어줘요.");
  else if (m === "write") setStatus("한글 자막을 보고 전체를 영어로 써보세요. '정답 보기'로 확인해요.");
  else setStatus("한 문장씩 — 한글을 영어로 옮겨 적고 '정답 확인'을 누르세요.");
}
viewBtn.addEventListener("click", () => setMode("view"));
writeBtn.addEventListener("click", () => setMode("write"));
studyBtn.addEventListener("click", () => setMode("study"));

function saveProgress() {
  if (!lesson) return;
  localStorage.setItem(PROG_KEY, JSON.stringify({ day: lesson.day, idx, mode }));
}

// ===== 전체 영문 보기 =====
function renderView() {
  if (!lesson) return;
  passageEl.className = "passage bombom-passage vm-" + viewMode;
  passageEl.innerHTML = lesson.lines
    .map((l, i) => {
      const sp = l.speaker
        ? `<span class="bl-speaker">${esc(l.speaker)}:</span> `
        : "";
      return `<div class="bline" data-index="${i}">
        <div class="bl-en">${sp}${esc(l.en)}</div>
        <div class="bl-ko">${esc(l.ko)}</div>
      </div>`;
    })
    .join("");
}
function applyViewMode(vm) {
  viewMode = vm;
  passageEl.className = "passage bombom-passage vm-" + vm;
  viewModeBar.querySelectorAll("button").forEach((b) =>
    b.classList.toggle("active", b.dataset.vm === vm)
  );
}
viewModeBar.querySelectorAll("button").forEach((b) => {
  b.addEventListener("click", () => applyViewMode(b.dataset.vm));
});

// 드래그하면 그 부분 발음
passageEl.addEventListener("mouseup", () => setTimeout(dragSpeak, 10));
passageEl.addEventListener("touchend", () => setTimeout(dragSpeak, 10));
function dragSpeak() {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
  const range = sel.getRangeAt(0);
  if (!passageEl.contains(range.commonAncestorContainer)) return;
  const text = (sel.toString() || range.toString() || "").trim();
  if (!text) return;
  warmUpSpeech();
  stopListenAll();
  speak(text);
  setStatus("🔊 발음 중… (드래그한 부분)");
}

// ===== 문장 전체 듣기 (순차 TTS + 하이라이트) =====
function highlight(i) {
  passageEl.querySelectorAll(".bline.now").forEach((el) => el.classList.remove("now"));
  if (i == null) return;
  const el = passageEl.querySelector(`.bline[data-index="${i}"]`);
  if (el) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
  if (el) el.classList.add("now");
}
function listenAllFrom(i) {
  if (!listeningAll || !lesson || i >= lesson.lines.length) {
    stopListenAll();
    return;
  }
  if (mode === "view") highlight(i);
  // 첫 문장만 프라이머(앞잘림 방지), 이후는 hello 없이 자연스럽게 이어읽기
  speak(
    lesson.lines[i].en,
    () => {
      if (!listeningAll) return;
      setTimeout(() => listenAllFrom(i + 1), 250);
    },
    i === 0,
    genderOf(lesson.lines[i].speaker)
  );
}
function stopListenAll() {
  listeningAll = false;
  stopSpeak(); // 남은 음성 정리 (모바일 반복 방지)
  listenAllBtn.textContent = "🔊 문장 전체 듣기";
  listenAllBtn.classList.remove("active");
  highlight(null);
}
listenAllBtn.addEventListener("click", () => {
  if (!lesson) return;
  if (listeningAll) {
    stopListenAll();
    stopSpeak();
    return;
  }
  warmUpSpeech();
  if (nativeAudio) nativeAudio.pause();
  listeningAll = true;
  listenAllBtn.textContent = "⏸️ 듣기 정지";
  listenAllBtn.classList.add("active");
  listenAllFrom(0);
  setStatus("🔊 전체 문장을 읽어드려요…");
});

// ===== 한글 자막 보기 (문장별 영작) =====
function renderWrite() {
  if (!lesson) return;
  writeListEl.innerHTML = lesson.lines
    .map((l, i) => {
      const sp = l.speaker
        ? `<span class="wr-speaker">${esc(l.speaker)}:</span> `
        : "";
      return `<div class="wr-line" data-index="${i}">
        <div class="wr-ko">${sp}${esc(l.ko)}</div>
        <textarea class="wr-input" data-index="${i}" rows="1" placeholder="영어로…"></textarea>
        <div class="wr-ans" data-index="${i}" style="display:none"></div>
      </div>`;
    })
    .join("");
  // 입력창 자동 높이
  writeListEl.querySelectorAll(".wr-input").forEach((ta) => {
    ta.addEventListener("input", () => {
      ta.style.height = "auto";
      ta.style.height = Math.min(ta.scrollHeight, 120) + "px";
    });
  });
}
function revealWriteLine(i) {
  const l = lesson.lines[i];
  const ans = writeListEl.querySelector(`.wr-ans[data-index="${i}"]`);
  if (!ans) return;
  ans.innerHTML = `<span class="wr-ans-en">${esc(l.en)}</span> <button class="icon-btn spk" data-text="${esc(
    l.en
  )}" title="듣기">🔊</button>`;
  ans.style.display = "";
  ans.querySelector(".spk").addEventListener("click", () => {
    warmUpSpeech();
    speak(l.en, null, true, genderOf(l.speaker));
  });
}
writeRevealBtn.addEventListener("click", () => {
  if (!lesson) return;
  lesson.lines.forEach((_, i) => revealWriteLine(i));
  setStatus("정답을 확인했어요. 내가 쓴 것과 비교하고, 소리 내어 따라 말해보세요.");
});

// ===== 한 문장씩 공부하기 =====
function renderStudy() {
  if (!lesson) return;
  const line = lesson.lines[idx];
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
  nextBtn.disabled = idx >= lesson.lines.length - 1;
  const p = document.querySelector(".bombom-progress");
  saveProgress();
}

async function checkAnswer() {
  if (!lesson) return;
  const line = lesson.lines[idx];
  const answer = answerInput.value.trim();
  renderStudyResult(answer, line, null);
  warmUpSpeech();
  speak(line.en, null, true, genderOf(line.speaker));
  if (!answer) {
    setStatus("정답을 확인했어요. 소리 내어 따라 말해보세요.");
    return;
  }
  setStatus("첨삭 중…");
  try {
    const res = await fetch("/api/bombom-grade", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ko: line.ko, answer, reference: line.en }),
    });
    if (res.ok) renderStudyResult(answer, line, await res.json());
    setStatus("확인 완료! '다음 ▶'으로 계속하세요.");
  } catch {
    setStatus("확인 완료! (첨삭 생략) '다음 ▶'으로 계속하세요.");
  }
}
function renderStudyResult(answer, line, grade) {
  let html = "";
  if (answer)
    html += `<div class="result-block"><div class="label">✍️ 내가 쓴 답</div><div class="result-line">${esc(
      answer
    )}</div></div>`;
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
  resultEl.querySelectorAll(".spk").forEach((b) =>
    b.addEventListener("click", () => {
      warmUpSpeech();
      speak(b.dataset.text, null, true, genderOf(line.speaker));
    })
  );
}
function go(delta) {
  if (!lesson) return;
  const n = idx + delta;
  if (n < 0 || n >= lesson.lines.length) return;
  stopSpeak();
  idx = n;
  renderStudy();
}
prevBtn.addEventListener("click", () => go(-1));
nextBtn.addEventListener("click", () => go(1));
hintBtn.addEventListener("click", () => {
  if (!lesson) return;
  warmUpSpeech();
  speak(lesson.lines[idx].en, null, true, genderOf(lesson.lines[idx].speaker));
  setStatus("🔊 정답 영어를 들려드려요. 듣고 영작해보세요.");
});
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
  idx = 0;
  selectLesson(parseInt(lessonSelect.value, 10));
});

// ===== 원어민 음원 =====
audioBtn.addEventListener("click", () => {
  if (!lesson || !lesson.audio) return;
  if (nativeAudio.paused) {
    stopSpeak();
    stopListenAll();
    nativeAudio.play().catch(() => setStatus("음원을 재생할 수 없습니다.", "error"));
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

// ===== 정지 유틸 =====
function stopAll() {
  stopListenAll();
  stopSpeak();
  if (nativeAudio) {
    nativeAudio.pause();
    audioBtn.textContent = "🎧 원어민 음원";
    audioBtn.classList.remove("active");
  }
}

// 질문하기 위젯
window.getAskContext = function () {
  if (!lesson) return "";
  const line = lesson.lines[idx];
  return `${CFG.name} ${lesson.day}일차. 한글: ${line.ko} / 강의 원문: ${line.en}`;
};

// ===== 클래스별 제목/네비 =====
(function applyClass() {
  document.title = CFG.name;
  const h1 = document.querySelector("header h1");
  if (h1) h1.textContent = `${CFG.emoji} ${CFG.name}`;
  document.querySelectorAll('.nav a[href^="bombom.html"]').forEach((a) => {
    const c = new URL(a.href, location.href).searchParams.get("c") || "guiddulki";
    a.classList.toggle("active", c === CLS);
  });
})();

// ===== 시작 =====
loadLessons();
