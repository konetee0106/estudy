// ===== Daily English Teacher =====
// 대화(messages)와 학습 기록(notes)을 localStorage에 저장해 수업이 이어지게 한다.
const MSG_KEY = "teacher_messages_v1";
const NOTES_KEY = "teacher_notes_v1";

let messages = load(MSG_KEY, []); // [{role, content}]
let notes = load(NOTES_KEY, ""); // 학습 기록(문자열)
let voices = [];
let selectedVoice = null;
let warmedUp = false;
let busy = false;

function load(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v == null ? fallback : v;
  } catch {
    return fallback;
  }
}
function save() {
  localStorage.setItem(MSG_KEY, JSON.stringify(messages.slice(-60)));
  localStorage.setItem(NOTES_KEY, JSON.stringify(notes));
}

// ===== DOM =====
const chatEl = document.getElementById("chat");
const statusEl = document.getElementById("status");
const micBtn = document.getElementById("micBtn");
const stopBtn = document.getElementById("stopBtn");
const textForm = document.getElementById("textForm");
const textInput = document.getElementById("textInput");
const startBtn = document.getElementById("startBtn");
const endBtn = document.getElementById("endBtn");
const resetBtn = document.getElementById("resetBtn");
const voiceSelect = document.getElementById("voiceSelect");
const rateInput = document.getElementById("rate");

// ===== 음성 인식 (STT) =====
const SpeechRecognition =
  window.SpeechRecognition || window.webkitSpeechRecognition;
const MIN_LISTEN_MS = 5000;
const SILENCE_MS = 2500;
let listening = false;
let finalBuffer = "";
let silenceTimer = null;
let listenStart = 0;
let recognition = null;

if (SpeechRecognition) {
  recognition = new SpeechRecognition();
  recognition.lang = "en-US";
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  recognition.onstart = () => {
    micBtn.classList.add("active");
    micBtn.querySelector(".mic-label").textContent = "듣는 중…";
    setStatus("듣고 있어요. 영어로 말해보세요. (다 말하면 버튼을 눌러도 됩니다)", "listening");
  };
  recognition.onerror = (e) => {
    if (e.error === "not-allowed" || e.error === "service-not-allowed") {
      listening = false;
      clearTimeout(silenceTimer);
      setStatus("마이크 권한이 필요합니다. 주소창의 마이크 권한을 허용해주세요.", "error");
    } else if (e.error === "no-speech" || e.error === "aborted") {
      // 무시
    } else {
      setStatus("음성 인식 오류: " + e.error, "error");
    }
  };
  recognition.onend = () => {
    if (listening) {
      try {
        recognition.start();
        return;
      } catch {}
    }
    micBtn.classList.remove("active");
    micBtn.querySelector(".mic-label").textContent = "말하기";
    const text = finalBuffer.trim();
    finalBuffer = "";
    // 정확도를 위해 자동 전송하지 않고 입력창에 넣어 확인 후 보내게 함
    if (text) {
      textInput.value = text;
      if (typeof autoGrow === "function") autoGrow();
      textInput.focus();
      setStatus("인식된 문장을 확인하고 '보내기'(또는 Enter)를 누르세요.");
    } else {
      setStatus("소리가 감지되지 않았어요. 다시 시도해보세요.");
    }
  };
  recognition.onresult = (event) => {
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const r = event.results[i];
      if (r.isFinal) finalBuffer += r[0].transcript + " ";
    }
    scheduleFinish();
  };
} else {
  micBtn.disabled = true;
}

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
  } catch {}
}
function startListening() {
  finalBuffer = "";
  listening = true;
  listenStart = Date.now();
  try {
    recognition.start();
  } catch {}
  scheduleFinish();
}
micBtn.addEventListener("click", () => {
  if (!recognition) return;
  warmUpSpeech();
  window.speechSynthesis.cancel();
  if (listening) finishListening();
  else startListening();
});

// ===== 음성 합성 (TTS) =====
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

// 선생님 답변에서 영어 부분만 골라 읽어준다 (한국어 설명은 건너뜀)
function englishParts(text) {
  return (text || "")
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?])\s+/))
    .map((s) => s.trim())
    .filter((s) => {
      const latin = (s.match(/[A-Za-z]/g) || []).length;
      const hangul = (s.match(/[가-힣]/g) || []).length;
      return latin >= 3 && latin >= hangul; // 영어가 한글보다 많은 조각만
    })
    // 앞의 라벨(교정:, 내 문장: 등) 제거
    .map((s) => s.replace(/^[^A-Za-z]*/, "").trim())
    .filter(Boolean)
    .join(". ");
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
stopBtn.addEventListener("click", () => window.speechSynthesis.cancel());

// ===== 렌더링 =====
function addMessage(role, text) {
  const div = document.createElement("div");
  div.className = "msg " + (role === "user" ? "user" : "ai");
  const body = document.createElement("div");
  body.className = "msg-body";
  body.textContent = text; // pre-line CSS로 줄바꿈 유지
  div.appendChild(body);
  chatEl.appendChild(div);
  chatEl.scrollTop = chatEl.scrollHeight;
  return div;
}

