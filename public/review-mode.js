// 전역 복습 모드 토글.
// 켜면 각 프로그램이 새 문장/지문을 생성하지 않고, 이전에 했던 것(복습 저장분)을 다시 낸다.
// window.isReviewMode() 로 각 프로그램에서 상태를 읽는다. (localStorage 로 전 페이지 공유)
(function () {
  const KEY = "review_mode_v1";
  const controls = document.querySelector(".controls");

  let on = false;
  try {
    on = JSON.parse(localStorage.getItem(KEY)) === true;
  } catch {}

  window.isReviewMode = () => on;

  if (controls) {
    const wrap = document.createElement("label");
    wrap.className = "review-toggle";
    wrap.title = "켜면 새 문장 대신 이전에 공부한 것을 다시 냅니다.";
    wrap.innerHTML = `<input type="checkbox" id="reviewModeChk" /> <span>🔁 복습 모드</span>`;
    controls.appendChild(wrap);

    const chk = wrap.querySelector("input");
    chk.checked = on;

    function apply() {
      on = chk.checked;
      localStorage.setItem(KEY, JSON.stringify(on));
      document.body.classList.toggle("review-on", on);
      wrap.classList.toggle("active", on);
    }
    chk.addEventListener("change", apply);
    apply();
  } else {
    document.body.classList.toggle("review-on", on);
  }
})();
