const { onRequest, onCall, HttpsError } = require("firebase-functions/v2/https");
const OpenAI = require("openai");
const admin = require("firebase-admin");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg");
const path = require("path");
const os = require("os");
const fs = require("fs");
const { google } = require("googleapis");
const { YoutubeTranscript } = require("youtube-transcript");
const axios = require("axios");

// Firebase Admin SDK 초기화 (Firestore 서버 사이드 쓰기용)
admin.initializeApp();
const adminDb = admin.firestore();

// FFmpeg 바이너리 경로 설정 (@ffmpeg-installer/ffmpeg 번들 바이너리)
ffmpeg.setFfmpegPath(ffmpegInstaller.path);

// ────────────────────────────────────────────────────────────
// 테스트용 함수
// ────────────────────────────────────────────────────────────
exports.testAI = onRequest((req, res) => {
  const openai = new OpenAI();
  res.send("비밀 금고에 AI 두뇌 탑재 완료!");
});

// ────────────────────────────────────────────────────────────
// AI 인사말 생성 함수
// ────────────────────────────────────────────────────────────
exports.generateGreeting = onCall(async (request) => {
  const openai = new OpenAI();
  const { name, persona } = request.data;

  if (!name || !persona) {
    throw new HttpsError("invalid-argument", "name과 persona는 필수 값입니다.");
  }

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: `당신은 ${name}입니다. 성격 및 특징은 다음과 같습니다: ${persona}. 팬들에게 할 법한 매력적인 첫 인사말을 1~2문장으로 작성해주세요.`,
        },
      ],
    });

    const greeting = completion.choices[0].message.content;
    return { greeting };
  } catch (error) {
    console.error("OpenAI API 오류:", error);
    throw new HttpsError("internal", "AI 인사말 생성 중 오류가 발생했습니다.");
  }
});

// ────────────────────────────────────────────────────────────
// 일일 트렌드 레이더: OpenAI → Firestore Today_Trends 저장
// 클라이언트에서 수동 호출 (onCall) + 향후 스케줄러 연동 가능
// ────────────────────────────────────────────────────────────
exports.fetchTodayTrends = onCall(
  { timeoutSeconds: 120, memory: "512MiB" },
  async (_request) => {
    const openai = new OpenAI();

    const today = new Date().toLocaleDateString("ko-KR", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    const systemPrompt = `당신은 글로벌 숏폼 SNS(TikTok, Instagram Reels, YouTube Shorts) 트렌드 분석 전문가입니다.
반드시 유효한 JSON만 반환하고, 다른 텍스트는 절대 포함하지 마세요.`;

    const userPrompt = `오늘(${today}) 기준으로 가장 트렌디한 숏폼 콘텐츠 대주제 10개와,
각 대주제에 속하는 크리에이터 페르소나(소주제) 3개씩을 아래 JSON 형식으로 반환하세요.

{
  "categories": [
    {
      "label": "대주제 이름 (한국어, 10자 이내)",
      "icon": "대주제를 표현하는 이모지 1개",
      "subs": [
        {
          "name": "크리에이터 컨셉명 (한국어, 12자 이내)",
          "voice": "이 크리에이터의 목소리 톤/전달 스타일 (20자 이내)",
          "prompt": "이 크리에이터의 페르소나를 설명하는 2~3문장. 시청자에게 어떤 가치를 주는지 포함."
        }
      ]
    }
  ]
}

조건:
- 대주제 정확히 10개
- 각 대주제마다 소주제 정확히 3개
- 최신 글로벌 트렌드 반영 (AI, 재테크, 웰니스, 밈, 스포츠, 뷰티, 먹방 등 다양하게)
- 한국 시청자에게 공감되는 내용 위주`;

    try {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.85,
      });

      const raw = completion.choices[0].message.content;
      const parsed = JSON.parse(raw);

      if (!parsed.categories || !Array.isArray(parsed.categories)) {
        throw new HttpsError("internal", "AI 응답 형식이 올바르지 않습니다.");
      }

      // Firestore Today_Trends/latest 문서에 덮어쓰기
      await adminDb.collection("Today_Trends").doc("latest").set({
        categories: parsed.categories,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        date: today,
      });

      console.log(`트렌드 ${parsed.categories.length}개 저장 완료 (${today})`);
      return { success: true, count: parsed.categories.length, date: today };

    } catch (error) {
      console.error("트렌드 수집 오류:", error);
      if (error instanceof HttpsError) throw error;
      throw new HttpsError("internal", `트렌드 수집 실패: ${error.message}`);
    }
  }
);

