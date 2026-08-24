// ===== 상태 =====
let currentSentence = ""; // 정답 문장 (제출 전까지 화면에 숨김)
let currentTranslation = ""; // 한글 번역 (제출 후 표시)

// 이미 연습한 문장(저장된 것) 중 최근 30개 → 서버가 이걸 피해서 새 문장을 만든다
function recentSentences() {
  if (typeof Library === "undefined") return [];
  return Library.all()
    .map((x) => x.sentence)
    .slice(-30);
}
let voices = [];
let selectedVoice = null;
let warmedUp = false;

// ===== DOM =====
const playBtn = document.getElementById("playBtn");
const newBtn = document.getElementById("newBtn");
const reviewBtn = document.getElementById("reviewBtn");
const answerForm = document.getElementById("answerForm");
const answerInput = document.getElementById("answerInput");
const submitBtn = document.getElementById("submitBtn");
const resultEl = document.getElementById("result");
const statusEl = document.getElementById("status");
const hintEl = document.getElementById("hint");
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
} else {
  setStatus("이 브라우저는 음성 출력을 지원하지 않습니다.", "error");
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

// 첫 재생은 음성 엔진이 차가워 앞부분이 잘린다 → 더 긴 희생 발화로 확실히 예열
let firstSpeak = true;

// 한 번 재생하고, 끝나면 onEnd 콜백 호출
function speakOnce(text, onEnd) {
  if (!("speechSynthesis" in window) || !text) {
    if (onEnd) onEnd();
    return;
  }
  const synth = window.speechSynthesis;
  synth.cancel();
  const cold = firstSpeak; // 이번이 첫 재생인가
  firstSpeak = false;
  setTimeout(() => {
    // 희생용 발화: 시작 부분이 잘리는 브라우저 버그 대응. 첫 재생은 더 길게.
    const primer = new SpeechSynthesisUtterance(
      cold ? "hello, hello, hello." : "hello"
    );
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
  }, cold ? 300 : 120);
}

// ===== 무한 반복 재생 컨트롤러 =====
let looping = false;
let loopTimer = null;
let playToken = 0; // 정지/재시작 시 예약된 콜백을 무효화하기 위한 토큰

function updatePlayBtn() {
  playBtn.textContent = looping ? "⏸️ 반복 멈춤" : "🔁 반복 듣기";
  playBtn.classList.toggle("active", looping);
}

function stopPlayback() {
  looping = false;
  playToken++; // 예약된 콜백/타이머 무효화
  clearTimeout(loopTimer);
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  updatePlayBtn();
  if (typeof tipEl !== "undefined" && tipEl) tipEl.classList.remove("show");
}

let loopText = ""; // 현재 반복 재생 중인 텍스트 (전체 문장 또는 드래그한 일부)

function startLoop() {
  if (!currentSentence) {
    setStatus("먼저 '새 문장' 버튼을 눌러 문장을 만들어 주세요.");
    return;
  }
  loopText = currentSentence;
  looping = true;
  playToken++;
  updatePlayBtn();
  setStatus("무한 반복 재생 중… (다시 누르면 멈춥니다)");
  playCycle(playToken);
}

// 드래그한 일부만 무한 반복 재생 (전체 반복은 멈춤)
function startSnippetLoop(text) {
  stopPlayback(); // 전체 반복 듣기 정지
  loopText = text;
  looping = true;
  playToken++;
  updatePlayBtn();
  playCycle(playToken);
}

function playCycle(token) {
  if (token !== playToken || !looping) return;
  speakOnce(loopText, () => {
    if (token !== playToken || !looping) return;
    // 1초 쉬고 다시 재생
    loopTimer = setTimeout(() => {
      if (token !== playToken || !looping) return;
      playCycle(token);
    }, 1000);
  });
}

// ===== 새 문장 가져오기 =====
async function fetchSentence() {
  stopPlayback(); // 이전에 돌던 반복 재생 정지
  setStatus("문장을 만드는 중…");
  newBtn.disabled = true;
  playBtn.disabled = true;
  try {
    const res = await fetch("/api/sentence", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recent: recentSentences(),
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
    // 저장 (다음 문장 생성 시 회피 목록으로 사용됨)
    if (typeof Library !== "undefined") {
      Library.add(currentSentence, currentTranslation);
    }
    // 복습(쉐도잉)에 저장
    if (typeof Review !== "undefined") {
      Review.add("shadowing", { en: currentSentence, ko: currentTranslation });
    }

    prepareForSentence();
  } catch (err) {
    setStatus("오류: " + err.message, "error");
  } finally {
    newBtn.disabled = false;
    playBtn.disabled = false;
  }
}

// currentSentence/currentTranslation 가 준비된 뒤 UI 초기화 + 재생 시작
function prepareForSentence() {
  resultEl.classList.remove("show");
  resultEl.innerHTML = "";
  answerInput.value = "";
  answerInput.disabled = false;
  submitBtn.disabled = false;
  hintEl.style.display = "none";
  warmUpSpeech();
  answerInput.focus();
  startLoop();
}

// ===== 복습: 저장된 문장 랜덤으로 =====
function loadReviewSentence() {
  stopPlayback();
  const list = typeof Review !== "undefined" ? Review.all("shadowing") : [];
  if (!list.length) {
    setStatus("복습할 문장이 없습니다. 먼저 '새 문장'으로 연습해 주세요.");
    return;
  }
  const item = list[Math.floor(Math.random() * list.length)];
  currentSentence = (item.en || "").trim();
  currentTranslation = (item.ko || "").trim();
  prepareForSentence();
  setStatus(`🔁 복습 (총 ${list.length}개 중 랜덤) — 듣고 받아쓰기 해보세요.`);
}

newBtn.addEventListener("click", fetchSentence);
reviewBtn.addEventListener("click", loadReviewSentence);

playBtn.addEventListener("click", () => {
  warmUpSpeech();
  if (looping) {
    stopPlayback();
    setStatus("재생을 멈췄습니다.");
  } else {
    startLoop();
  }
});

// ===== 채점 =====
// textarea 에서 Enter 를 누르면 제출/채점 (Shift+Enter 는 줄바꿈)
answerInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    if (typeof answerForm.requestSubmit === "function") {
      answerForm.requestSubmit();
    } else {
      answerForm.dispatchEvent(new Event("submit", { cancelable: true }));
    }
  }
});

