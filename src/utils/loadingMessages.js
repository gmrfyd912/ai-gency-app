const TOPIC_MESSAGES = [
  {
    keywords: ['여행', '핫플', '맛집'],
    title: '✈️ 관련 분야 최고 인기 쇼츠/릴스\n트렌드 분석 중...',
    detail: 'AI가 유튜브 쇼츠에서 실제 영상 대사를 추출하고\n시리즈로 기획하고 있습니다',
  },
  {
    keywords: ['뷰티', '패션', '다이어트'],
    title: '💄 뷰티/패션 조회수 폭발\n바이럴 영상 대본 추출 중...',
    detail: 'AI가 유튜브 쇼츠에서 실제 영상 대사를 추출하고\n시리즈로 기획하고 있습니다',
  },
  {
    keywords: ['재테크', '주식', '코인', '경제'],
    title: '📈 최신 경제/재테크 트렌드 및\n노하우 콘텐츠 수집 중...',
    detail: 'AI가 유튜브 쇼츠에서 실제 영상 대사를 추출하고\n시리즈로 기획하고 있습니다',
  },
  {
    keywords: ['썰', '막장', '연애', '갈등', '직장'],
    title: '🔥 커뮤니티 레전드 썰 수집 및\n각색 중...',
    detail: 'AI가 인터넷에서 바이럴 원본을 검색하고\n전문을 추출하여 시리즈를 기획하고 있습니다',
  },
  {
    keywords: ['먹방', '요리', '레시피'],
    title: '🍜 인기 먹방/요리 쇼츠 대사\n실시간 추출 중...',
    detail: 'AI가 유튜브 쇼츠에서 실제 영상 대사를 추출하고\n시리즈로 기획하고 있습니다',
  },
  {
    keywords: ['운동', '헬스', '다이어트', '홈트'],
    title: '💪 인기 운동/헬스 쇼츠 대사\n실시간 추출 중...',
    detail: 'AI가 유튜브 쇼츠에서 실제 영상 대사를 추출하고\n시리즈로 기획하고 있습니다',
  },
];

const DEFAULT_MESSAGE = {
  title: '🌐 해당 크리에이터 주제에 맞는\n최신 SNS 트렌드 분석 중...',
  detail: 'AI가 최신 바이럴 콘텐츠를 검색하고\n시리즈로 기획하고 있습니다',
};

export function getDynamicLoadingMessage(topic = '') {
  const lower = topic.toLowerCase();
  for (const { keywords, title, detail } of TOPIC_MESSAGES) {
    if (keywords.some((kw) => lower.includes(kw))) {
      return { title, detail };
    }
  }
  return DEFAULT_MESSAGE;
}