// ────────────────────────────────────────────────────────────
// Tavily Search API 헬퍼 — 바이럴 스토리 실시간 검색
// SEARCH_API_KEY 는 functions/.env 에서 로드
// ────────────────────────────────────────────────────────────
async function searchTrendingStories(query) {
  const apiKey = process.env.SEARCH_API_KEY;
  if (!apiKey) throw new Error("SEARCH_API_KEY가 설정되지 않았습니다.");

  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: "advanced",
      include_answer: true,
      include_raw_content: true,
      max_results: 5,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Tavily API 오류 (${res.status}): ${err.detail ?? err.message ?? "알 수 없는 오류"}`);
  }

  const data = await res.json();
  return {
    answer: data.answer ?? "",
    // raw_content 우선, 없으면 content 사용 — 3000자로 트림하여 컨텍스트 전달
    results: (data.results ?? []).slice(0, 3).map((r) => ({
      title: r.title ?? "",
      url: r.url ?? "",
      content: (r.raw_content ?? r.content ?? "").slice(0, 3000),
    })),
  };
}

// ────────────────────────────────────────────────────────────
// YouTube Shorts 검색 + 자막(Transcript) 추출 헬퍼
// YOUTUBE_API_KEY 는 functions/.env 에서 로드
// ────────────────────────────────────────────────────────────
async function searchYoutubeShortsTranscript(keyword, maxResults = 3) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) throw new Error("YOUTUBE_API_KEY가 설정되지 않았습니다.");

  const youtube = google.youtube({ version: "v3", auth: apiKey });

  // Step A: YouTube Data API v3 — Shorts 검색 (조회수 순)
  const searchRes = await youtube.search.list({
    part: "snippet",
    q: `${keyword} #shorts`,
    type: "video",
    videoDuration: "short",
    maxResults,
    order: "viewCount",
    relevanceLanguage: "ko",
    regionCode: "KR",
  });

  const items = searchRes.data.items ?? [];
  if (items.length === 0) {
    return { results: [] };
  }

  // Step B: 각 videoId에서 Transcript 추출 후 텍스트 합산
  const results = [];
  for (const item of items) {
    const videoId = item.id?.videoId;
    const title = item.snippet?.title ?? "";
    if (!videoId) continue;

    let transcript = "";
    try {
      const segments = await YoutubeTranscript.fetchTranscript(videoId, { lang: "ko" });
      transcript = segments.map((s) => s.text).join(" ").trim();
    } catch (_) {
      // 한국어 자막 없으면 영어 시도
      try {
        const segments = await YoutubeTranscript.fetchTranscript(videoId);
        transcript = segments.map((s) => s.text).join(" ").trim();
      } catch (_inner) {
        transcript = "";
      }
    }

    if (transcript.length > 0) {
      results.push({
        videoId,
        title,
        url: `https://www.youtube.com/shorts/${videoId}`,
        transcript: transcript.slice(0, 4000),
      });
    }
  }

  return { results };
}

