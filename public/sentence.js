// ===== 상태 =====
let pattern = "1"; // 1 | 2 | 3 | 4 | 5
let mode = "guide"; // guide | practice
let currentKorean = "";
let currentBest = "";
let voices = [];
let selectedVoice = null;
let warmedUp = false;

// 성분 역할 → 한국어 라벨
const ROLE_LABEL = {
  S: "주어",
  V: "동사",
  O: "목적어",
  IO: "간접목적어",
  DO: "직접목적어",
  SC: "보어",
  OC: "목적격보어",
  M: "수식어",
};
// 형식별로 등장하는 성분(범례용)
const PATTERN_ROLES = {
  "1": ["S", "V", "M"],
  "2": ["S", "V", "SC", "M"],
  "3": ["S", "V", "O", "M"],
  "4": ["S", "V", "IO", "DO", "M"],
  "5": ["S", "V", "O", "OC", "M"],
};
const PATTERN_NAME = {
  "1": "1형식",
  "2": "2형식",
  "3": "3형식",
  "4": "4형식",
  "5": "5형식",
};

// ===== DOM =====
const patternTabs = document.getElementById("patternTabs").querySelectorAll("button");
const modeTabs = document.getElementById("modeTabs").querySelectorAll("button");
const guideSection = document.getElementById("guideSection");
const practiceSection = document.getElementById("practiceSection");
const guideBtn = document.getElementById("guideBtn");
const guideBody = document.getElementById("guideBody");
const roleLegend = document.getElementById("roleLegend");
const patternNameA = document.getElementById("patternNameA");
const patternNameB = document.getElementById("patternNameB");
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
function patName() {
  return PATTERN_NAME[pattern];
}

// 성분 분해 → 색깔 칩 HTML
function renderParts(parts) {
  if (!Array.isArray(parts) || !parts.length) return "";
  const chips = parts
    .map((p) => {
      const role = ROLE_LABEL[p.role] ? p.role : "M";
      return `<span class="part role-${role}"><span class="part-role">${ROLE_LABEL[role]}</span>${esc(
        p.text || ""
      )}</span>`;
    })
    .join(" ");
  return `<div class="parts">${chips}</div>`;
}

// 범례
function renderLegend() {
  const roles = PATTERN_ROLES[pattern] || [];
  roleLegend.innerHTML = roles
    .map(
      (r) =>
        `<span class="legend-item"><span class="legend-dot role-${r}"></span>${r} · ${ROLE_LABEL[r]}</span>`
    )
    .join("");
}

