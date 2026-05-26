const { onRequest, onCall, HttpsError } = require("firebase-functions/v2/https");
const OpenAI = require("openai");
const admin = require("firebase-admin");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg");
const path = require("path");
const os = require("os");
const fs = require("fs");

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
      include_raw_content: false,
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
    results: (data.results ?? []).slice(0, 4).map((r) => ({
      title: r.title ?? "",
      url: r.url ?? "",
      snippet: (r.content ?? "").slice(0, 500),
    })),
  };
}

// ────────────────────────────────────────────────────────────
// 자율 검색 AI 에이전트: Function Calling → 웹 검색 → 각색
// JSON { synopsis, originalTitle, originalReference, originalReferenceUrl } 반환
// ────────────────────────────────────────────────────────────
exports.generateSynopsis = onCall(
  { timeoutSeconds: 90, memory: "256MiB" },
  async (request) => {
    const openai = new OpenAI();
    const { name, persona } = request.data;

    if (!name || !persona) {
      throw new HttpsError("invalid-argument", "name과 persona는 필수입니다.");
    }

    // ── OpenAI Function Calling 도구 정의 ──────────────────────
    const SEARCH_TOOL = {
      type: "function",
      function: {
        name: "search_trending_stories",
        description:
          "틱톡·유튜브 쇼츠·인스타그램 릴스·온라인 커뮤니티(에펨코리아·블라인드·네이트판)에서 현재 바이럴 중인 레전드 썰·사이다 스토리·역전 드라마를 웹에서 실시간 검색한다. 각색 베이스를 찾을 때 반드시 먼저 호출한다.",
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

    const systemPrompt = `너는 틱톡, 유튜브 쇼츠, 인스타그램 릴스에서 수백만 조회수를 기록한 숏폼 콘텐츠 플롯을 전문으로 수집·분석하는 바이럴 스토리 아카이버다.

【핵심 원칙 — 절대 준수】
1. 작업 시작 시 반드시 search_trending_stories 도구를 먼저 호출하여 실제 인터넷의 바이럴 스토리를 검색하라.
2. 훈련 데이터만으로 스토리를 창작하는 것은 금지. 검색 도구를 먼저 써야 한다.
3. 검색 결과를 베이스로 크리에이터 페르소나에 맞게 각색하라. 원본 출처 URL을 반드시 기록하라.
4. 반드시 유효한 JSON만 반환하고 다른 텍스트는 절대 포함하지 마라.`;

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
        tools: [SEARCH_TOOL],
        tool_choice: "auto",
      });

      const assistantMsg = step1.choices[0].message;
      messages.push(assistantMsg);
      console.log("[generateSynopsis] Step1 finish_reason:", step1.choices[0].finish_reason);

      // ── Step 2: 검색 도구가 호출된 경우 실제 웹 검색 실행 ──────
      for (const toolCall of assistantMsg.tool_calls ?? []) {
        if (toolCall.function.name !== "search_trending_stories") continue;

        let args;
        try { args = JSON.parse(toolCall.function.arguments); } catch (_) { args = {}; }
        const query = args.query ?? `${persona} 바이럴 스토리 레전드 썰`;
        console.log("[generateSynopsis] 검색 쿼리:", query);

        let searchContent;
        try {
          const result = await searchTrendingStories(query);
          searchContent = JSON.stringify(result);
          console.log("[generateSynopsis] 검색 완료, 결과 수:", result.results?.length);
        } catch (e) {
          console.warn("[generateSynopsis] 검색 실패, 폴백:", e.message);
          searchContent = JSON.stringify({ answer: "", results: [] });
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
        content: `검색 결과를 바탕으로 아래 JSON 형식으로 ${name}의 4~10부작 완결형 시리즈를 기획하라. (검색 결과가 없으면 검증된 바이럴 패턴 기반으로 작성)

{
  "synopsis": "전체 시리즈 제목(첫 줄)과 각 편(1화~N화) 줄거리. 500~800자.",
  "originalTitle": "참고한 원본 스토리의 제목 또는 핵심 키워드 (없으면 대표 바이럴 패턴명)",
  "originalReference": "원본 플롯 출처 (플랫폼명 + 핵심 키워드. 예: '유튜브 쇼츠 - 직장 갑질 사이다 썰')",
  "originalReferenceUrl": "검색에서 발견한 실제 URL (없으면 null)"
}

시리즈 요구사항:
- 편수 4~10편, 기승전결 완결형 (열린 결말 금지)
- 각 화 말미: 강력한 클리프행어 (마지막 화 제외)
- 마지막 화: 사이다/카타르시스 엔딩 필수
- 크리에이터 '${name}'의 페르소나에 완벽히 맞춘 각색`,
      });

      const step3 = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        messages,
        temperature: 0.85,
        max_tokens: 1500,
      });

      const parsed = JSON.parse(step3.choices[0].message.content);
      if (!parsed.synopsis) {
        throw new HttpsError("internal", "AI 응답 형식이 올바르지 않습니다.");
      }
      console.log("[generateSynopsis] 완료, synopsis 길이:", parsed.synopsis.length);
      return {
        synopsis: parsed.synopsis,
        originalTitle: parsed.originalTitle ?? "",
        originalReference: parsed.originalReference ?? "",
        originalReferenceUrl: parsed.originalReferenceUrl ?? null,
      };
    } catch (error) {
      console.error("[generateSynopsis] 오류:", error.message);
      if (error instanceof HttpsError) throw error;
      throw new HttpsError("internal", `시놉시스 생성 실패: ${error.message}`);
    }
  }
);

// ────────────────────────────────────────────────────────────
// 확정된 시놉시스 → 1화 5개 씬으로 분할 (generateContent 대체)
// ────────────────────────────────────────────────────────────
exports.generateScenesFromSynopsis = onCall(
  { timeoutSeconds: 60, memory: "256MiB" },
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
      console.log("[generateScenesFromSynopsis] 성공, 씬 수:", parsed.scenes.length);
      return { title: parsed.title, scenes: parsed.scenes };
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

    const enhancedPrompt = `Cinematic short-form social media video frame. ${visualPrompt} High quality, vibrant colors, vertical smartphone video style, professional lighting.`;
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