// ────────────────────────────────────────────────────────────
// 자율 검색 AI 에이전트: Function Calling → 웹 검색 → 원본 전문 추출 → 각색
// 완료 후 Firestore series 자동 저장, seriesId 반환
// ────────────────────────────────────────────────────────────
exports.generateSynopsis = onCall(
  { timeoutSeconds: 120, memory: "512MiB" },
  async (request) => {
    const openai = new OpenAI();
    const { name, persona, creatorId } = request.data;

    if (!name || !persona) {
      throw new HttpsError("invalid-argument", "name과 persona는 필수입니다.");
    }

    // ── OpenAI Function Calling 도구 정의 ──────────────────────
    const SEARCH_TOOL = {
      type: "function",
      function: {
        name: "search_trending_stories",
        description:
          "텍스트 기반 바이럴 콘텐츠(네이트판·에펨코리아·블라인드·온라인 커뮤니티)에서 실제로 터진 썰·사이다 스토리·역전 드라마를 웹에서 실시간 검색한다. 주제가 '인간관계 갈등', '직장 썰', '연애 막장', '복수 드라마' 등 텍스트 스토리텔링에 어울릴 때 호출한다.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description:
                "검색 쿼리 (한국어). 크리에이터 페르소나에 어울리는 바이럴 스토리 유형 명시. 예: '직장 갑질 사이다 썰 레전드', '연인 배신 역전 이야기 바이럴'",
            },
          },
          required: ["query"],
        },
      },
    };

    const YOUTUBE_TOOL = {
      type: "function",
      function: {
        name: "search_youtube_shorts_transcript",
        description:
          "유튜브 쇼츠에서 실제 영상을 검색하고, 해당 영상의 실제 음성 대사(자막/Transcript)를 100% 텍스트로 추출한다. 주제가 '뷰티·스킨케어', '꿀팁·생활정보', '브이로그', '먹방', '운동·헬스', '요리', '여행', '챌린지', '리뷰' 등 실제 영상 콘텐츠를 기반으로 각색할 때 호출한다. 실제 영상 크리에이터의 말투·표현·구성을 그대로 차용하여 각색 베이스로 삼는다.",
        parameters: {
          type: "object",
          properties: {
            keyword: {
              type: "string",
              description:
                "유튜브 쇼츠 검색 키워드 (한국어). 크리에이터 분야에 맞는 실제 영상 콘텐츠 유형 명시. 예: '피부 관리 꿀팁', '자취 요리 간단 레시피', '홈트 루틴 10분'",
            },
          },
          required: ["keyword"],
        },
      },
    };

    const systemPrompt = `너는 바이럴 스토리 각색 전문가다. 검색된 원본 콘텐츠의 재미 요소를 100% 살려 N부작 숏폼 시리즈로 구조화하는 것이 유일한 임무다.

【도구 자율 선택 기준 — 반드시 준수】
- 주제가 '썰', '갈등 드라마', '인간관계', '직장', '연애 막장', '복수', '사이다' 등 텍스트 스토리 기반이면 → search_trending_stories 호출
- 주제가 '뷰티', '꿀팁', '브이로그', '먹방', '운동', '요리', '여행', '챌린지', '리뷰', '정보성' 등 실제 영상 콘텐츠 기반이면 → search_youtube_shorts_transcript 호출
- 두 성격이 혼재하면 페르소나의 핵심 분야를 기준으로 하나를 선택한다.

【절대 금지 — 위반 시 실패 처리】
- 검색된 원본 본문을 무시하고 뻔하고 건전한 새 이야기를 지어내는 행위
- 원본의 자극적이거나 유머러스한 포인트를 "순화"하여 밋밋하게 만드는 행위
- 원본에 없는 AI식 클리셰 임의 삽입
- 검색 도구를 호출하지 않고 훈련 데이터만으로 이야기를 창작하는 행위

【반드시 지켜야 할 원칙】
1. 작업 시작 시 반드시 위 기준에 맞는 도구를 먼저 호출하여 원본 콘텐츠를 확보하라.
2. 확보한 원본의 구체적 사건·갈등 포인트·말투·표현·결말을 그대로 보존하라.
3. 너의 역할은 오직 "호흡 조절과 편수 구조화"뿐이다: 원본을 N화로 나누고 각 화 말미에 클리프행어를 배치하라.
4. 원본이 막장이면 막장으로, 사이다면 사이다로, 웃기면 웃기게 — 원본의 톤과 강도를 그대로 유지하라.
5. 반드시 유효한 JSON만 반환하고 다른 텍스트는 절대 포함하지 마라.`;

    const userPrompt = `각색 대상 크리에이터:
이름: ${name}
페르소나: ${persona}

이 크리에이터를 주인공으로 한 4~10부작 완결형 숏폼 시리즈를 기획하라.
먼저 search_trending_stories 도구를 호출하여 적합한 바이럴 스토리를 검색하고, 결과를 바탕으로 각색하라.`;

    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ];

    try {
      // ── Step 1: AI가 검색 도구 자율 호출 (auto) ───────────────
      const step1 = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages,
        tools: [SEARCH_TOOL, YOUTUBE_TOOL],
        tool_choice: "auto",
      });

      const assistantMsg = step1.choices[0].message;
      messages.push(assistantMsg);
      console.log("[generateSynopsis] Step1 finish_reason:", step1.choices[0].finish_reason);

      // ── Step 2: 도구 호출 처리 (Tavily 또는 YouTube 분기) ──────
      for (const toolCall of assistantMsg.tool_calls ?? []) {
        let searchContent;

        if (toolCall.function.name === "search_trending_stories") {
          let args;
          try { args = JSON.parse(toolCall.function.arguments); } catch (_) { args = {}; }
          const query = args.query ?? `${persona} 바이럴 스토리 레전드 썰`;
          console.log("[generateSynopsis] Tavily 검색 쿼리:", query);

          try {
            const result = await searchTrendingStories(query);
            searchContent = JSON.stringify(result);
            console.log("[generateSynopsis] Tavily 검색 완료, 결과 수:", result.results?.length);
          } catch (e) {
            console.warn("[generateSynopsis] Tavily 검색 실패, 폴백:", e.message);
            searchContent = JSON.stringify({ answer: "", results: [] });
          }

        } else if (toolCall.function.name === "search_youtube_shorts_transcript") {
          let args;
          try { args = JSON.parse(toolCall.function.arguments); } catch (_) { args = {}; }
          const keyword = args.keyword ?? `${persona} 쇼츠`;
          console.log("[generateSynopsis] YouTube 검색 키워드:", keyword);

          try {
            const result = await searchYoutubeShortsTranscript(keyword);
            searchContent = JSON.stringify(result);
            console.log("[generateSynopsis] YouTube 자막 추출 완료, 결과 수:", result.results?.length);
          } catch (e) {
            console.warn("[generateSynopsis] YouTube 추출 실패, 폴백:", e.message);
            searchContent = JSON.stringify({ results: [] });
          }

        } else {
          continue;
        }

        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: searchContent,
        });
      }

      // ── Step 3: 검색 결과 기반 시놉시스 JSON 최종 생성 ─────────
      messages.push({
        role: "user",
        content: `위에서 검색된 원본 콘텐츠(웹 스토리 또는 유튜브 쇼츠 실제 대사) 중 가장 풍부하고 흥미로운 것을 선택하여 아래 JSON 형식으로 응답하라.
유튜브 쇼츠 자막이 원본인 경우, transcript 필드의 실제 대사를 originalFullText에 그대로 사용하라.

【1단계 — 원본 전문 추출 (절대 요약·축약 금지)】
가장 재미있는 원본을 골라 핵심 이야기/대사 본문 전체를 originalFullText에 그대로 옮겨라.
광고·사이트 메뉴·관련 링크 등 콘텐츠와 무관한 텍스트는 제거하되, 실제 이야기·대사 본문은 한 자도 줄이지 마라. (최소 400자 이상)

【2단계 — N부작 시리즈 구조화 (원본 톤·결말 완전 보존)】
originalFullText의 플롯·갈등·결말을 그대로 유지하면서 ${name}의 페르소나에 맞는 인물·배경으로만 바꿔 4~10화 시리즈로 구조화하라.

【자체 검증 필수 — 3가지 모두 충족해야 반환 가능】
□ originalFullText가 원본 이야기 본문을 400자 이상 담고 있는가?
□ episodes 각 항목에 원본의 구체적 사건·갈등이 살아있는가?
□ 마지막 에피소드에 원본 사이다/막장/반전 결말이 명확히 반영되어 있는가?

{
  "originalFullText": "원본 이야기 핵심 본문 전체 — 400자 이상, 절대 요약·축약 금지",
  "seriesTitle": "각색 시리즈 전체 제목 (25자 이내)",
  "fullSynopsis": "전체 시리즈 흐름 요약 (200~350자, 원본 톤 완전 유지)",
  "episodes": [
    { "number": 1, "title": "1화 제목", "summary": "1화 줄거리 (100~150자, 구체적 사건 명시)" },
    { "number": 2, "title": "2화 제목", "summary": "2화 줄거리 (100~150자)" }
  ],
  "originalTitle": "원본 스토리 제목 또는 핵심 키워드",
  "originalReference": "출처 플랫폼 + 핵심 키워드 (예: '유튜브 쇼츠 - 직장 갑질 사이다 썰')",
  "originalReferenceUrl": "검색에서 발견한 실제 URL (없으면 null)",
  "preservedPlotPoints": ["원본에서 보존한 핵심 갈등/사건 포인트 3개 이상"]
}

시리즈 요구사항:
- 편수 4~10편, 기승전결 완결형 (열린 결말 금지)
- 각 화 말미: 강력한 클리프행어 (마지막 화 제외)
- 마지막 화: 원본 결말 기반 사이다/카타르시스 엔딩 필수
- 인물·배경은 ${name}의 페르소나로 각색, 플롯·갈등·결말은 원본 그대로`,
      });

      const step3 = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        messages,
        temperature: 0.85,
        max_tokens: 3000,
      });

      const parsed = JSON.parse(step3.choices[0].message.content);

      // ── 필수 필드 검증 ────────────────────────────────────────
      if (!parsed.originalFullText || !parsed.seriesTitle || !parsed.fullSynopsis) {
        throw new HttpsError("internal", "AI 응답 형식이 올바르지 않습니다 (필수 필드 누락).");
      }
      if (!Array.isArray(parsed.episodes) || parsed.episodes.length < 2) {
        throw new HttpsError("internal", "에피소드 구성이 올바르지 않습니다 (최소 2화 필요).");
      }
      if ((parsed.originalFullText ?? "").length < 200) {
        throw new HttpsError("internal", "원본 전문 추출 실패: 본문이 너무 짧습니다. 다시 시도해주세요.");
      }

      const preservedPoints = Array.isArray(parsed.preservedPlotPoints)
        ? parsed.preservedPlotPoints.filter((p) => typeof p === "string" && p.trim().length > 0)
        : [];
      if (preservedPoints.length < 2) {
        throw new HttpsError("internal", "원본 플롯 보존 검증 실패: 핵심 갈등 포인트가 부족합니다. 다시 시도해주세요.");
      }

      console.log("[generateSynopsis] 검증 완료 — 에피소드:", parsed.episodes.length, "개 | 원본전문:", parsed.originalFullText.length, "자");

      // ── Firestore series 자동 저장 ────────────────────────────
      let savedSeriesId = null;
      if (creatorId) {
        try {
          const seriesRef = await adminDb
            .collection("creators").doc(creatorId)
            .collection("series").add({
              title: parsed.seriesTitle,
              fullSynopsis: parsed.fullSynopsis,
              originalFullText: parsed.originalFullText,
              episodes: parsed.episodes,
              originalTitle: parsed.originalTitle ?? "",
              originalReference: parsed.originalReference ?? "",
              originalReferenceUrl: parsed.originalReferenceUrl ?? null,
              preservedPlotPoints: preservedPoints,
              status: "draft",
              createdAt: admin.firestore.FieldValue.serverTimestamp(),
            });
          savedSeriesId = seriesRef.id;
          console.log("[generateSynopsis] Firestore 저장 완료:", savedSeriesId);
        } catch (saveErr) {
          console.warn("[generateSynopsis] Firestore 저장 실패 (비치명적):", saveErr.message);
        }
      }

      return {
        seriesId: savedSeriesId,
        originalFullText: parsed.originalFullText,
        seriesTitle: parsed.seriesTitle,
        fullSynopsis: parsed.fullSynopsis,
        episodes: parsed.episodes,
        originalTitle: parsed.originalTitle ?? "",
        originalReference: parsed.originalReference ?? "",
        originalReferenceUrl: parsed.originalReferenceUrl ?? null,
        preservedPlotPoints: preservedPoints,
      };
    } catch (error) {
      console.error("[generateSynopsis] 오류:", error.message);
      if (error instanceof HttpsError) throw error;
      throw new HttpsError("internal", `시놉시스 생성 실패: ${error.message}`);
    }
  }
);

