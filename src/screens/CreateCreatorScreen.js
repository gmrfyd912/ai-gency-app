import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import {
  addDoc,
  collection,
  doc,
  getDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../services/firebase';

const fetchTodayTrendsFn = httpsCallable(functions, 'fetchTodayTrends');
const generatePersonaDraftFn = httpsCallable(functions, 'generatePersonaDraft');

export default function CreateCreatorScreen({ navigation }) {
  // ── 트렌드 데이터 상태 ──────────────────────────────────────
  const [categories, setCategories] = useState([]);
  const [trendsLoading, setTrendsLoading] = useState(true);
  const [trendsDate, setTrendsDate] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  // ── 단계 선택 상태 ──────────────────────────────────────────
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [selectedSub, setSelectedSub] = useState(null);

  // ── 직접 입력 모달 상태 ─────────────────────────────────────
  const [modalVisible, setModalVisible] = useState(false);
  const [customInput, setCustomInput] = useState('');
  const [generatingPersona, setGeneratingPersona] = useState(false);
  const customInputRef = useRef(null);

  // ── 3단계 폼 상태 ───────────────────────────────────────────
  const [creatorName, setCreatorName] = useState('');
  const [voice, setVoice] = useState('');
  const [prompt, setPrompt] = useState('');
  const [saving, setSaving] = useState(false);

  // ── Firestore Today_Trends 불러오기 ───────────────────────
  useEffect(() => {
    loadTrends();
  }, []);

  const loadTrends = async () => {
    setTrendsLoading(true);
    try {
      const snap = await getDoc(doc(db, 'Today_Trends', 'latest'));
      if (snap.exists()) {
        const data = snap.data();
        setCategories(data.categories ?? []);
        setTrendsDate(data.date ?? '');
      } else {
        // 데이터 없으면 AI 자동 생성 제안
        setCategories([]);
      }
    } catch (e) {
      Alert.alert('불러오기 실패', e.message);
    } finally {
      setTrendsLoading(false);
    }
  };

  // ── AI 트렌드 새로 생성 (Cloud Function 호출) ─────────────
  const handleRefreshTrends = async () => {
    setRefreshing(true);
    setSelectedCategory(null);
    setSelectedSub(null);
    try {
      const result = await fetchTodayTrendsFn();
      await loadTrends();
      Alert.alert(
        '트렌드 업데이트 완료 🎯',
        `${result.data.count}개 대주제가 새로 생성되었습니다.`
      );
    } catch (e) {
      Alert.alert('트렌드 생성 실패', e.message);
    } finally {
      setRefreshing(false);
    }
  };

  // ── 대분류 선택 ───────────────────────────────────────────
  const handleSelectCategory = (cat) => {
    setSelectedCategory(cat);
    setSelectedSub(null);
    setCreatorName('');
    setVoice('');
    setPrompt('');
  };

  // ── 직접 입력 모달 열기 ───────────────────────────────────
  const handleOpenCustomModal = () => {
    setCustomInput('');
    setModalVisible(true);
    setTimeout(() => customInputRef.current?.focus(), 200);
  };

  // ── 직접 입력 확정 → AI 페르소나 생성 후 STEP 3 자동 채움 ─
  const handleConfirmCustom = async () => {
    const trimmed = customInput.trim();
    if (!trimmed) {
      Alert.alert('입력 오류', '분야를 입력해주세요.');
      return;
    }
    setGeneratingPersona(true);
    try {
      const result = await generatePersonaDraftFn({ field: trimmed });
      const { name, voice: draftVoice, prompt: draftPrompt } = result.data;
      setModalVisible(false);
      setSelectedCategory({ label: trimmed, icon: '✏️', subs: [], isCustom: true });
      setSelectedSub({ name: '', voice: '', prompt: '', isCustom: true });
      setCreatorName(name);
      setVoice(draftVoice);
      setPrompt(draftPrompt);
    } catch (e) {
      Alert.alert('기획안 생성 실패', e.message);
    } finally {
      setGeneratingPersona(false);
    }
  };

  // ── 소분류 선택 → 폼 자동 채움 ──────────────────────────
  const handleSelectSub = (sub) => {
    setSelectedSub(sub);
    setCreatorName(sub.name);
    setVoice(sub.voice);
    setPrompt(sub.prompt);
  };

  // ── Firestore 저장 ────────────────────────────────────────
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

  // ── 로딩 화면 ────────────────────────────────────────────
  if (trendsLoading) {
    return (
      <View style={styles.loadingScreen}>
        <ActivityIndicator size="large" color="#4A90E2" />
        <Text style={styles.loadingText}>오늘의 트렌드를 불러오는 중...</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.inner} keyboardShouldPersistTaps="handled">

        {/* ── 트렌드 헤더 ──────────────────────────────────────── */}
        <View style={styles.trendHeader}>
          <View>
            <Text style={styles.trendTitle}>📡 오늘의 트렌드 레이더</Text>
            {trendsDate ? (
              <Text style={styles.trendDate}>{trendsDate} 기준</Text>
            ) : null}
          </View>
          <TouchableOpacity
            style={[styles.refreshBtn, refreshing && styles.refreshBtnDisabled]}
            onPress={handleRefreshTrends}
            disabled={refreshing}
          >
            {refreshing ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.refreshBtnText}>AI 갱신</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* ── STEP 1: 대분류 2열 그리드 ──────────────────────── */}
        <View style={styles.stepBlock}>
          <Text style={styles.stepBadge}>STEP 1</Text>
          <Text style={styles.stepTitle}>어떤 분야의 크리에이터인가요?</Text>

          {categories.length === 0 ? (
            <View style={styles.emptyTrends}>
              <Text style={styles.emptyTrendsIcon}>🔍</Text>
              <Text style={styles.emptyTrendsText}>
                아직 트렌드 데이터가 없습니다.{'\n'}
                상단 'AI 갱신' 버튼을 눌러 오늘의 트렌드를 생성하세요.
              </Text>
            </View>
          ) : null}

          {/* 트렌드 카드 + 직접 입력 카드를 항상 같은 그리드에 배치 */}
          <View style={styles.categoryGrid}>
            {categories.map((cat, idx) => (
              <TouchableOpacity
                key={idx}
                style={[
                  styles.categoryBtn,
                  selectedCategory?.label === cat.label &&
                    !selectedCategory?.isCustom &&
                    styles.categoryBtnActive,
                ]}
                onPress={() => handleSelectCategory(cat)}
              >
                <Text style={styles.categoryIcon}>{cat.icon}</Text>
                <Text
                  style={[
                    styles.categoryLabel,
                    selectedCategory?.label === cat.label &&
                      !selectedCategory?.isCustom &&
                      styles.categoryLabelActive,
                  ]}
                  numberOfLines={2}
                >
                  {cat.label}
                </Text>
              </TouchableOpacity>
            ))}

            {/* 직접 분야 입력 카드 */}
            <TouchableOpacity
              style={[
                styles.categoryBtn,
                styles.customCategoryBtn,
                selectedCategory?.isCustom && styles.customCategoryBtnActive,
              ]}
              onPress={handleOpenCustomModal}
            >
              <Text style={styles.categoryIcon}>✏️</Text>
              <Text
                style={[
                  styles.categoryLabel,
                  styles.customCategoryLabel,
                  selectedCategory?.isCustom && styles.customCategoryLabelActive,
                ]}
                numberOfLines={2}
              >
                {selectedCategory?.isCustom
                  ? selectedCategory.label
                  : '직접 입력'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── STEP 2: 소주제 추천 카드 (직접 입력 시 건너뜀) ── */}
        {selectedCategory && !selectedCategory.isCustom && (
          <View style={styles.stepBlock}>
            <Text style={styles.stepBadge}>STEP 2</Text>
            <Text style={styles.stepTitle}>트렌드 추천 컨셉을 선택하세요</Text>
            <View style={styles.subGrid}>
              {(selectedCategory.subs ?? []).map((sub, idx) => (
                <TouchableOpacity
                  key={idx}
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

        {/* ── STEP 3: 커스터마이징 폼 (일반 선택 or 직접 입력) ── */}
        {(selectedSub || selectedCategory?.isCustom) && (
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

      {/* ── 직접 분야 입력 모달 ──────────────────────────────── */}
      <Modal
        visible={modalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setModalVisible(false)}
      >
        <TouchableWithoutFeedback onPress={() => setModalVisible(false)}>
          <View style={styles.modalOverlay}>
            <TouchableWithoutFeedback>
              <View style={styles.modalCard}>
                <Text style={styles.modalTitle}>✏️ 직접 분야 입력</Text>
                <Text style={styles.modalSubtitle}>
                  원하는 크리에이터 분야를 자유롭게 입력하세요
                </Text>
                <TextInput
                  ref={customInputRef}
                  style={styles.modalInput}
                  value={customInput}
                  onChangeText={setCustomInput}
                  placeholder="예: K-뷰티, 요리/레시피, 투자 정보..."
                  placeholderTextColor="#9CA3AF"
                  returnKeyType="done"
                  onSubmitEditing={handleConfirmCustom}
                  maxLength={20}
                />
                <Text style={styles.modalCharCount}>{customInput.length} / 20</Text>
                <View style={styles.modalBtnRow}>
                  <TouchableOpacity
                    style={[styles.modalBtn, styles.modalCancelBtn]}
                    onPress={() => setModalVisible(false)}
                    disabled={generatingPersona}
                  >
                    <Text style={styles.modalCancelText}>취소</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.modalBtn,
                      styles.modalConfirmBtn,
                      (!customInput.trim() || generatingPersona) && styles.modalConfirmBtnDisabled,
                    ]}
                    onPress={handleConfirmCustom}
                    disabled={!customInput.trim() || generatingPersona}
                  >
                    {generatingPersona ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Text style={styles.modalConfirmText}>기획안 생성</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

    </KeyboardAvoidingView>
  );
}

// ─── 스타일 ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F7FA' },
  inner: { padding: 16, paddingBottom: 48 },

  loadingScreen: {
    flex: 1,
    backgroundColor: '#F5F7FA',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  loadingText: { fontSize: 15, color: '#6B7280' },

  // 트렌드 헤더
  trendHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  trendTitle: { fontSize: 15, fontWeight: '700', color: '#1A1A2E' },
  trendDate: { fontSize: 12, color: '#9CA3AF', marginTop: 2 },
  refreshBtn: {
    backgroundColor: '#4A90E2',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    minWidth: 70,
    alignItems: 'center',
  },
  refreshBtnDisabled: { opacity: 0.6 },
  refreshBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },

  // 스텝
  stepBlock: { marginBottom: 24 },
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
    fontSize: 16,
    fontWeight: '700',
    color: '#1A1A2E',
    marginBottom: 14,
  },

  // 대분류 2열 그리드
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  categoryBtn: {
    width: '47.5%',
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 10,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#E5E7EB',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
    minHeight: 86,
    justifyContent: 'center',
  },
  categoryBtnActive: {
    borderColor: '#4A90E2',
    backgroundColor: '#EBF4FF',
  },
  categoryIcon: { fontSize: 26, marginBottom: 6 },
  categoryLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#374151',
    textAlign: 'center',
    lineHeight: 17,
  },
  categoryLabelActive: { color: '#4A90E2' },

  // 빈 트렌드 안내
  emptyTrends: {
    alignItems: 'center',
    paddingVertical: 32,
    gap: 10,
  },
  emptyTrendsIcon: { fontSize: 40 },
  emptyTrendsText: {
    fontSize: 14,
    color: '#9CA3AF',
    textAlign: 'center',
    lineHeight: 22,
  },

  // 소주제 카드
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

  // 직접 입력 카드
  customCategoryBtn: {
    borderStyle: 'dashed',
    borderColor: '#9CA3AF',
    backgroundColor: '#FAFAFA',
  },
  customCategoryBtnActive: {
    borderStyle: 'solid',
    borderColor: '#4A90E2',
    backgroundColor: '#EBF4FF',
  },
  customCategoryLabel: { color: '#6B7280' },
  customCategoryLabelActive: { color: '#4A90E2' },

  // 모달
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalCard: {
    width: '100%',
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 24,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 10,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1A1A2E',
    marginBottom: 6,
  },
  modalSubtitle: {
    fontSize: 13,
    color: '#6B7280',
    marginBottom: 16,
    lineHeight: 19,
  },
  modalInput: {
    borderWidth: 1.5,
    borderColor: '#4A90E2',
    borderRadius: 10,
    padding: 12,
    fontSize: 15,
    backgroundColor: '#F9FBFF',
    color: '#1A1A2E',
  },
  modalCharCount: {
    fontSize: 11,
    color: '#9CA3AF',
    textAlign: 'right',
    marginTop: 4,
    marginBottom: 16,
  },
  modalBtnRow: {
    flexDirection: 'row',
    gap: 10,
  },
  modalBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 10,
    alignItems: 'center',
  },
  modalCancelBtn: {
    backgroundColor: '#F3F4F6',
  },
  modalCancelText: { color: '#6B7280', fontSize: 15, fontWeight: '600' },
  modalConfirmBtn: { backgroundColor: '#4A90E2' },
  modalConfirmBtnDisabled: { backgroundColor: '#B3D0F5' },
  modalConfirmText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
