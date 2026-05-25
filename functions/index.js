const { onRequest, onCall, HttpsError } = require("firebase-functions/v2/https");
const OpenAI = require("openai");
const admin = require("firebase-admin");

// Firebase Admin SDK 초기화 (Firestore 서버 사이드 쓰기용)
admin.initializeApp();
const adminDb = admin.firestore();

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
// 씬 연출 지시문 → DALL-E 3 이미지 생성
// ────────────────────────────────────────────────────────────
exports.generateSceneImage = onCall(
  { timeoutSeconds: 120, memory: "512MiB" },
  async (request) => {
    const openai = new OpenAI();
    const { visualPrompt } = request.data;

    if (!visualPrompt) {
      throw new HttpsError("invalid-argument", "visualPrompt는 필수입니다.");
    }

    // 숏폼 영상 씬 특화 프롬프트로 강화
    const enhancedPrompt = `Cinematic short-form social media video frame. ${visualPrompt} High quality, vibrant colors, vertical smartphone video style, professional lighting.`;

    try {
      // DALL-E 3 전용 이미지 생성 엔드포인트 (chat.completions 아님)
      const response = await openai.images.generate({
        model: "dall-e-3",
        prompt: enhancedPrompt,
        n: 1,
        size: "1024x1792",
      });

      const imageUrl = response.data[0].url;
      return { imageUrl };
    } catch (error) {
      console.error("이미지 생성 오류:", error);
      console.error("상세:", JSON.stringify(error?.error ?? error?.message));
      if (error instanceof HttpsError) throw error;
      throw new HttpsError("internal", `이미지 생성 실패: ${error.message}`);
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