// ────────────────────────────────────────────────────────────
// 시네마틱 초정밀 이미지 프롬프트 생성기 (GPT-4o 전문 촬영 감독 모드)
// 각 씬의 direction(한국어 연출 지시문)을 gpt-image-2에 최적화된
// 초정밀 영문 시네마틱 프롬프트로 변환
// ────────────────────────────────────────────────────────────
async function generateCinematicPrompts(scenes, name, persona) {
  const openai = new OpenAI();

  const systemPrompt = `You are a professional cinematographer generating ultra-precise image prompts for a vertical 9:16 short-form video series.

CREATOR PROFILE — embed this in EVERY prompt without exception:
Name: ${name}
Persona description: ${persona ?? "young adult content creator"}

MANDATORY STRUCTURE — every prompt MUST include all 4 elements:
① CAMERA ANGLE & LENS: exact shot type (extreme close-up / medium shot / wide establishing shot / over-the-shoulder / low-angle / high-angle / POV) + lens character (50mm portrait / 24mm wide / 85mm telephoto bokeh)
② SUBJECT: precise physical appearance derived from the creator persona — gender, approximate age, facial expression, body posture, clothing details. NEVER depict a subject whose gender or age contradicts the creator profile.
③ LIGHTING & COLOR: specific light source + direction + color temperature (e.g., "warm 3200K golden sunlight streaming through frosted glass from upper left", "cold 6500K blue neon sign reflecting off rain-soaked asphalt", "harsh 5600K fluorescent overhead casting deep shadows")
④ BACKGROUND DETAILS: 2–3 concrete environmental elements that reinforce the narrative (e.g., "worn laminated menu board, grease-stained counter, flickering strip light overhead", "stack of overdue invoices, cold coffee in paper cup, rain-streaked office window at night")

PROHIBITIONS:
- No abstract emotional adjectives without visual grounding ("beautiful", "sad", "dramatic" alone are banned)
- No subject whose appearance contradicts the creator persona profile
- No generic descriptions ("a person", "outdoor setting", "nice lighting")
- Do NOT include any Korean text in the prompts

OUTPUT: JSON only → { "prompts": ["full English prompt for scene 1", "full English prompt for scene 2", ...] }`;

  const scenesText = scenes
    .map((s, i) => `Scene ${i + 1} (Korean direction): ${s.direction}`)
    .join("\n\n");

  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: `Convert all ${scenes.length} scene directions below into cinematic image generation prompts.\n\n${scenesText}`,
      },
    ],
    temperature: 0.7,
    max_tokens: 3000,
  });

  const result = JSON.parse(completion.choices[0].message.content);
  const prompts = Array.isArray(result.prompts) ? result.prompts : [];
  console.log("[generateCinematicPrompts] 변환 완료, 프롬프트 수:", prompts.length);
  return prompts;
}

