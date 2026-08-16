// ===== 상태 =====
let enVoices = [];
let selectedVoice = null;
let koVoice = null; // 한글 번역 읽기용
let warmedUp = false;

let currentCat = "shadowing"; // shadowing | reading | writing | speaking
let revealAll = false; // 쓰기/말하기 복습에서 영어 전체 보기 여부
const revealedItems = new Set(); // 개별 항목 영어 공개 (en 기준)
const RECALL_CATS = ["writing", "speaking"]; // 한글→영어 떠올리기 방식 탭
let playing = false;
let token = 0; // 정지/재시작 시 예약 콜백 무효화
let loopTimer = null;
let order = []; // 재생 순서(인덱스 배열)
let pos = 0; // order 상의 현재 위치

const CAT_LABEL = {
  shadowing: "👂 쉐도잉",
  reading: "📖 읽기",
  writing: "✍️ 쓰기",
  speaking: "🗣️ 말하기",
};

// ===== DOM =====
const voiceSelect = document.getElementById("voiceSelect");
const rateInput = document.getElementById("rate");
const tabsEl = document.getElementById("reviewTabs");
const tabBtns = tabsEl.querySelectorAll("button");
const playAllBtn = document.getElementById("playAllBtn");
const revealBtn = document.getElementById("revealBtn");
const gapSelect = document.getElementById("gapSelect");
const readKoEl = document.getElementById("readKo");
const shuffleEl = document.getElementById("shuffle");
const listEl = document.getElementById("list");
const listCountEl = document.getElementById("listCount");
const clearBtn = document.getElementById("clearBtn");
const statusEl = document.getElementById("status");

// ===== 음성 로드 =====
function loadVoices() {
  const all = window.speechSynthesis.getVoices();
  enVoices = all.filter((v) => v.lang.startsWith("en"));
  koVoice = all.find((v) => v.lang.startsWith("ko")) || null;

  voiceSelect.innerHTML = "";
  enVoices.forEach((v, i) => {
    const opt = document.createElement("option");
    opt.value = i;
    opt.textContent = `${v.name} (${v.lang})`;
    voiceSelect.appendChild(opt);
  });
  const preferred = Math.max(
    0,
    enVoices.findIndex((v) => /en-US/i.test(v.lang))
  );
  voiceSelect.value = preferred;
  selectedVoice = enVoices[preferred] || null;

  if (!koVoice) {
    readKoEl.checked = false;
    readKoEl.disabled = true;
    readKoEl.parentElement.title =
      "이 브라우저/시스템에 한국어 음성이 없어 번역 읽기를 사용할 수 없습니다.";
  }
}

if ("speechSynthesis" in window) {
  loadVoices();
  window.speechSynthesis.onvoiceschanged = loadVoices;
} else {
  setStatus("이 브라우저는 음성 출력을 지원하지 않습니다.", "error");
  playAllBtn.disabled = true;
}

voiceSelect.addEventListener("change", () => {
  selectedVoice = enVoices[voiceSelect.value] || null;
});

function warmUpSpeech() {
  if (warmedUp || !("speechSynthesis" in window)) return;
  warmedUp = true;
  const u = new SpeechSynthesisUtterance(" ");
  u.volume = 0;
  if (selectedVoice) u.voice = selectedVoice;
  window.speechSynthesis.speak(u);
}

// ===== 탭 =====
tabBtns.forEach((b) => {
  b.addEventListener("click", () => {
    stopPlayback();
    currentCat = b.dataset.cat;
    revealAll = false;
    revealedItems.clear();
    tabBtns.forEach((x) => x.classList.toggle("active", x === b));
    renderList();
  });
});

// 영어 전체 보기/숨기기 토글 (쓰기/말하기 탭에서만 노출)
revealBtn.addEventListener("click", () => {
  revealAll = !revealAll;
  renderList();
});

// ===== 목록 렌더링 =====
function items() {
  return typeof Review !== "undefined" ? Review.all(currentCat) : [];
}