answerForm.addEventListener("submit", (e) => {
  e.preventDefault();
  if (!currentSentence) return;
  stopPlayback(); // 채점 시 반복 재생 정지
  const user = answerInput.value.trim();
  if (!user) {
    setStatus("들은 문장을 입력한 뒤 제출하세요.");
    return;
  }
  gradeAnswer(currentSentence, user);
});

// 단어 정규화: 소문자 + 문장부호 제거(아포스트로피는 유지)
function norm(w) {
  return w.toLowerCase().replace(/[^a-z0-9']/g, "");
}

function tokenize(s) {
  return s.trim().split(/\s+/).filter(Boolean);
}

// LCS 로 정답/입력 단어를 정렬해 일치 인덱스를 찾음
function lcsMatch(a, b) {
  const n = a.length,
    m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        a[i] === b[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const aMatched = new Set();
  const bMatched = new Set();
  let i = 0,
    j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      aMatched.add(i);
      bMatched.add(j);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  return { aMatched, bMatched };
}

function esc(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function gradeAnswer(target, userText) {
  const tTokens = tokenize(target);
  const uTokens = tokenize(userText);
  const tNorm = tTokens.map(norm);
  const uNorm = uTokens.map(norm);

  const { aMatched, bMatched } = lcsMatch(tNorm, uNorm);

  const correct = aMatched.size;
  const total = tTokens.length || 1;
  const pct = Math.round((correct / total) * 100);

  // 정답 문장: 맞힌 단어는 초록, 놓친 단어는 노랑 강조
  const correctHtml = tTokens
    .map((w, i) =>
      aMatched.has(i)
        ? `<span class="w-ok">${esc(w)}</span>`
        : `<span class="w-miss">${esc(w)}</span>`
    )
    .join(" ");

  // 내 답안: 맞힌 단어는 초록, 틀린/불필요 단어는 빨강 취소선
  const userHtml = uTokens
    .map((w, i) =>
      bMatched.has(i)
        ? `<span class="w-ok">${esc(w)}</span>`
        : `<span class="w-extra">${esc(w)}</span>`
    )
    .join(" ");

  let verdict;
  if (pct === 100) verdict = "🎉 완벽합니다!";
  else if (pct >= 80) verdict = "👍 거의 다 맞았어요.";
  else if (pct >= 50) verdict = "🙂 조금 더 들어보세요.";
  else verdict = "💪 다시 들어보고 도전해보세요.";

  resultEl.innerHTML = `
    <div class="score">${verdict} &nbsp; 정확도 ${pct}% (${correct}/${total} 단어)</div>
    <div class="result-block">
      <div class="label">✅ 정답 문장</div>
      <div class="result-line">${correctHtml}</div>
    </div>
    <div class="result-block">
      <div class="label">✍️ 내가 입력한 답</div>
      <div class="result-line">${userHtml}</div>
    </div>
    <div class="result-block">
      <div class="label">📖 정답 (그대로 보기)</div>
      <div class="result-line">${esc(target)}</div>
    </div>
    <div class="result-block">
      <div class="label">🇰🇷 한글 번역</div>
      <div class="result-line" id="koLine">${
        hasKorean(currentTranslation)
          ? esc(currentTranslation)
          : "번역 불러오는 중…"
      }</div>
    </div>
    <div class="legend">
      <span class="l-ok">맞은 단어</span>
      <span class="l-miss">놓친 단어</span>
      <span class="l-extra">틀린/불필요한 단어</span>
    </div>
  `;
  resultEl.classList.add("show");
  setStatus("채점 완료! '다시 듣기'로 확인하거나 '새 문장'으로 계속하세요.");

  // 저장된 번역이 깨졌으면(한글 없음) 다시 번역해서 채워넣음
  if (!hasKorean(currentTranslation)) fixTranslation(target);
}

// 한글이 하나라도 있는지
function hasKorean(s) {
  return /[가-힣]/.test(s || "");
}

// 번역이 이상할 때 /api/translate 로 다시 받아 채워넣고 저장소도 교체
async function fixTranslation(sentence) {
  try {
    const res = await fetch("/api/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: sentence }),
    });
    if (!res.ok) throw new Error();
    const data = await res.json();
    const ko = (data.translation || "").trim();
    if (!ko) throw new Error();

    currentTranslation = ko;
    const el = document.getElementById("koLine");
    if (el) el.textContent = ko;

    // 듣기 목록의 깨진 번역도 교체
    if (typeof Library !== "undefined") {
      Library.remove(sentence);
      Library.add(sentence, ko);
    }
  } catch {
    const el = document.getElementById("koLine");
    if (el) el.textContent = "(번역을 불러오지 못했습니다)";
  }
}

// ===== 채점 결과에서 드래그하면 그 부분 번역 =====
const tipEl = document.getElementById("tip");
let tipToken = 0;

resultEl.addEventListener("mouseup", () => {
  setTimeout(handleSelection, 10);
});

// 정답 문장에서 드래그한 부분을 무한 반복해서 들려주고 번역도 보여줌 (전체 반복은 멈춤)
async function handleSelection() {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed) return;
  const text = sel.toString().trim();
  if (!text) return;

  const range = sel.getRangeAt(0);
  if (!resultEl.contains(range.commonAncestorContainer)) return;

  const rect = range.getBoundingClientRect();
  warmUpSpeech();
  startSnippetLoop(text); // 이 부분만 무한 반복
  showTip("🔁 반복 재생 중 · 번역 중…", rect);

  // 번역도 함께 표시
  const myToken = ++tipToken;
  try {
    const res = await fetch("/api/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (myToken !== tipToken) return; // 그 사이 다른 부분을 드래그함
    if (!res.ok) throw new Error();
    const data = await res.json();
    if (myToken !== tipToken) return;
    showTip("🔁 반복 재생 중\n📖 " + (data.translation || "(번역 없음)"), rect);
  } catch {
    if (myToken !== tipToken) return;
    showTip("🔁 반복 재생 중 (번역 실패)", rect);
  }
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
  // 말풍선 밖을 누르면 안내만 숨김 (오디오는 유지)
  if (!tipEl.contains(e.target)) hideTip();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    stopPlayback(); // 반복 재생 정지
    hideTip();
  }
});
window.addEventListener("scroll", hideTip, true);

function setStatus(text, kind = "") {
  statusEl.textContent = text;
  statusEl.className = "status" + (kind ? " " + kind : "");
}

// 질문하기 위젯에 현재 문장을 전달
window.getAskContext = function () {
  if (!currentSentence) return "";
  let c = "Shadowing sentence: " + currentSentence;
  if (currentTranslation) c += "\nKorean: " + currentTranslation;
  return c;
};