// ────────────────────────────────────────────────────────────
// 확정된 시놉시스 → 씬 분할 + 시네마틱 비주얼 프롬프트 자동 생성
// ────────────────────────────────────────────────────────────
exports.generateScenesFromSynopsis = onCall(
  { timeoutSeconds: 120, memory: "512MiB" },
  async (request) => {
    const openai = new OpenAI();
    const { synopsis, name, persona } = request.data;

    if (!synopsis || !name) {
      throw new HttpsError("invalid-argument", "synopsis와 name은 필수입니다.");
    }

    const systemPrompt = `당신은 숏폼 영상 대본 전문 작가입니다.
반드시 유효한 JSON만 반환하고, 다른 텍스트는 절대 포함하지 마세요.`;

    const userPrompt = `다음은 크리에이터 '${name}'(페르소나: ${persona ?? ""})의 시리즈 시놉시스입니다.

[시놉시스]
${synopsis}

위 시놉시스를 바탕으로 1화에 해당하는 1분 숏폼 비디오 대본을 아래 JSON 형식으로 작성하세요.

{
  "title": "1화 영상 제목 (시청자 클릭을 유도하는 흥미로운 제목)",
  "scenes": [
    {
      "sceneNumber": 1,
      "direction": "카메라 앵글·배경·분위기 등 구체적인 화면 연출 지시문 (1~2문장)",
      "dialogue": "크리에이터가 실제로 말하는 자연스러운 대사 (2~4문장, 개성이 드러나도록)"
    }
  ]
}

조건:
- scenes 최소 5개 ~ 최대 15개 (1화 내용의 밀도와 호흡에 맞춰 자율 결정)
- 각 씬은 30~60초 분량의 단일 사건/감정에 집중
- '${name}'의 개성이 대사에 분명히 드러날 것
- 1화 내용 기반으로 구성하고 말미에 2화 예고 뉘앙스 포함`;

    try {
      // ── Step 1: 씬 대본 분할 (gpt-4o-mini) ──────────────────
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.9,
      });
      const parsed = JSON.parse(completion.choices[0].message.content);
      if (!parsed.title || !Array.isArray(parsed.scenes) || parsed.scenes.length === 0) {
        throw new HttpsError("internal", "AI 응답 형식이 올바르지 않습니다.");
      }
      console.log("[generateScenesFromSynopsis] 씬 분할 완료, 씬 수:", parsed.scenes.length);

      // ── Step 2: 시네마틱 초정밀 프롬프트 변환 (gpt-4o) ──────
      const cinematicPrompts = await generateCinematicPrompts(parsed.scenes, name, persona);

      const scenesWithVisualPrompts = parsed.scenes.map((scene, i) => ({
        ...scene,
        visualPrompt: cinematicPrompts[i] ?? scene.direction,
      }));

      return { title: parsed.title, scenes: scenesWithVisualPrompts };
    } catch (error) {
      console.error("[generateScenesFromSynopsis] 오류:", error.message);
      if (error instanceof HttpsError) throw error;
      throw new HttpsError("internal", `씬 분할 실패: ${error.message}`);
    }
  }
);

// ────────────────────────────────────────────────────────────
// 크리에이터 숏폼 콘텐츠(대본) 생성 — JSON 구조화 응답
// ────────────────────────────────────────────────────────────
exports.generateContent = onCall(async (request) => {
  const openai = new OpenAI();
  const { name, prompt } = request.data;

  if (!name || !prompt) {
    throw new HttpsError("invalid-argument", "name과 prompt는 필수입니다.");
  }

  const systemPrompt = `당신은 숏폼 영상 대본 전문 작가입니다.
반드시 유효한 JSON만 반환하고, 다른 텍스트는 절대 포함하지 마세요.`;

  const userPrompt = `당신은 ${prompt} 성격을 가진 크리에이터 '${name}'입니다.
당신의 성격과 전문 분야에 딱 맞는 1분 분량의 숏폼 비디오 대본을 아래 JSON 형식으로 작성하세요.

{
  "title": "영상 제목 (한 줄, 시청자의 클릭을 유도하는 흥미로운 제목)",
  "scenes": [
    {
      "sceneNumber": 1,
      "direction": "카메라 앵글·배경·분위기 등 구체적인 화면 연출 지시문 (1~2문장)",
      "dialogue": "크리에이터가 실제로 말하는 자연스러운 대사 (2~4문장, 개성이 드러나도록)"
    }
  ]
}

조건:
- 장면(scenes) 수: 정확히 5개
- 크리에이터 '${name}'의 개성이 대사에 분명히 드러날 것
- direction은 영상 편집자가 실제로 쓸 수 있는 구체적 지시문`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.9,
    });

    const parsed = JSON.parse(completion.choices[0].message.content);

    if (!parsed.title || !Array.isArray(parsed.scenes) || parsed.scenes.length === 0) {
      throw new HttpsError("internal", "AI 응답 형식이 올바르지 않습니다.");
    }

    return { title: parsed.title, scenes: parsed.scenes };
  } catch (error) {
    console.error("콘텐츠 생성 오류:", error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", `콘텐츠 생성 실패: ${error.message}`);
  }
});

