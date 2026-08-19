import express from "express";
import dotenv from "dotenv";
import Anthropic from "@anthropic-ai/sdk";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));

if (!process.env.ANTHROPIC_API_KEY) {
  console.error(
    "\n[오류] ANTHROPIC_API_KEY 가 설정되지 않았습니다.\n" +
      "  .env 파일을 만들고 아래처럼 키를 넣어주세요:\n" +
      "    ANTHROPIC_API_KEY=sk-ant-...\n"
  );
  process.exit(1);
}

const client = new Anthropic(); // ANTHROPIC_API_KEY 를 환경변수에서 자동으로 읽음
const MODEL = process.env.CLAUDE_MODEL || "claude-opus-4-8";
// 과외(Daily English Teacher)는 주고받는 대화라 속도가 중요 → 기본은 더 빠른 Sonnet.
// (환경변수 TEACHER_MODEL 로 바꿀 수 있음)
const TEACHER_MODEL = process.env.TEACHER_MODEL || "claude-sonnet-5";

const app = express();
app.use(express.json({ limit: "1mb" }));

// ===== 접근 암호 (배포 시 보호) =====
// 환경변수 APP_PASSWORD 가 설정돼 있으면, 그 암호를 입력해야 앱에 들어갈 수 있다.
// (로컬 개발에서는 APP_PASSWORD 를 비워두면 잠금 없이 바로 사용 가능)
const APP_PASSWORD = process.env.APP_PASSWORD;
if (APP_PASSWORD) {
  app.use((req, res, next) => {
    const header = req.headers.authorization || "";
    const [scheme, encoded] = header.split(" ");
    if (scheme === "Basic" && encoded) {
      const decoded = Buffer.from(encoded, "base64").toString("utf8");
      const pass = decoded.slice(decoded.indexOf(":") + 1);
      // 길이가 다르면 즉시 실패, 같으면 상수시간 비교
      if (
        pass.length === APP_PASSWORD.length &&
        (() => {
          let diff = 0;
          for (let i = 0; i < pass.length; i++)
            diff |= pass.charCodeAt(i) ^ APP_PASSWORD.charCodeAt(i);
          return diff === 0;
        })()
      ) {
        return next();
      }
    }
    res.set("WWW-Authenticate", 'Basic realm="estudy", charset="UTF-8"');
    return res.status(401).send("인증이 필요합니다. (Authentication required)");
  });
  console.log("[보안] APP_PASSWORD 가 설정되어 접근 암호가 활성화되었습니다.");
}

app.use(express.static(join(__dirname, "public")));

// 대화 상대(튜터) 역할 — 테마별 상황
const CHAT_SCENE = {
  trip_collab:
    "The learner is on an OVERSEAS BUSINESS TRIP: the airport, immigration, taxis, hotels, restaurants abroad, getting around a foreign city, and meeting business partners face to face (office/factory visits, in-person negotiations, business dinners, small talk). Play the role that fits — a hotel receptionist, taxi driver, restaurant server, or (most often) the overseas partner/host.",
  business:
    "The learner works with overseas partners to develop and make products: meetings, video calls, product specs, samples, suppliers, schedules, negotiations. Play the role of a friendly overseas colleague or business partner.",
  daily:
    "The conversation is about everyday life: hobbies, food, weekend plans, family, travel, movies, small daily situations. Play the role of a friendly acquaintance chatting casually.",
  mixed:
    "The conversation can be about overseas business trips, working with partners, or everyday life — whatever feels natural. Play whatever role fits the situation.",
};

function systemPromptForTheme(theme) {
  const scene = CHAT_SCENE[theme] || CHAT_SCENE.trip_collab;
  return `You are a warm, encouraging English conversation partner for a Korean learner.
${scene}
Have a natural spoken conversation so the learner can practice practical, real-world English.

Rules:
- Keep your reply short and conversational — 1 to 3 sentences, like real spoken English. It will be read aloud by text-to-speech, so avoid lists, markdown, emoji, or symbols.
- Stay in the situation described above. Light small talk is welcome.
- Speak at a level slightly above the learner's, but stay clear and natural.
- Always keep the conversation going: react to what they said, then ask a follow-up question.
- If the learner made a meaningful grammar or word-choice mistake, give one short correction of their most important error. If their English was fine, leave the correction empty.
- Never lecture. Be friendly and patient.`;
}

// 응답을 { reply, correction } 구조로 강제
const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    reply: {
      type: "string",
      description:
        "Your spoken conversational reply (1-3 sentences, no markdown/symbols).",
    },
    correction: {
      type: "string",
      description:
        "A short, gentle correction of the learner's most important mistake, or an empty string if there was none. Format like: \"You said 'X' — a more natural way is 'Y'.\"",
    },
  },
  required: ["reply", "correction"],
  additionalProperties: false,
};

app.post("/api/chat", async (req, res) => {
  try {
    const history = Array.isArray(req.body?.messages) ? req.body.messages : [];

    // 안전하게 role/content 만 추출
    const messages = history
      .filter((m) => m && (m.role === "user" || m.role === "assistant"))
      .map((m) => ({ role: m.role, content: String(m.content ?? "") }));

    if (messages.length === 0) {
      return res.status(400).json({ error: "messages 가 비어 있습니다." });
    }

    const theme = String(req.body?.theme || "trip_collab");

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: systemPromptForTheme(theme),
      messages,
      output_config: {
        format: { type: "json_schema", schema: OUTPUT_SCHEMA },
      },
    });

    const text = response.content.find((b) => b.type === "text")?.text ?? "{}";
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { reply: text, correction: "" };
    }

    res.json({
      reply: parsed.reply ?? "",
      correction: parsed.correction ?? "",
    });
  } catch (err) {
    console.error("[/api/chat] 오류:", err?.message || err);
    const status = err?.status && Number.isInteger(err.status) ? err.status : 500;
    res.status(status).json({
      error:
        err?.message ||
        "Claude 호출 중 오류가 발생했습니다. 서버 로그를 확인하세요.",
    });
  }
});

// ===== 리스닝 쉐도잉: 문장 생성 =====
const SHADOW_SCHEMA = {
  type: "object",
  properties: {
    sentence: {
      type: "string",
      description:
        "A single natural English sentence, 8-13 words, upper-beginner to lower-intermediate level, self-contained, ending with proper punctuation. No surrounding quotes.",
    },
    translation: {
      type: "string",
      description:
        "A natural Korean translation of the sentence (한국어 번역).",
    },
  },
  required: ["sentence", "translation"],
  additionalProperties: false,
};

// 테마별 주제 세트 (trip=출장, business=협업/사무, daily=일상)
const SHADOW_TOPIC_SETS = {
  trip: [
    "checking in at the airport counter",
    "going through immigration at a foreign airport",
    "going through customs",
    "asking about a connecting flight",
    "on the airplane, talking to a flight attendant",
    "collecting your luggage",
    "reporting lost luggage",
    "taking a taxi from the airport to the hotel",
    "using the subway or bus in a foreign city",
    "asking someone for directions on the street",
    "renting a car abroad",
    "checking in at the hotel",
    "asking about the wifi and breakfast at the hotel",
    "reporting a problem with the hotel room",
    "asking for a late checkout",
    "checking out of the hotel",
    "ordering food at a restaurant abroad",
    "asking for the bill and paying",
    "exchanging money or using a card abroad",
    "buying a local SIM card or getting internet",
    "asking about local customs or manners",
    "meeting a business partner face to face for the first time",
    "exchanging business cards",
    "small talk at the start of an in-person meeting",
    "visiting a partner's office",
    "taking a tour of a factory",
    "inspecting a product at the factory",
    "a face-to-face price negotiation",
    "having dinner with a client abroad",
    "making a toast at a business dinner",
    "thanking the host after a factory visit",
    "confirming tomorrow's meeting schedule",
    "saying goodbye at the end of the trip",
  ],
  business: [
    "starting a video call with an overseas partner",
    "introducing yourself to a new client",
    "small talk before a business meeting",
    "scheduling a meeting across time zones",
    "following up after a meeting",
    "explaining a product requirement",
    "discussing product specifications",
    "giving feedback on a prototype",
    "requesting a design change",
    "reporting project progress",
    "discussing a project timeline and milestones",
    "asking a supplier for a quote",
    "negotiating the price",
    "confirming an order",
    "discussing the delivery schedule",
    "handling a shipping delay",
    "talking about product quality issues",
    "reviewing a contract",
    "discussing payment terms",
    "asking a colleague for help",
    "presenting an idea to the team",
    "agreeing on the next steps",
    "writing a short business email",
  ],
  daily: [
    "morning routines",
    "cooking at home",
    "ordering food at a restaurant",
    "grocery shopping",
    "the weather and seasons",
    "weekend plans",
    "meeting a friend",
    "going to a cafe",
    "movies and TV shows",
    "exercise and the gym",
    "public transportation",
    "shopping for clothes",
    "a hobby",
    "making plans with friends",
    "going to the doctor",
    "pets",
    "family",
    "a short trip or vacation",
    "smartphones and apps",
    "housework and cleaning",
    "sleep and rest",
    "music",
    "a small problem at home",
  ],
};

