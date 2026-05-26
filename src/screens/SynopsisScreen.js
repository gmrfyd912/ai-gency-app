import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
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

const generateSynopsisFn = httpsCallable(functions, 'generateSynopsis', { timeout: 90000 });
const generateScenesFromSynopsisFn = httpsCallable(functions, 'generateScenesFromSynopsis', { timeout: 60000 });

const seriesCol = (creatorId) => collection(db, 'creators', creatorId, 'series');
const episodesCol = (creatorId, seriesId) =>
  collection(db, 'creators', creatorId, 'series', seriesId, 'episodes');

export default function SynopsisScreen({ route, navigation }) {
  const { creator } = route.params;

  const [synopsis, setSynopsis]                         = useState('');
  const [originalTitle, setOriginalTitle]               = useState('');
  const [originalReference, setOriginalReference]       = useState('');
  const [originalReferenceUrl, setOriginalReferenceUrl] = useState(null);
  const [preservedPlotPoints, setPreservedPlotPoints]   = useState([]);
  const [loadingSynopsis, setLoadingSynopsis]           = useState(false);
  const [generatingScenes, setGeneratingScenes]         = useState(false);
  const inputRef = useRef(null);

  const isLocked = loadingSynopsis || generatingScenes;

  useEffect(() => {
    callGenerateSynopsis();
  }, []);

  // ── 시놉시스 생성 ─────────────────────────────────────────
  const callGenerateSynopsis = async () => {
    setLoadingSynopsis(true);
    setSynopsis('');
    setOriginalTitle('');
    setOriginalReference('');
    setOriginalReferenceUrl(null);
    setPreservedPlotPoints([]);
    try {
      const result = await generateSynopsisFn({ name: creator.name, persona: creator.persona });
      setSynopsis(result.data.synopsis);
      setOriginalTitle(result.data.originalTitle ?? '');
      setOriginalReference(result.data.originalReference ?? '');
      setOriginalReferenceUrl(result.data.originalReferenceUrl ?? null);
      setPreservedPlotPoints(result.data.preservedPlotPoints ?? []);
    } catch (e) {
      Alert.alert('시놉시스 생성 실패', (e?.message ?? '알 수 없는 오류').slice(0, 100));
    } finally {
      setLoadingSynopsis(false);
    }
  };

  // ── 씬 분할 → series + episodes 저장 → StudioScreen 이동 ──
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

      // series 문서 생성
      const seriesRef = await addDoc(seriesCol(creator.id), {
        title: newScript.title,
        fullSynopsis: synopsis,
        originalTitle,
        originalReference,
        originalReferenceUrl,
        preservedPlotPoints,
        createdAt: serverTimestamp(),
      });

      // 1화 에피소드 생성
      const episodeRef = await addDoc(episodesCol(creator.id, seriesRef.id), {
        episodeNumber: 1,
        title: newScript.title,
        synopsis,
        scenes: newScript.scenes.map((s) => ({ ...s, imageUri: null, audioUri: null })),
        createdAt: serverTimestamp(),
      });

      navigation.navigate('CreatorStudio', {
        creator,
        incomingEpisode: {
          id: episodeRef.id,
          seriesId: seriesRef.id,
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
        {/* ── 크리에이터 헤더 ── */}
        <View style={styles.profileRow}>
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarText}>{creator.name.charAt(0)}</Text>
          </View>
          <View style={styles.profileInfo}>
            <Text style={styles.profileName}>{creator.name}</Text>
            <Text style={styles.profileSub}>시리즈 기획 중</Text>
          </View>
        </View>

        {/* ── 원본 출처 배지 ── */}
        {(originalTitle || originalReference) ? (
          <View style={styles.refBadge}>
            <Text style={styles.refIcon}>🔍</Text>
            <View style={styles.refTextBox}>
              <Text style={styles.refLabel}>AI 검색 · 원본 플롯 보존 확인</Text>
              {originalTitle ? <Text style={styles.refTitle}>{originalTitle}</Text> : null}
              {originalReference ? <Text style={styles.refValue}>{originalReference}</Text> : null}
              {originalReferenceUrl ? (
                <TouchableOpacity
                  onPress={() => Linking.openURL(originalReferenceUrl).catch(() => {})}
                  activeOpacity={0.7}
                >
                  <Text style={styles.refUrl}>🔗 원본 링크 열기</Text>
                </TouchableOpacity>
              ) : null}
              {preservedPlotPoints.length > 0 ? (
                <View style={styles.plotPointsBox}>
                  <Text style={styles.plotPointsLabel}>✅ 보존된 핵심 갈등 포인트</Text>
                  {preservedPlotPoints.map((pt, i) => (
                    <Text key={i} style={styles.plotPoint} numberOfLines={2}>
                      • {pt}
                    </Text>
                  ))}
                </View>
              ) : null}
            </View>
          </View>
        ) : null}

        {/* ── 시놉시스 카드 ── */}
        <View style={styles.synopsisCard}>
          <View style={styles.cardLabelRow}>
            <Text style={styles.cardLabelIcon}>📖</Text>
            <Text style={styles.cardLabel}>시리즈 줄거리 (시놉시스)</Text>
          </View>

          {loadingSynopsis ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator size="large" color="#4A90E2" />
              <Text style={styles.loadingTitle}>바이럴 플롯 분석 중...</Text>
              <Text style={styles.loadingSubtitle}>
                {creator.name}의 세계관에 맞는 검증된 스토리를 각색하고 있습니다
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

      {/* ── 하단 액션 버튼 ── */}
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

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F5F7FA' },
  scroll: { flex: 1 },
  inner: { padding: 16, paddingBottom: 24 },

  profileRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#fff', borderRadius: 16, padding: 14, marginBottom: 12,
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8, elevation: 3,
  },
  avatarCircle: { width: 46, height: 46, borderRadius: 23, backgroundColor: '#4A90E2', alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 18, fontWeight: '800', color: '#fff' },
  profileInfo: { flex: 1 },
  profileName: { fontSize: 17, fontWeight: '800', color: '#1A1A2E' },
  profileSub: { fontSize: 12, color: '#9CA3AF', marginTop: 2 },

  refBadge: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: '#FFFBEB', borderRadius: 12, padding: 12, marginBottom: 12,
    borderWidth: 1, borderColor: '#FDE68A',
  },
  refIcon: { fontSize: 16, marginTop: 1 },
  refTextBox: { flex: 1 },
  refLabel: { fontSize: 10, fontWeight: '700', color: '#D97706', letterSpacing: 0.5, marginBottom: 3 },
  refTitle: { fontSize: 13, fontWeight: '800', color: '#78350F', marginBottom: 2 },
  refValue: { fontSize: 12, color: '#92400E', lineHeight: 17 },
  refUrl: { fontSize: 11, color: '#B45309', textDecorationLine: 'underline', marginTop: 5 },
  plotPointsBox: { marginTop: 8, gap: 3 },
  plotPointsLabel: { fontSize: 10, fontWeight: '700', color: '#059669', marginBottom: 2 },
  plotPoint: { fontSize: 11, color: '#065F46', lineHeight: 16 },

  synopsisCard: {
    backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 12,
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8, elevation: 3, minHeight: 260,
  },
  cardLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 },
  cardLabelIcon: { fontSize: 15 },
  cardLabel: { fontSize: 13, fontWeight: '700', color: '#4A90E2', letterSpacing: 0.3 },

  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 56, gap: 12 },
  loadingTitle: { fontSize: 16, fontWeight: '700', color: '#1A1A2E' },
  loadingSubtitle: { fontSize: 13, color: '#9CA3AF', textAlign: 'center', lineHeight: 20 },

  synopsisInput: { fontSize: 14, color: '#1A1A2E', lineHeight: 24, minHeight: 200, textAlignVertical: 'top' },

  editHint: { fontSize: 12, color: '#9CA3AF', paddingHorizontal: 4, marginBottom: 8 },

  footer: {
    paddingHorizontal: 16, paddingBottom: 32, paddingTop: 12,
    backgroundColor: '#F5F7FA', borderTopWidth: 1, borderTopColor: '#E5E7EB', gap: 10,
  },
  secondaryRow: { flexDirection: 'row', gap: 10 },
  secondaryBtn: {
    flex: 1, paddingVertical: 13, borderRadius: 12, borderWidth: 1.5,
    borderColor: '#4A90E2', alignItems: 'center', backgroundColor: '#F0F7FF',
  },
  secondaryBtnText: { fontSize: 13, fontWeight: '700', color: '#4A90E2' },
  btnDisabled: { borderColor: '#E5E7EB', backgroundColor: '#F9F9F9' },
  disabledText: { color: '#C4C4C4' },

  primaryBtn: {
    backgroundColor: '#1A1A2E', borderRadius: 16, paddingVertical: 18,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    shadowColor: '#1A1A2E', shadowOpacity: 0.3, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 8,
  },
  primaryBtnDisabled: { opacity: 0.4, shadowOpacity: 0.05, elevation: 2 },
  primaryBtnIcon: { fontSize: 20 },
  primaryBtnText: { fontSize: 16, fontWeight: '800', color: '#fff', letterSpacing: -0.3 },
});