// ────────────────────────────────────────────────────────────
// 씬 연출 지시문 → gpt-image-2 이미지 생성 → Firebase Storage 업로드
// ────────────────────────────────────────────────────────────
exports.generateSceneImage = onCall(
  { timeoutSeconds: 120, memory: "512MiB" },
  async (request) => {
    const { visualPrompt, creatorId, seriesId, episodeId, sceneIndex } = request.data;

    if (!visualPrompt || !creatorId || !seriesId || !episodeId || sceneIndex == null) {
      throw new HttpsError("invalid-argument", "visualPrompt, creatorId, seriesId, episodeId, sceneIndex는 필수입니다.");
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new HttpsError("internal", "OPENAI_API_KEY 환경 변수가 없습니다.");
    }

    // visualPrompt is already a GPT-4o cinematic prompt — append format/quality specs only
    const enhancedPrompt = `${visualPrompt}. Vertical 9:16 smartphone format, photorealistic, ultra-sharp focus, cinematic color grade, no text overlays.`;
    console.log("[generateSceneImage] 시작, sceneIndex:", sceneIndex);

    let res;
    try {
      res = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-image-2",
          prompt: enhancedPrompt,
          n: 1,
          size: "1024x1536",
          quality: "low",
          output_format: "jpeg",
        }),
      });
    } catch (networkError) {
      throw new HttpsError("internal", `네트워크 오류: ${networkError.message}`);
    }

    const data = await res.json();
    console.log("[OpenAI Response] Keys:", Object.keys(data));

    if (!res.ok) {
      const msg = data?.error?.message ?? `HTTP ${res.status}`;
      throw new HttpsError("internal", `이미지 생성 실패: ${msg}`);
    }

    const b64 = data?.data?.[0]?.b64_json;
    if (!b64) {
      throw new HttpsError("internal", "이미지 데이터를 받지 못했습니다.");
    }

    // Base64 → Buffer → Firebase Storage 업로드
    const imgBuffer = Buffer.from(b64, "base64");
    const storagePath = `creators/${creatorId}/series/${seriesId}/episodes/${episodeId}/scene_${sceneIndex}.jpg`;
    const bucket = admin.storage().bucket();
    const file = bucket.file(storagePath);
    await file.save(imgBuffer, { contentType: "image/jpeg" });
    const [imageUrl] = await file.getSignedUrl({
      action: "read",
      expires: Date.now() + 365 * 24 * 60 * 60 * 1000,
    });

    console.log("[generateSceneImage] Storage 업로드 완료:", storagePath);
    return { imageUrl };
  }
);

// ────────────────────────────────────────────────────────────
// FFmpeg 기반 클라우드 비디오 렌더링 파이프라인
// ────────────────────────────────────────────────────────────
exports.generateFinalVideo = onCall(
  { timeoutSeconds: 540, memory: "2GiB" },
  async (request) => {
    const { creatorId, seriesId, episodeId } = request.data;

    if (!creatorId || !seriesId || !episodeId) {
      throw new HttpsError("invalid-argument", "creatorId, seriesId, episodeId는 필수입니다.");
    }

    // ── Firestore 에피소드 조회 ──────────────────────────────
    const episodeRef = adminDb
      .collection("creators").doc(creatorId)
      .collection("series").doc(seriesId)
      .collection("episodes").doc(episodeId);
    const episodeSnap = await episodeRef.get();

    if (!episodeSnap.exists) {
      throw new HttpsError("not-found", "에피소드를 찾을 수 없습니다.");
    }

    const episode = episodeSnap.data();
    const scenes = episode.scenes ?? [];

    // ── 씬 데이터 검증 ────────────────────────────────────────
    const incompleteScenes = scenes
      .map((s, i) => ({ i: i + 1, hasImg: !!s.imageUri, hasAudio: !!s.audioUri }))
      .filter((s) => !s.hasImg || !s.hasAudio);

    if (incompleteScenes.length > 0) {
      const detail = incompleteScenes
        .map((s) => `씬${s.i}(${!s.hasImg ? "이미지 " : ""}${!s.hasAudio ? "오디오" : ""} 없음)`)
        .join(", ");
      throw new HttpsError("failed-precondition", `합성 불가 — ${detail}`);
    }

    const sessionId = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const tmpDir = os.tmpdir();
    const tmpFiles = [];

    // FFmpeg 명령 실행 헬퍼
    const runFfmpeg = (cmd) =>
      new Promise((resolve, reject) => {
        cmd
          .on("start", (c) => console.log("[FFmpeg]", c.slice(0, 120)))
          .on("end", resolve)
          .on("error", (err, _stdout, stderr) => {
            console.error("[FFmpeg stderr]", (stderr || "").slice(0, 400));
            reject(new Error(stderr || err.message));
          })
          .run();
      });

    try {
      // ── 각 씬: Storage URL에서 파일 다운로드 + 개별 클립 생성 ─
      const clipPaths = [];
      for (let i = 0; i < scenes.length; i++) {
        const scene = scenes[i];

        const imgPath   = path.join(tmpDir, `img_${sessionId}_${i}.jpg`);
        const audioPath = path.join(tmpDir, `audio_${sessionId}_${i}.mp3`);
        const clipPath  = path.join(tmpDir, `clip_${sessionId}_${i}.mp4`);
        tmpFiles.push(imgPath, audioPath, clipPath);

        // Storage URL(signed URL 또는 공개 URL)에서 직접 다운로드
        const [imgRes, audioRes] = await Promise.all([
          fetch(scene.imageUri),
          fetch(scene.audioUri),
        ]);
        if (!imgRes.ok)   throw new Error(`이미지 다운로드 실패 (씬 ${i + 1}): HTTP ${imgRes.status}`);
        if (!audioRes.ok) throw new Error(`오디오 다운로드 실패 (씬 ${i + 1}): HTTP ${audioRes.status}`);

        fs.writeFileSync(imgPath,   Buffer.from(await imgRes.arrayBuffer()));
        fs.writeFileSync(audioPath, Buffer.from(await audioRes.arrayBuffer()));

        await runFfmpeg(
          ffmpeg()
            .input(imgPath).inputOptions(["-loop 1"])
            .input(audioPath)
            .videoCodec("libx264")
            .outputOptions([
              "-tune stillimage",
              "-pix_fmt yuv420p",
              "-shortest",
              "-movflags +faststart",
            ])
            .audioCodec("aac").audioBitrate("128k")
            .output(clipPath)
        );
        clipPaths.push(clipPath);
        console.log(`[generateFinalVideo] 클립 ${i + 1}/${scenes.length} 완료`);
      }

      // ── concat 목록 파일 작성 ─────────────────────────────
      const listPath  = path.join(tmpDir, `list_${sessionId}.txt`);
      const finalPath = path.join(tmpDir, `final_${sessionId}.mp4`);
      tmpFiles.push(listPath, finalPath);

      fs.writeFileSync(listPath, clipPaths.map((p) => `file '${p}'`).join("\n"));

      // ── 개별 클립 → 최종 영상 병합 ───────────────────────
      await runFfmpeg(
        ffmpeg()
          .input(listPath).inputOptions(["-f concat", "-safe 0"])
          .outputOptions(["-c copy"])
          .output(finalPath)
      );
      console.log("[generateFinalVideo] 최종 병합 완료");

      // ── Firebase Storage 업로드 ───────────────────────────
      const storagePath = `creators/${creatorId}/series/${seriesId}/episodes/${episodeId}/final.mp4`;
      const bucket = admin.storage().bucket();

      await bucket.upload(finalPath, {
        destination: storagePath,
        metadata: { contentType: "video/mp4" },
      });

      // 서명된 다운로드 URL 발급 (1년)
      const [videoUrl] = await bucket.file(storagePath).getSignedUrl({
        action: "read",
        expires: Date.now() + 365 * 24 * 60 * 60 * 1000,
      });
      console.log("[generateFinalVideo] Storage 업로드 완료");

      // ── Firestore 업데이트 ───────────────────────────────
      await episodeRef.update({ videoUrl });

      return { videoUrl };
    } finally {
      // 임시 파일 일괄 삭제
      for (const f of tmpFiles) {
        try { fs.unlinkSync(f); } catch (_) {}
      }
    }
  }
);