// 테마 → 주제 목록. trip_collab(기본)=출장+협업
function topicsForTheme(sets, theme) {
  if (theme === "business") return sets.business;
  if (theme === "daily") return sets.daily;
  if (theme === "mixed")
    return [...sets.trip, ...sets.business, ...sets.daily];
  return [...sets.trip, ...sets.business]; // trip_collab (기본)
}
function pickTopic(sets, theme) {
  const list = topicsForTheme(sets, theme);
  return list[Math.floor(Math.random() * list.length)];
}

// 레벨별 난이도 (기본 intermediate=중급)
function shadowLevel(level) {
  if (level === "easy")
    return {
      words: "7 to 11 words",
      desc: "upper-beginner (CEFR A2), simple common everyday words",
    };
  if (level === "advanced")
    return {
      words: "12 to 18 words",
      desc: "upper-intermediate (CEFR B2), richer vocabulary and some more complex structures",
    };
  return {
    words: "10 to 15 words",
    desc: "intermediate (CEFR B1), natural everyday vocabulary",
  };
}

// 매번 다른 문장 결이 나오도록 유형과 문법 포인트를 섞는다
const SHADOW_TYPES = [
  "a statement describing a situation",
  "a question someone would actually ask",
  "a sentence about a past experience",
  "a sentence about a future plan",
  "an opinion or preference",
  "a suggestion or piece of advice",
  "a short description of a place or thing",
  "a sentence expressing a feeling or reaction",
  "a polite request",
  "a comparison between two things",
];

const SHADOW_GRAMMAR = [
  "present simple",
  "present continuous",
  "past simple",
  "present perfect",
  "future with 'will' or 'going to'",
  "a modal verb (can, should, might, have to)",
  "a conditional with 'if'",
  "a phrasal verb",
  "a relative clause (who / that / which)",
  "a comparative or superlative",
  "an infinitive or gerund (to do / doing)",
  "a preposition of time or place",
  "there is / there are",
  "the passive voice",
];

app.post("/api/sentence", async (req, res) => {
  try {
    const recent = Array.isArray(req.body?.recent)
      ? req.body.recent.slice(-30).map((s) => String(s))
      : [];
    const theme = String(req.body?.theme || "trip_collab");
    const lv = shadowLevel(String(req.body?.level || "intermediate"));
    const topic = pickTopic(SHADOW_TOPIC_SETS, theme);
    const type = SHADOW_TYPES[Math.floor(Math.random() * SHADOW_TYPES.length)];
    const grammar =
      SHADOW_GRAMMAR[Math.floor(Math.random() * SHADOW_GRAMMAR.length)];

    const avoid = recent.length
      ? `\n\nThe learner has ALREADY practiced these sentences. Your sentence must be clearly different from all of them — different situation and different wording, not a small variation:\n- ${recent.join(
          "\n- "
        )}`
      : "";

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 256,
      system:
        "You generate single English sentences for a listening dictation (shadowing) exercise for Korean learners.",
      messages: [
        {
          role: "user",
          content:
            `Write ONE natural, everyday English sentence about "${topic}", ` +
            `and give its natural Korean translation.\n\n` +
            `Requirements:\n` +
            `- Make it ${type}.\n` +
            `- Naturally use ${grammar}. Do NOT force it — the sentence must sound completely natural. If it does not fit, just write a natural sentence instead.\n` +
            `- ${lv.words}, ${lv.desc}. Clear when spoken aloud.\n` +
            `- Self-contained; avoid hard-to-spell proper nouns.` +
            avoid,
        },
      ],
      output_config: {
        format: { type: "json_schema", schema: SHADOW_SCHEMA },
      },
    });

    const text = response.content.find((b) => b.type === "text")?.text ?? "{}";
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { sentence: "", translation: "" };
    }
    const sentence = (parsed.sentence || "").trim();
    const translation = (parsed.translation || "").trim();
    if (!sentence) throw new Error("문장 생성에 실패했습니다.");
    res.json({ sentence, translation });
  } catch (err) {
    console.error("[/api/sentence] 오류:", err?.message || err);
    const status = err?.status && Number.isInteger(err.status) ? err.status : 500;
    res.status(status).json({
      error: err?.message || "문장 생성 중 오류가 발생했습니다.",
    });
  }
});

// ===== 읽기 연습: 지문 생성 =====
const PASSAGE_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "A short English title." },
    paragraphs: {
      type: "array",
      description: "4-6 paragraphs making up the passage.",
      items: {
        type: "object",
        properties: {
          en: { type: "string", description: "One English paragraph." },
          ko: {
            type: "string",
            description: "Natural Korean translation of that paragraph.",
          },
          gender: {
            type: "string",
            enum: ["male", "female", ""],
            description:
              "For a DIALOGUE turn, the gender of the speaker of this line ('male' or 'female'), decided from the speaker's name and kept consistent for that speaker across the whole dialogue. For a NARRATIVE paragraph, use an empty string.",
          },
        },
        required: ["en", "ko", "gender"],
        additionalProperties: false,
      },
    },
  },
  required: ["title", "paragraphs"],
  additionalProperties: false,
};

const PASSAGE_TOPIC_SETS = {
  trip: [
    "checking in at an airport counter",
    "going through immigration at a foreign airport",
    "taking a taxi from the airport to a hotel",
    "checking in at a hotel abroad",
    "a problem with a hotel room",
    "ordering food at a restaurant in a foreign country",
    "asking a local for directions",
    "meeting an overseas business partner in person for the first time",
    "a partner showing a Korean visitor around the factory",
    "a business dinner with an overseas client",
    "a face-to-face meeting during a business trip",
    "saying goodbye to a partner at the end of a trip",
    "how to prepare for an overseas business trip",
    "what to expect at airport immigration and customs",
    "useful tips for staying at a hotel abroad",
    "how to handle jet lag on a business trip",
    "cultural manners to know when meeting partners abroad",
    "tips for a business dinner in a foreign country",
    "getting around a foreign city during a business trip",
  ],
  business: [
    "a video call between a Korean company and an overseas partner",
    "a first meeting with a new business client",
    "discussing a new product idea with an overseas team",
    "giving feedback on a product prototype",
    "negotiating the price with a supplier",
    "talking about a delivery delay",
    "solving a quality problem with a partner",
    "how to run an effective online meeting with a global team",
    "tips for writing clear business emails in English",
    "working across different time zones",
    "how to build trust with an overseas partner",
    "the steps of developing a product with a partner",
    "how to give and receive feedback politely at work",
    "how small talk helps business relationships",
  ],
  daily: [
    "a memorable weekend",
    "the benefits of walking every day",
    "how coffee became popular around the world",
    "living with a pet",
    "why people enjoy cooking at home",
    "how sleep affects our health",
    "a traditional Korean festival",
    "how music affects our mood",
    "the changing seasons and daily life",
    "learning a new hobby as an adult",
    "why exercise is good for the mind",
    "how the internet changed shopping",
    "a friendly neighborhood cafe",
    "the joy of reading books",
  ],
};

