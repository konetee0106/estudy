// 공용 속도 조절: 🐢 느리게 / 🐇 빠르게 버튼이 숨겨진 #rate 값을 조절하고
// #speedVal 에 현재 배속을 표시한다. (app.js / shadowing.js 는 #rate.value 를 읽음)
(function () {
  const rate = document.getElementById("rate");
  const val = document.getElementById("speedVal");
  const slower = document.getElementById("slower");
  const faster = document.getElementById("faster");
  if (!rate) return;

  const MIN = 0.5;
  const MAX = 1.5;
  const STEP = 0.1;

  function clamp(v) {
    return Math.min(MAX, Math.max(MIN, Math.round(v * 100) / 100));
  }
  function show() {
    if (val) val.textContent = parseFloat(rate.value).toFixed(1) + "x";
  }
  function set(v) {
    rate.value = clamp(v);
    show();
  }

  if (slower)
    slower.addEventListener("click", () =>
      set(parseFloat(rate.value) - STEP)
    );
  if (faster)
    faster.addEventListener("click", () =>
      set(parseFloat(rate.value) + STEP)
    );

  show();
})();
