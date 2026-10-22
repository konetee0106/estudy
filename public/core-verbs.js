// ===== 핵심동사 랜덤 연습 =====
// 서버(CORE_VERBS)와 동일한 풀. 칩 표시용.
const VERB_POOL = [
  "get", "take", "put", "have", "make", "give", "keep", "let", "hold", "bring",
  "carry", "pick", "pull", "push", "drop", "grab", "catch", "throw", "turn",
  "move", "run", "find", "lose", "leave", "call", "tell", "ask", "show", "help",
  "try", "look", "meet", "pay", "send", "use", "check", "break", "stop", "start",
  "open", "close", "buy", "wait", "save", "change",
];

// ===== 상태 =====
let lockedVerb = ""; // ""=랜덤, 아니면 그 동사만 연습
let currentVerb = ""; // 이번 문제의 동사
let currentKorean = "";
let currentBest = "";
let voices = [];
let selectedVoice = null;
let warmedUp = false;

// ===== DOM =====
const newBtn = document.getElementById("newBtn");
const questionEl = document.getElementById("question");
const pHint = document.getElementById("pHint");
const answerForm = document.getElementById("answerForm");
const answerInput = document.getElementById("answerInput");
const submitBtn = document.getElementById("submitBtn");
const resultEl = document.getElementById("result");
const statusEl = document.getElementById("status");
const voiceSelect = document.getElementById("voiceSelect");
const rateInput = document.getElementById("rate");
const poolChips = document.getElementById("poolChips");

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

// 예열: 버튼을 누른 순간(사용자 제스처) 아주 작게 소리를 내서 엔진을 깨운다.
function warmUpSpeech() {
  if (warmedUp || !("speechSynthesis" in window)) return;
  warmedUp = true;
  const u = new SpeechSynthesisUtterance("hello");
  u.volume = 0.05;
  u.rate = 1;
  if (selectedVoice) u.voice = selectedVoice;
  u.lang = selectedVoice ? selectedVoice.lang : "en-US";
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

// ===== 동사 풀 칩 =====
VERB_POOL.forEach((v) => {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "pool-chip";
  b.dataset.verb = v;
  b.textContent = v;
  poolChips.appendChild(b);
});
const allChips = document.querySelectorAll(".pool-chip");
allChips.forEach((b) => {
  b.addEventListener("click", () => {
    lockedVerb = b.dataset.verb; // ""=랜덤
    allChips.forEach((x) => x.classList.toggle("active", x === b));
    setStatus(
      lockedVerb
        ? `'${lockedVerb}' 만 연습합니다. 🎲 새 연습을 누르세요.`
        : "🎲 랜덤으로 연습합니다. 새 연습을 누르세요."
    );
  });
});

// ===== 연습 =====
function recentPractice() {
  const key = "core_" + (lockedVerb || "random");
  if (typeof History === "undefined") return [];
  return History.recent(key, 20);
}

async function fetchQuestion() {
  warmUpSpeech(); // 제스처 시점에 엔진 예열
  setStatus("문제를 만드는 중…");
  newBtn.disabled = true;
  try {
    const res = await fetch("/api/core-sentence", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        verb: lockedVerb || undefined, // 없으면 서버가 랜덤 선택
        recent: recentPractice(),
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `서버 오류 (${res.status})`);
    }
    const data = await res.json();
    currentVerb = (data.verb || "").trim();
    currentKorean = (data.korean || "").trim();
    currentBest = (data.best || "").trim();
    if (typeof History !== "undefined") {
      History.add("core_" + (lockedVerb || "random"), currentKorean);
    }

    pHint.style.display = "none";
    questionEl.style.display = "block";
    questionEl.innerHTML =
      `<div class="q-label">🎲 이번 동사: <b class="core-verb-chip">${esc(
        currentVerb
      )}</b> — 이 동사를 써서 영어로 옮겨보세요</div>` +
      `<div class="q-text">${esc(currentKorean)}</div>`;
    resultEl.classList.remove("show");
    resultEl.innerHTML = "";
    answerInput.value = "";
    answerInput.disabled = false;
    submitBtn.disabled = false;
    answerInput.focus();
    setStatus("영어로 옮겨 적고 Enter 또는 제출 버튼을 누르세요.");
  } catch (err) {
    setStatus("오류: " + err.message, "error");
  } finally {
    newBtn.disabled = false;
  }
}
newBtn.addEventListener("click", fetchQuestion);

answerInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    if (typeof answerForm.requestSubmit === "function") answerForm.requestSubmit();
    else answerForm.dispatchEvent(new Event("submit", { cancelable: true }));
  }
});

answerForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!currentKorean || !currentVerb) return;
  const answer = answerInput.value.trim();
  if (!answer) {
    setStatus("영어 문장을 입력한 뒤 제출하세요.");
    return;
  }
  setStatus("채점 중…");
  submitBtn.disabled = true;
  newBtn.disabled = true;
  try {
    const res = await fetch("/api/core-grade", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        verb: currentVerb,
        korean: currentKorean,
        answer,
        reference: currentBest,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `서버 오류 (${res.status})`);
    }
    const data = await res.json();
    renderResult(answer, data);
    setStatus("채점 완료! '새 연습'으로 계속하세요.");
  } catch (err) {
    setStatus("오류: " + err.message, "error");
  } finally {
    submitBtn.disabled = false;
    newBtn.disabled = false;
  }
});

function renderResult(answer, data) {
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

  const otherHtml = (data.otherVerbs || [])
    .map(
      (o) =>
        `<li>
          <div class="ov-line">
            <span class="ov-verb">${esc(o.verb || "")}</span>
            <span class="alt-text">${esc(o.en || "")}</span>
            <button class="icon-btn spk" data-text="${esc(
              o.en || ""
            )}" title="듣기">🔊</button>
          </div>
          ${o.ko ? `<div class="ov-ko">${esc(o.ko)}</div>` : ""}
        </li>`
    )
    .join("");

  resultEl.innerHTML = `
    <div class="score">${verdict} &nbsp; 점수 ${score}점 &nbsp; <span class="core-verb-chip">${esc(
    currentVerb
  )}</span></div>
    <div class="result-block">
      <div class="label">✍️ 내가 쓴 답</div>
      <div class="result-line">${esc(answer)}</div>
    </div>
    <div class="result-block">
      <div class="label">🎯 내가 제시한 동사 '<b>${esc(
        currentVerb
      )}</b>' 로 쓰면</div>
      <div class="result-line">${esc(data.best || "")}
        <button class="icon-btn spk" data-text="${esc(
          data.best || ""
        )}" title="듣기">🔊</button>
      </div>
    </div>
    ${
      altHtml
        ? `<div class="result-block"><div class="label">💡 이렇게도 말할 수 있어요</div><ul class="alt-list">${altHtml}</ul></div>`
        : ""
    }
    ${
      otherHtml
        ? `<div class="result-block"><div class="label">🔄 다른 동사로는 이렇게</div><ul class="alt-list other-verbs">${otherHtml}</ul></div>`
        : ""
    }
    ${
      data.feedback
        ? `<div class="result-block"><div class="label">📝 피드백</div><div class="result-line feedback-text">${esc(
            data.feedback
          )}</div></div>`
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

// 질문하기 위젯에 현재 학습 동사 전달
window.getAskContext = function () {
  let c = currentVerb
    ? `The learner is practicing the common English verb "${currentVerb}".`
    : `The learner is practicing common English verbs (get, take, put, etc.).`;
  if (currentKorean) c += ` Current practice (Korean to translate): ${currentKorean}`;
  return c;
};