app.post("/api/passage", async (req, res) => {
  try {
    const recent = Array.isArray(req.body?.recent)
      ? req.body.recent.slice(-10).map((s) => String(s))
      : [];
    const theme = String(req.body?.theme || "trip_collab");
    const level = String(req.body?.level || "intermediate");
    const topic = pickTopic(PASSAGE_TOPIC_SETS, theme);
    const passageLevel =
      level === "easy"
        ? "an easy CEFR A2 level (simple, short, clear sentences and very common words)"
        : level === "advanced"
        ? "an upper-intermediate CEFR B2 level (richer vocabulary, some longer and more complex sentences)"
        : "an intermediate CEFR B1 level (natural everyday vocabulary, a mix of short and some longer sentences)";
    // 서술문(narrative) : 대화문(dialogue) = 6:4 랜덤
    const format = Math.random() < 0.6 ? "narrative" : "dialogue";

    const formatRule =
      format === "dialogue"
        ? `- Write it as a NATURAL DIALOGUE (conversation) between two people about the topic (for example a customer and a barista, two friends, an interviewer and an applicant). ` +
          `Start each line with the speaker's name and a colon, like "Mina: ..." and "Tom: ...". Use simple, common Korean-friendly names, and pick names that clearly sound male or female. ` +
          `Each "paragraph" in the output = one speaker's turn (one or two sentences). Aim for 8 to 12 short turns total. ` +
          `Keep it natural and spoken, with everyday expressions and short questions and answers. ` +
          `For EACH turn, set the "gender" field to that speaker's gender ("male" or "female"), based on the name, and keep it consistent for the same speaker across all their turns.`
        : `- Write it as a NARRATIVE passage (normal prose) in 3 to 4 short paragraphs. Set "gender" to an empty string for every paragraph.`;

    const avoid = recent.length
      ? `\n\nIMPORTANT: Write about a clearly DIFFERENT topic and situation. This passage must NOT continue, extend, or reuse any of these recent passages — pick a fresh setting, different people, and a different subject:\n- ${recent.join(
          "\n- "
        )}`
      : "";

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 8000,
      system:
        "You write English reading-practice passages for Korean learners, with Korean translations.",
      messages: [
        {
          role: "user",
          content:
            `Write an English reading passage about "${topic}" at ${passageLevel}. ` +
            `Requirements:\n` +
            `- Total length about 200-250 words.\n` +
            formatRule +
            `\n` +
            `- Match the target level: keep it clear and readable, not academic. Avoid rare or obscure words.\n` +
            `- Interesting and natural to read aloud for pronunciation practice.\n` +
            `- Give a natural Korean translation for EACH paragraph (each turn, if it is a dialogue).` +
            avoid,
        },
      ],
      output_config: {
        format: { type: "json_schema", schema: PASSAGE_SCHEMA },
      },
    });

    const text = response.content.find((b) => b.type === "text")?.text ?? "{}";
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = {};
    }
    const title = (parsed.title || "").trim();
    const paragraphs = Array.isArray(parsed.paragraphs) ? parsed.paragraphs : [];
    if (!paragraphs.length) throw new Error("지문 생성에 실패했습니다.");
    res.json({ title, paragraphs });
  } catch (err) {
    console.error("[/api/passage] 오류:", err?.message || err);
    const status = err?.status && Number.isInteger(err.status) ? err.status : 500;
    res
      .status(status)
      .json({ error: err?.message || "지문 생성 중 오류가 발생했습니다." });
  }
});

// ===== 읽기 연습: 드래그한 부분 번역 =====
const TRANSLATE_SCHEMA = {
  type: "object",
  properties: {
    translation: {
      type: "string",
      description: "Natural Korean translation of the given English text.",
    },
  },
  required: ["translation"],
  additionalProperties: false,
};

app.post("/api/translate", async (req, res) => {
  try {
    const text = String(req.body?.text || "").trim().slice(0, 2000);
    if (!text) return res.status(400).json({ error: "번역할 텍스트가 없습니다." });

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system:
        "You translate English into natural Korean for a Korean learner. Translate exactly what is given, even a fragment. Output only the Korean translation.",
      messages: [
        {
          role: "user",
          content: `Translate this English text into natural Korean:\n\n${text}`,
        },
      ],
      output_config: {
        format: { type: "json_schema", schema: TRANSLATE_SCHEMA },
      },
    });

    const out = response.content.find((b) => b.type === "text")?.text ?? "{}";
    let parsed;
    try {
      parsed = JSON.parse(out);
    } catch {
      parsed = { translation: "" };
    }
    res.json({ translation: (parsed.translation || "").trim() });
  } catch (err) {
    console.error("[/api/translate] 오류:", err?.message || err);
    const status = err?.status && Number.isInteger(err.status) ? err.status : 500;
    res
      .status(status)
      .json({ error: err?.message || "번역 중 오류가 발생했습니다." });
  }
});

// ===== 쓰기/말하기 공용: 한글 문제 문장 생성 =====
const KO_SENTENCE_SCHEMA = {
  type: "object",
  properties: {
    korean: {
      type: "string",
      description: "One natural Korean sentence of about 5-12 words (어절).",
    },
  },
  required: ["korean"],
  additionalProperties: false,
};

const KO_TOPIC_SETS = {
  trip: [
    "공항 카운터에서 체크인하기",
    "입국심사 받기",
    "세관 통과하기",
    "환승 항공편 물어보기",
    "기내에서 승무원에게 요청하기",
    "수하물 찾기",
    "분실한 짐 신고하기",
    "공항에서 호텔까지 택시 타기",
    "현지에서 지하철·버스 이용하기",
    "길에서 길 물어보기",
    "렌터카 빌리기",
    "호텔 체크인하기",
    "호텔 와이파이와 조식 물어보기",
    "호텔 방 문제 이야기하기",
    "레이트 체크아웃 요청하기",
    "프런트에 추천 부탁하기",
    "해외 식당에서 음식 주문하기",
    "계산서 요청하고 결제하기",
    "환전하거나 카드로 결제하기",
    "현지 유심 사거나 인터넷 연결하기",
    "현지 예절·문화 물어보기",
    "해외 파트너를 처음 대면으로 만나기",
    "명함 주고받기",
    "대면 미팅 시작 전 가벼운 대화",
    "파트너 사무실 방문하기",
    "공장 견학하기",
    "공장에서 제품 검수하기",
    "대면으로 가격 협상하기",
    "거래처와 저녁 식사하기",
    "비즈니스 저녁 자리에서 건배하기",
    "공장 방문 후 감사 전하기",
    "내일 미팅 일정 확인하기",
    "출장 마무리하며 작별 인사하기",
  ],
  business: [
    "해외 파트너와 화상회의 시작하기",
    "새 거래처에 자기소개하기",
    "시차를 고려해 회의 시간 잡기",
    "회의 후 후속 연락하기",
    "제품 요구사항 설명하기",
    "제품 사양 논의하기",
    "시제품 피드백 주기",
    "디자인 변경 요청하기",
    "프로젝트 진행 상황 보고하기",
    "프로젝트 일정 논의하기",
    "공급업체에 견적 요청하기",
    "가격 협상하기",
    "주문 확정하기",
    "납기 일정 논의하기",
    "배송 지연 대응하기",
    "제품 품질 문제 이야기하기",
    "결제 조건 논의하기",
    "동료에게 도움 요청하기",
    "팀에 아이디어 발표하기",
    "다음 단계에 합의하기",
    "짧은 비즈니스 이메일 쓰기",
  ],
  daily: [
    "아침 준비와 하루 시작",
    "집에서 요리하기",
    "식당에서 주문하기",
    "장 보기",
    "날씨와 계절 이야기",
    "주말 계획",
    "친구 만나기",
    "카페 가기",
    "영화나 드라마 이야기",
    "운동과 헬스장",
    "대중교통 이용하기",
    "옷 쇼핑하기",
    "취미 이야기하기",
    "친구와 약속 잡기",
    "병원 가기",
    "반려동물",
    "가족 이야기",
    "짧은 여행이나 휴가",
    "스마트폰 앱 사용하기",
    "집안일과 청소",
    "잠과 휴식",
  ],
};

// 매번 다른 결의 문장이 나오도록 유형과 문법 포인트를 섞는다
const KO_TYPES = [
  "상황을 설명하는 평서문",
  "실제로 물어볼 법한 질문",
  "과거의 경험을 말하는 문장",
  "앞으로의 계획을 말하는 문장",
  "의견이나 선호를 말하는 문장",
  "제안이나 조언을 하는 문장",
  "장소나 사물을 묘사하는 문장",
  "감정이나 반응을 나타내는 문장",
  "정중한 부탁이나 요청",
  "두 가지를 비교하는 문장",
];

const KO_GRAMMAR = [
  "현재 시제",
  "현재 진행형",
  "과거 시제",
  "현재완료 (have p.p.)",
  "미래 표현 (will / be going to)",
  "조동사 (can, should, might, have to)",
  "if 조건문",
  "구동사 (phrasal verb)",
  "관계사절 (who / that / which)",
  "비교급이나 최상급",
  "to부정사 또는 동명사",
  "시간·장소 전치사",
  "there is / there are",
  "수동태",
];

