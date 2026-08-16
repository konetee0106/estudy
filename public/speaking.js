// ===== 상태 =====
let currentKorean = "";
let heard = ""; // 음성인식 결과
let voices = [];

// 이미 출제된 문제 중 최근 30개 → 서버가 이걸 피해서 새 문제를 만든다
// (localStorage 에 저장되어 브라우저를 껐다 켜도 유지됨)
function recentQuestions() {
  if (typeof History === "undefined") return [];
  return History.recent("speaking", 30);
}

// 말이 잠깐 끊겨도 바로 종료하지 않도록
const MIN_LISTEN_MS = 5000; // 시작 후 최소 이만큼은 기다림
const SILENCE_MS = 3000; // 말이 멈춘 뒤 이만큼 더 기다림
let listening = false; // "듣고 싶은 상태" (브라우저가 임의로 끊어도 유지)
let finalBuffer = ""; // 인식된 문장 누적
let silenceTimer = null;
let listenStart = 0;
let aborted = false; // 새 문제 등으로 녹음을 취소한 경우
let selectedVoice = null;
let warmedUp = false;

// ===== DOM =====
const newBtn = document.getElementById("newBtn");
const micBtn = document.getElementById("micBtn");
const submitBtn = document.getElementById("submitBtn");
const questionEl = document.getElementById("question");
const hintEl = document.getElementById("hint");
const heardBox = document.getElementById("heardBox");
const heardText = document.getElementById("heardText");
const resultEl = document.getElementById("result");
const statusEl = document.getElementById("status");
const voiceSelect = document.getElementById("voiceSelect");
const rateInput = document.getElementById("rate");

// ===== 음성 출력 (TTS) =====
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

function speak(text) {
  if (!("speechSynthesis" in window) || !text) return;
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
    synth.speak(utter);
  }, 120);
}

// ===== 음성 인식 (STT) =====
const SpeechRecognition =
  window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;

if (SpeechRecognition) {
  recognition = new SpeechRecognition();
  recognition.lang = "en-US";
  recognition.continuous = true; // 한 번 끊겼다고 바로 종료하지 않게
  recognition.interimResults = true; // 말하는 중인지 감지해 타이머를 늦춤
  recognition.maxAlternatives = 1;

  recognition.onstart = () => {
    micBtn.classList.add("active");
    micBtn.textContent = "🔴 듣는 중…";
    setStatus("영어로 말해보세요. (다 말했으면 버튼을 누르면 바로 끝납니다)");
  };

  recognition.onerror = (e) => {
    if (e.error === "not-allowed" || e.error === "service-not-allowed") {
      listening = false;
      clearTimeout(silenceTimer);
      setStatus("마이크 권한이 필요합니다. 브라우저에서 허용해주세요.", "error");
    } else if (e.error === "no-speech" || e.error === "aborted") {
      // 무시 — onend 에서 계속 들을지 판단
    } else {
      setStatus("음성 인식 오류: " + e.error, "error");
    }
  };

  recognition.onend = () => {
    // 아직 듣는 중이어야 하는데 브라우저가 임의로 끊은 경우 → 다시 시작
    if (listening) {
      try {
        recognition.start();
        return;
      } catch {
        // 재시작 실패 시 아래 마무리 로직으로
      }
    }

    micBtn.classList.remove("active");

    // 새 문제 등으로 취소된 경우 → 결과를 반영하지 않음
    if (aborted) {
      aborted = false;
      micBtn.textContent = "🎤 말하기";
      return;
    }

    heard = finalBuffer.trim();
    micBtn.textContent = heard ? "🎤 다시 말하기" : "🎤 말하기";

    if (heard) {
      heardBox.style.display = "block";
      heardText.textContent = heard;
      submitBtn.disabled = false;
      setStatus("제출하면 발음 상태를 체크해 드립니다. (다시 말하기도 가능)");
    } else {
      setStatus("소리가 감지되지 않았어요. 다시 시도해보세요.");
    }
  };

  recognition.onresult = (event) => {
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const r = event.results[i];
      if (r.isFinal) finalBuffer += r[0].transcript + " ";
      else interim += r[0].transcript;
    }
    // 말하는 동안 실시간으로 보여줌
    const preview = (finalBuffer + interim).trim();
    if (preview) {
      heardBox.style.display = "block";
      heardText.textContent = preview;
    }
    // 말소리가 들리는 동안에는 계속 기다림
    scheduleFinish();
  };
} else {
  setStatus(
    "이 브라우저는 음성 인식을 지원하지 않습니다. Chrome 또는 Edge 를 사용하세요.",
    "error"
  );
}

// ===== 새 문제 =====
async function fetchQuestion() {
  abortListening(); // 녹음 중이었다면 취소
  setStatus("문제를 만드는 중…");
  newBtn.disabled = true;
  try {
    const res = await fetch("/api/ko-sentence", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recent: recentQuestions(),
        theme: typeof getTheme === "function" ? getTheme() : undefined,
        level: typeof getLevel === "function" ? getLevel() : undefined,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `서버 오류 (${res.status})`);
    }
    const data = await res.json();
    currentKorean = (data.korean || "").trim();
    if (typeof History !== "undefined") History.add("speaking", currentKorean);

    // 초기화
    heard = "";
    heardBox.style.display = "none";
    heardText.textContent = "";
    resultEl.classList.remove("show");
    resultEl.innerHTML = "";
    submitBtn.disabled = true;
    micBtn.disabled = !recognition;
    micBtn.textContent = "🎤 말하기";

    hintEl.style.display = "none";
    questionEl.style.display = "block";
    questionEl.innerHTML = `<div class="q-label">이 문장을 영어로 말해보세요</div><div class="q-text">${esc(
      currentKorean
    )}</div>`;

    setStatus("🎤 말하기 버튼을 누르고 영어로 말해보세요.");
  } catch (err) {
    setStatus("오류: " + err.message, "error");
  } finally {
    newBtn.disabled = false;
  }
}

