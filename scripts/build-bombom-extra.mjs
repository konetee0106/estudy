// 봄봄클래스 "핵심표현(중요 문장)" + "(Q)/(A) 묻고 답하기"를 PDF에서 추출해
// 기존 public/lessons-bombom.json 의 각 강의에 keyExpressions / qa 필드로 병합한다.
// 사용법: node scripts/build-bombom-extra.mjs   (전체)
//         node scripts/build-bombom-extra.mjs 1 (1개월차만)
import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { execFileSync } from "child_process";
import { readFileSync, writeFileSync } from "fs";
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

// PDF → Map(전역 강의번호 → 그 강의 전체 영어 텍스트[본문+핵심표현+Q&A, 슬래시 제외])
function getLessonRaw(file) {
  const raw = execFileSync("pdftotext", ["-layout", join(SRC_DIR, file), "-"], {
    encoding: "utf8",
  });
  const map = new Map();
  for (const pg of raw.split("\f")) {
    const m = pg.match(/\[(\d{1,2})\]/);
    if (!m) continue;
    const n = parseInt(m[1], 10);
    const eng = pg
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(
        (l) =>
          /[A-Za-z]{3}/.test(l) &&
          !l.includes("/") &&
          !/youtube|gmail|guideenglish/.test(l)
      );
    if (!eng.length) continue;
    map.set(n, (map.get(n) || "") + "\n" + eng.join("\n"));
  }
  return map;
}

const EX = {
  type: "object",
  properties: { en: { type: "string" }, ko: { type: "string" } },
  required: ["en", "ko"],
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
          lessonNo: { type: "integer" },
          keyExpressions: {
            type: "array",
            description: "핵심표현: 각 패턴과 예문들.",
            items: {
              type: "object",
              properties: {
                pattern: { type: "string", description: "The expression/pattern, e.g. 'help A with B'." },
                meaning: { type: "string", description: "패턴의 한국어 뜻/설명 (짧게)." },
                examples: { type: "array", items: EX },
              },
              required: ["pattern", "meaning", "examples"],
              additionalProperties: false,
            },
          },
          qa: {
            type: "array",
            description: "묻고 답하기: 질문과 예시 답변들.",
            items: {
              type: "object",
              properties: {
                q: { type: "string", description: "English question." },
                qKo: { type: "string", description: "질문의 한국어 번역." },
                answers: { type: "array", items: EX, description: "예시 답변들." },
              },
              required: ["q", "qKo", "answers"],
              additionalProperties: false,
            },
          },
        },
        required: ["lessonNo", "keyExpressions", "qa"],
        additionalProperties: false,
      },
    },
  },
  required: ["lessons"],
  additionalProperties: false,
};

async function extractBatch(items) {
  const body = items.map((it) => `=== LESSON ${it.no} ===\n${it.text}`).join("\n\n");
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    system:
      "You extract the '핵심표현(key expressions)' and '(Q)/(A) speaking practice' from English lesson materials for Korean learners, and translate everything into natural Korean. Ignore the main dialogue/monologue passage.",
    messages: [
      {
        role: "user",
        content:
          `아래에 여러 강의 자료가 "=== LESSON N ===" 라벨로 있다. 각 강의에서 두 가지만 뽑아라(라벨 번호를 lessonNo로):\n` +
          `1) 핵심표현(keyExpressions): 문법 패턴/표현(pattern)과 그 예문들(examples). 패턴의 한국어 뜻(meaning)도. 보통 'help A with B : ...' 뒤에 예문 2~3개가 나온다.\n` +
          `2) 묻고 답하기(qa): '(Q)'로 시작하는 질문과 '(A)' 및 그 아래 예시 답변들(answers).\n` +
          `본문(대화문/독백)은 무시하라. 깨진 한글 조각은 버려라. 모든 영어에 자연스러운 한국어 번역을 붙여라.\n\n` +
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
  const monthArg = process.argv[2] ? parseInt(process.argv[2], 10) : null;
  const books = monthArg ? [BOOKS[monthArg - 1]] : BOOKS;

  const texts = new Map();
  for (const file of books) for (const [n, t] of getLessonRaw(file)) texts.set(n, t);

  const data = JSON.parse(readFileSync(OUT, "utf8"));
  const byDay = new Map(data.map((l) => [l.day, l]));

  const days = [...texts.keys()].sort((a, b) => a - b);
  for (let i = 0; i < days.length; i += BATCH) {
    const chunk = days.slice(i, i + BATCH).map((no) => ({ no, text: texts.get(no) }));
    process.stdout.write(`  ${chunk[0].no}~${chunk[chunk.length - 1].no} … `);
    let lessons = [];
    try {
      lessons = await extractBatch(chunk);
    } catch (e) {
      console.log("실패:", e.message);
      continue;
    }
    for (const l of lessons) {
      const day = l.lessonNo;
      const target = byDay.get(day);
      if (!target) continue;
      target.keyExpressions = Array.isArray(l.keyExpressions) ? l.keyExpressions : [];
      target.qa = Array.isArray(l.qa) ? l.qa : [];
    }
    console.log(`✅ ${lessons.length}강`);
    // 배치마다 저장
    writeFileSync(OUT, JSON.stringify([...byDay.values()].sort((a, b) => a.day - b.day), null, 2), "utf8");
  }
  const all = [...byDay.values()].sort((a, b) => a.day - b.day);
  const withKE = all.filter((l) => l.keyExpressions && l.keyExpressions.length).length;
  const withQA = all.filter((l) => l.qa && l.qa.length).length;
  console.log(`\n완료: 핵심표현 ${withKE}강, 묻고답하기 ${withQA}강 / 총 ${all.length}강`);
}
main();