app.post("/api/ko-sentence", async (req, res) => {
  try {
    const recent = Array.isArray(req.body?.recent)
      ? req.body.recent.slice(-30).map((s) => String(s))
      : [];
    const theme = String(req.body?.theme || "trip_collab");
    const level = String(req.body?.level || "intermediate");
    const koLevel =
      level === "easy"
        ? "초중급 학습자가 옮기기 좋은, 약간 쉬운 난이도. 쉬운 기본 단어와 단순한 문장 구조"
        : level === "advanced"
        ? "중상급 학습자용으로 조금 도전적인 난이도. 다양한 표현과 조금 더 복잡한 문장 구조"
        : "중급 학습자가 옮기기 적당한 난이도. 자연스러운 일상 표현과 기본~중급 문장 구조";
    const topic = pickTopic(KO_TOPIC_SETS, theme);
    const type = KO_TYPES[Math.floor(Math.random() * KO_TYPES.length)];
    const grammar = KO_GRAMMAR[Math.floor(Math.random() * KO_GRAMMAR.length)];

    const avoid = recent.length
      ? `\n\n학습자가 이미 연습한 문장들입니다. 이것들과 확실히 다른 문장을 만들어 주세요. 상황도 다르고 표현도 달라야 하며, 살짝 바꾼 변형이면 안 됩니다:\n- ${recent.join(
          "\n- "
        )}`
      : "";

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 256,
      system:
        "너는 한국인 영어 학습자를 위한 영작/스피킹 연습 문제를 만든다. 자연스러운 일상 한국어 문장을 제시한다.",
      messages: [
        {
          role: "user",
          content:
            `"${topic}" 주제로 자연스러운 한국어 문장을 하나만 만들어줘.\n\n` +
            `조건:\n` +
            `- 유형: ${type}\n` +
            `- 영어로 옮겼을 때 "${grammar}"를 자연스럽게 쓰게 되는 문장. 단, 억지로 끼워맞추지 말고 어색하면 그냥 자연스러운 문장을 우선할 것.\n` +
            `- 5~12어절 정도, 자연스러운 한국어 표현.\n` +
            `- ${koLevel}를 쓰게 되는 문장으로.\n` +
            `- 너무 어려운 고유명사나 전문용어는 피할 것.` +
            avoid,
        },
      ],
      output_config: {
        format: { type: "json_schema", schema: KO_SENTENCE_SCHEMA },
      },
    });

    const text = response.content.find((b) => b.type === "text")?.text ?? "{}";
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { korean: "" };
    }
    const korean = (parsed.korean || "").trim();
    if (!korean) throw new Error("문제 생성에 실패했습니다.");
    res.json({ korean });
  } catch (err) {
    console.error("[/api/ko-sentence] 오류:", err?.message || err);
    const status = err?.status && Number.isInteger(err.status) ? err.status : 500;
    res
      .status(status)
      .json({ error: err?.message || "문제 생성 중 오류가 발생했습니다." });
  }
});

// ===== 쓰기: 영작 채점 =====
const WRITING_GRADE_SCHEMA = {
  type: "object",
  properties: {
    score: {
      type: "integer",
      description: "0-100 score for how well the English conveys the Korean.",
    },
    best: {
      type: "string",
      description: "The most natural English translation of the Korean sentence.",
    },
    alternatives: {
      type: "array",
      description:
        "1-3 other natural English ways to say it. Empty array if none worth showing.",
      items: { type: "string" },
    },
    feedback: {
      type: "string",
      description:
        "Short feedback in KOREAN about the learner's answer: what was wrong or unnatural and why. If the answer was already good, say so briefly.",
    },
  },
  required: ["score", "best", "alternatives", "feedback"],
  additionalProperties: false,
};

app.post("/api/writing/grade", async (req, res) => {
  try {
    const korean = String(req.body?.korean || "").trim();
    const answer = String(req.body?.answer || "").trim().slice(0, 1000);
    // 답을 안 썼으면 "정답만 보기" 모드 (폰에서 타이핑 없이 정답 확인)
    const reveal = !!req.body?.reveal || !answer;
    if (!korean) return res.status(400).json({ error: "문제가 비어 있습니다." });

    const userContent = reveal
      ? `한국어 문장:\n${korean}\n\n` +
        `학습자가 직접 쓰지 않고 정답만 확인하려고 해. ` +
        `이 문장의 가장 자연스러운 영어 번역(best), 다른 자연스러운 표현(alternatives), ` +
        `그리고 이 문장을 영작할 때 알아두면 좋은 핵심 포인트를 짧은 한국어로(feedback) 줘. score는 0으로.`
      : `한국어 문장:\n${korean}\n\n` +
        `학습자가 쓴 영어:\n${answer}\n\n` +
        `이 영작을 평가해줘. 가장 자연스러운 영어 문장(best), 다른 표현(alternatives), ` +
        `그리고 학습자 답안에 대한 한국어 피드백(feedback)과 점수(score)를 줘.`;

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      system:
        "You are a kind English writing tutor for Korean learners. You grade a learner's English translation of a Korean sentence. Feedback must be written in Korean, short and encouraging, and point out concrete issues (grammar, word choice, naturalness).",
      messages: [
        {
          role: "user",
          content: userContent,
        },
      ],
      output_config: {
        format: { type: "json_schema", schema: WRITING_GRADE_SCHEMA },
      },
    });

    const text = response.content.find((b) => b.type === "text")?.text ?? "{}";
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = {};
    }
    res.json({
      score: Number.isFinite(parsed.score) ? parsed.score : 0,
      best: parsed.best || "",
      alternatives: Array.isArray(parsed.alternatives) ? parsed.alternatives : [],
      feedback: parsed.feedback || "",
      reveal,
    });
  } catch (err) {
    console.error("[/api/writing/grade] 오류:", err?.message || err);
    const status = err?.status && Number.isInteger(err.status) ? err.status : 500;
    res
      .status(status)
      .json({ error: err?.message || "채점 중 오류가 발생했습니다." });
  }
});

// ===== 말하기: 스피킹 채점 =====
const SPEAKING_GRADE_SCHEMA = {
  type: "object",
  properties: {
    score: {
      type: "integer",
      description:
        "0-100 score for how well the recognized speech matches a correct English rendering of the Korean.",
    },
    best: {
      type: "string",
      description: "The most natural English sentence for the Korean prompt.",
    },
    feedback: {
      type: "string",
      description:
        "Short feedback in KOREAN comparing what was recognized to the correct sentence.",
    },
    tips: {
      type: "array",
      description:
        "0-3 concrete pronunciation tips in KOREAN, based on likely mis-recognized words.",
      items: { type: "string" },
    },
  },
  required: ["score", "best", "feedback", "tips"],
  additionalProperties: false,
};

app.post("/api/speaking/grade", async (req, res) => {
  try {
    const korean = String(req.body?.korean || "").trim();
    const heard = String(req.body?.heard || "").trim().slice(0, 1000);
    if (!korean || !heard)
      return res.status(400).json({ error: "문제나 인식된 음성이 없습니다." });

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      system:
        "You are a kind English speaking coach for Korean learners. The learner spoke English aloud and a speech recognizer transcribed it. Compare the transcript to a correct English rendering of the Korean prompt. Differences often indicate pronunciation problems. Feedback and tips must be in Korean. Be encouraging and concrete.",
      messages: [
        {
          role: "user",
          content:
            `한국어 문제:\n${korean}\n\n` +
            `음성인식이 받아적은 학습자의 발화:\n${heard}\n\n` +
            `학습자의 스피킹을 평가해줘. 정답 영어 문장(best), 한국어 피드백(feedback), ` +
            `발음 팁(tips), 점수(score)를 줘. ` +
            `인식 결과가 정답과 다르면 어떤 단어의 발음이 문제였을지 짚어줘.`,
        },
      ],
      output_config: {
        format: { type: "json_schema", schema: SPEAKING_GRADE_SCHEMA },
      },
    });

    const text = response.content.find((b) => b.type === "text")?.text ?? "{}";
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = {};
    }
    res.json({
      score: Number.isFinite(parsed.score) ? parsed.score : 0,
      best: parsed.best || "",
      feedback: parsed.feedback || "",
      tips: Array.isArray(parsed.tips) ? parsed.tips : [],
    });
  } catch (err) {
    console.error("[/api/speaking/grade] 오류:", err?.message || err);
    const status = err?.status && Number.isInteger(err.status) ? err.status : 500;
    res
      .status(status)
      .json({ error: err?.message || "채점 중 오류가 발생했습니다." });
  }
});

// ===== 공용: 학습 중 질문하기 =====
app.post("/api/ask", async (req, res) => {
  try {
    const question = String(req.body?.question || "").trim().slice(0, 2000);
    const context = String(req.body?.context || "").trim().slice(0, 6000);
    const history = Array.isArray(req.body?.history)
      ? req.body.history
          .filter((m) => m && (m.role === "user" || m.role === "assistant"))
          .slice(-8)
          .map((m) => ({ role: m.role, content: String(m.content ?? "") }))
      : [];

    if (!question) return res.status(400).json({ error: "질문이 비어 있습니다." });

    const contextBlock = context
      ? `The learner is currently studying this material:\n"""\n${context}\n"""\n\n`
      : "";

    const messages = [
      ...history,
      { role: "user", content: contextBlock + `Question: ${question}` },
    ];

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1500,
      system:
        "You are a friendly, patient English tutor for a Korean learner. " +
        "Answer the learner's questions about English — word meanings, grammar, pronunciation, translations, usage, and why something is said a certain way. " +
        "ALWAYS answer in Korean (한국어), clearly and concisely. " +
        "When helpful, give a short English example and its Korean meaning. " +
        "Use plain text only — do NOT use markdown tables, headings, or '#' or '*' symbols. Short dashes (-) for simple lists are fine. " +
        "If the learner refers to 'this', 'this word', 'this sentence', use the study material provided as context.",
      messages,
    });

    const answer =
      response.content.find((b) => b.type === "text")?.text?.trim() || "";
    res.json({ answer });
  } catch (err) {
    console.error("[/api/ask] 오류:", err?.message || err);
    const status = err?.status && Number.isInteger(err.status) ? err.status : 500;
    res
      .status(status)
      .json({ error: err?.message || "답변 생성 중 오류가 발생했습니다." });
  }
});

