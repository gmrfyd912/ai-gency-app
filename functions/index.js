const { onRequest, onCall, HttpsError } = require("firebase-functions/v2/https");
const OpenAI = require("openai");

// OpenAI 인스턴스 초기화 (자동으로 .env의 OPENAI_API_KEY를 가져옵니다)
const openai = new OpenAI();

// 테스트용 임시 함수
exports.testAI = onRequest((req, res) => {
  res.send("비밀 금고에 AI 두뇌 탑재 완료!");
});

// AI 인사말 생성 함수
exports.generateGreeting = onCall(async (request) => {
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