// ===== 탭 =====
patternTabs.forEach((b) => {
  b.addEventListener("click", () => {
    window.speechSynthesis.cancel();
    pattern = b.dataset.pattern;
    patternTabs.forEach((x) => x.classList.toggle("active", x === b));
    patternNameA.textContent = patName();
    patternNameB.textContent = patName();
    renderLegend();
    renderGuideFromCache();
    currentKorean = "";
    questionEl.style.display = "none";
    resultEl.classList.remove("show");
    resultEl.innerHTML = "";
    pHint.style.display = "block";
    setStatus(`'${patName()}' 선택됨.`);
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
  return "sentguide_" + pattern;
}

function renderGuideFromCache() {
  let cached = null;
  try {
    cached = JSON.parse(localStorage.getItem(guideKey()) || "null");
  } catch {
    cached = null;
  }
  if (cached && cached.examples && cached.examples.length) {
    renderGuide(cached);
    guideBtn.textContent = "🔄 정리 다시 만들기";
  } else {
    guideBody.innerHTML = `<div class="reading-empty">위 <b>정리 보기</b> 를 누르면 <b>${patName()}</b> 의 구조·규칙·예문이 성분별로 정리됩니다.</div>`;
    guideBtn.textContent = "📖 정리 보기";
  }
}

async function fetchGuide() {
  setStatus(`'${patName()}' 정리를 만드는 중… (10초 정도 걸릴 수 있어요)`);
  guideBtn.disabled = true;
  try {
    const res = await fetch("/api/sentence-guide", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pattern }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `서버 오류 (${res.status})`);
    }
    const data = await res.json();
    localStorage.setItem(guideKey(), JSON.stringify(data));
    renderGuide(data);
    guideBtn.textContent = "🔄 정리 다시 만들기";
    setStatus(`'${patName()}' 정리 완료! 예문의 🔊 로 발음을 들어보세요.`);
  } catch (err) {
    setStatus("오류: " + err.message, "error");
  } finally {
    guideBtn.disabled = false;
  }
}

function renderGuide(data) {
  let html = "";
  html += `<div class="pattern-structure">${esc(data.structure || "")}</div>`;
  if (data.intro) html += `<div class="guide-intro">${esc(data.intro)}</div>`;

  if (Array.isArray(data.points) && data.points.length) {
    html += `<ul class="tips-list">${data.points
      .map((p) => `<li>${esc(p)}</li>`)
      .join("")}</ul>`;
  }
  if (Array.isArray(data.verbs) && data.verbs.length) {
    html += `<div class="guide-group"><div class="guide-label">자주 쓰는 동사</div><div class="verb-chips">${data.verbs
      .map((v) => `<span class="verb-chip">${esc(v)}</span>`)
      .join("")}</div></div>`;
  }

  const exHtml = (data.examples || [])
    .map(
      (e) =>
        `<li class="sent-ex">
          <div class="ex-top">
            <span class="ex-en">${esc(e.en)}</span>
            <button class="icon-btn spk" data-text="${esc(e.en)}" title="듣기">🔊</button>
          </div>
          ${renderParts(e.parts)}
          <div class="ex-ko">${esc(e.ko)}</div>
        </li>`
    )
    .join("");
  html += `<div class="guide-group"><div class="guide-label">예문 (성분 분해)</div><ul class="sent-examples">${exHtml}</ul></div>`;

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
  return History.recent("sentence_" + pattern, 20);
}

async function fetchQuestion() {
  setStatus("문제를 만드는 중…");
  newBtn.disabled = true;
  try {
    const res = await fetch("/api/sentence-drill", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pattern, recent: recentPractice() }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `서버 오류 (${res.status})`);
    }
    const data = await res.json();
    currentKorean = (data.korean || "").trim();
    currentBest = (data.best || "").trim();
    if (typeof History !== "undefined")
      History.add("sentence_" + pattern, currentKorean);

    pHint.style.display = "none";
    questionEl.style.display = "block";
    questionEl.innerHTML = `<div class="q-label">'${patName()}' 으로 영어로 옮겨보세요</div><div class="q-text">${esc(
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
    const res = await fetch("/api/sentence-grade", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pattern,
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
  else if (score >= 50) verdict = "🙂 뜻은 통해요. 형식을 다듬어 봅시다.";
  else verdict = "💪 다시 도전해봐요.";

  const matchBadge = data.matched
    ? `<span class="match-badge ok">✅ ${patName()} 맞음</span>`
    : `<span class="match-badge no">⚠️ ${patName()} 아님</span>`;

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
    <div class="score">${verdict} &nbsp; 점수 ${score}점 &nbsp; ${matchBadge}</div>
    <div class="result-block">
      <div class="label">✍️ 내가 쓴 답</div>
      <div class="result-line">${esc(answer)}</div>
    </div>
    <div class="result-block">
      <div class="label">✅ 올바른 답 (${patName()})</div>
      <div class="result-line">${esc(data.best || "")}
        <button class="icon-btn spk" data-text="${esc(
          data.best || ""
        )}" title="듣기">🔊</button>
      </div>
      ${renderParts(data.parts)}
    </div>
    ${
      altHtml
        ? `<div class="result-block"><div class="label">💡 이렇게도 말할 수 있어요</div><ul class="alt-list">${altHtml}</ul></div>`
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

// 질문하기 위젯에 현재 학습 문형 전달
window.getAskContext = function () {
  let c = `The learner is studying English sentence pattern ${patName()} (Korean 5형식 grammar).`;
  if (currentKorean) c += ` Current practice (Korean to translate): ${currentKorean}`;
  return c;
};

// ===== 시작 =====
(function init() {
  const params = new URLSearchParams(location.search);
  const p = (params.get("pattern") || "1").replace(/[^1-5]/g, "").charAt(0);
  if (["1", "2", "3", "4", "5"].includes(p)) pattern = p;
  patternTabs.forEach((x) => x.classList.toggle("active", x.dataset.pattern === pattern));
  patternNameA.textContent = patName();
  patternNameB.textContent = patName();
  renderLegend();
  renderGuideFromCache();
})();