// ===== 드래그하면 그 부분 발음해주기 =====
function handleDragSpeak() {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
  const range = sel.getRangeAt(0);
  if (!chatEl.contains(range.commonAncestorContainer)) return; // 채팅 영역 안에서만
  const text = (sel.toString() || range.toString() || "").trim();
  if (!text) return;
  warmUpSpeech();
  const en = englishParts(text);
  speak(en || text); // 선택한 영어(있으면 영어만) 발음
  setStatus("🔊 발음 중… (드래그한 부분)");
}
chatEl.addEventListener("mouseup", () => setTimeout(handleDragSpeak, 10));
chatEl.addEventListener("touchend", () => setTimeout(handleDragSpeak, 10));

function renderAll() {
  chatEl.innerHTML = "";
  messages.forEach((m) => addMessage(m.role, m.content));
}

// ===== 대화 전송 (스트리밍) =====
const NOTES_DELIM = "@@@NOTES@@@";

// 아직 완성 안 된 구분자 조각이 화면에 잠깐 보이는 것 방지
function stripTrailingDelimPrefix(s) {
  for (let k = NOTES_DELIM.length - 1; k > 0; k--) {
    if (s.endsWith(NOTES_DELIM.slice(0, k))) return s.slice(0, -k);
  }
  return s;
}

async function send(text) {
  if (busy || !text.trim()) return;
  busy = true;
  addMessage("user", text);
  messages.push({ role: "user", content: text });
  save();

  setStatus("선생님이 답하는 중…");
  micBtn.disabled = true;
  startBtn.disabled = true;
  endBtn.disabled = true;

  const aiDiv = addMessage("assistant", ""); // 스트리밍용 빈 말풍선
  const aiBody = aiDiv.querySelector(".msg-body");
  let buf = "";

  try {
    const res = await fetch("/api/teacher", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages, notes }),
    });
    if (!res.ok || !res.body) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `서버 오류 (${res.status})`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const idx = buf.indexOf(NOTES_DELIM);
      let shown = idx >= 0 ? buf.slice(0, idx) : stripTrailingDelimPrefix(buf);
      aiBody.textContent = shown.replace(/^\s+/, "");
      chatEl.scrollTop = chatEl.scrollHeight;
    }
    buf += decoder.decode();

    const idx = buf.indexOf(NOTES_DELIM);
    const reply = (idx >= 0 ? buf.slice(0, idx) : buf).trim();
    const newNotes = idx >= 0 ? buf.slice(idx + NOTES_DELIM.length).trim() : "";

    aiBody.textContent = reply || "(응답 없음)";
    if (newNotes) notes = newNotes;
    if (reply) messages.push({ role: "assistant", content: reply });
    save();
    setStatus("답을 쓰거나 🎤로 말해보세요. (영어를 드래그하면 발음을 들려줘요)");
  } catch (err) {
    aiDiv.remove(); // 실패한 빈 말풍선 제거
    setStatus("오류: " + err.message, "error");
  } finally {
    busy = false;
    micBtn.disabled = false;
    startBtn.disabled = false;
    endBtn.disabled = false;
  }
}

// ===== 입력 =====
// 입력 내용에 따라 높이 자동 조절 (여러 줄이면 늘어남)
function autoGrow() {
  textInput.style.height = "auto";
  textInput.style.height = Math.min(textInput.scrollHeight, 140) + "px";
}
textInput.addEventListener("input", autoGrow);

// Enter = 보내기, Shift+Enter = 줄바꿈 (한글 입력 조합 중에는 무시)
textInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    if (typeof textForm.requestSubmit === "function") textForm.requestSubmit();
    else textForm.dispatchEvent(new Event("submit", { cancelable: true }));
  }
});

textForm.addEventListener("submit", (e) => {
  e.preventDefault();
  warmUpSpeech();
  const text = textInput.value.trim();
  if (text) {
    textInput.value = "";
    autoGrow(); // 전송 후 높이 초기화
    send(text);
  }
});

startBtn.addEventListener("click", () => {
  warmUpSpeech();
  send("수업 시작하자");
});
endBtn.addEventListener("click", () => {
  warmUpSpeech();
  send("오늘 수업 끝");
});
resetBtn.addEventListener("click", () => {
  if (
    !confirm(
      "학습 기록과 대화를 모두 지울까요?\n(지금까지 선생님이 기억한 실수·약점 기록도 사라집니다.)"
    )
  )
    return;
  messages = [];
  notes = "";
  localStorage.removeItem(MSG_KEY);
  localStorage.removeItem(NOTES_KEY);
  chatEl.innerHTML = "";
  setStatus('초기화했어요. "수업 시작하자" 로 새로 시작하세요.');
});

function setStatus(text, kind = "") {
  statusEl.textContent = text;
  statusEl.className = "status" + (kind ? " " + kind : "");
}

// 질문하기 위젯에 최근 대화 전달
window.getAskContext = function () {
  const recent = messages.slice(-6);
  if (!recent.length) return "";
  return (
    "Recent tutoring conversation:\n" +
    recent
      .map((m) => (m.role === "user" ? "Student: " : "Teacher: ") + m.content)
      .join("\n")
  );
};

// ===== 시작 =====
(function init() {
  if (messages.length) {
    renderAll();
    setStatus("이전 수업을 이어갑니다. 답을 쓰거나 🎤로 말해보세요.");
  } else {
    addMessage(
      "assistant",
      "👋 안녕하세요! 저는 당신의 1:1 영어 과외 선생님이에요.\n" +
        '준비되면 아래 "▶️ 수업 시작하자" 를 눌러주세요.\n' +
        "영어 문장을 쓰거나 🎤로 말하면 바로 교정해 드릴게요."
    );
  }
})();
