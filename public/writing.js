// ===== 상태 =====
let currentKorean = "";

// 이미 출제된 문제 중 최근 30개 → 서버가 이걸 피해서 새 문제를 만든다
// (localStorage 에 저장되어 브라우저를 껐다 켜도 유지됨)
function recentQuestions() {
  if (typeof History === "undefined") return [];
  return History.recent("writing", 30);
}
let voices = [];
let selectedVoice = null;
let warmedUp = false;

// ===== DOM =====
const newBtn = document.getElementById("newBtn");
const reviewBtn = document.getElementById("reviewBtn");
const questionEl = document.getElementById("question");
const hintEl = document.getElementById("hint");
const answerForm = document.getElementById("answerForm");
const answerInput = document.getElementById("answerInput");
const submitBtn = document.getElementById("submitBtn");
const resultEl = document.getElementById("result");
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

// 한 번 재생하고 끝나면 onEnd 호출 (시작 잘림 방지용 희생 발화 포함)
function speakOnce(text, myToken, onEnd) {
  if (!("speechSynthesis" in window) || !text) {
    onEnd && onEnd();
    return;
  }
  const synth = window.speechSynthesis;
  synth.cancel();
  setTimeout(() => {
    if (myToken !== speakToken) return;
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
  }, 120);
}

// ===== 무한 반복 듣기 (🔊 버튼 토글) =====
let looping = false;
let loopTimer = null;
let speakToken = 0;
let loopingBtn = null; // 현재 반복 중인 버튼

function stopLoop() {
  looping = false;
  speakToken++;
  clearTimeout(loopTimer);
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  if (loopingBtn) {
    loopingBtn.textContent = "🔊";
    loopingBtn.classList.remove("playing");
    loopingBtn = null;
  }
}

function startLoop(text, btn) {
  stopLoop(); // 다른 게 돌고 있으면 정지
  looping = true;
  speakToken++;
  loopingBtn = btn;
  btn.textContent = "⏸️";
  btn.classList.add("playing");
  const token = speakToken;
  playCycle(text, token);
}

function playCycle(text, token) {
  if (token !== speakToken || !looping) return;
  speakOnce(text, token, () => {
    if (token !== speakToken || !looping) return;
    loopTimer = setTimeout(() => {
      if (token !== speakToken || !looping) return;
      playCycle(text, token);
    }, 1000); // 1초 쉬고 다시
  });
}

// ===== 새 문제 =====
async function fetchQuestion() {
  stopLoop(); // 반복 듣기 정지
  setStatus("문제를 만드는 중…");
  newBtn.disabled = true;
  try {
    const res = await fetch("/api/ko-sentence", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recent: recentQuestions(),
        theme: typeof getTheme === "function" ? getTheme() : undefined,
        // 쓰기는 말하기(speaking) 연습을 위한 것이라 항상 초급으로 고정
        level: "easy",
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `서버 오류 (${res.status})`);
    }
    const data = await res.json();
    currentKorean = (data.korean || "").trim();
    if (typeof History !== "undefined") History.add("writing", currentKorean);

    showQuestion("영어로 옮겨 적고 Enter 또는 제출 버튼을 누르세요.");
  } catch (err) {
    setStatus("오류: " + err.message, "error");
  } finally {
    newBtn.disabled = false;
  }
}

// currentKorean 이 준비된 뒤 문제 화면 표시
function showQuestion(statusText) {
  hintEl.style.display = "none";
  questionEl.style.display = "block";
  questionEl.innerHTML = `<div class="q-label">이 문장을 영어로 써보세요</div><div class="q-text">${esc(
    currentKorean
  )}</div>`;

  resultEl.classList.remove("show");
  resultEl.innerHTML = "";
  answerInput.value = "";
  answerInput.disabled = false;
  submitBtn.disabled = false;
  updateSubmitLabel();
  answerInput.focus();
  setStatus(statusText);
}

// 입력 여부에 따라 버튼 라벨 변경: 비어 있으면 "정답 보기", 쓰면 "제출하고 채점"
function updateSubmitLabel() {
  submitBtn.textContent = answerInput.value.trim()
    ? "제출하고 채점"
    : "👀 정답 보기";
}
answerInput.addEventListener("input", updateSubmitLabel);

// ===== 복습: 내가 연습했던 문제 랜덤으로 =====
function loadReviewQuestion() {
  stopLoop();
  const list = typeof Review !== "undefined" ? Review.all("writing") : [];
  if (!list.length) {
    setStatus("복습할 문제가 없습니다. 먼저 '새 문제'로 연습해 주세요.");
    return;
  }
  const item = list[Math.floor(Math.random() * list.length)];
  currentKorean = (item.ko || "").trim();
  showQuestion(`🔁 복습 (총 ${list.length}개 중 랜덤) — 영어로 옮겨 적어 보세요.`);
}