// ===== 동사 정복 (take / get): 핵심 정리 =====
const VERB_GUIDE_SCHEMA = {
  type: "object",
  properties: {
    intro: { type: "string", description: "One encouraging Korean sentence." },
    groups: {
      type: "array",
      description: "7-10 groups covering meanings, collocations, phrasal verbs.",
      items: {
        type: "object",
        properties: {
          label: {
            type: "string",
            description:
              "Short label: English pattern + Korean gloss, e.g. \"take a taxi (택시를 타다)\".",
          },
          note: {
            type: "string",
            description: "One-line Korean explanation of when/how to use it.",
          },
          examples: {
            type: "array",
            description: "2 short example sentences.",
            items: {
              type: "object",
              properties: {
                en: { type: "string" },
                ko: { type: "string" },
              },
              required: ["en", "ko"],
              additionalProperties: false,
            },
          },
        },
        required: ["label", "note", "examples"],
        additionalProperties: false,
      },
    },
  },
  required: ["intro", "groups"],
  additionalProperties: false,
};

app.post("/api/verb-guide", async (req, res) => {
  try {
    const verb = String(req.body?.verb || "").trim().toLowerCase();
    if (!["take", "get", "put", "grab", "both"].includes(verb)) {
      return res.status(400).json({ error: "지원하지 않는 동사입니다." });
    }

    const recent = Array.isArray(req.body?.recent)
      ? req.body.recent.slice(-40).map((s) => String(s))
      : [];
    const avoid = recent.length
      ? `\n\nThe learner has already seen these example sentences before. Use completely NEW and DIFFERENT example sentences — do not reuse or lightly reword any of these:\n- ${recent.join(
          "\n- "
        )}`
      : "";

    let guideInstruction;
    if (verb === "both") {
      guideInstruction =
        `Create a study guide of common everyday and business-trip SITUATIONS where natural English uses BOTH "take" and "get" together. ` +
        `Make 6 to 8 groups. For each group provide:\n` +
        `- label: a short English description of the situation with a Korean gloss, e.g. "getting a taxi and taking it somewhere (택시를 잡아서 타고 가기)".\n` +
        `- note: a one-line Korean explanation.\n` +
        `- examples: exactly 2 natural example sentences, and EACH sentence must use BOTH "take" and "get" naturally, with a natural Korean translation.\n` +
        `Write the intro as one short encouraging Korean sentence.`;
    } else {
      const PHRASALS = {
        take: "take off, take on, take over, take out, take up, take back, take care of",
        get: "get up, get over, get along, get off, get on, get back, get through, get to, get rid of",
        put: "put on, put off, put up, put up with, put out, put away, put down, put together, put back",
        grab: "grab a coffee, grab a bite, grab a taxi, grab lunch, grab a seat, grab your attention, grab the chance",
      };
      const phrasals = PHRASALS[verb] || "";
      guideInstruction =
        `Create a study guide to help a Korean learner master the English verb "${verb}". ` +
        `Organize its main meanings and most common, useful uses into 8 to 10 groups. ` +
        `Cover: the core meanings, very common collocations, and the most important phrasal verbs (such as ${phrasals}). ` +
        `For each group provide:\n` +
        `- label: a short English pattern with a Korean gloss, e.g. "take a taxi (택시를 타다)".\n` +
        `- note: a one-line Korean explanation of when to use it.\n` +
        `- examples: exactly 2 short, practical example sentences (everyday or business-trip context), each with a natural Korean translation.\n` +
        `Write the intro as one short encouraging Korean sentence.`;
    }

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 8000,
      system:
        "You are an English teacher creating a clear, well-organized study guide for a Korean learner.",
      messages: [
        {
          role: "user",
          content: guideInstruction + avoid,
        },
      ],
      output_config: {
        format: { type: "json_schema", schema: VERB_GUIDE_SCHEMA },
      },
    });

    const text = response.content.find((b) => b.type === "text")?.text ?? "{}";
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = {};
    }
    const groups = Array.isArray(parsed.groups) ? parsed.groups : [];
    if (!groups.length) throw new Error("정리 생성에 실패했습니다.");
    res.json({ intro: parsed.intro || "", groups });
  } catch (err) {
    console.error("[/api/verb-guide] 오류:", err?.message || err);
    const status = err?.status && Number.isInteger(err.status) ? err.status : 500;
    res
      .status(status)
      .json({ error: err?.message || "정리 생성 중 오류가 발생했습니다." });
  }
});

// ===== 동사 정복: 연습 문제 (그 동사를 쓰게 되는 한글 문장) =====
const VERB_SENTENCE_SCHEMA = {
  type: "object",
  properties: {
    korean: { type: "string", description: "Natural Korean sentence (the question)." },
    best: {
      type: "string",
      description: "The English sentence that uses the target verb(s).",
    },
  },
  required: ["korean", "best"],
  additionalProperties: false,
};

app.post("/api/verb-sentence", async (req, res) => {
  try {
    const verb = String(req.body?.verb || "").trim().toLowerCase();
    if (!["take", "get", "put", "grab", "both"].includes(verb)) {
      return res.status(400).json({ error: "지원하지 않는 동사입니다." });
    }
    const recent = Array.isArray(req.body?.recent)
      ? req.body.recent.slice(-20).map((s) => String(s))
      : [];
    const avoid = recent.length
      ? `\n\n다음 최근 문장들과 겹치지 않게 해주세요:\n- ${recent.join("\n- ")}`
      : "";

    // 핵심: 영어 문장을 "먼저" 만들고 → 한글로 번역. 그래야 문제가 항상 그 동사에 딱 맞는다.
    let sentenceInstruction;
    if (verb === "both") {
      // 매번 다른 상황을 강제로 지정해 반복·단조로움을 깬다.
      const BOTH_SCENARIOS = [
        "arriving in a new city for a business trip — transport, hotel check-in, luggage",
        "a client meeting, negotiation, or closing a deal",
        "something going wrong and fixing it — a delay, a mistake, a lost item, a cancellation",
        "dividing tasks and coordinating with colleagues on a project",
        "meals, coffee, or entertaining a client after work",
        "handling documents, approvals, signatures, or paperwork",
        "a trade show, conference, or giving a presentation",
        "commuting, tickets, connections, and tight schedules",
        "onboarding, training a new hire, or handing over work before leave",
        "expenses, invoices, discounts, or getting reimbursed",
        "jet lag, feeling unwell abroad, or a small emergency on a trip",
        "a follow-up call or email after a meeting, chasing a reply",
      ];
      const scen = BOTH_SCENARIOS[Math.floor(Math.random() * BOTH_SCENARIOS.length)];
      // take 표현·get 표현을 각각 랜덤 지정 → "take a taxi / get to" 습관을 구조적으로 차단
      const TAKE_USES = [
        "take over (a task/client/shift)", "take notes", "take a break",
        "take responsibility for", "take a look at", "take care of",
        "take the lead on", "take a different approach", "take feedback",
        "take the elevator/stairs", "take a day off", "take a call",
        "take minutes (of a meeting)", "take a shortcut", "take charge",
      ];
      const GET_USES = [
        "get approval", "get feedback", "get in touch with", "get the details",
        "get ready", "get a discount", "get reimbursed", "get an update",
        "get access to", "get the contract signed", "get everyone on the same page",
        "get some rest", "get a refund", "get back to (someone)", "get started",
      ];
      const takeUse = TAKE_USES[Math.floor(Math.random() * TAKE_USES.length)];
      const getUse = GET_USES[Math.floor(Math.random() * GET_USES.length)];
      sentenceInstruction =
        `Situation for THIS sentence (you MUST set it in this context): ${scen}.\n` +
        `You MUST use the "take" expression "${takeUse}" AND the "get" expression "${getUse}" together in ONE natural sentence. ` +
        `Do NOT use "take a taxi/bus" or "get to (a place)" this time — use exactly the two expressions given above.\n` +
        `Step 1: Write ONE BEGINNER-level English sentence (CEFR A2 — 7 to 12 words) built around those two expressions. ` +
        `Keep it SHORT and SIMPLE: easy common words, simple sentence structure, at most one short linking word (and/so/before/after). ` +
        `It is for a beginner practicing speaking, so avoid hard vocabulary and long or complex clauses. Still make it sound natural.\n` +
        `Step 2: Translate that English sentence into natural, conversational Korean.\n\n` +
        `Return: "best" = the English sentence, "korean" = its natural Korean translation.`;
    } else {
      const USES = {
        take: "take a taxi/bus, take time, take a break, take off, take care of, take a photo, take medicine, take a look, take notes, take over, take up",
        get: "get up, get to (arrive), get off/on (transport), get over, get a taxi, get lost, get ready, get in touch, get back, get through, get + adjective (tired/hungry/cold), get a discount, get along with",
        put: "put on (clothes/makeup), put down, put away, put off (postpone), put together, put up with, put back, put in (effort/time), put something on the desk/table, put pressure on",
        grab: "grab a coffee, grab a bite, grab lunch, grab a taxi, grab a seat, grab your bag, grab someone's attention, grab a quick word, grab the chance/opportunity",
      };
      const uses = USES[verb] || "";
      sentenceInstruction =
        `Step 1: Write ONE BEGINNER-level English sentence (CEFR A2 — 4 to 9 words) that clearly and naturally uses the verb "${verb}" (one of: ${uses}). ` +
        `Keep it SHORT and SIMPLE with easy common words and a simple structure — it is for a beginner practicing speaking. ` +
        `The verb "${verb}" must be the natural choice — not a sentence where another verb (transfer, change, arrive, wake, watch, receive, etc.) would be more natural. Vary the use each time.\n` +
        `Step 2: Translate that English sentence into natural Korean.\n\n` +
        `Return: "best" = the English sentence, "korean" = its natural Korean translation.`;
    }

    const avoidEn = recent.length
      ? `\n\nDo NOT reuse or lightly reword these recent sentences:\n- ${recent.join(
          "\n- "
        )}`
      : "";

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 512,
      system:
        "You create English writing-practice items for Korean learners. You first write a natural English sentence using a target verb, then translate it into Korean.",
      messages: [
        {
          role: "user",
          content: sentenceInstruction + avoidEn,
        },
      ],
      output_config: {
        format: { type: "json_schema", schema: VERB_SENTENCE_SCHEMA },
      },
    });

    const text = response.content.find((b) => b.type === "text")?.text ?? "{}";
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { korean: "", best: "" };
    }
    const korean = (parsed.korean || "").trim();
    const best = (parsed.best || "").trim();
    if (!korean) throw new Error("문제 생성에 실패했습니다.");
    res.json({ korean, best });
  } catch (err) {
    console.error("[/api/verb-sentence] 오류:", err?.message || err);
    const status = err?.status && Number.isInteger(err.status) ? err.status : 500;
    res
      .status(status)
      .json({ error: err?.message || "문제 생성 중 오류가 발생했습니다." });
  }
});