// ────────────────────────────────────────────────────────────
// 씬 대사 → OpenAI TTS 오디오 생성 → Firebase Storage 업로드
// ────────────────────────────────────────────────────────────
exports.generateSceneAudio = onCall(
  { timeoutSeconds: 60, memory: "256MiB" },
  async (request) => {
    const openai = new OpenAI();
    const { dialogue, voice, creatorId, seriesId, episodeId, sceneIndex } = request.data;

    if (!dialogue || !creatorId || !seriesId || !episodeId || sceneIndex == null) {
      throw new HttpsError("invalid-argument", "dialogue, creatorId, seriesId, episodeId, sceneIndex는 필수입니다.");
    }

    const VALID_VOICES = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"];
    const selectedVoice = VALID_VOICES.includes(voice) ? voice : "nova";
    console.log("[generateSceneAudio] voice:", selectedVoice, "sceneIndex:", sceneIndex);

    try {
      const mp3 = await openai.audio.speech.create({
        model: "tts-1",
        voice: selectedVoice,
        input: dialogue,
      });

      const buffer = Buffer.from(await mp3.arrayBuffer());

      // Buffer → Firebase Storage 업로드
      const storagePath = `creators/${creatorId}/series/${seriesId}/episodes/${episodeId}/scene_${sceneIndex}.mp3`;
      const bucket = admin.storage().bucket();
      const file = bucket.file(storagePath);
      await file.save(buffer, { contentType: "audio/mpeg" });
      const [audioUri] = await file.getSignedUrl({
        action: "read",
        expires: Date.now() + 365 * 24 * 60 * 60 * 1000,
      });

      console.log("[generateSceneAudio] Storage 업로드 완료:", storagePath);
      return { audioUri };
    } catch (error) {
      console.error("[generateSceneAudio] 오류:", error.message);
      if (error instanceof HttpsError) throw error;
      throw new HttpsError("internal", `오디오 생성 실패: ${error.message}`);
    }
  }
);

// ────────────────────────────────────────────────────────────
// 직접 입력 분야 기반 AI 페르소나 초안 생성
// ────────────────────────────────────────────────────────────
exports.generatePersonaDraft = onCall(async (request) => {
  const openai = new OpenAI();
  const { field } = request.data;

  if (!field) {
    throw new HttpsError("invalid-argument", "field는 필수입니다.");
  }

  const userPrompt = `"${field}" 분야의 AI 가상 크리에이터를 기획해주세요.
반드시 유효한 JSON만 반환하고 다른 텍스트는 포함하지 마세요.

{
  "name": "크리에이터 이름 (한국어, 12자 이내, 캐릭터성 있게)",
  "voice": "목소리 톤과 전달 스타일 (20자 이내, 예: 친근하고 유쾌한 언니 톤)",
  "prompt": "이 크리에이터의 페르소나 성격 설명 (2~3문장, 시청자에게 주는 가치 포함)"
}`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: userPrompt }],
      temperature: 0.9,
    });

    const parsed = JSON.parse(completion.choices[0].message.content);

    if (!parsed.name || !parsed.voice || !parsed.prompt) {
      throw new HttpsError("internal", "AI 응답 형식이 올바르지 않습니다.");
    }

    return { name: parsed.name, voice: parsed.voice, prompt: parsed.prompt };
  } catch (error) {
    console.error("페르소나 생성 오류:", error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", `페르소나 생성 실패: ${error.message}`);
  }
});

