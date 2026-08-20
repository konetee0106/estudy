// 봄봄클래스 강의 데이터 빌드 스크립트
// PDF(귀뚫기챌린지 강의자료)에서 영어 본문을 추출 → Claude로 문장 정리 + 한글 번역
//   → public/lessons-guiddulki.json 생성
//
// 사용법 (english-conversation-app 폴더에서):
//   node scripts/build-bombom.mjs
//   node scripts/build-bombom.mjs 11 12 13   ← 특정 일차만 (추가할 때)
//
// 필요: .env 에 ANTHROPIC_API_KEY. PDF 폴더 경로는 아래 SRC_DIR.
import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { execFileSync } from "child_process";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_DIR = join(__dirname, "..");
const OUT = join(APP_DIR, "public", "lessons-guiddulki.json");
// 강의 PDF/MP3 폴더
const SRC_DIR = "C:/Users/kyemy/Desktop/영어공부/귀뚫기챌린지";

const client = new Anthropic();
const MODEL = process.env.BUILD_MODEL || "claude-opus-4-8";

const LESSON_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "Short English title for the lesson topic." },
    titleKo: { type: "string", description: "짧은 한국어 제목." },
    type: { type: "string", description: '"monologue" or "dialogue".' },
    lines: {
      type: "array",
      description:
        "The lesson body, cleaned into the ORIGINAL sentences in order. Remove OCR duplicates/garbage fragments. One natural sentence per item.",
      items: {
        type: "object",
        properties: {
          speaker: {
            type: "string",
            description: 'Speaker name for a dialogue turn, or "" for monologue / continuation.',
          },
          en: { type: "string", description: "One English sentence (no speaker prefix)." },
          ko: { type: "string", description: "Natural Korean translation of this sentence." },
        },
        required: ["speaker", "en", "ko"],
        additionalProperties: false,
      },
    },
  },
  required: ["title", "titleKo", "type", "lines"],
  additionalProperties: false,
};

function extractEnglish(day) {
  const pdf = join(SRC_DIR, `${day}일차_강의자료.pdf`);
  if (!existsSync(pdf)) return null;
  let raw;
  try {
    raw = execFileSync("pdftotext", ["-layout", pdf, "-"], { encoding: "utf8" });
  } catch (e) {
    console.error(`  pdftotext 실패 (${day}일차):`, e.message);
    return null;
  }
  // "Let's Learn More" 앞까지, 영어 줄만, 슬래시(끊어읽기) 버전 제거
  const lines = raw.split(/\r?\n/);
  const out = [];
  for (const line of lines) {
    if (/Let.?s Learn More/.test(line)) break;
    const t = line.trim();
    if (!/[A-Za-z]{3}/.test(t)) continue; // 영어 없는 줄(한글/빈줄) 제외
    if (t.includes("/")) continue; // 끊어읽기 버전 제외
    if (/youtube|gmail|guideenglish|^</.test(t)) continue;
    out.push(t);
  }
  return out.join("\n");
}

async function buildLesson(day) {
  const rawEn = extractEnglish(day);
  if (!rawEn) return null;
  const hasAudio = existsSync(join(SRC_DIR, `${day}일차_원어민음원.mp3`));

  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    system:
      "You clean and structure English lesson transcripts for Korean learners, and translate each sentence into natural Korean.",
    messages: [
      {
        role: "user",
        content:
          `아래는 영어 회화 강의(${day}일차)의 본문을 PDF에서 추출한 것이다. ` +
          `OCR 과정에서 문장 끝부분이 중복되거나 순서가 살짝 섞였을 수 있다. ` +
          `원래의 문장들을 순서대로 깨끗하게 복원하고(중복·잡음 제거), 대화문이면 화자 이름을 유지하고 독백이면 speaker를 ""로 둔다. ` +
          `한 항목에 자연스러운 문장 하나씩. 각 문장을 자연스러운 한국어로 번역하라.\n\n` +
          `원문:\n${rawEn}`,
      },
    ],
    output_config: { format: { type: "json_schema", schema: LESSON_SCHEMA } },
  });
  const text = res.content.find((b) => b.type === "text")?.text ?? "{}";
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = {};
  }
  const lines = Array.isArray(parsed.lines) ? parsed.lines : [];
  if (!lines.length) {
    console.error(`  ${day}일차: 문장 없음`);
    return null;
  }
  return {
    day,
    title: parsed.title || `Day ${day}`,
    titleKo: parsed.titleKo || `${day}일차`,
    type: parsed.type === "dialogue" ? "dialogue" : "monologue",
    audio: hasAudio ? `audio/${day}일차_원어민음원.mp3` : "",
    lines: lines.map((l) => ({
      speaker: String(l.speaker || ""),
      en: String(l.en || "").trim(),
      ko: String(l.ko || "").trim(),
    })),
  };
}

async function main() {
  const args = process.argv.slice(2).map((n) => parseInt(n, 10)).filter(Boolean);
  const days = args.length ? args : Array.from({ length: 10 }, (_, i) => i + 1);

  // 기존 데이터 로드 (특정 일차만 다시 빌드할 때 병합)
  let existing = [];
  if (existsSync(OUT)) {
    try {
      existing = JSON.parse(readFileSync(OUT, "utf8"));
    } catch {}
  }
  const byDay = new Map(existing.map((l) => [l.day, l]));

  for (const day of days) {
    process.stdout.write(`${day}일차 처리 중… `);
    const lesson = await buildLesson(day);
    if (lesson) {
      byDay.set(day, lesson);
      console.log(`✅ ${lesson.lines.length}문장 (${lesson.type})`);
    } else {
      console.log("건너뜀");
    }
  }

  const all = Array.from(byDay.values()).sort((a, b) => a.day - b.day);
  writeFileSync(OUT, JSON.stringify(all, null, 2), "utf8");
  console.log(`\n저장 완료: ${OUT} (총 ${all.length}강)`);
}
main();
