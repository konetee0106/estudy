// 봄봄클래스 강의 데이터 빌드 (페이지 기반 정확 분리)
// 각 강의는 PDF 페이지 헤더의 [번호] 마커로 구분되고, 강의의 '첫 페이지'가 본문(대화문/독백)이다.
// 본문만 뽑아 라벨 배치로 Claude에 보내 문장 정리 + 한글 번역 → public/lessons-bombom.json
//
// 사용법: node scripts/build-bombom.mjs           (전체 1~60)
//         node scripts/build-bombom.mjs 21 40     (범위만)
import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { execFileSync } from "child_process";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "..", "public", "lessons-bombom.json");
const SRC_DIR = "C:/Users/kyemy/Desktop/영어공부/봄봄클래스";
const client = new Anthropic();
const MODEL = process.env.BUILD_MODEL || "claude-opus-4-8";

const BOOKS = [
  "봄봄클래스_1개월차_01~20.pdf",
  "봄봄클래스_2개월차_21~40.pdf",
  "봄봄클래스_3개월차_41~60.pdf",
];
const BATCH = 5;

// PDF → Map(전역 강의번호 → 본문 영어 텍스트)
function getLessonTexts(file) {
  const raw = execFileSync("pdftotext", ["-layout", join(SRC_DIR, file), "-"], {
    encoding: "utf8",
  });
  const map = new Map();
  for (const pg of raw.split("\f")) {
    const m = pg.match(/\[(\d{1,2})\]/); // 페이지 헤더의 강의 번호
    if (!m) continue;
    const n = parseInt(m[1], 10);
    const eng = pg
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(
        (l) =>
          /[A-Za-z]{3}/.test(l) &&
          !/youtube|gmail|guideenglish/.test(l) &&
          !l.includes("/") // 끊어읽기 버전 줄 제외
      );
    if (!eng.length) continue;
    if (!map.has(n)) map.set(n, eng.join("\n")); // 첫 페이지 = 본문
  }
  return map;
}

const LINE = {
  type: "object",
  properties: {
    speaker: { type: "string" },
    en: { type: "string" },
    ko: { type: "string" },
  },
  required: ["speaker", "en", "ko"],
  additionalProperties: false,
};
const SCHEMA = {
  type: "object",
  properties: {
    lessons: {
      type: "array",
      items: {
        type: "object",
        properties: {
          lessonNo: { type: "integer", description: "The LESSON NUMBER from the === LESSON N === label." },
          titleKo: { type: "string" },
          type: { type: "string", description: '"dialogue" or "monologue".' },
          lines: { type: "array", items: LINE },
        },
        required: ["lessonNo", "titleKo", "type", "lines"],
        additionalProperties: false,
      },
    },
  },
  required: ["lessons"],
  additionalProperties: false,
};

async function structureBatch(items) {
  // items: [{no, text}]
  const body = items.map((it) => `=== LESSON ${it.no} ===\n${it.text}`).join("\n\n");
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    system:
      "You structure English lesson bodies for Korean learners and translate each sentence into natural Korean.",
    messages: [
      {
        role: "user",
        content:
          `아래에 여러 강의의 '본문'이 "=== LESSON N ===" 라벨로 구분되어 있다. 각 라벨의 본문을 그대로 처리하라(라벨 번호를 lessonNo 로).\n` +
          `각 강의: 본문을 한 문장씩(speaker=대화면 화자 이름, 독백이면 ""), 각 문장을 자연스러운 한국어로 번역(ko), 짧은 한글 제목(titleKo). 독백이면 type="monologue", 대화면 "dialogue".\n` +
          `문장을 지어내지 말고 주어진 본문만 사용하라.\n\n` +
          body,
      },
    ],
    output_config: { format: { type: "json_schema", schema: SCHEMA } },
  });
  const text = res.content.find((b) => b.type === "text")?.text ?? "{}";
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = {};
  }
  return Array.isArray(parsed.lessons) ? parsed.lessons : [];
}

async function main() {
  const lo = process.argv[2] ? parseInt(process.argv[2], 10) : 1;
  const hi = process.argv[3] ? parseInt(process.argv[3], 10) : 60;

  // 모든 책에서 본문 수집
  const texts = new Map();
  for (const file of BOOKS) {
    for (const [n, t] of getLessonTexts(file)) texts.set(n, t);
  }
  const days = [...texts.keys()].filter((n) => n >= lo && n <= hi).sort((a, b) => a - b);
  console.log(`대상 강의: ${days.length}개 (${days[0]}~${days[days.length - 1]})`);

  let existing = [];
  if (existsSync(OUT)) {
    try {
      existing = JSON.parse(readFileSync(OUT, "utf8"));
    } catch {}
  }
  const byDay = new Map(existing.map((l) => [l.day, l]));

  for (let i = 0; i < days.length; i += BATCH) {
    const chunk = days.slice(i, i + BATCH).map((no) => ({ no, text: texts.get(no) }));
    process.stdout.write(`  ${chunk[0].no}~${chunk[chunk.length - 1].no} 처리 중… `);
    let lessons = [];
    try {
      lessons = await structureBatch(chunk);
    } catch (e) {
      console.log("실패:", e.message);
      continue;
    }
    for (const l of lessons) {
      const day = l.lessonNo;
      if (!Number.isInteger(day)) continue;
      byDay.set(day, {
        day,
        title: l.titleKo || `Lesson ${day}`,
        titleKo: l.titleKo || `${day}강`,
        type: l.type === "monologue" ? "monologue" : "dialogue",
        audio: "",
        lines: (l.lines || []).map((x) => ({
          speaker: String(x.speaker || ""),
          en: String(x.en || "").trim(),
          ko: String(x.ko || "").trim(),
        })),
      });
    }
    console.log(`✅ ${lessons.length}강`);
    // 배치마다 저장 (중간에 끊겨도 진행분 보존)
    const partial = Array.from(byDay.values()).sort((a, b) => a.day - b.day);
    writeFileSync(OUT, JSON.stringify(partial, null, 2), "utf8");
  }

  const all = Array.from(byDay.values()).sort((a, b) => a.day - b.day);
  writeFileSync(OUT, JSON.stringify(all, null, 2), "utf8");
  const missing = [];
  for (let i = 1; i <= 60; i++) if (!all.find((l) => l.day === i)) missing.push(i);
  console.log(`\n저장 완료: 총 ${all.length}강 | 누락: ${missing.length ? missing.join(",") : "없음"}`);
}
main();