// ===== 동사 정복: 채점 (정답은 반드시 그 동사를 사용) =====
// 채점 결과에 "다른 동사로 말하는 법(otherVerbs)"을 추가로 제시한다.
const VERB_GRADE_SCHEMA = {
  type: "object",
  properties: {
    score: {
      type: "integer",
      description: "0-100 score for correctness and natural use of the target verb(s).",
    },
    best: {
      type: "string",
      description: "The most natural English answer that USES the target verb(s).",
    },
    alternatives: {
      type: "array",
      description:
        "1-3 other natural English versions that also USE the target verb(s). Empty array if none.",
      items: { type: "string" },
    },
    otherVerbs: {
      type: "array",
      description:
        "1-3 natural ways to express the SAME meaning using a DIFFERENT main verb (NOT take/get). Show how a native speaker might phrase it with another verb.",
      items: {
        type: "object",
        properties: {
          en: {
            type: "string",
            description: "The full English sentence using a different main verb.",
          },
          verb: {
            type: "string",
            description:
              "The different main verb/expression used, e.g. 'postpone', 'catch', 'receive', 'grab', 'fetch'.",
          },
          ko: {
            type: "string",
            description:
              "Short Korean note on the nuance or when to use this version.",
          },
        },
        required: ["en", "verb", "ko"],
        additionalProperties: false,
      },
    },
    feedback: {
      type: "string",
      description:
        "Short feedback in KOREAN about the learner's answer: what was wrong or unnatural and why, or that it was already good.",
    },
  },
  required: ["score", "best", "alternatives", "otherVerbs", "feedback"],
  additionalProperties: false,
};

app.post("/api/verb-grade", async (req, res) => {
  try {
    const verb = String(req.body?.verb || "").trim().toLowerCase();
    const korean = String(req.body?.korean || "").trim();
    const answer = String(req.body?.answer || "").trim().slice(0, 1000);
    if (
      !["take", "get", "put", "grab", "both"].includes(verb) ||
      !korean ||
      !answer
    ) {
      return res.status(400).json({ error: "요청 정보가 부족합니다." });
    }

    const reference = String(req.body?.reference || "").trim();
    const target =
      verb === "both" ? 'both "take" and "get"' : `the verb "${verb}"`;
    const mustUse =
      verb === "both"
        ? 'MUST use BOTH "take" and "get" naturally in the same sentence'
        : `MUST use the verb "${verb}" (a form of it) in a natural way`;
    const refBlock = reference
      ? `A known-good reference answer that correctly uses ${target} is: "${reference}". Use this as the "best" answer (or an equally natural sentence that also uses ${target}).\n\n`
      : "";

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      system:
        `You are a kind English writing tutor for Korean learners who are practicing ${target}. ` +
        `The learner translates a Korean sentence into English, and the goal is to USE ${target} naturally. ` +
        `In your response, the "best" answer ${mustUse}, and the "alternatives" should do the same when possible. ` +
        `In "otherVerbs", ALSO show 1-3 natural ways to say the SAME thing using a DIFFERENT main verb (NOT take/get) — e.g. postpone/delay instead of "put off", catch/fetch instead of "grab", receive/obtain instead of "get", bring/carry instead of "take". For each, give the sentence, the different verb, and a short Korean nuance note. This teaches the learner alternatives so they don't over-rely on take/get. ` +
        `Feedback must be in Korean, short and encouraging. If the learner did not use ${target} (or used a different verb like transfer/change/arrive), gently point that out and show how to say it with ${target}. ` +
        `Score reflects both correctness and whether they used ${target} naturally.`,
      messages: [
        {
          role: "user",
          content:
            refBlock +
            `한국어 문장:\n${korean}\n\n` +
            `학습자가 쓴 영어:\n${answer}\n\n` +
            `이 영작을 평가해줘. 반드시 ${
              verb === "both" ? '"take"와 "get"을 둘 다' : `"${verb}"를`
            } 쓴 가장 자연스러운 정답(best), 같은 조건의 다른 표현(alternatives), ` +
            `그리고 take/get(또는 이번 대상 동사) 말고 다른 동사를 써서 같은 뜻을 말하는 법(otherVerbs), ` +
            `학습자 답안에 대한 한국어 피드백(feedback), 점수(score)를 줘.`,
        },
      ],
      output_config: {
        format: { type: "json_schema", schema: VERB_GRADE_SCHEMA },
      },
    });

    const text = response.content.find((b) => b.type === "text")?.text ?? "{}";
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = {};
    }
    res.json({
      score: Number.isFinite(parsed.score) ? parsed.score : 0,
      best: parsed.best || "",
      alternatives: Array.isArray(parsed.alternatives) ? parsed.alternatives : [],
      otherVerbs: Array.isArray(parsed.otherVerbs) ? parsed.otherVerbs : [],
      feedback: parsed.feedback || "",
    });
  } catch (err) {
    console.error("[/api/verb-grade] 오류:", err?.message || err);
    const status = err?.status && Number.isInteger(err.status) ? err.status : 500;
    res
      .status(status)
      .json({ error: err?.message || "채점 중 오류가 발생했습니다." });
  }
});

// ===== 문형 공부 (1형식~5형식) =====
// 성분 역할 코드: S(주어) V(동사) O(목적어) IO(간접목적어) DO(직접목적어)
//                 SC(주격보어) OC(목적격보어) M(수식어)
const PATTERN_INFO = {
  "1": {
    name: "1형식 (S + V)",
    structure: "주어(S) + 동사(V)",
    desc: "완전자동사. 목적어나 보어 없이 주어와 동사만으로 문장이 완성된다. 뒤에 수식어(부사구)가 붙기도 한다.",
    roles: "S, V, and optionally M (adverbial modifier like a place/time phrase). NO object and NO complement.",
    sampleVerbs: "go, come, run, sleep, arrive, happen, work, rise, fall, wait",
  },
  "2": {
    name: "2형식 (S + V + C)",
    structure: "주어(S) + 동사(V) + 주격보어(SC)",
    desc: "불완전자동사 + 주격보어. 보어는 주어를 설명한다(주어 = 보어). be동사, become, look, feel, seem 등.",
    roles: "S, V, and SC (subject complement — a noun or adjective describing the subject). Optionally M.",
    sampleVerbs: "be, become, look, feel, seem, get, turn, stay, sound, taste",
  },
  "3": {
    name: "3형식 (S + V + O)",
    structure: "주어(S) + 동사(V) + 목적어(O)",
    desc: "완전타동사 + 목적어 1개. 가장 흔한 문형. 목적어는 '~을/를'에 해당.",
    roles: "S, V, and O (one direct object). Optionally M.",
    sampleVerbs: "have, like, love, want, make, buy, see, know, need, use",
  },
  "4": {
    name: "4형식 (S + V + IO + DO)",
    structure: "주어(S) + 동사(V) + 간접목적어(IO) + 직접목적어(DO)",
    desc: "수여동사 + 목적어 2개. '~에게(IO) ~을(DO) 해주다'. give, send, tell, show, buy 등.",
    roles: "S, V, IO (indirect object — the person, '~에게'), and DO (direct object — the thing, '~을/를'). Optionally M.",
    sampleVerbs: "give, send, tell, show, buy, teach, offer, bring, lend, ask",
  },
  "5": {
    name: "5형식 (S + V + O + OC)",
    structure: "주어(S) + 동사(V) + 목적어(O) + 목적격보어(OC)",
    desc: "불완전타동사 + 목적어 + 목적격보어. 보어가 목적어를 설명한다(목적어 = 보어, 또는 목적어의 상태/동작). make, keep, call, find, let 등.",
    roles: "S, V, O (object), and OC (object complement — a noun, adjective, or verb form describing the object). Optionally M.",
    sampleVerbs: "make, keep, call, find, let, have, get, want, consider, name",
  },
};
function patternKey(p) {
  const k = String(p || "").replace(/[^0-9]/g, "").charAt(0);
  return PATTERN_INFO[k] ? k : null;
}

