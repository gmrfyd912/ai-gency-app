import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { addDoc, collection, getDocs, orderBy, query, serverTimestamp } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../services/firebase';

const generateScenesFromSynopsisFn = httpsCallable(functions, 'generateScenesFromSynopsis', { timeout: 60000 });

const seriesCol = (creatorId) => collection(db, 'creators', creatorId, 'series');
const episodesCol = (creatorId, seriesId) =>
  collection(db, 'creators', creatorId, 'series', seriesId, 'episodes');

export default function StoryListScreen({ route, navigation }) {
  const { creator } = route.params;
  const [stories, setStories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState(null);
  const [showOriginalId, setShowOriginalId] = useState(null);
  const [buildingId, setBuildingId] = useState(null);

  useEffect(() => { loadStories(); }, []);

  const loadStories = async () => {
    setLoading(true);
    try {
      const snap = await getDocs(
        query(seriesCol(creator.id), orderBy('createdAt', 'desc'))
      );
      setStories(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    } catch (e) {
      console.error('[StoryListScreen] 로드 실패:', e.message);
    } finally {
      setLoading(false);
    }
  };

  // 선택한 스토리로 장면 분할 후 StudioScreen으로 이동
  const handleStartProduction = async (story) => {
    if (buildingId) return;
    setBuildingId(story.id);
    try {
      const synopsis = story.fullSynopsis ?? '';
      if (!synopsis.trim()) throw new Error('저장된 줄거리가 없습니다.');

      const result = await generateScenesFromSynopsisFn({
        synopsis,
        name: creator.name,
        persona: creator.persona,
      });

      const episodeRef = await addDoc(episodesCol(creator.id, story.id), {
        episodeNumber: 1,
        title: result.data.title,
        synopsis,
        scenes: result.data.scenes.map((s) => ({ ...s, imageUri: null, audioUri: null })),
        createdAt: serverTimestamp(),
      });

      navigation.navigate('CreatorStudio', {
        creator,
        incomingEpisode: {
          id: episodeRef.id,
          seriesId: story.id,
          title: result.data.title,
          scenes: result.data.scenes,
        },
      });
    } catch (e) {
      Alert.alert('영상 제작 준비 실패', (e?.message ?? '알 수 없는 오류').slice(0, 120));
    } finally {
      setBuildingId(null);
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingScreen}>
        <ActivityIndicator size="large" color="#7C3AED" />
        <Text style={styles.loadingText}>스토리 보관함 불러오는 중...</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <FlatList
        data={stories}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View style={styles.headerRow}>
            <Text style={styles.headerTitle}>📜 스토리 기획안 보관함</Text>
            <TouchableOpacity style={styles.refreshBtn} onPress={loadStories}>
              <Text style={styles.refreshBtnText}>↺ 새로고침</Text>
            </TouchableOpacity>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.emptyBox}>
            <Text style={styles.emptyIcon}>📝</Text>
            <Text style={styles.emptyText}>아직 저장된 스토리가 없습니다.</Text>
            <Text style={styles.emptyHint}>
              시놉시스 화면에서 AI가 스토리를 생성하면 자동으로 여기에 저장됩니다.
            </Text>
            <TouchableOpacity
              style={styles.goSynopsisBtn}
              onPress={() => navigation.navigate('Synopsis', { creator })}
            >
              <Text style={styles.goSynopsisBtnText}>✨ 새 스토리 생성하기</Text>
            </TouchableOpacity>
          </View>
        }
        renderItem={({ item }) => {
          const isExpanded = expandedId === item.id;
          const isShowingOriginal = showOriginalId === item.id;
          const isBuilding = buildingId === item.id;

          return (
            <View style={styles.card}>
              {/* ── 카드 헤더 (탭하면 확장) ── */}
              <TouchableOpacity
                onPress={() => setExpandedId(isExpanded ? null : item.id)}
                activeOpacity={0.75}
                style={styles.cardHeader}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle} numberOfLines={2}>
                    {item.title ?? '제목 없음'}
                  </Text>
                  {item.originalTitle ? (
                    <Text style={styles.cardOriginal} numberOfLines={1}>
                      📌 {item.originalTitle}
                    </Text>
                  ) : null}
                  {item.originalReference ? (
                    <Text style={styles.cardRef} numberOfLines={1}>
                      🔍 {item.originalReference}
                    </Text>
                  ) : null}
                </View>
                <View style={styles.cardRight}>
                  {item.episodes?.length > 0 ? (
                    <View style={styles.epCountBadge}>
                      <Text style={styles.epCountText}>{item.episodes.length}부작</Text>
                    </View>
                  ) : null}
                  <Text style={styles.expandIcon}>{isExpanded ? '▲' : '▼'}</Text>
                </View>
              </TouchableOpacity>

              {/* ── 확장 영역 ── */}
              {isExpanded ? (
                <View style={styles.expandedBody}>

                  {/* 원본 전문 토글 */}
                  {item.originalFullText ? (
                    <View style={styles.originalSection}>
                      <TouchableOpacity
                        style={styles.toggleBtn}
                        onPress={() => setShowOriginalId(isShowingOriginal ? null : item.id)}
                        activeOpacity={0.7}
                      >
                        <Text style={styles.toggleBtnText}>
                          {isShowingOriginal
                            ? '▲ 원본 전문 접기'
                            : '▼ 원본 전문 보기 (AI 검색 추출 완전체)'}
                        </Text>
                        {item.originalReferenceUrl ? (
                          <TouchableOpacity
                            onPress={() =>
                              Linking.openURL(item.originalReferenceUrl).catch(() => {})
                            }
                            activeOpacity={0.7}
                            style={styles.linkBtn}
                          >
                            <Text style={styles.linkText}>🔗 원본 링크</Text>
                          </TouchableOpacity>
                        ) : null}
                      </TouchableOpacity>
                      {isShowingOriginal ? (
                        <ScrollView
                          style={styles.originalTextScroll}
                          nestedScrollEnabled
                          showsVerticalScrollIndicator
                        >
                          <Text style={styles.originalText}>{item.originalFullText}</Text>
                        </ScrollView>
                      ) : null}
                    </View>
                  ) : null}

                  {/* N부작 에피소드 구성 */}
                  {item.episodes?.length > 0 ? (
                    <View style={styles.episodesSection}>
                      <Text style={styles.sectionLabel}>
                        🎬 {item.episodes.length}부작 시리즈 구성
                      </Text>
                      {item.episodes.map((ep) => (
                        <View key={ep.number} style={styles.epRow}>
                          <View style={styles.epNumBadge}>
                            <Text style={styles.epNumText}>{ep.number}화</Text>
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.epTitle}>{ep.title}</Text>
                            <Text style={styles.epSummary}>{ep.summary}</Text>
                          </View>
                        </View>
                      ))}
                    </View>
                  ) : item.fullSynopsis ? (
                    <View style={styles.episodesSection}>
                      <Text style={styles.sectionLabel}>📖 시리즈 줄거리</Text>
                      <Text style={styles.epSummary}>{item.fullSynopsis}</Text>
                    </View>
                  ) : null}

                  {/* 보존된 갈등 포인트 */}
                  {item.preservedPlotPoints?.length > 0 ? (
                    <View style={styles.plotPointsSection}>
                      <Text style={styles.plotPointsLabel}>✅ 원본 보존 갈등 포인트</Text>
                      {item.preservedPlotPoints.map((pt, i) => (
                        <Text key={i} style={styles.plotPoint}>• {pt}</Text>
                      ))}
                    </View>
                  ) : null}

                  {/* 🚀 영상 제작 가동 버튼 */}
                  <TouchableOpacity
                    style={[styles.buildBtn, isBuilding && styles.buildBtnDisabled]}
                    onPress={() => handleStartProduction(item)}
                    disabled={!!isBuilding}
                    activeOpacity={0.85}
                  >
                    {isBuilding ? (
                      <>
                        <ActivityIndicator color="#fff" size="small" />
                        <Text style={styles.buildBtnText}>장면 분할 중...</Text>
                      </>
                    ) : (
                      <>
                        <Text style={styles.buildBtnIcon}>🚀</Text>
                        <Text style={styles.buildBtnText}>이 스토리로 장면 분할 및 영상 제작 가동</Text>
                      </>
                    )}
                  </TouchableOpacity>
                </View>
              ) : null}
            </View>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F5F7FA' },
  loadingScreen: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, backgroundColor: '#F5F7FA' },
  loadingText: { fontSize: 14, color: '#6B7280' },

  list: { padding: 16, paddingBottom: 40, gap: 12 },

  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  headerTitle: { flex: 1, fontSize: 18, fontWeight: '800', color: '#1A1A2E' },
  refreshBtn: { paddingHorizontal: 12, paddingVertical: 6, backgroundColor: '#EEF2FF', borderRadius: 10 },
  refreshBtnText: { fontSize: 12, fontWeight: '700', color: '#7C3AED' },

  emptyBox: { alignItems: 'center', marginTop: 60, gap: 10 },
  emptyIcon: { fontSize: 52 },
  emptyText: { fontSize: 15, color: '#6B7280', fontWeight: '600' },
  emptyHint: { fontSize: 13, color: '#9CA3AF', textAlign: 'center', lineHeight: 20 },
  goSynopsisBtn: {
    marginTop: 8, paddingHorizontal: 24, paddingVertical: 12,
    backgroundColor: '#7C3AED', borderRadius: 14,
  },
  goSynopsisBtnText: { fontSize: 14, fontWeight: '800', color: '#fff' },

  card: {
    backgroundColor: '#fff', borderRadius: 16, overflow: 'hidden',
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8, elevation: 3,
  },
  cardHeader: {
    flexDirection: 'row', alignItems: 'flex-start',
    padding: 16, gap: 10,
  },
  cardTitle: { fontSize: 15, fontWeight: '800', color: '#1A1A2E', marginBottom: 4 },
  cardOriginal: { fontSize: 12, color: '#7C3AED', marginBottom: 2 },
  cardRef: { fontSize: 11, color: '#9CA3AF' },
  cardRight: { alignItems: 'center', gap: 6, flexShrink: 0 },
  epCountBadge: {
    backgroundColor: '#EDE9FE', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8,
  },
  epCountText: { fontSize: 11, fontWeight: '700', color: '#7C3AED' },
  expandIcon: { fontSize: 12, color: '#9CA3AF' },

  expandedBody: {
    borderTopWidth: 1, borderTopColor: '#F3F4F6',
    paddingHorizontal: 16, paddingBottom: 16, paddingTop: 12, gap: 12,
  },

  originalSection: { gap: 6 },
  toggleBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  toggleBtnText: { fontSize: 12, fontWeight: '700', color: '#B45309', flex: 1 },
  linkBtn: { paddingLeft: 8 },
  linkText: { fontSize: 11, color: '#4F46E5', textDecorationLine: 'underline' },
  originalTextScroll: {
    maxHeight: 220, backgroundColor: '#FEF3C7', borderRadius: 8, padding: 10,
  },
  originalText: { fontSize: 12, color: '#78350F', lineHeight: 18 },

  episodesSection: { gap: 8 },
  sectionLabel: { fontSize: 12, fontWeight: '700', color: '#374151', marginBottom: 4 },
  epRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  epNumBadge: {
    width: 34, height: 20, backgroundColor: '#7C3AED', borderRadius: 4,
    alignItems: 'center', justifyContent: 'center', marginTop: 2, flexShrink: 0,
  },
  epNumText: { fontSize: 10, fontWeight: '800', color: '#fff' },
  epTitle: { fontSize: 13, fontWeight: '700', color: '#1A1A2E', marginBottom: 2 },
  epSummary: { fontSize: 12, color: '#6B7280', lineHeight: 17 },

  plotPointsSection: { gap: 4 },
  plotPointsLabel: { fontSize: 11, fontWeight: '700', color: '#059669' },
  plotPoint: { fontSize: 11, color: '#065F46', lineHeight: 16 },

  buildBtn: {
    backgroundColor: '#7C3AED', borderRadius: 14, paddingVertical: 15,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    shadowColor: '#7C3AED', shadowOpacity: 0.3, shadowRadius: 8, elevation: 5,
    marginTop: 4,
  },
  buildBtnDisabled: { opacity: 0.5, shadowOpacity: 0 },
  buildBtnIcon: { fontSize: 18 },
  buildBtnText: { fontSize: 14, fontWeight: '800', color: '#fff' },
});
