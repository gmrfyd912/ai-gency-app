import { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '../services/firebase';

// ─── 카테고리 & 추천 데이터 ───────────────────────────────────────────────────
const CATEGORIES = [
  {
    key: 'drama',
    label: '드라마/스토리',
    icon: '🎭',
    subs: [
      {
        name: '도파민 막장',
        voice: '극적이고 감정적인 목소리',
        prompt:
          '당신은 매화마다 반전이 넘치는 막장 드라마 전문 크리에이터입니다. 시청자의 감정을 극대화하는 자극적인 스토리와 과장된 감정 표현이 특기입니다.',
      },
      {
        name: 'K-직장인 썰툰',
        voice: '친근하고 공감 가는 직장인 말투',
        prompt:
          '당신은 대한민국 직장인의 희노애락을 담은 웹툰 스타일 스토리 크리에이터입니다. 실제 직장 생활 에피소드를 유머러스하게 전달합니다.',
      },
      {
        name: '미스터리 괴담',
        voice: '낮고 으스스한 속삭임 톤',
        prompt:
          '당신은 한국 도시 전설과 미스터리 괴담 전문 크리에이터입니다. 듣는 이의 등골을 오싹하게 만드는 긴장감 넘치는 이야기를 전달합니다.',
      },
    ],
  },
  {
    key: 'animal',
    label: '반려동물/동물',
    icon: '🐾',
    subs: [
      {
        name: '고양이 일상 브이로그',
        voice: '귀엽고 애교 넘치는 말투',
        prompt:
          '당신은 고양이 시선으로 일상을 공유하는 크리에이터입니다. 고양이 행동 심리를 해설하고 귀여운 에피소드를 공유합니다.',
      },
      {
        name: '강아지 훈련 팁',
        voice: '다정하고 차분한 전문가 목소리',
        prompt:
          '당신은 반려견 훈련 전문 크리에이터입니다. 과학적 근거 기반 훈련법과 강아지와의 유대를 높이는 실용 팁을 제공합니다.',
      },
      {
        name: '희귀동물 관찰일기',
        voice: '탐험가처럼 신나고 설레는 톤',
        prompt:
          '당신은 세계 각국의 희귀 동물을 탐구하는 크리에이터입니다. 다큐멘터리 스타일로 동물 생태와 습성을 흥미롭게 전달합니다.',
      },
    ],
  },
  {
    key: 'health',
    label: '건강/의학',
    icon: '💊',
    subs: [
      {
        name: '다이어트 식단 코치',
        voice: '활기차고 응원하는 코치 말투',
        prompt:
          '당신은 과학적 근거 기반 다이어트 식단 전문 크리에이터입니다. 실천 가능한 식단 조절법과 건강한 식습관 형성 정보를 제공합니다.',
      },
      {
        name: '멘탈헬스 상담사',
        voice: '따뜻하고 공감적인 상담사 목소리',
        prompt:
          '당신은 현대인의 정신 건강을 케어하는 크리에이터입니다. 스트레스 관리, 감정 조절, 자존감 향상을 위한 심리학 기반 콘텐츠를 제공합니다.',
      },
      {
        name: '운동 PT 트레이너',
        voice: '힘차고 동기부여 넘치는 트레이너 목소리',
        prompt:
          '당신은 홈트레이닝 & 헬스 전문 PT 크리에이터입니다. 초보자도 따라 할 수 있는 운동 루틴과 자세 교정 팁을 열정적으로 전달합니다.',
      },
    ],
  },
  {
    key: 'selfdev',
    label: '자기계발',
    icon: '🚀',
    subs: [
      {
        name: '독서 요약 큐레이터',
        voice: '지적이고 차분한 큐레이터 목소리',
        prompt:
          '당신은 다양한 분야의 책을 읽고 핵심을 10분 안에 전달하는 독서 크리에이터입니다. 책의 정수를 쉽고 임팩트 있게 요약합니다.',
      },
      {
        name: '재테크/투자 멘토',
        voice: '신뢰감 있는 전문가 멘토 목소리',
        prompt:
          '당신은 주식, 부동산, 코인 등 다양한 재테크 분야를 다루는 투자 멘토 크리에이터입니다. 초보 투자자도 이해하기 쉬운 언어로 전략을 공유합니다.',
      },
      {
        name: '영어 회화 선생님',
        voice: '밝고 격려하는 영어 선생님 말투',
        prompt:
          '당신은 실생활에서 바로 쓸 수 있는 영어 회화를 가르치는 크리에이터입니다. 원어민이 실제로 쓰는 표현과 문화적 맥락을 재미있게 전달합니다.',
      },
    ],
  },
];

// ─── 컴포넌트 ─────────────────────────────────────────────────────────────────
export default function CreateCreatorScreen({ navigation }) {
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [selectedSub, setSelectedSub] = useState(null);

  // 3단계 폼 상태
  const [creatorName, setCreatorName] = useState('');
  const [voice, setVoice] = useState('');
  const [prompt, setPrompt] = useState('');
  const [saving, setSaving] = useState(false);

  // 대분류 선택
  const handleSelectCategory = (cat) => {
    setSelectedCategory(cat);
    setSelectedSub(null);
    setCreatorName('');
    setVoice('');
    setPrompt('');
  };

  // 소분류(추천 카드) 선택 → 폼 자동 채움
  const handleSelectSub = (sub) => {
    setSelectedSub(sub);
    setCreatorName(sub.name);
    setVoice(sub.voice);
    setPrompt(sub.prompt);
  };

  // Firestore 저장
  const handleSave = async () => {
    if (!creatorName.trim() || !voice.trim() || !prompt.trim()) {
      Alert.alert('입력 오류', '이름, 목소리 톤, 프롬프트를 모두 입력해주세요.');
      return;
    }
    setSaving(true);
    try {
      await addDoc(collection(db, 'creators'), {
        category: selectedCategory?.label ?? '',
        subCategory: selectedSub?.name ?? '',
        name: creatorName.trim(),
        voice: voice.trim(),
        persona: prompt.trim(),
        createdAt: serverTimestamp(),
      });
      Alert.alert('영입 완료! 🎉', `${creatorName} 크리에이터가 소속되었습니다.`, [
        { text: '확인', onPress: () => navigation.goBack() },
      ]);
    } catch (e) {
      Alert.alert('저장 실패', e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.inner} keyboardShouldPersistTaps="handled">

        {/* ── STEP 1: 대분류 선택 ─────────────────────────────────────── */}
        <View style={styles.stepBlock}>
          <Text style={styles.stepBadge}>STEP 1</Text>
          <Text style={styles.stepTitle}>어떤 분야의 크리에이터인가요?</Text>
          <View style={styles.categoryGrid}>
            {CATEGORIES.map((cat) => (
              <TouchableOpacity
                key={cat.key}
                style={[
                  styles.categoryBtn,
                  selectedCategory?.key === cat.key && styles.categoryBtnActive,
                ]}
                onPress={() => handleSelectCategory(cat)}
              >
                <Text style={styles.categoryIcon}>{cat.icon}</Text>
                <Text
                  style={[
                    styles.categoryLabel,
                    selectedCategory?.key === cat.key && styles.categoryLabelActive,
                  ]}
                >
                  {cat.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* ── STEP 2: 트렌드 추천 카드 ─────────────────────────────────── */}
        {selectedCategory && (
          <View style={styles.stepBlock}>
            <Text style={styles.stepBadge}>STEP 2</Text>
            <Text style={styles.stepTitle}>트렌드 추천 컨셉을 선택하세요</Text>
            <View style={styles.subGrid}>
              {selectedCategory.subs.map((sub) => (
                <TouchableOpacity
                  key={sub.name}
                  style={[
                    styles.subCard,
                    selectedSub?.name === sub.name && styles.subCardActive,
                  ]}
                  onPress={() => handleSelectSub(sub)}
                >
                  <Text
                    style={[
                      styles.subCardName,
                      selectedSub?.name === sub.name && styles.subCardNameActive,
                    ]}
                  >
                    {sub.name}
                  </Text>
                  <Text
                    style={[
                      styles.subCardVoice,
                      selectedSub?.name === sub.name && styles.subCardVoiceActive,
                    ]}
                    numberOfLines={1}
                  >
                    🎙 {sub.voice}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* ── STEP 3: 자유 커스터마이징 폼 ─────────────────────────────── */}
        {selectedSub && (
          <View style={styles.stepBlock}>
            <Text style={styles.stepBadge}>STEP 3</Text>
            <Text style={styles.stepTitle}>자유롭게 커스터마이징하세요</Text>

            <View style={styles.form}>
              <Text style={styles.fieldLabel}>크리에이터 이름</Text>
              <TextInput
                style={styles.input}
                value={creatorName}
                onChangeText={setCreatorName}
                placeholder="이름을 입력하세요"
              />

              <Text style={styles.fieldLabel}>목소리 톤</Text>
              <TextInput
                style={styles.input}
                value={voice}
                onChangeText={setVoice}
                placeholder="목소리 톤을 설명하세요"
              />

              <Text style={styles.fieldLabel}>메인 프롬프트 (페르소나 성격)</Text>
              <TextInput
                style={[styles.input, styles.inputMulti]}
                value={prompt}
                onChangeText={setPrompt}
                placeholder="크리에이터의 성격과 특징을 설명하세요"
                multiline
                textAlignVertical="top"
              />

              <TouchableOpacity
                style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
                onPress={handleSave}
                disabled={saving}
              >
                <Text style={styles.saveBtnText}>
                  {saving ? '저장 중...' : '✅ 생성 완료 — 영입하기'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ─── 스타일 ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F7FA' },
  inner: { padding: 20, paddingBottom: 48 },

  stepBlock: { marginBottom: 28 },
  stepBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#4A90E2',
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 10,
    marginBottom: 8,
    overflow: 'hidden',
  },
  stepTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#1A1A2E',
    marginBottom: 14,
  },

  // 대분류 그리드
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  categoryBtn: {
    width: '47%',
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#E5E7EB',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  categoryBtnActive: {
    borderColor: '#4A90E2',
    backgroundColor: '#EBF4FF',
  },
  categoryIcon: { fontSize: 28, marginBottom: 6 },
  categoryLabel: { fontSize: 13, fontWeight: '600', color: '#374151', textAlign: 'center' },
  categoryLabelActive: { color: '#4A90E2' },

  // 추천 카드
  subGrid: { gap: 10 },
  subCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    borderWidth: 2,
    borderColor: '#E5E7EB',
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 2,
  },
  subCardActive: { borderColor: '#4A90E2', backgroundColor: '#EBF4FF' },
  subCardName: { fontSize: 15, fontWeight: '700', color: '#1A1A2E', marginBottom: 4 },
  subCardNameActive: { color: '#4A90E2' },
  subCardVoice: { fontSize: 12, color: '#6B7280' },
  subCardVoiceActive: { color: '#4A90E2' },

  // 폼
  form: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    gap: 8,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: '#374151', marginTop: 4 },
  input: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    padding: 10,
    fontSize: 14,
    backgroundColor: '#FAFAFA',
  },
  inputMulti: { minHeight: 100 },
  saveBtn: {
    marginTop: 8,
    backgroundColor: '#4A90E2',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  saveBtnDisabled: { opacity: 0.5 },
  saveBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
