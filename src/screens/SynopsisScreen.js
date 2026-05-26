import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../services/firebase';

// ── Cloud Function 클라이언트 ─────────────────────────────────
const generateSynopsisFn = httpsCallable(functions, 'generateSynopsis', { timeout: 60000 });
const generateScenesFromSynopsisFn = httpsCallable(functions, 'generateScenesFromSynopsis', { timeout: 60000 });

const episodesCol = (creatorId) => collection(db, 'creators', creatorId, 'episodes');

export default function SynopsisScreen({ route, navigation }) {
  const { creator } = route.params;

  const [synopsis, setSynopsis]               = useState('');
  const [loadingSynopsis, setLoadingSynopsis] = useState(false);
  const [generatingScenes, setGeneratingScenes] = useState(false);
  const inputRef = useRef(null);

  const isLocked = loadingSynopsis || generatingScenes;

  // 마운트 시 자동 시놉시스 생성
  useEffect(() => {
    callGenerateSynopsis();
  }, []);

  // ── 시놉시스 생성 ─────────────────────────────────────────
  const callGenerateSynopsis = async () => {
    setLoadingSynopsis(true);
    setSynopsis('');
    try {
      const result = await generateSynopsisFn({ name: creator.name, persona: creator.persona });
      setSynopsis(result.data.synopsis);
    } catch (e) {
      Alert.alert('시놉시스 생성 실패', (e?.message ?? '알 수 없는 오류').slice(0, 100));
    } finally {
      setLoadingSynopsis(false);
    }
  };

  // ── 씬 분할 → Firestore 저장 → StudioScreen 이동 ──────────
  const handleSplitScenes = async () => {
    if (!synopsis.trim() || isLocked) return;
    setGeneratingScenes(true);
    try {
      const result = await generateScenesFromSynopsisFn({
        synopsis,
        name: creator.name,
        persona: creator.persona,
      });
      const newScript = { title: result.data.title, scenes: result.data.scenes };

      const episodeRef = await addDoc(episodesCol(creator.id), {
        title: newScript.title,
        synopsis,
        scenes: newScript.scenes.map((s) => ({ ...s, imageUri: null, audioUri: null })),
        createdAt: serverTimestamp(),
      });

      navigation.navigate('CreatorStudio', {
        creator,
        incomingEpisode: {
          id: episodeRef.id,
          title: newScript.title,
          scenes: newScript.scenes,
        },
      });
    } catch (e) {
      Alert.alert('장면 분할 실패', (e?.message ?? '알 수 없는 오류').slice(0, 100));
    } finally {
      setGeneratingScenes(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={90}
    >
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.inner}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── 크리에이터 프로필 헤더 ── */}
        <View style={styles.profileRow}>
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarText}>{creator.name.charAt(0)}</Text>
          </View>
          <View style={styles.profileInfo}>
            <Text style={styles.profileName}>{creator.name}</Text>
            <Text style={styles.profileSub}>시리즈 기획 중</Text>
          </View>
        </View>

        {/* ── 시놉시스 카드 ── */}
        <View style={styles.synopsisCard}>
          <View style={styles.cardLabelRow}>
            <Text style={styles.cardLabelIcon}>📖</Text>
            <Text style={styles.cardLabel}>시리즈 줄거리 (시놉시스)</Text>
          </View>

          {loadingSynopsis ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator size="large" color="#4A90E2" />
              <Text style={styles.loadingTitle}>트렌드 반영 중...</Text>
              <Text style={styles.loadingSubtitle}>
                {creator.name}의 세계관으로 시리즈를 기획하고 있습니다
              </Text>
            </View>
          ) : (
            <TextInput
              ref={inputRef}
              style={styles.synopsisInput}
              value={synopsis}
              onChangeText={setSynopsis}
              multiline
              placeholder="시놉시스를 생성하면 여기에 표시됩니다..."
              placeholderTextColor="#C4C4C4"
              textAlignVertical="top"
              editable={!isLocked}
            />
          )}
        </View>

        {synopsis ? (
          <Text style={styles.editHint}>
            💡 텍스트를 직접 수정하여 원하는 방향으로 조정할 수 있습니다
          </Text>
        ) : null}
      </ScrollView>

      {/* ── 하단 액션 버튼 3개 ── */}
      <View style={styles.footer}>
        <View style={styles.secondaryRow}>
          {/* ① 스토리 다시 짜기 */}
          <TouchableOpacity
            style={[styles.secondaryBtn, isLocked && styles.btnDisabled]}
            onPress={callGenerateSynopsis}
            disabled={isLocked}
            activeOpacity={0.75}
          >
            {loadingSynopsis ? (
              <ActivityIndicator color="#4A90E2" size="small" />
            ) : (
              <Text style={[styles.secondaryBtnText, isLocked && styles.disabledText]}>
                ↺ 스토리 다시 짜기
              </Text>
            )}
          </TouchableOpacity>

          {/* ② 직접 수정하기 */}
          <TouchableOpacity
            style={[styles.secondaryBtn, isLocked && styles.btnDisabled]}
            onPress={() => inputRef.current?.focus()}
            disabled={isLocked}
            activeOpacity={0.75}
          >
            <Text style={[styles.secondaryBtnText, isLocked && styles.disabledText]}>
              ✏️ 직접 수정하기
            </Text>
          </TouchableOpacity>
        </View>

        {/* ③ 이대로 장면 분할하기 */}
        <TouchableOpacity
          style={[
            styles.primaryBtn,
            (!synopsis.trim() || isLocked) && styles.primaryBtnDisabled,
          ]}
          onPress={handleSplitScenes}
          disabled={!synopsis.trim() || isLocked}
          activeOpacity={0.85}
        >
          {generatingScenes ? (
            <>
              <ActivityIndicator color="#fff" size="small" />
              <Text style={styles.primaryBtnText}>장면 분할 중...</Text>
            </>
          ) : (
            <>
              <Text style={styles.primaryBtnIcon}>🎬</Text>
              <Text style={styles.primaryBtnText}>이대로 장면 분할하기</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

// ─── 스타일 ───────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F5F7FA' },
  scroll: { flex: 1 },
  inner: { padding: 16, paddingBottom: 24 },

  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 14,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  avatarCircle: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: '#4A90E2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 18, fontWeight: '800', color: '#fff' },
  profileInfo: { flex: 1 },
  profileName: { fontSize: 17, fontWeight: '800', color: '#1A1A2E' },
  profileSub: { fontSize: 12, color: '#9CA3AF', marginTop: 2 },

  synopsisCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
    minHeight: 280,
  },
  cardLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 },
  cardLabelIcon: { fontSize: 15 },
  cardLabel: { fontSize: 13, fontWeight: '700', color: '#4A90E2', letterSpacing: 0.3 },

  loadingBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    gap: 12,
  },
  loadingTitle: { fontSize: 16, fontWeight: '700', color: '#1A1A2E' },
  loadingSubtitle: { fontSize: 13, color: '#9CA3AF', textAlign: 'center', lineHeight: 20 },

  synopsisInput: {
    fontSize: 14,
    color: '#1A1A2E',
    lineHeight: 24,
    minHeight: 200,
    textAlignVertical: 'top',
  },

  editHint: { fontSize: 12, color: '#9CA3AF', paddingHorizontal: 4, marginBottom: 8 },

  footer: {
    paddingHorizontal: 16,
    paddingBottom: 32,
    paddingTop: 12,
    backgroundColor: '#F5F7FA',
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    gap: 10,
  },
  secondaryRow: { flexDirection: 'row', gap: 10 },
  secondaryBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#4A90E2',
    alignItems: 'center',
    backgroundColor: '#F0F7FF',
  },
  secondaryBtnText: { fontSize: 13, fontWeight: '700', color: '#4A90E2' },
  btnDisabled: { borderColor: '#E5E7EB', backgroundColor: '#F9F9F9' },
  disabledText: { color: '#C4C4C4' },

  primaryBtn: {
    backgroundColor: '#1A1A2E',
    borderRadius: 16,
    paddingVertical: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    shadowColor: '#1A1A2E',
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  primaryBtnDisabled: { opacity: 0.4, shadowOpacity: 0.05, elevation: 2 },
  primaryBtnIcon: { fontSize: 20 },
  primaryBtnText: { fontSize: 16, fontWeight: '800', color: '#fff', letterSpacing: -0.3 },
});
