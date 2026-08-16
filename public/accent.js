// 공용 발음(억양) 프리셋.
// 원칙: "그 나라 사람이 영어를 하는 느낌"을 내려면, 네이티브 언어 음성이 아니라
//       실제 '억양이 밴 영어 음성(en-XX)'을 써야 한다.
//       예) 인도 영어 en-IN, 홍콩(중국계) 영어 en-HK, 필리핀 영어 en-PH …
//       일본/남미는 이런 '영어 음성'이 존재하지 않아 억양 근사가 불가능하다.
(function () {
  const sel = document.getElementById("voiceSelect");
  if (!sel) return;

  const KEY = "voice_accent"; // 저장: 선택된 실제 언어코드(loc)
  // 지역별 선호 음성 이름. 여러 브라우저를 대비해 후보를 "순서대로" 시도한다.
  // 미국 표준은 남성 음성 우선: Edge=Brian/Guy/Andrew/Eric, Windows Chrome=David …
  const PREFER = {
    "en-sg": ["wayne"],
    "en-us": ["brian", "guy", "andrew", "eric", "roger", "steffan", "david", "mark"],
  };

  // 각 버튼: 후보 언어코드 목록 (앞에서부터 있는 걸 사용)
  // 전부 en-XX (진짜 영어 음성) — 로컬 언어로 읽지 않고 그 지역 억양의 영어를 읽음
  const PRESETS = [
    { label: "🇺🇸 표준", locs: ["en-US"] },
    { label: "🇬🇧 영국", locs: ["en-GB"] },
    { label: "🇮🇳 인도", locs: ["en-IN"] },
    { label: "🇸🇬 싱가포르", locs: ["en-SG"] },
    { label: "🌏 동남아", locs: ["en-PH", "en-SG", "en-IN"] },
    { label: "🇭🇰 중화권", locs: ["en-HK", "en-SG"] },
    { label: "🇪🇺 유럽", locs: ["en-GB", "en-IE"] },
  ];

  // ===== UI =====
  const wrap = document.createElement("div");
  wrap.className = "accent-group";
  const capt = document.createElement("span");
  capt.className = "accent-caption";
  capt.textContent = "발음";
  wrap.appendChild(capt);

  const btns = document.createElement("div");
  btns.className = "accent-btns";
  wrap.appendChild(btns);

  const buttons = PRESETS.map((p) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = p.label;
    b._locs = p.locs;
    b.addEventListener("click", () => {
      const loc = firstAvailable(p.locs);
      if (loc && applyLoc(loc)) {
        localStorage.setItem(KEY, loc);
        userTouched = false;
        markActiveByLoc(loc);
      }
    });
    btns.appendChild(b);
    return b;
  });

  const label = sel.closest("label") || sel;
  label.parentNode.insertBefore(wrap, label.nextSibling);

  let userTouched = false;
  sel.addEventListener("change", (e) => {
    if (e.isTrusted) {
      userTouched = true;
      buttons.forEach((b) => b.classList.remove("active"));
    }
  });

  // ===== 로직 =====
  function optForLoc(loc) {
    const l = loc.toLowerCase();
    const opts = Array.from(sel.options);
    const prefs = PREFER[l] || [];
    // 선호 음성 후보를 순서대로 찾아 있으면 그걸 사용
    for (const name of prefs) {
      const m = opts.find(
        (o) =>
          o.textContent.toLowerCase().includes(l) &&
          o.textContent.toLowerCase().includes(name)
      );
      if (m) return m;
    }
    // 선호 음성이 없는 브라우저면 그 지역의 첫 음성으로 대체
    return opts.find((o) => o.textContent.toLowerCase().includes(l));
  }
  // 이 지역에 선호(남성) 음성이 이 브라우저에 실제로 있는지
  function hasPref(loc) {
    const l = loc.toLowerCase();
    const opts = Array.from(sel.options);
    return (PREFER[l] || []).some((name) =>
      opts.some(
        (o) =>
          o.textContent.toLowerCase().includes(l) &&
          o.textContent.toLowerCase().includes(name)
      )
    );
  }
  function firstAvailable(locs) {
    for (const loc of locs) if (optForLoc(loc)) return loc;
    return null;
  }
  function applyLoc(loc) {
    const o = optForLoc(loc);
    if (!o) return false;
    sel.value = o.value;
    sel.dispatchEvent(new Event("change")); // 페이지가 selectedVoice 갱신
    return true;
  }
  function currentMatchesLoc(loc) {
    const cur = sel.options[sel.selectedIndex];
    if (!cur) return false;
    const t = cur.textContent.toLowerCase();
    const l = loc.toLowerCase();
    if (!t.includes(l)) return false;
    const prefs = PREFER[l] || [];
    if (!prefs.length) return true;
    // 선호(남성) 음성이 이 브라우저에 없으면 현재 음성을 그대로 인정,
    // 있으면 그중 하나가 현재 선택된 경우에만 일치로 본다.
    if (!hasPref(loc)) return true;
    return prefs.some((name) => t.includes(name));
  }
  function markActiveByLoc(loc) {
    const l = loc.toLowerCase();
    buttons.forEach((b) =>
      b.classList.toggle(
        "active",
        b._locs.some((x) => x.toLowerCase() === l)
      )
    );
  }
  function updateAvailability() {
    buttons.forEach((b) => {
      const ok = !!firstAvailable(b._locs);
      b.disabled = !ok;
      b.title = ok ? "" : "이 브라우저/시스템에 해당 발음 음성이 없습니다";
    });
  }

  function refresh() {
    updateAvailability();
    if (userTouched) return;
    // 저장된 설정이 있으면 그걸, 없으면 기본값 "en-US"(미국 표준·남성 우선) 적용.
    // → PC(Edge/Chrome)에서 처음 열어도 여성 Ava가 아니라 남성 Brian 등이 기본이 된다.
    const saved = localStorage.getItem(KEY);
    const target = saved && optForLoc(saved) ? saved : "en-US";
    if (optForLoc(target)) {
      if (!currentMatchesLoc(target)) applyLoc(target);
      markActiveByLoc(target);
    }
  }

  refresh();
  new MutationObserver(refresh).observe(sel, { childList: true });
  let tries = 0;
  const iv = setInterval(() => {
    refresh();
    if (++tries > 15) clearInterval(iv);
  }, 300);
})();