const SENTENCE_PART_SCHEMA = {
  type: "object",
  properties: {
    text: { type: "string", description: "A chunk of the English sentence, in order." },
    role: {
      type: "string",
      description:
        "Grammatical role of this chunk: one of S, V, O, IO, DO, SC, OC, M.",
    },
  },
  required: ["text", "role"],
  additionalProperties: false,
};

const SENTENCE_GUIDE_SCHEMA = {
  type: "object",
  properties: {
    structure: { type: "string", description: "The pattern structure in Korean, e.g. '주어(S) + 동사(V) + 목적어(O)'." },
    intro: { type: "string", description: "2-3 sentence Korean explanation of this pattern." },
    points: {
      type: "array",
      description: "3-5 short Korean bullet points: how it works, cautions, how to tell it apart.",
      items: { type: "string" },
    },
    verbs: {
      type: "array",
      description: "8-12 common verbs typically used in this pattern.",
      items: { type: "string" },
    },
    examples: {
      type: "array",
      description: "5-6 example sentences, each split into ordered parts by role.",
      items: {
        type: "object",
        properties: {
          en: { type: "string" },
          ko: { type: "string" },
          parts: {
            type: "array",
            description:
              "The full English sentence split into consecutive chunks covering the WHOLE sentence in order, each tagged with its role.",
            items: SENTENCE_PART_SCHEMA,
          },
        },
        required: ["en", "ko", "parts"],
        additionalProperties: false,
      },
    },
  },
  required: ["structure", "intro", "points", "verbs", "examples"],
  additionalProperties: false,
};

app.post("/api/sentence-guide", async (req, res) => {
  try {
    const k = patternKey(req.body?.pattern);
    if (!k) return res.status(400).json({ error: "지원하지 않는 문형입니다." });
    const info = PATTERN_INFO[k];

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 4000,
      system:
        "You are an English grammar teacher explaining the 5 basic English sentence patterns (5형식) to a Korean learner. Be clear, accurate, and beginner-friendly. All explanations in Korean; example sentences in English with Korean translations.",
      messages: [
        {
          role: "user",
          content:
            `Explain the English sentence pattern "${info.name}" for a Korean learner.\n` +
            `Structure: ${info.structure}. ${info.desc}\n` +
            `In this pattern each example must contain exactly these roles: ${info.roles}\n\n` +
            `Provide:\n` +
            `- structure: "${info.structure}"\n` +
            `- intro: 2-3 Korean sentences explaining the pattern.\n` +
            `- points: 3-5 short Korean bullets (핵심, 주의점, 다른 형식과 구분법).\n` +
            `- verbs: 8-12 common verbs used in this pattern.\n` +
            `- examples: 5-6 SHORT, everyday example sentences. For each, give en, ko, and parts.\n` +
            `  "parts" MUST split the whole English sentence into consecutive chunks IN ORDER, each tagged with its role (${info.roles.includes("IO") ? "S,V,IO,DO,M" : info.roles.includes("OC") ? "S,V,O,OC,M" : info.roles.includes("SC") ? "S,V,SC,M" : info.roles.includes("O)") || k === "3" ? "S,V,O,M" : "S,V,M"}). Concatenating all part texts (with spaces) must reproduce the sentence.`,
        },
      ],
      output_config: {
        format: { type: "json_schema", schema: SENTENCE_GUIDE_SCHEMA },
      },
    });

    const text = response.content.find((b) => b.type === "text")?.text ?? "{}";
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = {};
    }
    if (!Array.isArray(parsed.examples) || !parsed.examples.length) {
      throw new Error("정리 생성에 실패했습니다.");
    }
    res.json({
      pattern: info.name,
      structure: parsed.structure || info.structure,
      intro: parsed.intro || "",
      points: Array.isArray(parsed.points) ? parsed.points : [],
      verbs: Array.isArray(parsed.verbs) ? parsed.verbs : [],
      examples: parsed.examples,
    });
  } catch (err) {
    console.error("[/api/sentence-guide] 오류:", err?.message || err);
    const status = err?.status && Number.isInteger(err.status) ? err.status : 500;
    res.status(status).json({ error: err?.message || "정리 생성 중 오류가 발생했습니다." });
  }
});

// 문형 연습 문제: 그 형식으로 쓰게 되는 한국어 문장 (영어 먼저 만들고 → 한글)
const SENTENCE_DRILL_SCHEMA = {
  type: "object",
  properties: {
    korean: { type: "string", description: "Natural Korean sentence (the question)." },
    best: { type: "string", description: "The English sentence in the target pattern." },
  },
  required: ["korean", "best"],
  additionalProperties: false,
};

app.post("/api/sentence-drill", async (req, res) => {
  try {
    const k = patternKey(req.body?.pattern);
    if (!k) return res.status(400).json({ error: "지원하지 않는 문형입니다." });
    const info = PATTERN_INFO[k];
    const recent = Array.isArray(req.body?.recent)
      ? req.body.recent.slice(-20).map((s) => String(s))
      : [];
    const avoidEn = recent.length
      ? `\n\nDo NOT reuse or lightly reword these recent sentences:\n- ${recent.join("\n- ")}`
      : "";

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 400,
      system:
        "You create English sentence-pattern practice items for Korean beginners. You first write a simple English sentence in a target pattern, then translate it into Korean.",
      messages: [
        {
          role: "user",
          content:
            `Target pattern: ${info.name} — ${info.structure}. Roles required: ${info.roles}\n` +
            `Step 1: Write ONE BEGINNER-level English sentence (CEFR A2, 3 to 9 words) that clearly follows the "${info.name}" pattern and NO other pattern. Use easy, everyday words (everyday or business-trip context). Vary the verb and situation each time.\n` +
            `Step 2: Translate it into natural Korean.\n\n` +
            `Return: "best" = the English sentence, "korean" = its natural Korean translation.` +
            avoidEn,
        },
      ],
      output_config: {
        format: { type: "json_schema", schema: SENTENCE_DRILL_SCHEMA },
      },
    });
    const text = response.content.find((b) => b.type === "text")?.text ?? "{}";
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { korean: "", best: "" };
    }
    const korean = (parsed.korean || "").trim();
    const best = (parsed.best || "").trim();
    if (!korean) throw new Error("문제 생성에 실패했습니다.");
    res.json({ korean, best });
  } catch (err) {
    console.error("[/api/sentence-drill] 오류:", err?.message || err);
    const status = err?.status && Number.isInteger(err.status) ? err.status : 500;
    res.status(status).json({ error: err?.message || "문제 생성 중 오류가 발생했습니다." });
  }
});

// 문형 채점: 정답을 성분별로 분해해서 보여준다
const SENTENCE_GRADE_SCHEMA = {
  type: "object",
  properties: {
    score: { type: "integer", description: "0-100 for correctness and matching the target pattern." },
    matched: { type: "boolean", description: "Whether the learner's answer follows the target pattern." },
    best: { type: "string", description: "The most natural English answer IN the target pattern." },
    parts: {
      type: "array",
      description: "The best answer split into ordered chunks by role.",
      items: SENTENCE_PART_SCHEMA,
    },
    alternatives: {
      type: "array",
      description: "0-2 other natural answers in the same pattern.",
      items: { type: "string" },
    },
    feedback: { type: "string", description: "Short Korean feedback about the learner's answer and its pattern." },
  },
  required: ["score", "matched", "best", "parts", "alternatives", "feedback"],
  additionalProperties: false,
};