newBtn.addEventListener("click", fetchQuestion);

// ===== 마이크 =====
// 말이 멈춘 뒤 종료 예약. 단, 시작 후 최소 MIN_LISTEN_MS 는 무조건 기다림.
function scheduleFinish() {
  clearTimeout(silenceTimer);
  const elapsed = Date.now() - listenStart;
  const wait = Math.max(SILENCE_MS, MIN_LISTEN_MS - elapsed);
  silenceTimer = setTimeout(finishListening, wait);
}

function finishListening() {
  if (!listening) return;
  listening = false;
  clearTimeout(silenceTimer);
  try {
    recognition.stop();
  } catch {
    // 이미 멈춘 경우 무시
  }
}

// 녹음을 취소하고 결과를 버림 (새 문제로 넘어갈 때)
function abortListening() {
  if (!listening) return;
  aborted = true;
  listening = false;
  clearTimeout(silenceTimer);
  finalBuffer = "";
  try {
    recognition.stop();
  } catch {
    // 이미 멈춘 경우 무시
  }
}

function startListening() {
  finalBuffer = "";
  heard = "";
  submitBtn.disabled = true;
  listening = true;
  listenStart = Date.now();
  try {
    recognition.start();
  } catch {
    // 이미 시작된 경우 무시
  }
  scheduleFinish(); // 아무 말이 없어도 최소 시간 뒤 종료
}

micBtn.addEventListener("click", () => {
  if (!recognition) return;
  warmUpSpeech();
  window.speechSynthesis.cancel();
  if (listening) {
    finishListening(); // 다 말했으면 버튼으로 바로 종료
  } else {
    startListening();
  }
});

// ===== 채점 =====
submitBtn.addEventListener("click", async () => {
  if (!currentKorean || !heard) return;

  setStatus("발음을 확인하는 중…");
  submitBtn.disabled = true;
  newBtn.disabled = true;

  try {
    const res = await fetch("/api/speaking/grade", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ korean: currentKorean, heard }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `서버 오류 (${res.status})`);
    }
    const data = await res.json();
    renderResult(data);
    // 요청대로 정답을 한 번 읽어줌
    warmUpSpeech();
    speak(data.best);
    setStatus("채점 완료! 정답을 들려드렸어요. 🔊 로 다시 들을 수 있습니다.");
  } catch (err) {
    setStatus("오류: " + err.message, "error");
  } finally {
    submitBtn.disabled = false;
    newBtn.disabled = false;
  }
});

let lastBest = ""; // 방금 채점한 정답 문장 (질문 컨텍스트용)

function renderResult(data) {
  lastBest = data.best || "";
  // 복습(말하기)에 저장: 한글 문제 + 올바른 영어 답
  if (typeof Review !== "undefined" && lastBest) {
    Review.add("speaking", { en: lastBest, ko: currentKorean });
  }
  const score = data.score || 0;
  let verdict;
  if (score >= 90) verdict = "🎉 발음이 아주 좋아요!";
  else if (score >= 70) verdict = "👍 잘했어요. 조금만 더 다듬어 봐요.";
  else if (score >= 50) verdict = "🙂 통했어요. 몇 단어를 더 연습해봐요.";
  else verdict = "💪 다시 도전해봐요.";

  const tipsHtml = (data.tips || [])
    .map((t) => `<li>${esc(t)}</li>`)
    .join("");

  resultEl.innerHTML = `
    <div class="score">${verdict} &nbsp; 점수 ${score}점</div>

    <div class="result-block">
      <div class="label">🎧 내가 말한 것 (인식 결과)</div>
      <div class="result-line">${esc(heard)}</div>
    </div>

    <div class="result-block">
      <div class="label">✅ 정답 문장</div>
      <div class="result-line">
        ${esc(data.best || "")}
        <button class="icon-btn spk" data-text="${esc(
          data.best || ""
        )}" title="듣기">🔊</button>
      </div>
    </div>

    ${
      data.feedback
        ? `<div class="result-block">
      <div class="label">📝 피드백</div>
      <div class="result-line feedback-text">${esc(data.feedback)}</div>
    </div>`
        : ""
    }

    ${
      tipsHtml
        ? `<div class="result-block">
      <div class="label">🔈 발음 팁</div>
      <ul class="tips-list">${tipsHtml}</ul>
    </div>`
        : ""
    }
  `;
  resultEl.classList.add("show");

  resultEl.querySelectorAll(".spk").forEach((btn) => {
    btn.addEventListener("click", () => {
      warmUpSpeech();
      speak(btn.dataset.text);
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
  let c = "Speaking exercise. Korean prompt to say in English: " + currentKorean;
  if (heard) c += "\nWhat the recognizer heard: " + heard;
  if (lastBest) c += "\nCorrect answer: " + lastBest;
  return c;
};
