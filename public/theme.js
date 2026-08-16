// 공용 테마·레벨 선택. 상단 컨트롤에 드롭다운을 추가하고 localStorage 에 저장한다.
// 각 프로그램은 window.getTheme() / window.getLevel() 로 값을 읽어 서버에 보낸다.
(function () {
  const THEME_KEY = "study_theme";
  const LEVEL_KEY = "study_level";

  const THEMES = [
    { v: "trip_collab", label: "출장/협업" },
    { v: "business", label: "비즈니스" },
    { v: "daily", label: "일상" },
    { v: "mixed", label: "전체 섞기" },
  ];
  const LEVELS = [
    { v: "easy", label: "초급" },
    { v: "intermediate", label: "중급" },
    { v: "advanced", label: "고급" },
  ];

  window.getTheme = function () {
    return localStorage.getItem(THEME_KEY) || "trip_collab";
  };
  window.getLevel = function () {
    return localStorage.getItem(LEVEL_KEY) || "intermediate";
  };

  const controls = document.querySelector(".controls");
  if (!controls) return; // UI 없이도 getter 는 동작

  function makeSelect(id, caption, opts, current, key) {
    const label = document.createElement("label");
    label.className = "theme-sel";
    label.appendChild(document.createTextNode(caption));
    const sel = document.createElement("select");
    sel.id = id;
    opts.forEach((o) => {
      const op = document.createElement("option");
      op.value = o.v;
      op.textContent = o.label;
      if (o.v === current) op.selected = true;
      sel.appendChild(op);
    });
    sel.addEventListener("change", () => localStorage.setItem(key, sel.value));
    label.appendChild(sel);
    return label;
  }

  controls.appendChild(
    makeSelect("themeSel", "테마", THEMES, window.getTheme(), THEME_KEY)
  );
  controls.appendChild(
    makeSelect("levelSel", "레벨", LEVELS, window.getLevel(), LEVEL_KEY)
  );
})();