// ────────────────────────────────────────────────────────────
// 크리에이터 전체 데이터 연쇄 삭제
// Firestore: series > episodes 전량 + creator 문서
// Storage: creators/{creatorId}/ 하위 모든 파일
// ────────────────────────────────────────────────────────────
exports.deleteCreatorData = onCall(
  { timeoutSeconds: 120, memory: "256MiB" },
  async (request) => {
    const { creatorId } = request.data;

    if (!creatorId) {
      throw new HttpsError("invalid-argument", "creatorId는 필수입니다.");
    }

    try {
      // ── 1. Storage 하위 파일 전체 삭제 ──────────────────────
      try {
        await admin.storage().bucket().deleteFiles({
          prefix: `creators/${creatorId}/`,
          force: true,
        });
        console.log("[deleteCreatorData] Storage 삭제 완료:", creatorId);
      } catch (storageErr) {
        // Storage 오류는 치명적이지 않으므로 경고만 기록 후 진행
        console.warn("[deleteCreatorData] Storage 삭제 경고 (계속 진행):", storageErr.message);
      }

      // ── 2. Firestore: series > episodes 연쇄 삭제 ───────────
      const seriesSnap = await adminDb
        .collection("creators").doc(creatorId)
        .collection("series").get();

      let deletedEpisodes = 0;
      for (const seriesDoc of seriesSnap.docs) {
        const episodesSnap = await seriesDoc.ref.collection("episodes").get();
        for (const epDoc of episodesSnap.docs) {
          await epDoc.ref.delete();
          deletedEpisodes++;
        }
        await seriesDoc.ref.delete();
      }
      console.log(
        `[deleteCreatorData] Firestore 삭제 완료 — 시리즈: ${seriesSnap.size}, 에피소드: ${deletedEpisodes}`
      );

      // ── 3. 크리에이터 문서 삭제 ─────────────────────────────
      await adminDb.collection("creators").doc(creatorId).delete();
      console.log("[deleteCreatorData] 크리에이터 문서 삭제 완료:", creatorId);

      return {
        success: true,
        deletedSeries: seriesSnap.size,
        deletedEpisodes,
      };
    } catch (error) {
      console.error("[deleteCreatorData] 오류:", error.message);
      if (error instanceof HttpsError) throw error;
      throw new HttpsError("internal", `삭제 실패: ${error.message}`);
    }
  }
);

// ────────────────────────────────────────────────────────────
// ElevenLabs TTS 음성 생성 엔진
// 대본 텍스트 → ElevenLabs API → Firebase Storage → Firestore audioUrl 저장
// 비용 방어선: 1,000자 초과 시 즉시 차단
// ────────────────────────────────────────────────────────────
const ELEVENLABS_DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM"; // Rachel (eleven_multilingual_v2 최적화)
const ELEVENLABS_CHAR_LIMIT = 1000;

exports.generateAudio = onCall(
  { timeoutSeconds: 120, memory: "512MiB" },
  async (request) => {
    const { text, voiceId, storyId } = request.data;

    if (!text || !storyId) {
      throw new HttpsError("invalid-argument", "text와 storyId는 필수입니다.");
    }

    // ── 비용 방어선: 1,000자 초과 즉시 차단 ─────────────────────
    if (text.length > ELEVENLABS_CHAR_LIMIT) {
      throw new HttpsError(
        "invalid-argument",
        `글자 수 제한 초과: 비용 방어선 작동 (${text.length}자 / 최대 ${ELEVENLABS_CHAR_LIMIT}자)`
      );
    }

    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      throw new HttpsError("internal", "ELEVENLABS_API_KEY가 설정되지 않았습니다.");
    }

    const selectedVoiceId = voiceId || ELEVENLABS_DEFAULT_VOICE_ID;
    console.log(`[generateAudio] storyId: ${storyId}, 글자수: ${text.length}, voiceId: ${selectedVoiceId}`);

    // ── ElevenLabs TTS API 호출 ───────────────────────────────
    let audioBuffer;
    try {
      const response = await axios.post(
        `https://api.elevenlabs.io/v1/text-to-speech/${selectedVoiceId}`,
        {
          text,
          model_id: "eleven_multilingual_v2",
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
          },
        },
        {
          headers: {
            "xi-api-key": apiKey,
            "Content-Type": "application/json",
            Accept: "audio/mpeg",
          },
          responseType: "arraybuffer",
          timeout: 60000,
        }
      );

      audioBuffer = Buffer.from(response.data);
      console.log(`[generateAudio] ElevenLabs 응답 완료, 크기: ${audioBuffer.length} bytes`);
    } catch (axiosErr) {
      const status = axiosErr.response?.status;
      const errMsg = axiosErr.response?.data
        ? Buffer.from(axiosErr.response.data).toString("utf8").slice(0, 200)
        : axiosErr.message;
      console.error("[generateAudio] ElevenLabs API 오류:", status, errMsg);
      throw new HttpsError("internal", `ElevenLabs TTS 실패 (${status ?? "네트워크 오류"}): ${errMsg}`);
    }

    // ── Firebase Storage 업로드 ───────────────────────────────
    const storagePath = `stories/${storyId}/audio.mp3`;
    const bucket = admin.storage().bucket();
    const file = bucket.file(storagePath);

    await file.save(audioBuffer, { contentType: "audio/mpeg" });
    const [audioUrl] = await file.getSignedUrl({
      action: "read",
      expires: Date.now() + 365 * 24 * 60 * 60 * 1000,
    });
    console.log("[generateAudio] Storage 업로드 완료:", storagePath);

    // ── Firestore audioUrl 업데이트 ───────────────────────────
    await adminDb.collection("stories").doc(storyId).set(
      { audioUrl, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true }
    );
    console.log("[generateAudio] Firestore 업데이트 완료:", storyId);

    return { audioUrl };
  }
);
