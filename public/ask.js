// 모든 페이지에 뜨는 "💬 질문하기" 위젯.
// 각 페이지가 window.getAskContext() 를 정의해두면 현재 학습 내용을 함께 보낸다.
(function () {
  const askHistory = []; // {role, content}

  // ===== UI 생성 =====
  const btn = document.createElement("button");
  btn.id = "askBtn";
  btn.className = "ask-fab";
  btn.textContent = "💬 질문하기";
  btn.title = "모르는 단어·문법·해석을 물어보세요";

  const panel = document.createElement("div");
  panel.id = "askPanel";
  panel.className = "ask-panel";
  panel.innerHTML = `
    <div class="ask-resize" id="askResize" title="드래그해서 창 크기 조절"></div>
    <div class="ask-head">
      <span>💬 질문하기</span>
      <button id="askClose" class="ask-close" title="닫기">✕</button>
    </div>
    <div id="askLog" class="ask-log"></div>
    <form id="askForm" class="ask-form">
      <textarea id="askInput" rows="2" placeholder="예: 'get over' 무슨 뜻이야? / 이 문장 해석해줘 (Enter=전송)"></textarea>
      <button type="submit" id="askSend">전송</button>
    </form>
  `;

  document.body.appendChild(btn);
  document.body.appendChild(panel);

  const askLog = panel.querySelector("#askLog");
  const askForm = panel.querySelector("#askForm");
  const askInput = panel.querySelector("#askInput");
  const askClose = panel.querySelector("#askClose");
  const askResize = panel.querySelector("#askResize");

  // ===== 크기 조절 (왼쪽 위 모서리 드래그) =====
  const SIZE_KEY = "ask_panel_size";
  const MIN_W = 320;
  const MIN_H = 380;

  // 저장된 크기 복원
  try {
    const saved = JSON.parse(localStorage.getItem(SIZE_KEY) || "null");
    if (saved && saved.w && saved.h) {
      panel.style.width = saved.w + "px";
      panel.style.height = saved.h + "px";
    }
  } catch {
    /* 무시 */
  }

  let resizing = false;
  let startX = 0;
  let startY = 0;
  let startW = 0;
  let startH = 0;

  askResize.addEventListener("pointerdown", (e) => {
    resizing = true;
    const r = panel.getBoundingClientRect();
    startX = e.clientX;
    startY = e.clientY;
    startW = r.width;
    startH = r.height;
    askResize.setPointerCapture(e.pointerId);
    e.preventDefault();
  });

  askResize.addEventListener("pointermove", (e) => {
    if (!resizing) return;
    const maxW = window.innerWidth - 40;
    const maxH = window.innerHeight - 40;
    // 오른쪽 아래에 고정돼 있으므로, 위·왼쪽으로 드래그하면 커진다
    let w = startW + (startX - e.clientX);
    let h = startH + (startY - e.clientY);
    w = Math.max(MIN_W, Math.min(maxW, w));
    h = Math.max(MIN_H, Math.min(maxH, h));
    panel.style.width = w + "px";
    panel.style.height = h + "px";
  });

  function endResize(e) {
    if (!resizing) return;
    resizing = false;
    try {
      askResize.releasePointerCapture(e.pointerId);
    } catch {
      /* 무시 */
    }
    // 크기 저장
    const r = panel.getBoundingClientRect();
    localStorage.setItem(
      SIZE_KEY,
      JSON.stringify({ w: Math.round(r.width), h: Math.round(r.height) })
    );
  }
  askResize.addEventListener("pointerup", endResize);
  askResize.addEventListener("pointercancel", endResize);

  // 첫 안내 메시지
  addMsg(
    "ai",
    "안녕하세요! 공부하다가 모르는 단어, 문법, 해석 등을 물어보세요. 지금 보고 있는 화면 내용도 제가 참고합니다. 😊"
  );

  // ===== 열고 닫기 =====
  function openPanel() {
    panel.classList.add("open");
    btn.classList.add("hidden");
    // 화면에서 텍스트를 선택해둔 게 있으면 입력창에 미리 채워줌
    const sel = window.getSelection?.().toString().trim();
    if (sel && !askInput.value) askInput.value = sel + " ";
    askInput.focus();
  }
  function closePanel() {
    panel.classList.remove("open");
    btn.classList.remove("hidden");
  }
  btn.addEventListener("click", openPanel);
  askClose.addEventListener("click", closePanel);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && panel.classList.contains("open")) closePanel();
  });

  // ===== 전송 =====
  askInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      askForm.requestSubmit
        ? askForm.requestSubmit()
        : askForm.dispatchEvent(new Event("submit", { cancelable: true }));
    }
  });

  askForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const q = askInput.value.trim();
    if (!q) return;
    askInput.value = "";
    addMsg("user", q);
    askHistory.push({ role: "user", content: q });

    const thinking = addMsg("ai", "생각 중…");

    let context = "";
    try {
      if (typeof window.getAskContext === "function") {
        context = String(window.getAskContext() || "");
      }
    } catch {
      context = "";
    }

    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, context, history: askHistory }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `서버 오류 (${res.status})`);
      }
      const data = await res.json();
      const answer = data.answer || "(답변 없음)";
      thinking.textContent = answer;
      askHistory.push({ role: "assistant", content: answer });
      if (askHistory.length > 16) askHistory.splice(0, askHistory.length - 16);
    } catch (err) {
      thinking.textContent = "오류: " + err.message;
    }
    askLog.scrollTop = askLog.scrollHeight;
  });

  function addMsg(role, text) {
    const div = document.createElement("div");
    div.className = "ask-msg " + (role === "user" ? "user" : "ai");
    div.textContent = text;
    askLog.appendChild(div);
    askLog.scrollTop = askLog.scrollHeight;
    return div;
  }
})();
