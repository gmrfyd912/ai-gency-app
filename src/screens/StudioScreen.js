import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Audio, ResizeMode, Video } from 'expo-av';
import {
  addDoc,
  collection,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../services/firebase';

// ── Cloud Function 클라이언트 ─────────────────────────────────
const generateContentFn    = httpsCallable(functions, 'generateContent');
const generateSceneImageFn = httpsCallable(functions, 'generateSceneImage', { timeout: 90000 });
const generateSceneAudioFn = httpsCallable(functions, 'generateSceneAudio');
const generateFinalVideoFn = httpsCallable(functions, 'generateFinalVideo', { timeout: 300000 });

// ── 상수 ─────────────────────────────────────────────────────
const pad = (n) => String(n).padStart(2, '0');
const SCENE_COLORS = ['#4A90E2', '#7C3AED', '#059669', '#D97706', '#DC2626'];

// ── Firestore 경로 헬퍼 ───────────────────────────────────────
const episodesCol = (creatorId) =>
  collection(db, 'creators', creatorId, 'episodes');
const episodeDoc = (creatorId, episodeId) =>
  doc(db, 'creators', creatorId, 'episodes', episodeId);

// ── scenes 배열을 Firestore 저장 형태로 직렬화 ──────────────
// script.scenes (순수 대본 데이터) + 현재 imageUri/audioUri 상태를 합산
const buildScenesPayload = (scenes, sceneImages, sceneAudios, overrides = {}) =>
  scenes.map((scene, i) => ({
    ...scene,
    imageUri: overrides.imageIdx === i ? overrides.imageUri : (sceneImages[i] ?? null),
    audioUri: overrides.audioIdx === i ? overrides.audioUri : (sceneAudios[i] ?? null),
  }));

export default function StudioScreen({ route }) {
  const { creator } = route.params;

  // ── 대본·이미지 상태 ─────────────────────────────────────
  const [script, setScript]               = useState(null);
  const [generating, setGenerating]       = useState(false);
  const [sceneImages, setSceneImages]     = useState({});
  const [sceneLoadingIdx, setSceneLoadingIdx] = useState(null);
  const [modalImageUrl, setModalImageUrl] = useState(null);

  // ── 오디오 상태 ───────────────────────────────────────────
  const [sceneAudios, setSceneAudios]         = useState({});
  const [audioDubbingIdx, setAudioDubbingIdx] = useState(null);
  const [playingIdx, setPlayingIdx]           = useState(null);
  const soundRef = useRef(null); // 현재 재생 중인 Sound 인스턴스

  // ── Firestore 자동 저장 상태 ─────────────────────────────
  const [currentEpisodeId, setCurrentEpisodeId] = useState(null);
  const [initialLoading, setInitialLoading]     = useState(true);

  // ── 영상 합성 상태 ────────────────────────────────────────
  const [synthesizing, setSynthesizing] = useState(false);
  const [videoUrl, setVideoUrl]         = useState(null);

  // ── 마운트: Audio 모드 설정 + 최신 에피소드 로드 ──────────
  useEffect(() => {
    Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
      shouldDuckAndroid: true,
      staysActiveInBackground: false,
    });
    loadLatestEpisode();

    // 언마운트 시 재생 중 사운드 해제
    return () => {
      if (soundRef.current) {
        soundRef.current.stopAsync().then(() => soundRef.current?.unloadAsync());
      }
    };
  }, []);

  // ── Firestore 최신 에피소드 로드 ─────────────────────────
  const loadLatestEpisode = async () => {
    setInitialLoading(true);
    try {
      const q = query(episodesCol(creator.id), orderBy('createdAt', 'desc'), limit(1));
      const snapshot = await getDocs(q);
      if (!snapshot.empty) {
        const snap = snapshot.docs[0];
        const data = snap.data();
        setCurrentEpisodeId(snap.id);
        const savedImages = {};
        const savedAudios = {};
        (data.scenes ?? []).forEach((scene, idx) => {
          if (scene.imageUri) savedImages[idx] = scene.imageUri;
          if (scene.audioUri) savedAudios[idx] = scene.audioUri;
        });
        setScript({
          title: data.title,
          scenes: data.scenes.map(({ imageUri: _i, audioUri: _a, ...rest }) => rest),
        });
        setSceneImages(savedImages);
        setSceneAudios(savedAudios);
        if (data.videoUrl) setVideoUrl(data.videoUrl);
      }
    } catch (e) {
      console.error('에피소드 로드 실패:', e.message);
    } finally {
      setInitialLoading(false);
    }
  };

  // ── Firestore 씬 배열 일괄 저장 ──────────────────────────
  const persistScenes = async (overrides = {}) => {
    if (!currentEpisodeId || !script) return;
    try {
      await updateDoc(episodeDoc(creator.id, currentEpisodeId), {
        scenes: buildScenesPayload(script.scenes, sceneImages, sceneAudios, overrides),
      });
    } catch (e) {
      console.error('Firestore 저장 실패:', e.message);
    }
  };

  // ── 대본 생성 + Firestore 저장 ───────────────────────────
  const handleGenerate = async () => {
    setGenerating(true);
    setScript(null);
    setSceneImages({});
    setSceneAudios({});
    setSceneLoadingIdx(null);
    setCurrentEpisodeId(null);
    setVideoUrl(null);
    setSynthesizing(false);
    if (soundRef.current) {
      await soundRef.current.stopAsync();
      await soundRef.current.unloadAsync();
      soundRef.current = null;
    }
    setPlayingIdx(null);
    try {
      const result = await generateContentFn({ name: creator.name, prompt: creator.persona });
      const newScript = { title: result.data.title, scenes: result.data.scenes };
      setScript(newScript);
      const episodeRef = await addDoc(episodesCol(creator.id), {
        title: newScript.title,
        scenes: newScript.scenes.map((s) => ({ ...s, imageUri: null, audioUri: null })),
        createdAt: serverTimestamp(),
      });
      setCurrentEpisodeId(episodeRef.id);
    } catch (e) {
      Alert.alert('생성 실패', (e?.message ?? '알 수 없는 오류').slice(0, 100));
    } finally {
      setGenerating(false);
    }
  };

  // ── 씬 이미지 생성 + Firestore 갱신 ─────────────────────
  const handleRenderScene = async (idx, direction) => {
    setSceneLoadingIdx(idx);
    try {
      const result = await generateSceneImageFn({
        visualPrompt: direction,
        creatorId: creator.id,
        episodeId: currentEpisodeId,
        sceneIndex: idx,
      });
      const imageUrl = result.data.imageUrl;
      setSceneImages((prev) => ({ ...prev, [idx]: imageUrl }));
      await persistScenes({ imageIdx: idx, imageUri: imageUrl });
    } catch (e) {
      Alert.alert('이미지 생성 실패', (e?.message ?? '알 수 없는 오류').slice(0, 100));
    } finally {
      setSceneLoadingIdx(null);
    }
  };

  // ── 씬 오디오 더빙 + Firestore 갱신 ─────────────────────
  const handleDubScene = async (idx, dialogue) => {
    setAudioDubbingIdx(idx);
    try {
      const result = await generateSceneAudioFn({
        dialogue,
        voice: 'nova',
        creatorId: creator.id,
        episodeId: currentEpisodeId,
        sceneIndex: idx,
      });
      const audioUri = result.data.audioUri;
      setSceneAudios((prev) => ({ ...prev, [idx]: audioUri }));
      await persistScenes({ audioIdx: idx, audioUri });
    } catch (e) {
      Alert.alert('더빙 생성 실패', (e?.message ?? '알 수 없는 오류').slice(0, 100));
    } finally {
      setAudioDubbingIdx(null);
    }
  };

  // ── 씬 오디오 재생/정지 ───────────────────────────────────
  const handlePlayAudio = async (idx, audioUri) => {
    // 동일 씬 재클릭 → 정지
    if (playingIdx === idx && soundRef.current) {
      await soundRef.current.stopAsync();
      await soundRef.current.unloadAsync();
      soundRef.current = null;
      setPlayingIdx(null);
      return;
    }
    // 다른 씬 재생 중이면 먼저 정지
    if (soundRef.current) {
      await soundRef.current.stopAsync();
      await soundRef.current.unloadAsync();
      soundRef.current = null;
    }
    setPlayingIdx(idx);
    try {
      const { sound } = await Audio.Sound.createAsync({ uri: audioUri });
      soundRef.current = sound;
      await sound.playAsync();
      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.didJustFinish) {
          sound.unloadAsync();
          soundRef.current = null;
          setPlayingIdx(null);
        }
      });
    } catch (e) {
      setPlayingIdx(null);
      Alert.alert('재생 실패', '오디오 재생 중 오류가 발생했습니다.');
    }
  };

  const handleSynthesize = async () => {
    if (!script || !currentEpisodeId || synthesizing) return;

    // Pre-flight: 모든 씬에 이미지 + 오디오가 있는지 확인
    const missing = script.scenes.reduce((acc, _, idx) => {
      if (!sceneImages[idx] || !sceneAudios[idx]) acc.push(idx + 1);
      return acc;
    }, []);
    if (missing.length > 0) {
      Alert.alert(
        '합성 불가',
        `씬 ${missing.join(', ')}번의 이미지 또는 오디오가 없습니다.\n모든 씬을 먼저 완성해주세요.`,
        [{ text: '확인' }]
      );
      return;
    }

    setSynthesizing(true);
    try {
      const result = await generateFinalVideoFn({ creatorId: creator.id, episodeId: currentEpisodeId });
      setVideoUrl(result.data.videoUrl);
    } catch (e) {
      Alert.alert('렌더링 실패', (e?.message ?? '알 수 없는 오류').slice(0, 100));
    } finally {
      setSynthesizing(false);
    }
  };

  // ── 초기 로딩 화면 ───────────────────────────────────────
  if (initialLoading) {
    return (
      <View style={styles.initLoadingScreen}>
        <ActivityIndicator size="large" color="#4A90E2" />
        <Text style={styles.initLoadingText}>이전 에피소드를 불러오는 중...</Text>
      </View>
    );
  }

  // ── 메인 렌더 ────────────────────────────────────────────
  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.inner, script && !generating && styles.innerWithFooter]}
      >
        {/* ── 크리에이터 프로필 ── */}
        <View style={styles.profileCard}>
          <View style={styles.profileTop}>
            <View style={styles.avatarCircle}>
              <Text style={styles.avatarText}>
                {creator.name ? creator.name.charAt(0) : '?'}
              </Text>
            </View>
            <View style={styles.profileInfo}>
              {creator.category ? (
                <Text style={styles.categoryBadge}>{creator.category}</Text>
              ) : null}
              <Text style={styles.creatorName}>{creator.name}</Text>
              {creator.voice ? <Text style={styles.voiceTag}>🎙 {creator.voice}</Text> : null}
            </View>
          </View>
          {creator.persona ? (
            <Text style={styles.personaText} numberOfLines={3}>{creator.persona}</Text>
          ) : null}
        </View>

        {/* ── 생성 버튼 ── */}
        <TouchableOpacity
          style={[styles.generateBtn, generating && styles.generateBtnDisabled]}
          onPress={handleGenerate}
          disabled={generating}
          activeOpacity={0.85}
        >
          {generating ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <>
              <Text style={styles.generateBtnIcon}>🎬</Text>
              <Text style={styles.generateBtnText}>
                {script ? '새 대본 생성하기' : '오늘의 숏폼 콘텐츠 생성하기'}
              </Text>
            </>
          )}
        </TouchableOpacity>

        {currentEpisodeId ? (
          <View style={styles.saveBadge}>
            <Text style={styles.saveBadgeText}>💾 자동 저장됨</Text>
          </View>
        ) : null}

        {/* ── 생성 중 로딩 ── */}
        {generating && (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="large" color="#4A90E2" />
            <Text style={styles.loadingTitle}>AI가 대본을 작성 중입니다</Text>
            <Text style={styles.loadingSubtitle}>{creator.name}의 세계관을 담는 중...</Text>
          </View>
        )}

        {/* ── 대본 완성 ── */}
        {script && !generating ? (
          <>
            <View style={styles.scriptTitleCard}>
              <View style={styles.scriptTitleRow}>
                <Text style={styles.scriptTitleLabel}>📋 저장된 대본</Text>
                <TouchableOpacity style={styles.regenBtn} onPress={handleGenerate}>
                  <Text style={styles.regenBtnText}>↺ 재생성</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.scriptTitle}>{script.title}</Text>
              <Text style={styles.scriptMeta}>총 {script.scenes.length}개 장면</Text>
            </View>

            {/* ── 완성 영상 플레이어 ── */}
            {videoUrl ? (
              <View style={styles.videoSection}>
                <View style={styles.videoHeader}>
                  <Text style={styles.videoHeaderIcon}>🎬</Text>
                  <Text style={styles.videoHeaderText}>완성된 숏폼 영상</Text>
                </View>
                <Video
                  source={{ uri: videoUrl }}
                  style={styles.videoPlayer}
                  useNativeControls
                  resizeMode={ResizeMode.COVER}
                  shouldPlay={false}
                />
                <Text style={styles.videoHint}>네이티브 컨트롤로 재생·정지·탐색</Text>
              </View>
            ) : null}

            {script.scenes.map((scene, idx) => {
              const accentColor    = SCENE_COLORS[idx % SCENE_COLORS.length];
              const imageUrl       = sceneImages[idx];
              const audioUri       = sceneAudios[idx];
              const isImgLoading   = sceneLoadingIdx === idx;
              const isAnyImgLoad   = sceneLoadingIdx !== null;
              const isDubbing      = audioDubbingIdx === idx;
              const isAnyDubbing   = audioDubbingIdx !== null;
              const isPlaying      = playingIdx === idx;

              return (
                <View key={scene.sceneNumber ?? idx} style={[styles.sceneCard, { borderLeftColor: accentColor }]}>

                  {/* 씬 헤더 */}
                  <View style={[styles.sceneHeader, { backgroundColor: accentColor + '18' }]}>
                    <View style={[styles.sceneDot, { backgroundColor: accentColor }]} />
                    <Text style={[styles.sceneNumber, { color: accentColor }]}>
                      SCENE {pad(scene.sceneNumber ?? idx + 1)}
                    </Text>
                    <View style={styles.sceneHeaderBadges}>
                      {imageUrl ? <Text style={styles.sceneBadgeIcon}>🖼</Text> : null}
                      {audioUri ? <Text style={styles.sceneBadgeIcon}>🔊</Text> : null}
                    </View>
                  </View>

                  {/* 연출 지시문 */}
                  <View style={styles.sectionBlock}>
                    <View style={styles.sectionLabelRow}>
                      <Text style={styles.sectionIcon}>🎭</Text>
                      <Text style={[styles.sectionLabel, styles.labelDirection]}>연출 지시문</Text>
                    </View>
                    <View style={styles.directionBox}>
                      <Text style={styles.directionText}>{scene.direction}</Text>
                    </View>
                  </View>

                  {/* 대사 */}
                  <View style={styles.sectionBlock}>
                    <View style={styles.sectionLabelRow}>
                      <Text style={styles.sectionIcon}>💬</Text>
                      <Text style={[styles.sectionLabel, styles.labelDialogue]}>대사</Text>
                    </View>
                    <View style={styles.dialogueBox}>
                      <Text style={styles.dialogueText}>{scene.dialogue}</Text>
                    </View>
                  </View>

                  {/* ── 이미지 섹션 ── */}
                  <View style={styles.imageSection}>
                    {imageUrl ? (
                      <TouchableOpacity onPress={() => setModalImageUrl(imageUrl)} activeOpacity={0.92}>
                        <Image source={{ uri: imageUrl }} style={styles.sceneImage} resizeMode="cover" />
                        <View style={styles.imageTapHintRow}>
                          <Text style={styles.imageTapHint}>🔍  탭하여 크게 보기</Text>
                        </View>
                      </TouchableOpacity>
                    ) : isImgLoading ? (
                      <View style={[styles.mediaLoadingBox, { borderColor: accentColor + '60' }]}>
                        <ActivityIndicator size="large" color={accentColor} />
                        <Text style={[styles.mediaLoadingText, { color: accentColor }]}>이미지 생성 중...</Text>
                        <Text style={styles.mediaLoadingHint}>최대 30초 소요</Text>
                      </View>
                    ) : (
                      <TouchableOpacity
                        style={[styles.actionBtn, { borderColor: accentColor }, isAnyImgLoad && styles.actionBtnDisabled]}
                        onPress={() => handleRenderScene(idx, scene.direction)}
                        disabled={isAnyImgLoad}
                        activeOpacity={0.75}
                      >
                        <Text style={[styles.actionBtnText, { color: isAnyImgLoad ? '#C4C4C4' : accentColor }]}>
                          🎨  이 장면 렌더링 (이미지 생성)
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>

                  {/* ── 오디오 섹션 ── */}
                  <View style={styles.audioSection}>
                    {isDubbing ? (
                      <View style={[styles.mediaLoadingBox, { borderColor: '#059669' + '60' }]}>
                        <ActivityIndicator size="small" color="#059669" />
                        <Text style={[styles.mediaLoadingText, { color: '#059669' }]}>
                          TTS 더빙 생성 중...
                        </Text>
                      </View>
                    ) : audioUri ? (
                      // 오디오 있음 → 재생/정지 버튼
                      <TouchableOpacity
                        style={[
                          styles.audioPlayBtn,
                          isPlaying && styles.audioPlayBtnActive,
                        ]}
                        onPress={() => handlePlayAudio(idx, audioUri)}
                        activeOpacity={0.82}
                      >
                        <Text style={styles.audioPlayBtnIcon}>
                          {isPlaying ? '⏹' : '▶️'}
                        </Text>
                        <Text style={[styles.audioPlayBtnText, isPlaying && styles.audioPlayBtnTextActive]}>
                          {isPlaying ? '재생 중... (탭하여 정지)' : '대사 들어보기 (재생)'}
                        </Text>
                      </TouchableOpacity>
                    ) : (
                      // 더빙 없음 → 더빙 생성 버튼
                      <TouchableOpacity
                        style={[styles.actionBtn, styles.dubBtn, isAnyDubbing && styles.actionBtnDisabled]}
                        onPress={() => handleDubScene(idx, scene.dialogue)}
                        disabled={isAnyDubbing}
                        activeOpacity={0.75}
                      >
                        <Text style={[styles.actionBtnText, { color: isAnyDubbing ? '#C4C4C4' : '#059669' }]}>
                          🔊  이 장면 더빙하기
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>

                </View>
              );
            })}
          </>
        ) : null}
      </ScrollView>

      {/* ── 고정 하단 합성 버튼 ── */}
      {script && !generating ? (
        <View style={styles.fixedFooter}>
          <TouchableOpacity
            style={[styles.synthBtn, synthesizing && styles.synthBtnDisabled]}
            onPress={handleSynthesize}
            disabled={synthesizing}
            activeOpacity={0.88}
          >
            {synthesizing ? (
              <>
                <ActivityIndicator color="#fff" size="small" />
                <Text style={styles.synthBtnText}>클라우드 렌더링 공장 가동 중... (최대 2분 소요)</Text>
              </>
            ) : (
              <>
                <Text style={styles.synthBtnIcon}>🎥</Text>
                <Text style={styles.synthBtnText}>
                  {videoUrl ? '영상 재렌더링하기' : '전체 숏폼 영상으로 합성하기'}
                </Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      ) : null}

      {/* ── 전체화면 이미지 모달 ── */}
      <Modal visible={!!modalImageUrl} transparent animationType="fade" onRequestClose={() => setModalImageUrl(null)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setModalImageUrl(null)}>
          {modalImageUrl ? (
            <Image source={{ uri: modalImageUrl }} style={styles.modalImage} resizeMode="contain" />
          ) : null}
          <View style={styles.modalCloseHint}>
            <Text style={styles.modalCloseText}>✕  탭하여 닫기</Text>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

// ─── 스타일 ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F5F7FA' },
  scroll: { flex: 1 },
  inner: { padding: 16, paddingBottom: 32 },
  innerWithFooter: { paddingBottom: 112 },

  initLoadingScreen: { flex: 1, backgroundColor: '#F5F7FA', alignItems: 'center', justifyContent: 'center', gap: 16 },
  initLoadingText: { fontSize: 14, color: '#6B7280' },

  profileCard: { backgroundColor: '#fff', borderRadius: 18, padding: 18, marginBottom: 16, shadowColor: '#000', shadowOpacity: 0.07, shadowRadius: 10, elevation: 4 },
  profileTop: { flexDirection: 'row', alignItems: 'center', marginBottom: 12, gap: 14 },
  avatarCircle: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#4A90E2', alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 20, fontWeight: '800', color: '#fff' },
  profileInfo: { flex: 1, gap: 3 },
  categoryBadge: { alignSelf: 'flex-start', backgroundColor: '#EBF4FF', color: '#4A90E2', fontSize: 11, fontWeight: '700', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, overflow: 'hidden' },
  creatorName: { fontSize: 19, fontWeight: '800', color: '#1A1A2E' },
  voiceTag: { fontSize: 12, color: '#6B7280' },
  personaText: { fontSize: 13, color: '#6B7280', lineHeight: 20, backgroundColor: '#F9FAFB', borderRadius: 10, padding: 10 },

  generateBtn: { backgroundColor: '#4A90E2', borderRadius: 16, paddingVertical: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: 8, shadowColor: '#4A90E2', shadowOpacity: 0.38, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 8, minHeight: 64 },
  generateBtnDisabled: { opacity: 0.6, shadowOpacity: 0.1, elevation: 2 },
  generateBtnIcon: { fontSize: 22 },
  generateBtnText: { fontSize: 17, fontWeight: '800', color: '#fff', letterSpacing: -0.3 },

  saveBadge: { alignSelf: 'flex-end', marginBottom: 14, paddingHorizontal: 10, paddingVertical: 4, backgroundColor: '#ECFDF5', borderRadius: 10, borderWidth: 1, borderColor: '#A7F3D0' },
  saveBadgeText: { fontSize: 11, color: '#059669', fontWeight: '700' },

  loadingBox: { alignItems: 'center', paddingVertical: 36, gap: 12 },
  loadingTitle: { fontSize: 16, fontWeight: '700', color: '#1A1A2E' },
  loadingSubtitle: { fontSize: 13, color: '#9CA3AF' },

  scriptTitleCard: { backgroundColor: '#1A1A2E', borderRadius: 16, padding: 18, marginBottom: 14, shadowColor: '#1A1A2E', shadowOpacity: 0.2, shadowRadius: 12, elevation: 6 },
  scriptTitleRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  scriptTitleLabel: { flex: 1, fontSize: 12, fontWeight: '700', color: '#9CA3AF', letterSpacing: 0.5 },
  regenBtn: { backgroundColor: 'rgba(255,255,255,0.12)', paddingHorizontal: 12, paddingVertical: 5, borderRadius: 12 },
  regenBtnText: { fontSize: 12, fontWeight: '700', color: '#fff' },
  scriptTitle: { fontSize: 18, fontWeight: '800', color: '#fff', lineHeight: 26, marginBottom: 8 },
  scriptMeta: { fontSize: 12, color: '#6B7280' },

  sceneCard: { backgroundColor: '#fff', borderRadius: 16, marginBottom: 14, borderLeftWidth: 4, overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  sceneHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
  sceneDot: { width: 8, height: 8, borderRadius: 4 },
  sceneNumber: { fontSize: 12, fontWeight: '800', letterSpacing: 1, flex: 1 },
  sceneHeaderBadges: { flexDirection: 'row', gap: 4 },
  sceneBadgeIcon: { fontSize: 13 },

  sectionBlock: { paddingHorizontal: 16, paddingBottom: 12 },
  sectionLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 6 },
  sectionIcon: { fontSize: 13 },
  sectionLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  labelDirection: { color: '#D97706' },
  labelDialogue: { color: '#4A90E2' },
  directionBox: { backgroundColor: '#FFFBEB', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: '#FDE68A' },
  directionText: { fontSize: 13, color: '#78350F', lineHeight: 20, fontStyle: 'italic' },
  dialogueBox: { backgroundColor: '#EFF6FF', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: '#BFDBFE' },
  dialogueText: { fontSize: 14, color: '#1E3A5F', lineHeight: 22 },

  imageSection: { marginHorizontal: 16, marginBottom: 10 },
  audioSection: { marginHorizontal: 16, marginBottom: 16 },

  // 공통 액션 버튼 (이미지 렌더링 / 오디오 더빙)
  actionBtn: { paddingVertical: 12, borderRadius: 10, borderWidth: 1.5, alignItems: 'center', backgroundColor: '#FAFAFA' },
  actionBtnDisabled: { borderColor: '#E5E7EB', backgroundColor: '#F9F9F9' },
  actionBtnText: { fontSize: 13, fontWeight: '700' },
  dubBtn: { borderColor: '#059669' },

  // 미디어 로딩 공통
  mediaLoadingBox: { alignItems: 'center', paddingVertical: 24, borderWidth: 1.5, borderStyle: 'dashed', borderRadius: 12, gap: 8, backgroundColor: '#FAFAFA' },
  mediaLoadingText: { fontSize: 13, fontWeight: '700' },
  mediaLoadingHint: { fontSize: 11, color: '#9CA3AF' },

  // 이미지 미리보기
  sceneImage: { width: '100%', aspectRatio: 9 / 16, borderRadius: 12, backgroundColor: '#E5E7EB' },
  imageTapHintRow: { alignItems: 'center', marginTop: 6 },
  imageTapHint: { fontSize: 11, color: '#9CA3AF' },

  // 오디오 재생 버튼
  audioPlayBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 13, borderRadius: 10, borderWidth: 1.5, borderColor: '#059669', backgroundColor: '#F0FDF4' },
  audioPlayBtnActive: { backgroundColor: '#059669', borderColor: '#059669' },
  audioPlayBtnIcon: { fontSize: 16 },
  audioPlayBtnText: { fontSize: 13, fontWeight: '700', color: '#059669' },
  audioPlayBtnTextActive: { color: '#fff' },

  // 고정 하단
  fixedFooter: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: 16, paddingBottom: 24, paddingTop: 10, backgroundColor: '#F5F7FA', borderTopWidth: 1, borderTopColor: '#E5E7EB' },
  synthBtn: { backgroundColor: '#1A1A2E', borderRadius: 16, paddingVertical: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, shadowColor: '#1A1A2E', shadowOpacity: 0.3, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 8 },
  synthBtnDisabled: { opacity: 0.75, elevation: 2 },
  synthBtnIcon: { fontSize: 22 },
  synthBtnText: { fontSize: 16, fontWeight: '800', color: '#fff', letterSpacing: -0.3 },

  // 영상 플레이어
  videoSection: { marginBottom: 16, backgroundColor: '#1A1A2E', borderRadius: 20, overflow: 'hidden', shadowColor: '#1A1A2E', shadowOpacity: 0.25, shadowRadius: 14, elevation: 8 },
  videoHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 18, paddingTop: 16, paddingBottom: 10 },
  videoHeaderIcon: { fontSize: 20 },
  videoHeaderText: { fontSize: 16, fontWeight: '800', color: '#fff' },
  videoPlayer: { width: '100%', aspectRatio: 9 / 16, backgroundColor: '#000' },
  videoHint: { fontSize: 11, color: '#9CA3AF', textAlign: 'center', paddingVertical: 10 },

  // 전체화면 모달
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center' },
  modalImage: { width: '90%', height: '82%', borderRadius: 16 },
  modalCloseHint: { marginTop: 20, paddingHorizontal: 24, paddingVertical: 10, backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 24 },
  modalCloseText: { color: '#fff', fontSize: 14, fontWeight: '600' },
});
