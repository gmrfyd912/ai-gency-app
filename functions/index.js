const { onRequest } = require("firebase-functions/v2/https");
const OpenAI = require("openai");

// OpenAI 인스턴스 초기화 (자동으로 .env의 OPENAI_API_KEY를 가져옵니다)
const openai = new OpenAI();

// 테스트용 임시 함수
exports.testAI = onRequest((req, res) => {
  res.send("비밀 금고에 AI 두뇌 탑재 완료!");
});