app.post("/api/sentence-grade", async (req, res) => {
  try {
    const k = patternKey(req.body?.pattern);
    const korean = String(req.body?.korean || "").trim();
    const answer = String(req.body?.answer || "").trim().slice(0, 1000);
    if (!k || !korean || !answer) {
      return res.status(400).json({ error: "요청 정보가 부족합니다." });
    }
    const info = PATTERN_INFO[k];
    const reference = String(req.body?.reference || "").trim();
    const refBlock = reference
      ? `A known-good reference answer in the ${info.name} pattern is: "${reference}". Use it as "best" (or an equally natural sentence in the same pattern).\n\n`
      : "";

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1500,
      system:
        `You are a kind English grammar tutor for Korean learners studying the 5 sentence patterns. ` +
        `The learner translates a Korean sentence into English, and the goal is to write it in the ${info.name} pattern (${info.structure}). ` +
        `The "best" answer MUST follow the ${info.name} pattern. In "parts", split "best" into consecutive chunks in order, each tagged with its role (${info.roles}). ` +
        `Set "matched" = true only if the learner's own answer follows the ${info.name} pattern. ` +
        `Feedback in Korean, short and encouraging; if their sentence was a different pattern, gently explain which one it was and how to make it ${info.name}.`,
      messages: [
        {
          role: "user",
          content:
            refBlock +
            `대상 문형: ${info.name} — ${info.structure}\n` +
            `한국어 문장:\n${korean}\n\n` +
            `학습자가 쓴 영어:\n${answer}\n\n` +
            `이 영작을 평가해줘. ${info.name} 형식의 가장 자연스러운 정답(best), 그 정답의 성분 분해(parts), ` +
            `학습자 답이 그 형식에 맞는지(matched), 같은 형식의 다른 표현(alternatives), 한국어 피드백(feedback), 점수(score)를 줘.`,
        },
      ],
      output_config: {
        format: { type: "json_schema", schema: SENTENCE_GRADE_SCHEMA },
      },
    });
    const text = response.content.find((b) => b.type === "text")?.text ?? "{}";
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = {};
    }
    res.json({
      score: Number.isFinite(parsed.score) ? parsed.score : 0,
      matched: !!parsed.matched,
      best: parsed.best || "",
      parts: Array.isArray(parsed.parts) ? parsed.parts : [],
      alternatives: Array.isArray(parsed.alternatives) ? parsed.alternatives : [],
      feedback: parsed.feedback || "",
    });
  } catch (err) {
    console.error("[/api/sentence-grade] 오류:", err?.message || err);
    const status = err?.status && Number.isInteger(err.status) ? err.status : 500;
    res.status(status).json({ error: err?.message || "채점 중 오류가 발생했습니다." });
  }
});

// ===== Daily English Teacher (1:1 과외 선생님) =====
function teacherSystemPrompt(notes) {
  return (
    `너는 학생의 1:1 영어 과외 선생님이다. 아래 규칙을 항상 지킨다.\n\n` +
    `[학생 정보]\n` +
    `- 레벨: 중급 (토익 650점 정도)\n` +
    `- 목표: 원어민과 일상대화. 특히 사업상 외국인(현재 인도·인도네시아·일본·유럽)과 대화할 일이 많아지고 있음\n` +
    `- 하루 공부 가능 시간: 30분\n` +
    `- 특히 향상시키고 싶은 영역: Speaking / 문장 만들기\n\n` +
    `[수업 규칙]\n` +
    `1. 복습부터: 학생이 "수업 시작하자"라고 하면, 아래 [학습 기록]이 있으면 이전에 배운 표현이나 틀렸던 내용을 활용한 복습 퀴즈 3개를 먼저 낸다. 한 번에 정답을 알려주지 말고 학생이 먼저 답하게 기다린다. 기록이 없으면(첫 수업) 간단한 레벨 체크 문제를 낸다.\n` +
    `2. 문장 교정: 학생이 영어 문장을 쓰면 [내 문장 → 교정 → 이유(쉬운 한국어) → 추가 예문 2개] 순으로 피드백한다. 전체를 불필요하게 바꾸지 말고 틀렸거나 부자연스러운 부분 중심으로 교정한다.\n` +
    `3. 쉬운 설명: 어려운 문법 용어를 최대한 쓰지 말고 한국어로 쉽게 설명한다. 긴 설명보다 짧은 설명 + 실제 쓸 수 있는 예문 2개 이상.\n` +
    `4. 실수 활용: 학생이 자주 틀리는 문법·표현·단어·문장 구조는 [학습 기록]에 적어두고 이후 다시 연습시킨다. 같은 실수를 반복하면 그 패턴을 활용한 영작·빈칸 문제를 만든다.\n` +
    `5. 정답 바로 안 알려주기: 학생이 틀리면 바로 정답부터 주지 말고 먼저 힌트를 한 번 준다. 다시 시도한 뒤에도 틀리면 정답과 이유를 설명한다.\n` +
    `6. 실제 쓰는 영어: 문법적으로 맞아도 원어민이 일상적으로 잘 안 쓰면 더 자연스러운 표현을 알려준다. 교과서적 표현보다 실제 대화에서 자주 쓰는 표현을 우선한다.\n` +
    `7. 칭찬은 구체적으로(무엇을 잘했는지 짧게), 지적은 짧고 명확하게.\n` +
    `8. 마무리: 학생이 "오늘 수업 끝" 또는 비슷한 말을 하면 [오늘 배운 것(핵심 표현/문법) / 오늘 발견한 약점(반복해서 틀린 것) / 내일 숙제(30분 내 분량)] 세 가지를 정리한다.\n\n` +
    `[가장 중요]\n` +
    `이 수업의 목표는 지식을 많이 설명하는 것이 아니라 학생이 직접 영어를 사용하게 만드는 것이다. 설명만 길게 하지 말고 "질문 → 학생 답변 → 교정 → 재시도 → 반복" 순으로 최대한 많이 연습시킨다. 학생이 이전보다 잘하게 된 부분과 계속 틀리는 부분을 구분해 난이도와 문제를 조절한다.\n\n` +
    `[학습 기록] (이 학생의 지금까지의 실수·약점·배운 표현. 매 답변마다 이번 대화를 반영해 갱신한다):\n` +
    (notes && notes.trim() ? notes.trim() : "아직 없음 (첫 수업).") +
    `\n\n[출력 형식 — 반드시 지켜라]\n` +
    `1) 먼저 학생에게 보여줄 말을 쓴다 (위 규칙대로, 한국어 설명 + 영어 예문, 너무 길지 않게).\n` +
    `2) 그 다음 줄에 정확히 "@@@NOTES@@@" 만 쓴다.\n` +
    `3) 그 아래에 갱신된 [학습 기록] 전체를 쓴다 (간결한 불릿, 2000자 이내).\n` +
    `"@@@NOTES@@@" 위쪽만 학생에게 보이고, 아래쪽(학습 기록)은 학생에게 보이지 않는다.`
  );
}

app.post("/api/teacher", async (req, res) => {
  try {
    const notes = String(req.body?.notes || "");
    const history = Array.isArray(req.body?.messages) ? req.body.messages : [];
    // 대화 히스토리 정리 (role/content 만, 최근 40개)
    const messages = history
      .filter(
        (m) =>
          m &&
          (m.role === "user" || m.role === "assistant") &&
          typeof m.content === "string" &&
          m.content.trim()
      )
      .slice(-40)
      .map((m) => ({ role: m.role, content: m.content }));

    if (!messages.length || messages[messages.length - 1].role !== "user") {
      return res.status(400).json({ error: "학생의 입력이 필요합니다." });
    }

    // 스트리밍: 답변을 글자가 나오는 대로 즉시 흘려보낸다 (체감 속도 향상).
    // 본문에는 "...reply... @@@NOTES@@@ ...notes..." 가 그대로 흘러가고,
    // 클라이언트가 구분자로 나눠 앞쪽은 화면에, 뒤쪽(학습 기록)은 저장한다.
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("X-Accel-Buffering", "no");

    const stream = client.messages.stream({
      model: TEACHER_MODEL,
      max_tokens: 2048,
      system: teacherSystemPrompt(notes),
      messages,
    });
    stream.on("text", (t) => res.write(t));
    await stream.finalMessage();
    res.end();
  } catch (err) {
    console.error("[/api/teacher] 오류:", err?.message || err);
    if (!res.headersSent) {
      const status = err?.status && Number.isInteger(err.status) ? err.status : 500;
      res.status(status).json({ error: err?.message || "수업 진행 중 오류가 발생했습니다." });
    } else {
      res.end();
    }
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n영어 학습 앱이 실행되었습니다.`);
  console.log(`  회화:   http://localhost:${PORT}/`);
  console.log(`  쉐도잉: http://localhost:${PORT}/shadowing.html`);
  console.log(`  (Chrome 또는 Edge 브라우저에서 가장 잘 동작합니다.)\n`);
  console.log(`  사용 모델: ${MODEL}\n`);
});
