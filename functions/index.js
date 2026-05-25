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
// 씬 연출 지시문 → DALL-E 3 이미지 생성 (raw fetch — SDK 우회)
// ────────────────────────────────────────────────────────────
exports.generateSceneImage = onCall(
  { timeoutSeconds: 120, memory: "512MiB" },
  async (request) => {
    const { visualPrompt } = request.data;

    if (!visualPrompt) {
      throw new HttpsError("invalid-argument", "visualPrompt는 필수입니다.");
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new HttpsError("internal", "OPENAI_API_KEY 환경 변수가 없습니다.");
    }

    const enhancedPrompt = `Cinematic short-form social media video frame. ${visualPrompt} High quality, vibrant colors, vertical smartphone video style, professional lighting.`;

    console.log("[generateSceneImage] 호출 시작, prompt 길이:", enhancedPrompt.length);

    let res;
    try {
      // OpenAI SDK를 완전히 우회 — REST API 직접 호출
      res = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        // gpt-image-2 공식 스펙 파라미터만 사용
        // - response_format: gpt-image-2 미지원 (DALL-E 2/3 전용) → 제거
        // - output_format: 이미지 파일 포맷 (jpeg가 가장 작음)
        // - quality: "low"로 페이로드 최소화
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
      console.error("[generateSceneImage] 네트워크 오류:", networkError.message);
      throw new HttpsError("internal", `네트워크 오류: ${networkError.message}`);
    }

    const data = await res.json();

    // 키 구조만 로깅 — Base64 본문은 절대 로깅하지 않음
    console.log("[OpenAI Response] Keys:", Object.keys(data));
    if (Array.isArray(data?.data)) {
      console.log("[OpenAI Response] data[0] Keys:", Object.keys(data.data[0] ?? {}));
    }

    if (!res.ok) {
      const msg = data?.error?.message ?? `HTTP ${res.status}`;
      console.error("[generateSceneImage] API 오류:", msg);
      throw new HttpsError("internal", `이미지 생성 실패: ${msg}`);
    }

    // gpt-image-2는 항상 b64_json 반환 (URL 방식 없음)
    const b64 = data?.data?.[0]?.b64_json;
    if (!b64) {
      console.error("[generateSceneImage] b64_json 없음, data[0] Keys:",
        Object.keys(data?.data?.[0] ?? {}));
      throw new HttpsError("internal", "이미지 데이터를 받지 못했습니다. 서버 로그를 확인하세요.");
    }

    // Data URI로 변환 → React Native Image 컴포넌트에서 직접 렌더링 가능
    const imageUrl = `data:image/jpeg;base64,${b64}`;
    console.log("[generateSceneImage] 성공, base64 길이:", b64.length);
    return { imageUrl };
  }
);

// ────────────────────────────────────────────────────────────
// FFmpeg 기반 클라우드 비디오 렌더링 파이프라인
// ────────────────────────────────────────────────────────────
exports.generateFinalVideo = onCall(
  { timeoutSeconds: 540, memory: "2GiB" },
  async (request) => {
    const { creatorId, episodeId } = request.data;

    if (!creatorId || !episodeId) {
      throw new HttpsError("invalid-argument", "creatorId와 episodeId는 필수입니다.");
    }

    // ── Firestore 에피소드 조회 ──────────────────────────────
    const episodeRef = adminDb
      .collection("creators").doc(creatorId)
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
      // ── 각 씬: 이미지·오디오 파일 저장 + 개별 클립 생성 ─────
      const clipPaths = [];
      for (let i = 0; i < scenes.length; i++) {
        const scene = scenes[i];

        const imgBase64   = scene.imageUri.replace(/^data:[^;]+;base64,/, "");
        const audioBase64 = scene.audioUri.replace(/^data:[^;]+;base64,/, "");

        const imgPath   = path.join(tmpDir, `img_${sessionId}_${i}.jpg`);
        const audioPath = path.join(tmpDir, `audio_${sessionId}_${i}.mp3`);
        const clipPath  = path.join(tmpDir, `clip_${sessionId}_${i}.mp4`);
        tmpFiles.push(imgPath, audioPath, clipPath);

        fs.writeFileSync(imgPath,   Buffer.from(imgBase64,   "base64"));
        fs.writeFileSync(audioPath, Buffer.from(audioBase64, "base64"));

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
      const storagePath = `creators/${creatorId}/episodes/${episodeId}/final.mp4`;
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
// 씬 대사 → OpenAI TTS 오디오 생성 (Base64 MP3)
// ────────────────────────────────────────────────────────────
exports.generateSceneAudio = onCall(
  { timeoutSeconds: 60, memory: "256MiB" },
  async (request) => {
    const openai = new OpenAI();
    const { dialogue, voice } = request.data;

    if (!dialogue) {
      throw new HttpsError("invalid-argument", "dialogue는 필수입니다.");
    }

    const VALID_VOICES = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"];
    const selectedVoice = VALID_VOICES.includes(voice) ? voice : "nova";

    console.log("[generateSceneAudio] voice:", selectedVoice, "길이:", dialogue.length);

    try {
      const mp3 = await openai.audio.speech.create({
        model: "tts-1",
        voice: selectedVoice,
        input: dialogue,
      });

      const buffer = Buffer.from(await mp3.arrayBuffer());
      const base64 = buffer.toString("base64");
      console.log("[generateSceneAudio] 성공, base64 길이:", base64.length);
      return { audioUri: `data:audio/mp3;base64,${base64}` };
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
