// ===== 상태 =====
let recentTitles = []; // 최근 지문 제목(중복 방지용)
let viewMode = "en"; // "en" | "both" | "ko"
let tipToken = 0; // 드래그 번역 요청 경쟁 방지

// ===== DOM =====
const startBtn = document.getElementById("startBtn");
const reviewBtn = document.getElementById("reviewBtn");
const viewModeEl = document.getElementById("viewMode");
const modeBtns = viewModeEl.querySelectorAll("button");
const readAllBtn = document.getElementById("readAllBtn");
const fontSizeSel = document.getElementById("fontSize");
const passageEl = document.getElementById("passage");
const listenHintEl = document.getElementById("listenHint");
const statusEl = document.getElementById("status");
const tipEl = document.getElementById("tip");
const voiceSelect = document.getElementById("voiceSelect");
const rateInput = document.getElementById("rate");

// ===== 음성 (TTS) =====
let voices = [];
let selectedVoice = null;
let femaleVoice = null; // 대화문 화자 A 용
let maleVoice = null; // 대화문 화자 B 용
let warmedUp = false;
let reading = false; // 전체 읽어주기 중 여부
let speakToken = 0; // 정지/재시작 시 예약 콜백 무효화

// 음성 이름으로 성별 추정 (Windows/Mac/모바일에서 흔한 이름들)
const FEMALE_PAT =
  /zira|hazel|susan|female|woman|samantha|victoria|karen|moira|tessa|fiona|serena|aria|jenny|michelle|catherine|linda|heera|eva|sonia|zoe/i;
const MALE_PAT =
  /david|mark|george|male|\bman\b|daniel|alex|fred|guy|ryan|eric|james|paul|tom|william|richard|oliver|thomas/i;

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
  pickGenderVoices();
}

// 대화문용 여성·남성 목소리 선택.
// 억양이 튀지 않도록 "선택된 음성과 같은 언어(예: en-US)" 안에서만 찾는다.
// 같은 억양의 남/여 음성이 없으면 null → 선택된 음성 + 음높이로만 구분.
function pickGenderVoices() {
  const lang = selectedVoice ? selectedVoice.lang : "en-US";
  femaleVoice =
    voices.find((v) => v.lang === lang && FEMALE_PAT.test(v.name)) || null;
  maleVoice =
    voices.find((v) => v.lang === lang && MALE_PAT.test(v.name)) || null;
}

// 화자 성별 → 목소리/음높이 (여성=높은음, 남성=낮은음)
function voiceForGender(gender) {
  if (gender === "female")
    return { voice: femaleVoice || selectedVoice, pitch: 1.25 };
  if (gender === "male")
    return { voice: maleVoice || selectedVoice, pitch: 0.75 };
  return {}; // 서술문 등: 기본 목소리
}

if ("speechSynthesis" in window) {
  loadVoices();
  window.speechSynthesis.onvoiceschanged = loadVoices;
}

voiceSelect.addEventListener("change", () => {
  selectedVoice = voices[voiceSelect.value] || null;
  pickGenderVoices(); // 바뀐 음성의 억양에 맞춰 남/여 음성 재선택
});

function warmUpSpeech() {
  if (warmedUp || !("speechSynthesis" in window)) return;
  warmedUp = true;
  const u = new SpeechSynthesisUtterance(" ");
  u.volume = 0;
  if (selectedVoice) u.voice = selectedVoice;
  window.speechSynthesis.speak(u);
}

