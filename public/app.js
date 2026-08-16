// ===== 상태 =====
const messages = []; // Claude 에 보낼 대화 히스토리 [{role, content}]
let voices = [];
let selectedVoice = null;

// ===== DOM =====
const chatEl = document.getElementById("chat");
const statusEl = document.getElementById("status");
const micBtn = document.getElementById("micBtn");
const stopBtn = document.getElementById("stopBtn");
const textForm = document.getElementById("textForm");
const textInput = document.getElementById("textInput");
const voiceSelect = document.getElementById("voiceSelect");
const rateInput = document.getElementById("rate");

// ===== 음성 인식 (STT) 설정 =====
const SpeechRecognition =
  window.SpeechRecognition || window.webkitSpeechRecognition;

// 최소 이만큼은 기다려 준다 (말이 끊겨도 성급히 종료하지 않음)
const MIN_LISTEN_MS = 5000;
// 말이 멈춘 뒤 이만큼 조용하면 다 말한 것으로 보고 종료
const SILENCE_MS = 2500;

let listening = false; // "듣고 싶은 상태" (브라우저가 임의로 끊어도 유지)
let finalBuffer = ""; // 지금까지 인식된 문장 누적
let silenceTimer = null;
let listenStart = 0;

let recognition = null;
if (SpeechRecognition) {
  recognition = new SpeechRecognition();
  recognition.lang = "en-US";
  recognition.continuous = true; // 한 문장 뒤 바로 끊기지 않게
  recognition.interimResults = true; // 말하는 중인지 감지해 타이머를 늦춤
  recognition.maxAlternatives = 1;

  recognition.onstart = () => {
    micBtn.classList.add("active");
    micBtn.querySelector(".mic-label").textContent = "듣는 중…";
    setStatus("듣고 있어요. 편하게 말해보세요. (다 말하면 버튼을 눌러도 됩니다)", "listening");
  };

  recognition.onerror = (e) => {
    if (e.error === "not-allowed" || e.error === "service-not-allowed") {
      listening = false;
      clearTimeout(silenceTimer);
      setStatus("마이크 권한이 필요합니다. 브라우저 주소창의 마이크 권한을 허용해주세요.", "error");
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
    micBtn.querySelector(".mic-label").textContent = "말하기";

    const text = finalBuffer.trim();
    finalBuffer = "";
    if (text) {
      handleUserInput(text);
    } else {
      setStatus("소리가 감지되지 않았어요. 다시 시도해보세요.");
    }
  };

  recognition.onresult = (event) => {
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const r = event.results[i];
      if (r.isFinal) finalBuffer += r[0].transcript + " ";
    }
    // 말소리가 들리는 동안에는 계속 기다림
    scheduleFinish();
  };
} else {
  setStatus(
    "이 브라우저는 음성 인식을 지원하지 않습니다. Chrome 또는 Edge 를 사용하거나 텍스트로 입력하세요.",
    "error"
  );
  micBtn.disabled = true;
}

// ===== 음성 합성 (TTS) 설정 =====
function loadVoices() {
  voices = window.speechSynthesis.getVoices().filter((v) => v.lang.startsWith("en"));
  voiceSelect.innerHTML = "";
  voices.forEach((v, i) => {
    const opt = document.createElement("option");
    opt.value = i;
    opt.textContent = `${v.name} (${v.lang})`;
    voiceSelect.appendChild(opt);
  });
  // 기본값: 미국 영어 우선
  const preferred =
    voices.findIndex((v) => /en-US/i.test(v.lang)) >= 0
      ? voices.findIndex((v) => /en-US/i.test(v.lang))
      : 0;
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

let warmedUp = false;

// 음성 엔진 예열: 첫 발화의 앞부분이 잘리는 것을 막기 위해
// 사용자 상호작용 시 한 번 무음에 가까운 짧은 발화를 재생해 엔진을 깨워둠.
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
  // cancel() 직후 바로 speak() 하면 앞부분이 잘리는 브라우저 버그가 있어 짧게 지연.
  setTimeout(() => {
    // 1) 희생용 발화: 브라우저가 첫 발화의 시작 오디오를 잘라먹으므로,
    //    실제 문장 대신 이 짧은 저음량 발화가 잘리도록 큐 맨 앞에 넣는다.
    const primer = new SpeechSynthesisUtterance("hello");
    primer.volume = 0.05;
    primer.rate = 1;
    if (selectedVoice) primer.voice = selectedVoice;
    primer.lang = selectedVoice ? selectedVoice.lang : "en-US";
    synth.speak(primer);

    // 2) 실제 문장: 큐의 두 번째라 처음부터 온전히 재생된다.
    const utter = new SpeechSynthesisUtterance(text);
    if (selectedVoice) utter.voice = selectedVoice;
    utter.lang = selectedVoice ? selectedVoice.lang : "en-US";
    utter.rate = parseFloat(rateInput.value) || 0.95;
    synth.speak(utter);
  }, 120);
}

