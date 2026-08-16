// 공용 발음(억양) 프리셋.
// 원칙: "그 나라 사람이 영어를 하는 느낌"을 내려면, 네이티브 언어 음성이 아니라
//       실제 '억양이 밴 영어 음성(en-XX)'을 써야 한다.
//       예) 인도 영어 en-IN, 홍콩(중국계) 영어 en-HK, 필리핀 영어 en-PH …
//       일본/남미는 이런 '영어 음성'이 존재하지 않아 억양 근사가 불가능하다.
(function () {
  const sel = document.getElementById("voiceSelect");
  if (!sel) return;

  const KEY = "voice_accent"; // 저장: 선택된 실제 언어코드(loc)
  const PREFER = { "en-sg": "wayne", "en-us": "brian" }; // 특정 지역 선호 음성 이름

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
    const pref = PREFER[l];
    if (pref) {
      const m = opts.find(
        (o) =>
          o.textContent.toLowerCase().includes(l) &&
          o.textContent.toLowerCase().includes(pref)
      );
      if (m) return m;
    }
    return opts.find((o) => o.textContent.toLowerCase().includes(l));
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
    const pref = PREFER[l];
    return t.includes(l) && (!pref || t.includes(pref));
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
    const saved = localStorage.getItem(KEY);
    if (saved && optForLoc(saved)) {
      if (!currentMatchesLoc(saved)) applyLoc(saved);
      markActiveByLoc(saved);
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