newBtn.addEventListener("click", fetchQuestion);
reviewBtn.addEventListener("click", loadReviewQuestion);

// ===== Enter 로 제출 (Shift+Enter 는 줄바꿈) =====
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

// ===== 채점 =====
answerForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!currentKorean) return;
  stopLoop(); // 이전 반복 듣기 정지 (새 결과 렌더 전)
  const answer = answerInput.value.trim();
  // 답을 안 썼으면 채점 대신 "정답 보기" (폰에서 타이핑 없이 확인)
  const reveal = !answer;

  setStatus(reveal ? "정답을 불러오는 중…" : "채점 중…");
  submitBtn.disabled = true;
  newBtn.disabled = true;

  try {
    const res = await fetch("/api/writing/grade", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ korean: currentKorean, answer, reveal }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `서버 오류 (${res.status})`);
    }
    const data = await res.json();
    renderResult(answer, data);
    setStatus(
      reveal
        ? "정답을 확인했어요. 소리 내어 말해보고 '새 문제'로 계속하세요."
        : "채점 완료! '새 문제'로 계속 연습하세요."
    );
  } catch (err) {
    setStatus("오류: " + err.message, "error");
  } finally {
    submitBtn.disabled = false;
    newBtn.disabled = false;
  }
});

let lastBest = ""; // 방금 채점한 올바른 답 (질문 컨텍스트용)

function renderResult(answer, data) {
  lastBest = data.best || "";
  // 복습(쓰기)에 저장: 한글 문제 + 올바른 영어 답
  if (typeof Review !== "undefined" && lastBest) {
    Review.add("writing", { en: lastBest, ko: currentKorean });
  }
  const reveal = !!data.reveal || !answer;
  const score = data.score || 0;
  let verdict;
  if (score >= 90) verdict = "🎉 훌륭합니다!";
  else if (score >= 70) verdict = "👍 좋아요, 조금만 다듬으면 완벽해요.";
  else if (score >= 50) verdict = "🙂 뜻은 통해요. 표현을 다듬어 봅시다.";
  else verdict = "💪 다시 도전해봐요.";

  const altHtml = (data.alternatives || [])
    .map(
      (a) =>
        `<li><span class="alt-text">${esc(
          a
        )}</span> <button class="icon-btn spk" data-text="${esc(
          a
        )}" title="듣기">🔊</button></li>`
    )
    .join("");

  resultEl.innerHTML = `
    ${
      reveal
        ? `<div class="score">👀 정답 확인 &nbsp;<span class="reveal-note">머릿속으로 떠올린 답과 비교해 보세요</span></div>`
        : `<div class="score">${verdict} &nbsp; 점수 ${score}점</div>

    <div class="result-block">
      <div class="label">✍️ 내가 쓴 답</div>
      <div class="result-line">${esc(answer)}</div>
    </div>`
    }

    <div class="result-block">
      <div class="label">✅ 올바른 답</div>
      <div class="result-line">
        ${esc(data.best || "")}
        <button class="icon-btn spk" data-text="${esc(
          data.best || ""
        )}" title="듣기">🔊</button>
      </div>
    </div>

    ${
      altHtml
        ? `<div class="result-block">
      <div class="label">💡 이렇게도 말할 수 있어요</div>
      <ul class="alt-list">${altHtml}</ul>
    </div>`
        : ""
    }

    ${
      data.feedback
        ? `<div class="result-block">
      <div class="label">${reveal ? "📝 핵심 포인트" : "📝 피드백"}</div>
      <div class="result-line feedback-text">${esc(data.feedback)}</div>
    </div>`
        : ""
    }
  `;
  resultEl.classList.add("show");

  // 듣기 버튼: 누르면 무한 반복, 다시 누르면 정지
  resultEl.querySelectorAll(".spk").forEach((btn) => {
    btn.addEventListener("click", () => {
      warmUpSpeech();
      if (loopingBtn === btn) {
        stopLoop();
      } else {
        startLoop(btn.dataset.text, btn);
      }
    });
  });
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

// 질문하기 위젯에 현재 문제 상황을 전달
window.getAskContext = function () {
  if (!currentKorean) return "";
  let c = "Writing exercise. Korean prompt to translate: " + currentKorean;
  const myAns = (answerInput.value || "").trim();
  if (myAns) c += "\nMy English answer: " + myAns;
  if (lastBest) c += "\nCorrect answer: " + lastBest;
  return c;
};