// 한 번 재생하고 끝나면 onEnd 호출 (시작 잘림 방지용 희생 발화 포함)
// opts: { voice, pitch } — 대화문 화자별 목소리 지정용
function speakOnce(text, myToken, onEnd, opts = {}) {
  if (!("speechSynthesis" in window) || !text) {
    onEnd && onEnd();
    return;
  }
  const voice = opts.voice || selectedVoice;
  const pitch = opts.pitch != null ? opts.pitch : 1;
  const synth = window.speechSynthesis;
  synth.cancel();
  setTimeout(() => {
    if (myToken !== speakToken) return;
    const primer = new SpeechSynthesisUtterance("hello");
    primer.volume = 0.05;
    primer.rate = 1;
    if (voice) primer.voice = voice;
    primer.lang = voice ? voice.lang : "en-US";
    synth.speak(primer);

    const utter = new SpeechSynthesisUtterance(text);
    if (voice) utter.voice = voice;
    utter.lang = voice ? voice.lang : "en-US";
    utter.rate = parseFloat(rateInput.value) || 0.9;
    utter.pitch = pitch;
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

function stopReading() {
  reading = false;
  speakToken++;
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  highlightPara(null);
  updateReadAllBtn();
}

function updateReadAllBtn() {
  readAllBtn.textContent = reading ? "⏸️ 정지" : "🔊 전체 읽어주기";
  readAllBtn.classList.toggle("active", reading);
}

function highlightPara(el) {
  document
    .querySelectorAll(".para.now")
    .forEach((p) => p.classList.remove("now"));
  if (el) {
    el.classList.add("now");
    el.scrollIntoView({ block: "center", behavior: "smooth" });
  }
}

// 전체 읽어주기: 제목 + 문단을 순서대로
function startReadAll() {
  const paras = Array.from(passageEl.querySelectorAll(".para"));
  if (paras.length === 0) {
    setStatus("먼저 지문을 만들어 주세요.");
    return;
  }
  reading = true;
  speakToken++;
  warmUpSpeech();
  updateReadAllBtn();
  setStatus("🔊 읽어주는 중… (다시 누르면 멈춥니다)");
  readParaAt(speakToken, 0, paras);
}

function readParaAt(myToken, i, paras) {
  if (myToken !== speakToken || !reading) return;
  if (i >= paras.length) {
    // 끝까지 다 읽음
    reading = false;
    speakToken++; // 예약된 콜백 무효화 (모바일 반복 방지)
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    highlightPara(null);
    updateReadAllBtn();
    setStatus("다 읽었습니다. 소리 내어 따라 읽어보세요.");
    return;
  }
  const para = paras[i];
  const enEl = para.querySelector(".para-en");
  // 대화문이면 이름은 빼고 대사만 읽음
  const text = enEl?.dataset.spoken || enEl?.textContent || "";
  const opts = voiceForGender(enEl?.dataset.gender || "");
  highlightPara(para);
  speakOnce(
    text,
    myToken,
    () => {
      if (myToken !== speakToken || !reading) return;
      readParaAt(myToken, i + 1, paras);
    },
    opts
  );
}

readAllBtn.addEventListener("click", () => {
  warmUpSpeech();
  if (reading) {
    stopReading();
    setStatus("읽기를 멈췄습니다.");
  } else {
    startReadAll();
  }
});

// ===== 지문 가져오기 =====
async function fetchPassage() {
  // 복습 모드: 새 지문 대신 이전에 공부한 지문을 다시 낸다
  if (typeof window.isReviewMode === "function" && window.isReviewMode()) {
    loadReviewPassage();
    return;
  }
  stopReading();
  setStatus("지문을 만드는 중… (10초 정도 걸릴 수 있어요)");
  startBtn.disabled = true;
  modeBtns.forEach((b) => (b.disabled = true));
  readAllBtn.disabled = true;
  hideTip();

  try {
    const res = await fetch("/api/passage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recent: recentTitles,
        theme: typeof getTheme === "function" ? getTheme() : undefined,
        level: typeof getLevel === "function" ? getLevel() : undefined,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `서버 오류 (${res.status})`);
    }
    const data = await res.json();
    renderPassage(data);

    if (data.title) {
      recentTitles.push(data.title);
      if (recentTitles.length > 6) recentTitles.shift();
    }

    // 복습(읽기)에 지문 저장
    if (typeof Review !== "undefined" && data.paragraphs && data.paragraphs.length) {
      Review.add("reading", {
        en: data.paragraphs.map((p) => p.en).join("\n"),
        ko: data.paragraphs.map((p) => p.ko).join("\n"),
        title: data.title || "",
      });
    }

    afterPassageReady();
  } catch (err) {
    setStatus("오류: " + err.message, "error");
  } finally {
    startBtn.disabled = false;
  }
}

// 지문이 화면에 그려진 뒤 공통 마무리 처리
function afterPassageReady() {
  setViewMode("en"); // 영어 보기로 시작
  modeBtns.forEach((b) => (b.disabled = false));
  readAllBtn.disabled = false;
  startBtn.textContent = "🔄 새 지문";
}

// ===== 복습: 저장된 지문 랜덤으로 =====
function loadReviewPassage() {
  stopReading();
  hideTip();
  const list = typeof Review !== "undefined" ? Review.all("reading") : [];
  if (!list.length) {
    setStatus("복습할 지문이 없습니다. 먼저 '시작'으로 지문을 만들어 주세요.");
    return;
  }
  const item = list[Math.floor(Math.random() * list.length)];

  const ens = (item.en || "").split("\n");
  const kos = (item.ko || "").split("\n");
  const data = {
    title: item.title || "",
    paragraphs: ens.map((e, i) => ({ en: e, ko: kos[i] || "" })),
  };
  renderPassage(data);
  afterPassageReady();
  setStatus(`🔁 복습 지문 (총 ${list.length}개 중 랜덤) — 소리 내어 읽어보세요.`);
}

function renderPassage(data) {
  passageEl.innerHTML = "";

  if (data.title) {
    const h = document.createElement("h2");
    h.className = "passage-title";
    h.textContent = data.title;
    passageEl.appendChild(h);
  }

  (data.paragraphs || []).forEach((p) => {
    const wrap = document.createElement("div");
    wrap.className = "para";

    const en = document.createElement("p");
    en.className = "para-en";
    if (p.gender) en.dataset.gender = p.gender; // 화자 성별 (목소리 선택용)
    // 대화문("Name: ...")이면 화자 이름을 강조
    const m = (p.en || "").match(/^([A-Za-z][\w' ]{0,20}?):\s([\s\S]*)$/);
    if (m) {
      wrap.classList.add("turn");
      en.dataset.spoken = m[2]; // 이름 뺀 대사 (읽어줄 텍스트)
      const name = document.createElement("span");
      name.className = "speaker";
      name.textContent = m[1] + ": ";
      en.appendChild(name);
      en.appendChild(document.createTextNode(m[2]));
    } else {
      en.textContent = p.en || "";
    }

    const ko = document.createElement("p");
    ko.className = "para-ko";
    ko.textContent = p.ko || "";

    wrap.appendChild(en);
    wrap.appendChild(ko);
    passageEl.appendChild(wrap);
  });

  applyFontSize();
  applyViewMode();
  passageEl.scrollTop = 0;

  // 모바일에서는 상단 툴바가 길어 지문이 화면 아래에서 시작한다.
  // 지문이 만들어지면 지문 위치로 부드럽게 스크롤해 바로 보이게 한다.
  if (window.matchMedia("(max-width: 768px)").matches) {
    requestAnimationFrame(() =>
      passageEl.scrollIntoView({ behavior: "smooth", block: "start" })
    );
  }
}

startBtn.addEventListener("click", fetchPassage);
reviewBtn.addEventListener("click", loadReviewPassage);

// ===== 보기 모드 (영어 / 영어+한글 / 한글만 / 듣기만) =====
function applyViewMode() {
  const listen = viewMode === "listen";
  // 한글 표시: both, ko
  passageEl.classList.toggle("show-ko", viewMode === "both" || viewMode === "ko");
  // 영어(+제목) 숨김: ko, listen
  passageEl.classList.toggle("hide-en", viewMode === "ko" || listen);
  // 듣기만: 지문 상자 숨기고 안내 표시 (지문 텍스트는 DOM 에 남아 읽어주기 가능)
  passageEl.style.display = listen ? "none" : "";
  listenHintEl.style.display = listen ? "flex" : "none";
  modeBtns.forEach((b) => b.classList.toggle("active", b.dataset.mode === viewMode));
}

function setViewMode(mode) {
  viewMode = mode;
  applyViewMode();
}

modeBtns.forEach((b) => {
  b.addEventListener("click", () => {
    const mode = b.dataset.mode;
    setViewMode(mode);
    if (mode === "listen") {
      setStatus("🎧 지문을 숨기고 읽어드릴게요. 잘 들어보세요.");
      if (!reading) startReadAll(); // 자동으로 읽어주기 시작
    } else {
      if (reading) stopReading(); // 다른 모드로 바꾸면 읽기 정지
      if (mode === "ko") {
        setStatus("한글을 보고 영어로 말해보세요. 확인하려면 '영어'를 누르세요.");
      }
    }
  });
});

// ===== 글자 크기 =====
function applyFontSize() {
  passageEl.style.fontSize = fontSizeSel.value + "rem";
}
fontSizeSel.addEventListener("change", applyFontSize);

// ===== 드래그하면 그 부분 해석 =====
passageEl.addEventListener("mouseup", () => {
  // 선택이 확정된 뒤 읽도록 약간 지연
  setTimeout(handleSelection, 10);
});

async function handleSelection() {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed) return;

  const text = sel.toString().trim();
  if (!text) return;

  // 선택 영역이 지문 안인지 확인
  const range = sel.getRangeAt(0);
  if (!passageEl.contains(range.commonAncestorContainer)) return;

  const rect = range.getBoundingClientRect();
  const myToken = ++tipToken;

  // 드래그한 부분을 읽어주기 (전체 읽어주기 중이면 멈춤)
  stopReading();
  warmUpSpeech();
  speakOnce(text, ++speakToken, null);

  showTip("번역 중…", rect);

  try {
    const res = await fetch("/api/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (myToken !== tipToken) return; // 그 사이 새로 드래그함
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `서버 오류 (${res.status})`);
    }
    const data = await res.json();
    if (myToken !== tipToken) return;
    showTip(data.translation || "(번역 없음)", rect);
  } catch (err) {
    if (myToken !== tipToken) return;
    showTip("번역 실패: " + err.message, rect);
  }
}

function showTip(text, rect) {
  tipEl.textContent = text;
  tipEl.classList.add("show");

  // 위치 계산 (선택 영역 아래, 화면 밖으로 나가지 않게)
  const margin = 8;
  const tipW = Math.min(420, window.innerWidth - margin * 2);
  tipEl.style.maxWidth = tipW + "px";

  let left = rect.left + rect.width / 2 - tipW / 2;
  left = Math.max(margin, Math.min(left, window.innerWidth - tipW - margin));

  let top = rect.bottom + 10;
  // 아래 공간이 부족하면 위쪽에 표시
  if (top + tipEl.offsetHeight > window.innerHeight - margin) {
    top = Math.max(margin, rect.top - tipEl.offsetHeight - 10);
  }

  tipEl.style.left = left + "px";
  tipEl.style.top = top + "px";
}

function hideTip() {
  tipEl.classList.remove("show");
}

// 빈 곳 클릭하거나 ESC 누르면 말풍선 닫기
document.addEventListener("mousedown", (e) => {
  if (!tipEl.contains(e.target)) hideTip();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") hideTip();
});
window.addEventListener("scroll", hideTip, true);

function setStatus(text, kind = "") {
  statusEl.textContent = text;
  statusEl.className = "status" + (kind ? " " + kind : "");
}

// 질문하기 위젯에 현재 지문을 전달
window.getAskContext = function () {
  const title = passageEl.querySelector(".passage-title")?.textContent || "";
  const paras = Array.from(passageEl.querySelectorAll(".para-en"))
    .map((p) => p.textContent)
    .join("\n\n");
  if (!paras) return "";
  return "Reading passage:\n" + (title ? title + "\n\n" : "") + paras;
};
