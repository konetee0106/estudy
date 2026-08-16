// 쉐도잉한 문장들을 브라우저(localStorage)에 저장/관리하는 공용 모듈
const Library = (function () {
  const KEY = "shadow_library_v1";

  function load() {
    try {
      return JSON.parse(localStorage.getItem(KEY)) || [];
    } catch {
      return [];
    }
  }

  function save(list) {
    localStorage.setItem(KEY, JSON.stringify(list));
  }

  function all() {
    return load();
  }

  function add(sentence, translation) {
    sentence = (sentence || "").trim();
    if (!sentence) return;
    const list = load();
    if (list.some((x) => x.sentence === sentence)) return; // 중복 방지
    list.push({
      sentence,
      translation: (translation || "").trim(),
      ts: Date.now(),
    });
    save(list);
  }

  function remove(sentence) {
    save(load().filter((x) => x.sentence !== sentence));
  }

  function clear() {
    localStorage.removeItem(KEY);
  }

  function count() {
    return load().length;
  }

  return { all, add, remove, clear, count };
})();

// 쓰기/말하기 등에서 "최근 출제된 문제"를 기억하는 공용 모듈.
// 브라우저를 껐다 켜도 유지되어 같은 문제가 반복되는 것을 줄여준다.
const History = (function () {
  const MAX = 60; // 저장 상한

  function key(name) {
    return "history_" + name;
  }

  function all(name) {
    try {
      return JSON.parse(localStorage.getItem(key(name))) || [];
    } catch {
      return [];
    }
  }

  function add(name, item) {
    item = (item || "").trim();
    if (!item) return;
    const list = all(name).filter((x) => x !== item); // 중복 제거 후 맨 뒤로
    list.push(item);
    while (list.length > MAX) list.shift();
    localStorage.setItem(key(name), JSON.stringify(list));
  }

  function recent(name, n = 30) {
    return all(name).slice(-n);
  }

  function clear(name) {
    localStorage.removeItem(key(name));
  }

  return { all, add, recent, clear };
})();

// 복습용 저장소. 프로그램별(shadowing/reading/writing/speaking)로 연습한 항목을 보관.
// 각 항목: { en, ko, title, ts }
const Review = (function () {
  const CATS = ["shadowing", "reading", "writing", "speaking"];
  const MAX = 200; // 카테고리당 상한

  function key(cat) {
    return "review_" + cat;
  }

  function load(cat) {
    try {
      return JSON.parse(localStorage.getItem(key(cat))) || [];
    } catch {
      return [];
    }
  }

  function save(cat, list) {
    localStorage.setItem(key(cat), JSON.stringify(list));
  }

  function all(cat) {
    return load(cat);
  }

  function add(cat, item) {
    const en = (item && item.en ? item.en : "").trim();
    if (!en) return;
    const list = load(cat);
    if (list.some((x) => x.en === en)) return; // 중복 방지 (영어 기준)
    list.push({
      en,
      ko: (item.ko || "").trim(),
      title: (item.title || "").trim(),
      ts: Date.now(),
    });
    while (list.length > MAX) list.shift();
    save(cat, list);
  }

  function remove(cat, en) {
    save(cat, load(cat).filter((x) => x.en !== en));
  }

  function clear(cat) {
    localStorage.removeItem(key(cat));
  }

  function count(cat) {
    return load(cat).length;
  }

  return { CATS, all, add, remove, clear, count };
})();

// 기존 쉐도잉 저장분(Library)을 복습(shadowing)으로 1회 이관
(function migrateShadowingToReview() {
  try {
    if (localStorage.getItem("review_shadowing")) return; // 이미 있음
    const old = Library.all();
    if (!old.length) return;
    old.forEach((x) => Review.add("shadowing", { en: x.sentence, ko: x.translation }));
  } catch {
    /* 무시 */
  }
})();