function renderList() {
  const list = items();
  const recall = RECALL_CATS.includes(currentCat);

  listCountEl.textContent = `${CAT_LABEL[currentCat]} · ${list.length}개`;
  // 영어 전체 보기 토글은 쓰기/말하기에서만
  revealBtn.style.display = recall && list.length ? "" : "none";
  revealBtn.textContent = revealAll ? "🙈 영어 숨기기" : "👁️ 영어+한글 보기";
  listEl.innerHTML = "";

  if (list.length === 0) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = `아직 ${CAT_LABEL[currentCat]} 복습 항목이 없습니다. 해당 프로그램에서 연습하면 여기에 쌓입니다.`;
    listEl.appendChild(li);
    playAllBtn.disabled = true;
    return;
  }
  playAllBtn.disabled = false;

  list.forEach((item, i) => {
    const li = document.createElement("li");
    li.className = "listen-item";
    li.dataset.index = i;

    const main = document.createElement("div");
    main.className = "item-main";

    if (item.title) {
      const t = document.createElement("div");
      t.className = "item-title";
      t.textContent = item.title;
      main.appendChild(t);
    }

    if (recall) {
      // 쓰기/말하기 복습: 한글(문제)을 먼저 보여주고, 영어(정답)는 숨김/공개
      const revealed = revealAll || revealedItems.has(item.en);

      if (item.ko) {
        const ko = document.createElement("div");
        ko.className = "item-prompt";
        ko.textContent = preview(item.ko, 220);
        main.appendChild(ko);
      }

      if (revealed) {
        const en = document.createElement("div");
        en.className = "item-answer";
        en.textContent = preview(item.en, 220);
        main.appendChild(en);
      } else {
        const rb = document.createElement("button");
        rb.className = "reveal-one";
        rb.textContent = "👁️ 영어 정답 보기";
        rb.addEventListener("click", () => {
          revealedItems.add(item.en);
          renderList();
        });
        main.appendChild(rb);
      }
    } else {
      // 쉐도잉/읽기: 영어 먼저, 한글 아래
      const en = document.createElement("div");
      en.className = "item-en";
      en.textContent = preview(item.en, 220);
      main.appendChild(en);

      if (item.ko) {
        const ko = document.createElement("div");
        ko.className = "item-ko";
        ko.textContent = preview(item.ko, 220);
        main.appendChild(ko);
      }
    }

    const btns = document.createElement("div");
    btns.className = "item-btns";

    const playOne = document.createElement("button");
    playOne.className = "icon-btn";
    playOne.textContent = "🔊";
    playOne.title = "이 항목만 듣기";
    playOne.addEventListener("click", () => {
      stopPlayback();
      warmUpSpeech();
      const t = ++token;
      speakItem(item, t, () => {});
    });

    const del = document.createElement("button");
    del.className = "icon-btn";
    del.textContent = "🗑️";
    del.title = "삭제";
    del.addEventListener("click", () => {
      Review.remove(currentCat, item.en);
      renderList();
    });

    btns.appendChild(playOne);
    btns.appendChild(del);

    li.appendChild(main);
    li.appendChild(btns);
    listEl.appendChild(li);
  });
}

function preview(text, n) {
  text = (text || "").replace(/\n/g, " ");
  return text.length > n ? text.slice(0, n) + "…" : text;
}

