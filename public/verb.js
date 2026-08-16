// ===== 상태 =====
let verb = "take"; // take | get
let mode = "guide"; // guide | practice
let currentKorean = "";
let currentBest = ""; // 문제와 함께 받은 기준 정답 (그 동사 사용)
let voices = [];
let selectedVoice = null;
let warmedUp = false;

// ===== DOM =====
const verbTabs = document.getElementById("verbTabs").querySelectorAll("button");
const modeTabs = document.getElementById("modeTabs").querySelectorAll("button");
const guideSection = document.getElementById("guideSection");
const practiceSection = document.getElementById("practiceSection");
const guideBtn = document.getElementById("guideBtn");
const guideBody = document.getElementById("guideBody");
const verbNameA = document.getElementById("verbNameA");
const verbNameB = document.getElementById("verbNameB");
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

function verbName() {
  return verb === "both" ? "take + get" : verb;
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

// ===== 탭 =====
verbTabs.forEach((b) => {
  b.addEventListener("click", () => {
    window.speechSynthesis.cancel();
    verb = b.dataset.verb;
    verbTabs.forEach((x) => x.classList.toggle("active", x === b));
    verbNameA.textContent = verbName();
    verbNameB.textContent = verbName();
    // 정리는 저장된 것 있으면 자동 표시
    renderGuideFromCache();
    // 연습 초기화
    currentKorean = "";
    questionEl.style.display = "none";
    resultEl.classList.remove("show");
    resultEl.innerHTML = "";
    pHint.style.display = "block";
    setStatus(`'${verbName()}' 선택됨.`);
  });
});

modeTabs.forEach((b) => {
  b.addEventListener("click", () => {
    window.speechSynthesis.cancel();
    mode = b.dataset.mode;
    modeTabs.forEach((x) => x.classList.toggle("active", x === b));
    guideSection.style.display = mode === "guide" ? "" : "none";
    practiceSection.style.display = mode === "practice" ? "" : "none";
  });
});

// ===== 핵심 정리 =====
function guideKey() {
  return "verbguide_" + verb;
}
function seenKey() {
  return "verbguide_seen_" + verb;
}

// 지금까지 예문으로 나온 영어 문장들(중복 방지용)
function loadSeen() {
  try {
    return JSON.parse(localStorage.getItem(seenKey()) || "[]") || [];
  } catch {
    return [];
  }
}
function addSeen(data) {
  const seen = loadSeen();
  (data.groups || []).forEach((g) =>
    (g.examples || []).forEach((e) => {
      const en = (e.en || "").trim();
      if (en && !seen.includes(en)) seen.push(en);
    })
  );
  while (seen.length > 80) seen.shift(); // 상한
  localStorage.setItem(seenKey(), JSON.stringify(seen));
}

function renderGuideFromCache() {
  let cached = null;
  try {
    cached = JSON.parse(localStorage.getItem(guideKey()) || "null");
  } catch {
    cached = null;
  }
  if (cached && cached.groups && cached.groups.length) {
    renderGuide(cached);
    guideBtn.textContent = "🔄 정리 다시 만들기";
  } else {
    guideBody.innerHTML = `<div class="reading-empty">위 <b>정리 보기</b> 를 누르면 <b>${verbName()}</b> 의 핵심 뜻·표현·예문이 정리됩니다.</div>`;
    guideBtn.textContent = "📖 정리 보기";
  }
}

async function fetchGuide() {
  setStatus(`'${verb}' 정리를 만드는 중… (10~20초 걸릴 수 있어요)`);
  guideBtn.disabled = true;
  try {
    const res = await fetch("/api/verb-guide", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ verb, recent: loadSeen() }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `서버 오류 (${res.status})`);
    }
    const data = await res.json();
    localStorage.setItem(guideKey(), JSON.stringify(data));
    addSeen(data); // 이번 예문들을 "본 것"으로 기록
    renderGuide(data);
    guideBtn.textContent = "🔄 정리 다시 만들기";
    setStatus(`'${verb}' 정리 완료! 예문의 🔊 로 발음을 들어보세요.`);
  } catch (err) {
    setStatus("오류: " + err.message, "error");
  } finally {
    guideBtn.disabled = false;
  }
}

function renderGuide(data) {
  let html = "";
  if (data.intro) html += `<div class="guide-intro">${esc(data.intro)}</div>`;
  (data.groups || []).forEach((g, i) => {
    const exHtml = (g.examples || [])
      .map(
        (e) =>
          `<li>
            <span class="ex-en">${esc(e.en)}</span>
            <button class="icon-btn spk" data-text="${esc(e.en)}" title="듣기">🔊</button>
            <div class="ex-ko">${esc(e.ko)}</div>
          </li>`
      )
      .join("");
    html += `
      <div class="guide-group">
        <div class="guide-label"><span class="guide-num">${i + 1}</span> ${esc(
      g.label
    )}</div>
        <div class="guide-note">${esc(g.note)}</div>
        <ul class="guide-examples">${exHtml}</ul>
      </div>`;
  });
  guideBody.innerHTML = html;

  guideBody.querySelectorAll(".spk").forEach((btn) => {
    btn.addEventListener("click", () => {
      warmUpSpeech();
      speak(btn.dataset.text);
    });
  });
}

guideBtn.addEventListener("click", fetchGuide);

// ===== 연습 =====
function recentPractice() {
  if (typeof History === "undefined") return [];
  return History.recent("verb_" + verb, 20);
}

async function fetchQuestion() {
  setStatus("문제를 만드는 중…");
  newBtn.disabled = true;
  try {
    const res = await fetch("/api/verb-sentence", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ verb, recent: recentPractice() }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `서버 오류 (${res.status})`);
    }
    const data = await res.json();
    currentKorean = (data.korean || "").trim();
    currentBest = (data.best || "").trim(); // 그 동사를 쓰는 기준 정답
    if (typeof History !== "undefined") History.add("verb_" + verb, currentKorean);

    pHint.style.display = "none";
    questionEl.style.display = "block";
    questionEl.innerHTML = `<div class="q-label">'${verbName()}' 를 써서 영어로 옮겨보세요</div><div class="q-text">${esc(
      currentKorean
    )}</div>`;
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
  if (!currentKorean) return;
  const answer = answerInput.value.trim();
  if (!answer) {
    setStatus("영어 문장을 입력한 뒤 제출하세요.");
    return;
  }
  setStatus("채점 중…");
  submitBtn.disabled = true;
  newBtn.disabled = true;
  try {
    const res = await fetch("/api/verb-grade", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ verb, korean: currentKorean, answer, reference: currentBest }),
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
    <div class="score">${verdict} &nbsp; 점수 ${score}점</div>
    <div class="result-block">
      <div class="label">✍️ 내가 쓴 답</div>
      <div class="result-line">${esc(answer)}</div>
    </div>
    <div class="result-block">
      <div class="label">✅ 올바른 답</div>
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
  let c =
    verb === "both"
      ? `The learner is studying how to use both "take" and "get" together in one sentence.`
      : `The learner is studying the English verb "${verb}".`;
  if (currentKorean) c += ` Current practice (Korean to translate): ${currentKorean}`;
  return c;
};

// ===== 시작 =====
(function init() {
  const params = new URLSearchParams(location.search);
  const v = (params.get("verb") || "take").toLowerCase();
  if (["get", "put", "grab", "both"].includes(v)) verb = v;
  verbTabs.forEach((x) => x.classList.toggle("active", x.dataset.verb === verb));
  verbNameA.textContent = verbName();
  verbNameB.textContent = verbName();
  renderGuideFromCache();
})();
