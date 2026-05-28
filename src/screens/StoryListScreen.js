import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Linking,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { ResizeMode, Video } from 'expo-av';
import {
  addDoc,
  collection,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../services/firebase';

// ── Cloud Functions ─────────────────────────────────────────
const generateScenesFromSynopsisFn = httpsCallable(functions, 'generateScenesFromSynopsis', { timeout: 60000  });
const generateSceneImageFn         = httpsCallable(functions, 'generateSceneImage',          { timeout: 120000 });
const generateSceneAudioFn         = httpsCallable(functions, 'generateSceneAudio',          { timeout: 60000  });
const generateFinalVideoFn         = httpsCallable(functions, 'generateFinalVideo',          { timeout: 540000 });

// ── Firestore 경로 헬퍼 ─────────────────────────────────────
const seriesCol     = (cid)           => collection(db, 'creators', cid, 'series');
const episodesCol   = (cid, sid)      => collection(db, 'creators', cid, 'series', sid, 'episodes');
const episodeDocRef = (cid, sid, eid) => doc(db, 'creators', cid, 'series', sid, 'episodes', eid);

export default function StoryListScreen({ route, navigation }) {
  const { creator, initialSeriesId } = route.params;

  const [stories,        setStories]        = useState([]);
  const [loading,        setLoading]        = useState(true);
  const [expandedId,     setExpandedId]     = useState(null);
  const [showOriginalId, setShowOriginalId] = useState(null);

  // 시리즈별 에피소드 제작 상태: { [seriesId]: { [epNumber]: { episodeId, videoUrl } } }
  const [episodeStatus, setEpisodeStatus] = useState({});

  // 제작 진행 상태 — null이면 유휴
  // { seriesId, epNumber, phase: 'scenes'|'image'|'audio'|'video', current, total }
  const [producing, setProducing] = useState(null);

  // 인라인 비디오 재생 모달
  const [videoModal, setVideoModal] = useState(null);
  // { videoUrl, title }

  useEffect(() => { loadStories(); }, []);

  // 스토리 로드 완료 후 initialSeriesId 자동 확장
  useEffect(() => {
    if (!loading && initialSeriesId) {
      setExpandedId(initialSeriesId);
      loadEpisodeStatus(initialSeriesId);
    }
  }, [loading, initialSeriesId]);

  const loadStories = async () => {
    setLoading(true);
    try {
      const snap = await getDocs(query(seriesCol(creator.id), orderBy('createdAt', 'desc')));
      setStories(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    } catch (e) {
      console.error('[StoryListScreen] 로드 실패:', e.message);
    } finally {
      setLoading(false);
    }
  };

  // 시리즈 확장 시 해당 시리즈의 에피소드 제작 현황 로드
  const loadEpisodeStatus = async (seriesId) => {
    if (episodeStatus[seriesId]) return; // 이미 로드됨
    try {
      const snap = await getDocs(episodesCol(creator.id, seriesId));
      const status = {};
      snap.docs.forEach((d) => {
        const data = d.data();
        const num = data.episodeNumber;
        if (num != null) {
          status[num] = { episodeId: d.id, videoUrl: data.videoUrl ?? null };
        }
      });
      setEpisodeStatus((prev) => ({ ...prev, [seriesId]: status }));
    } catch (e) {
      console.error('[loadEpisodeStatus] 실패:', e.message);
    }
  };

  const handleExpand = (seriesId) => {
    const willExpand = expandedId !== seriesId;
    setExpandedId(willExpand ? seriesId : null);
    if (willExpand) loadEpisodeStatus(seriesId);
  };

  // ── 에피소드별 원클릭 통짜 제작 파이프라인 ─────────────────
  const handleProduceEpisode = async (story, ep) => {
    if (producing) return;

    setProducing({ seriesId: story.id, epNumber: ep.number, phase: 'scenes', current: 0, total: 0 });

    try {
      // ① 씬 분할
      const sceneRes = await generateScenesFromSynopsisFn({
        synopsis: ep.summary ?? story.fullSynopsis ?? '',
        name:     creator.name,
        persona:  creator.persona,
      });
      const { title, scenes } = sceneRes.data;
      const total = scenes.length;

      // Firestore 에피소드 문서 생성
      const epRef = await addDoc(episodesCol(creator.id, story.id), {
        episodeNumber: ep.number,
        title,
        synopsis: ep.summary ?? '',
        scenes:   scenes.map((s) => ({ ...s, imageUri: null, audioUri: null })),
        createdAt: serverTimestamp(),
      });
      const episodeId = epRef.id;

      // ② 이미지 순차 생성 (rate-limit 방어)
      setProducing((p) => ({ ...p, phase: 'image', current: 0, total }));
      const imageUris = {};
      for (let i = 0; i < total; i++) {
        setProducing((p) => ({ ...p, current: i + 1 }));
        const imgRes = await generateSceneImageFn({
          visualPrompt: scenes[i].visualPrompt ?? scenes[i].direction,
          creatorId:    creator.id,
          seriesId:     story.id,
          episodeId,
          sceneIndex:   i,
        });
        imageUris[i] = imgRes.data.imageUrl;
      }

      // ③ 오디오 병렬 생성
      setProducing((p) => ({ ...p, phase: 'audio', current: 0, total }));
      const audioUris = {};
      let audioDone = 0;
      await Promise.all(
        scenes.map(async (scene, i) => {
          const audioRes = await generateSceneAudioFn({
            dialogue:   scene.dialogue,
            voice:      'nova',
            creatorId:  creator.id,
            seriesId:   story.id,
            episodeId,
            sceneIndex: i,
          });
          audioUris[i] = audioRes.data.audioUri;
          audioDone += 1;
          const done = audioDone;
          setProducing((p) => ({ ...p, current: done }));
        })
      );

      // Firestore 미디어 URL 저장 (generateFinalVideo가 읽기 전 필수)
      await updateDoc(episodeDocRef(creator.id, story.id, episodeId), {
        scenes: scenes.map((s, i) => ({
          ...s,
          imageUri: imageUris[i] ?? null,
          audioUri: audioUris[i] ?? null,
        })),
      });

      // ④ 최종 MP4 합성 — Cloud Function 내부에서 Firestore videoUrl도 저장됨
      setProducing((p) => ({ ...p, phase: 'video', current: 0, total: 1 }));
      const videoRes = await generateFinalVideoFn({
        creatorId: creator.id,
        seriesId:  story.id,
        episodeId,
      });
      const finalVideoUrl = videoRes.data.videoUrl;

      // 로컬 에피소드 상태 즉시 갱신 (리로드 없이 UI 업데이트)
      setEpisodeStatus((prev) => ({
        ...prev,
        [story.id]: {
          ...(prev[story.id] ?? {}),
          [ep.number]: { episodeId, videoUrl: finalVideoUrl },
        },
      }));

      // 완성 영상 모달 표시 (화면 이동 없음)
      setVideoModal({ videoUrl: finalVideoUrl, title });

    } catch (e) {
      Alert.alert('제작 실패', (e?.message ?? '알 수 없는 오류').slice(0, 120));
    } finally {
      setProducing(null);
    }
  };

  // 제작 진행 단계 표시 텍스트
  const phaseLabel = () => {
    if (!producing) return '';
    switch (producing.phase) {
      case 'scenes': return '⚙️ 씬 분할 중...';
      case 'image':  return `🖼 이미지 생성 중... (${producing.current}/${producing.total})`;
      case 'audio':  return `🔊 더빙 생성 중... (${producing.current}/${producing.total})`;
      case 'video':  return '🎬 최종 MP4 렌더링 중...';
      default:       return '처리 중...';
    }
  };
  const phaseStep = () => {
    switch (producing?.phase) {
      case 'scenes': return '1 / 4 — 씬 분할';
      case 'image':  return '2 / 4 — 이미지 생성';
      case 'audio':  return '3 / 4 — 더빙';
      case 'video':  return '4 / 4 — 영상 합성';
      default:       return '';
    }
  };

  // ─────────────────────────────────────────────────────────
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

      {/* ── 제작 진행 전체화면 오버레이 ── */}
      <Modal visible={!!producing} transparent animationType="fade" statusBarTranslucent>
        <View style={styles.producingOverlay}>
          <View style={styles.producingCard}>
            <ActivityIndicator size="large" color="#7C3AED" style={{ marginBottom: 16 }} />
            <Text style={styles.producingStep}>{phaseStep()}</Text>
            <Text style={styles.producingLabel}>{phaseLabel()}</Text>
            <Text style={styles.producingDetail}>
              {producing ? `${creator.name} — ${producing.epNumber}화 숏폼 자동 제작 중` : ''}
            </Text>
            <Text style={styles.producingHint}>화면을 닫지 마세요. 최대 5~10분 소요됩니다.</Text>
          </View>
        </View>
      </Modal>

      {/* ── 인라인 비디오 재생 모달 ── */}
      <Modal
        visible={!!videoModal}
        transparent
        animationType="slide"
        onRequestClose={() => setVideoModal(null)}
      >
        <View style={styles.videoOverlay}>
          <View style={styles.videoCard}>
            <Text style={styles.videoCardTitle} numberOfLines={2}>
              {videoModal?.title}
            </Text>

            {videoModal?.videoUrl ? (
              <Video
                source={{ uri: videoModal.videoUrl }}
                style={styles.videoPlayer}
                useNativeControls
                resizeMode={ResizeMode.CONTAIN}
                shouldPlay
              />
            ) : (
              <View style={styles.videoPlaceholder}>
                <ActivityIndicator color="#7C3AED" />
              </View>
            )}

            <TouchableOpacity
              style={styles.videoCloseBtn}
              onPress={() => setVideoModal(null)}
              activeOpacity={0.85}
            >
              <Text style={styles.videoCloseBtnText}>✕  닫기</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── 메인 스토리 목록 ── */}
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
          const isExpanded      = expandedId === item.id;
          const isShowingOrigin = showOriginalId === item.id;
          const seriesEpStatus  = episodeStatus[item.id] ?? {};

          return (
            <View style={styles.card}>

              {/* ── 카드 헤더 ── */}
              <TouchableOpacity
                onPress={() => handleExpand(item.id)}
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

                  {/* 원본 전문 비교 */}
                  {item.originalFullText ? (
                    <View style={styles.compareSection}>
                      <TouchableOpacity
                        style={styles.compareTitleRow}
                        onPress={() => setShowOriginalId(isShowingOrigin ? null : item.id)}
                        activeOpacity={0.7}
                      >
                        <View style={styles.compareLabel}>
                          <Text style={styles.compareLabelIcon}>📖</Text>
                          <Text style={styles.compareLabelText}>원본 썰 전문 보기</Text>
                        </View>
                        {item.originalReferenceUrl ? (
                          <TouchableOpacity
                            onPress={() => Linking.openURL(item.originalReferenceUrl).catch(() => {})}
                            activeOpacity={0.7}
                            style={styles.linkBtn}
                          >
                            <Text style={styles.linkText}>🔗 출처</Text>
                          </TouchableOpacity>
                        ) : null}
                        <Text style={styles.compareToggleIcon}>{isShowingOrigin ? '▲' : '▼'}</Text>
                      </TouchableOpacity>

                      {isShowingOrigin ? (
                        <ScrollView
                          style={styles.originalScroll}
                          nestedScrollEnabled
                          showsVerticalScrollIndicator
                        >
                          <Text style={styles.originalText}>{item.originalFullText}</Text>
                        </ScrollView>
                      ) : null}
                    </View>
                  ) : null}

                  {/* AI 각색 줄거리 */}
                  {item.fullSynopsis ? (
                    <View style={styles.synopsisSection}>
                      <View style={styles.sectionLabelRow}>
                        <Text style={styles.sectionLabelIcon}>✍️</Text>
                        <Text style={styles.sectionLabelText}>AI 각색 전체 줄거리</Text>
                      </View>
                      <Text style={styles.synopsisText}>{item.fullSynopsis}</Text>
                    </View>
                  ) : null}

                  {/* 보존 갈등 포인트 */}
                  {item.preservedPlotPoints?.length > 0 ? (
                    <View style={styles.plotSection}>
                      <Text style={styles.plotLabel}>✅ 원본 보존 갈등 포인트</Text>
                      {item.preservedPlotPoints.map((pt, i) => (
                        <Text key={i} style={styles.plotPoint}>• {pt}</Text>
                      ))}
                    </View>
                  ) : null}

                  {/* 에피소드별 제작 카드 */}
                  {item.episodes?.length > 0 ? (
                    <View style={styles.episodesBlock}>
                      <View style={styles.sectionLabelRow}>
                        <Text style={styles.sectionLabelIcon}>🎬</Text>
                        <Text style={[styles.sectionLabelText, { color: '#7C3AED' }]}>
                          {item.episodes.length}부작 에피소드
                        </Text>
                      </View>

                      {item.episodes.map((ep) => {
                        const epStatus = seriesEpStatus[ep.number];
                        const hasVideo = !!(epStatus?.videoUrl);
                        const isThisProducing =
                          producing?.seriesId === item.id && producing?.epNumber === ep.number;

                        return (
                          <View key={ep.number} style={styles.epCard}>
                            {/* 화수 헤더 */}
                            <View style={styles.epCardHeader}>
                              <View style={[styles.epNumBadge, hasVideo && styles.epNumBadgeDone]}>
                                <Text style={styles.epNumText}>{ep.number}화</Text>
                              </View>
                              <View style={{ flex: 1 }}>
                                <Text style={styles.epTitle}>{ep.title}</Text>
                              </View>
                              {hasVideo ? (
                                <View style={styles.doneTag}>
                                  <Text style={styles.doneTagText}>✅ 완성</Text>
                                </View>
                              ) : null}
                            </View>

                            <Text style={styles.epSummary}>{ep.summary}</Text>

                            {hasVideo ? (
                              /* ── 완성된 영상 있음 ── */
                              <View style={styles.doneButtonRow}>
                                <TouchableOpacity
                                  style={styles.playBtn}
                                  onPress={() =>
                                    setVideoModal({
                                      videoUrl: epStatus.videoUrl,
                                      title: ep.title,
                                    })
                                  }
                                  activeOpacity={0.85}
                                >
                                  <Text style={styles.playBtnIcon}>▶️</Text>
                                  <Text style={styles.playBtnText}>완성된 숏폼 재생</Text>
                                </TouchableOpacity>

                                <TouchableOpacity
                                  style={[
                                    styles.remakeBtn,
                                    !!producing && styles.produceBtnDisabled,
                                  ]}
                                  onPress={() => handleProduceEpisode(item, ep)}
                                  disabled={!!producing}
                                  activeOpacity={0.75}
                                >
                                  <Text style={styles.remakeBtnText}>🔄 다시 제작</Text>
                                </TouchableOpacity>
                              </View>
                            ) : (
                              /* ── 제작 전 / 진행 중 ── */
                              <TouchableOpacity
                                style={[
                                  styles.produceBtn,
                                  !!producing && !isThisProducing && styles.produceBtnDisabled,
                                ]}
                                onPress={() => handleProduceEpisode(item, ep)}
                                disabled={!!producing}
                                activeOpacity={0.85}
                              >
                                {isThisProducing ? (
                                  <>
                                    <ActivityIndicator color="#fff" size="small" />
                                    <Text style={styles.produceBtnText}>{phaseLabel()}</Text>
                                  </>
                                ) : (
                                  <>
                                    <Text style={styles.produceBtnIcon}>🚀</Text>
                                    <Text style={styles.produceBtnText}>
                                      {ep.number}화 숏폼 자동 제작
                                    </Text>
                                  </>
                                )}
                              </TouchableOpacity>
                            )}
                          </View>
                        );
                      })}
                    </View>
                  ) : item.fullSynopsis ? (
                    // 에피소드 배열 없는 구버전 스토리
                    <TouchableOpacity
                      style={[styles.produceBtn, !!producing && styles.produceBtnDisabled]}
                      onPress={() =>
                        handleProduceEpisode(item, {
                          number: 1, summary: item.fullSynopsis, title: item.title,
                        })
                      }
                      disabled={!!producing}
                      activeOpacity={0.85}
                    >
                      <Text style={styles.produceBtnIcon}>🚀</Text>
                      <Text style={styles.produceBtnText}>이 스토리로 숏폼 자동 제작</Text>
                    </TouchableOpacity>
                  ) : null}

                </View>
              ) : null}
            </View>
          );
        }}
      />
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F5F7FA' },
  loadingScreen: {
    flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, backgroundColor: '#F5F7FA',
  },
  loadingText: { fontSize: 14, color: '#6B7280' },

  list: { padding: 16, paddingBottom: 40, gap: 12 },

  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  headerTitle: { flex: 1, fontSize: 18, fontWeight: '800', color: '#1A1A2E' },
  refreshBtn: {
    paddingHorizontal: 12, paddingVertical: 6, backgroundColor: '#EEF2FF', borderRadius: 10,
  },
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

  // ── 시리즈 카드 ──
  card: {
    backgroundColor: '#fff', borderRadius: 16, overflow: 'hidden',
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8, elevation: 3,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', padding: 16, gap: 10 },
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
    paddingHorizontal: 16, paddingBottom: 16, paddingTop: 12, gap: 14,
  },

  // ── 원본 전문 섹션 ──
  compareSection: {
    backgroundColor: '#FFFBEB', borderRadius: 12, padding: 12,
    borderWidth: 1, borderColor: '#FDE68A', gap: 6,
  },
  compareTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  compareLabel: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 5 },
  compareLabelIcon: { fontSize: 14 },
  compareLabelText: { fontSize: 12, fontWeight: '800', color: '#B45309' },
  compareToggleIcon: { fontSize: 12, color: '#B45309', marginLeft: 4 },
  linkBtn: { paddingHorizontal: 6, paddingVertical: 2 },
  linkText: { fontSize: 11, color: '#4F46E5', textDecorationLine: 'underline' },
  originalScroll: {
    maxHeight: 240, backgroundColor: '#FEF3C7', borderRadius: 8, padding: 10, marginTop: 4,
  },
  originalText: { fontSize: 12, color: '#78350F', lineHeight: 18 },

  // ── 각색 줄거리 섹션 ──
  synopsisSection: {
    backgroundColor: '#F5F3FF', borderRadius: 12, padding: 12,
    borderWidth: 1, borderColor: '#DDD6FE',
  },
  sectionLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 8 },
  sectionLabelIcon: { fontSize: 13 },
  sectionLabelText: { fontSize: 12, fontWeight: '800', color: '#4B5563' },
  synopsisText: { fontSize: 13, color: '#374151', lineHeight: 20 },

  // ── 갈등 포인트 ──
  plotSection: { gap: 4 },
  plotLabel: { fontSize: 11, fontWeight: '800', color: '#059669', marginBottom: 4 },
  plotPoint: { fontSize: 11, color: '#065F46', lineHeight: 16 },

  // ── 에피소드 제작 블록 ──
  episodesBlock: { gap: 10 },
  epCard: {
    backgroundColor: '#F9F8FF', borderRadius: 14, padding: 14, gap: 8,
    borderWidth: 1, borderColor: '#EDE9FE',
  },
  epCardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  epNumBadge: {
    width: 36, height: 22, backgroundColor: '#7C3AED', borderRadius: 5,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1,
  },
  epNumBadgeDone: { backgroundColor: '#059669' },
  epNumText: { fontSize: 11, fontWeight: '800', color: '#fff' },
  epTitle: { fontSize: 14, fontWeight: '800', color: '#1A1A2E', lineHeight: 20 },
  epSummary: { fontSize: 12, color: '#6B7280', lineHeight: 18 },
  doneTag: {
    backgroundColor: '#D1FAE5', paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 8, flexShrink: 0,
  },
  doneTagText: { fontSize: 10, fontWeight: '800', color: '#065F46' },

  // 완성된 영상 버튼 행
  doneButtonRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  playBtn: {
    flex: 1, backgroundColor: '#059669', borderRadius: 12, paddingVertical: 12,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    shadowColor: '#059669', shadowOpacity: 0.3, shadowRadius: 6, elevation: 4,
  },
  playBtnIcon: { fontSize: 14 },
  playBtnText: { fontSize: 12, fontWeight: '800', color: '#fff' },
  remakeBtn: {
    paddingHorizontal: 14, paddingVertical: 12, backgroundColor: '#F3F4F6',
    borderRadius: 12, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: '#E5E7EB',
  },
  remakeBtnText: { fontSize: 11, fontWeight: '700', color: '#6B7280' },

  // 제작 전 버튼
  produceBtn: {
    backgroundColor: '#7C3AED', borderRadius: 12, paddingVertical: 13, marginTop: 4,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    shadowColor: '#7C3AED', shadowOpacity: 0.3, shadowRadius: 8, elevation: 5,
  },
  produceBtnDisabled: { opacity: 0.35, shadowOpacity: 0, elevation: 0 },
  produceBtnIcon: { fontSize: 16 },
  produceBtnText: { fontSize: 13, fontWeight: '800', color: '#fff' },

  // ── 제작 진행 오버레이 ──
  producingOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.72)',
    alignItems: 'center', justifyContent: 'center', padding: 32,
  },
  producingCard: {
    backgroundColor: '#1A1A2E', borderRadius: 24, padding: 32,
    alignItems: 'center', width: '100%',
    shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 24, elevation: 24,
  },
  producingStep: {
    fontSize: 11, fontWeight: '700', color: '#7C3AED',
    letterSpacing: 0.8, marginBottom: 8,
  },
  producingLabel: {
    fontSize: 18, fontWeight: '900', color: '#fff',
    textAlign: 'center', marginBottom: 10,
  },
  producingDetail: { fontSize: 13, color: '#9CA3AF', textAlign: 'center', marginBottom: 6 },
  producingHint: { fontSize: 11, color: '#4B5563', textAlign: 'center', lineHeight: 16 },

  // ── 비디오 재생 모달 ──
  videoOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.9)',
    alignItems: 'center', justifyContent: 'flex-end',
  },
  videoCard: {
    backgroundColor: '#111827', borderTopLeftRadius: 28, borderTopRightRadius: 28,
    padding: 20, width: '100%', alignItems: 'center', gap: 14, paddingBottom: 44,
  },
  videoCardTitle: {
    fontSize: 15, fontWeight: '800', color: '#fff',
    textAlign: 'center', paddingHorizontal: 8,
  },
  videoPlayer: {
    width: '100%', aspectRatio: 9 / 16, borderRadius: 16,
    backgroundColor: '#000', maxHeight: 440,
  },
  videoPlaceholder: {
    width: '100%', aspectRatio: 9 / 16, maxHeight: 440,
    alignItems: 'center', justifyContent: 'center', backgroundColor: '#1F2937', borderRadius: 16,
  },
  videoCloseBtn: {
    backgroundColor: '#374151', borderRadius: 14, paddingVertical: 13,
    paddingHorizontal: 48, alignItems: 'center',
  },
  videoCloseBtnText: { fontSize: 14, fontWeight: '700', color: '#9CA3AF' },
});