stopBtn.addEventListener("click", () => window.speechSynthesis.cancel());

// ===== 마이크 버튼 =====
// 말이 멈춘 뒤 종료 예약. 단, 시작 후 최소 MIN_LISTEN_MS 는 무조건 기다림.
function scheduleFinish() {
  clearTimeout(silenceTimer);
  const elapsed = Date.now() - listenStart;
  const wait = Math.max(SILENCE_MS, MIN_LISTEN_MS - elapsed);
  silenceTimer = setTimeout(finishListening, wait);
}

// 듣기 종료 → onend 에서 누적된 문장을 전송
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

function startListening() {
  finalBuffer = "";
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

// ===== 텍스트 입력 =====
textForm.addEventListener("submit", (e) => {
  e.preventDefault();
  warmUpSpeech();
  const text = textInput.value.trim();
  if (text) {
    textInput.value = "";
    handleUserInput(text);
  }
});

// ===== 메시지 처리 =====
async function handleUserInput(text) {
  addMessage("user", text);
  messages.push({ role: "user", content: text });

  setStatus("생각 중…");
  micBtn.disabled = true;

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages,
        theme: typeof getTheme === "function" ? getTheme() : undefined,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `서버 오류 (${res.status})`);
    }

    const data = await res.json();
    const reply = data.reply || "(응답 없음)";
    const correction = data.correction || "";

    messages.push({ role: "assistant", content: reply });
    addMessage("ai", reply, correction);
    speak(reply);
    setStatus("마이크 버튼을 눌러 이어서 말해보세요.");
  } catch (err) {
    setStatus("오류: " + err.message, "error");
  } finally {
    micBtn.disabled = false;
  }
}

// ===== UI 렌더링 =====
function addMessage(role, text, correction = "") {
  const div = document.createElement("div");
  div.className = "msg " + (role === "user" ? "user" : "ai");
  div.textContent = text;

  if (role === "ai") {
    const replay = document.createElement("span");
    replay.className = "replay";
    replay.textContent = "🔊 다시 듣기";
    replay.addEventListener("click", () => speak(text));
    div.appendChild(replay);
  }

  if (correction) {
    const c = document.createElement("div");
    c.className = "correction";
    c.textContent = "✍️ " + correction;
    div.appendChild(c);
  }

  chatEl.appendChild(div);
  chatEl.scrollTop = chatEl.scrollHeight;
}

function setStatus(text, kind = "") {
  statusEl.textContent = text;
  statusEl.className = "status" + (kind ? " " + kind : "");
}

// 질문하기 위젯에 최근 대화 내용을 전달
window.getAskContext = function () {
  const recent = messages.slice(-6);
  if (!recent.length) return "";
  return (
    "Recent conversation:\n" +
    recent
      .map((m) => (m.role === "user" ? "Me: " : "Partner: ") + m.content)
      .join("\n")
  );
};

// ===== 시작 인사 =====
window.addEventListener("load", () => {
  const greeting =
    "Welcome! It's great to finally meet you in person. How was your flight over?";
  messages.push({ role: "assistant", content: greeting });
  addMessage("ai", greeting);
  // 자동 재생은 브라우저 정책상 사용자 상호작용 후에만 가능하므로 여기서는 표시만 함
});
