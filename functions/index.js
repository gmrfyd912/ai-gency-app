const { onRequest } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");

// 배포 예시 함수 (주석 해제 후 firebase deploy --only functions 실행)
// exports.helloWorld = onRequest((request, response) => {
//   logger.info("Hello logs!", { structuredData: true });
//   response.send("Hello from Firebase!");
// });