function highlight(orderPos) {
  document
    .querySelectorAll(".listen-item.now")
    .forEach((el) => el.classList.remove("now"));
  if (orderPos == null) return;
  const itemIndex = order[orderPos];
  const el = listEl.querySelector(`.listen-item[data-index="${itemIndex}"]`);
  if (el) {
    el.classList.add("now");
    el.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
}

// ===== 재생 엔진 =====
// 긴 지문은 문장 단위로 쪼개 재생(브라우저의 긴 발화 끊김 방지)
function splitSentences(text) {
  const parts = (text || "")
    .replace(/\n+/g, " ")
    .match(/[^.!?]+[.!?]*/g);
  return parts ? parts.map((s) => s.trim()).filter(Boolean) : [text];
}

function speakParts(parts, myToken, onDone) {
  if (!("speechSynthesis" in window) || parts.length === 0) {
    onDone && onDone();
    return;
  }
  const synth = window.speechSynthesis;
  synth.cancel();
  setTimeout(() => {
    if (myToken !== token) return;
    // 희생용 발화(시작 잘림 방지)
    const primer = new SpeechSynthesisUtterance("hello");
    primer.volume = 0.05;
    primer.rate = 1;
    if (selectedVoice) primer.voice = selectedVoice;
    primer.lang = selectedVoice ? selectedVoice.lang : "en-US";
    synth.speak(primer);

    let last = null;
    parts.forEach((p) => {
      const u = new SpeechSynthesisUtterance(p.text);
      const v = p.lang === "ko" ? koVoice : selectedVoice;
      if (v) u.voice = v;
      u.lang = v ? v.lang : p.lang === "ko" ? "ko-KR" : "en-US";
      u.rate = parseFloat(rateInput.value) || 0.9;
      synth.speak(u);
      last = u;
    });
    if (last) {
      last.onend = () => onDone && onDone();
      last.onerror = () => onDone && onDone();
    } else {
      onDone && onDone();
    }
  }, 100);
}

function speakItem(item, myToken, onDone) {
  const parts = splitSentences(item.en).map((t) => ({ text: t, lang: "en" }));
  if (readKoEl.checked && koVoice && item.ko) {
    parts.push({ text: item.ko.replace(/\n+/g, " "), lang: "ko" });
  }
  speakParts(parts, myToken, onDone);
}

function buildOrder(n) {
  const arr = Array.from({ length: n }, (_, i) => i);
  if (shuffleEl.checked) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }
  return arr;
}

function startPlayback() {
  const list = items();
  if (list.length === 0) {
    setStatus("복습할 항목이 없습니다.");
    return;
  }
  playing = true;
  token++;
  order = buildOrder(list.length);
  pos = 0;
  warmUpSpeech();
  updatePlayBtn();
  setStatus(`🎧 ${CAT_LABEL[currentCat]} 전체 반복 재생 중… (다시 누르면 멈춤)`);
  playAt(token);
}

function playAt(myToken) {
  if (myToken !== token || !playing) return;
  const list = items();
  if (list.length === 0) {
    stopPlayback();
    return;
  }
  if (pos >= order.length) {
    order = buildOrder(list.length); // 한 바퀴 끝 → 다시
    pos = 0;
  }
  const itemIndex = order[pos];
  const item = list[itemIndex];
  if (!item) {
    pos++;
    playAt(myToken);
    return;
  }
  highlight(pos);
  speakItem(item, myToken, () => {
    if (myToken !== token || !playing) return;
    const gap = parseInt(gapSelect.value, 10) || 1000;
    loopTimer = setTimeout(() => {
      if (myToken !== token || !playing) return;
      pos++;
      playAt(myToken);
    }, gap);
  });
}

function stopPlayback() {
  playing = false;
  token++;
  clearTimeout(loopTimer);
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  highlight(null);
  updatePlayBtn();
}

function updatePlayBtn() {
  playAllBtn.textContent = playing ? "⏸️ 정지" : "▶️ 전체 반복 재생";
  playAllBtn.classList.toggle("active", playing);
}

// ===== 이벤트 =====
playAllBtn.addEventListener("click", () => {
  if (playing) {
    stopPlayback();
    setStatus("재생을 멈췄습니다.");
  } else {
    startPlayback();
  }
});

clearBtn.addEventListener("click", () => {
  if (Review.count(currentCat) === 0) return;
  if (confirm(`${CAT_LABEL[currentCat]} 복습 항목을 모두 삭제할까요?`)) {
    stopPlayback();
    Review.clear(currentCat);
    renderList();
    setStatus("모두 삭제했습니다.");
  }
});

function setStatus(text, kind = "") {
  statusEl.textContent = text;
  statusEl.className = "status" + (kind ? " " + kind : "");
}

// ===== 시작 =====
renderList();
