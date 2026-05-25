import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../services/firebase';

const generateContentFn = httpsCallable(functions, 'generateContent');

// 장면 번호를 두 자리 문자열로 포맷
const pad = (n) => String(n).padStart(2, '0');

// 장면 카드 accent 색상 (인덱스 기반 순환)
const SCENE_COLORS = ['#4A90E2', '#7C3AED', '#059669', '#D97706', '#DC2626'];

export default function StudioScreen({ route }) {
  const { creator } = route.params;
  const [script, setScript] = useState(null); // { title, scenes }
  const [generating, setGenerating] = useState(false);

  const handleGenerate = async () => {
    setGenerating(true);
    setScript(null);
    try {
      const result = await generateContentFn({
        name: creator.name,
        prompt: creator.persona,
      });
      setScript({ title: result.data.title, scenes: result.data.scenes });
    } catch (e) {
      Alert.alert('생성 실패', e.message);
    } finally {
      setGenerating(false);
    }
  };

  const handleRenderScene = (sceneNumber) => {
    Alert.alert(
      '🎬 장면 렌더링',
      `[장면 ${sceneNumber}] 비디오 렌더링 서버 연동 준비 중입니다.`,
      [{ text: '확인' }]
    );
  };

  const handleSynthesize = () => {
    Alert.alert(
      '🎥 영상 합성',
      '비디오 렌더링 서버 연동 준비 중입니다.',
      [{ text: '확인' }]
    );
  };

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.inner,
          script && styles.innerWithFooter,
        ]}
      >

        {/* ── 크리에이터 프로필 헤더 ── */}
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
              {creator.voice ? (
                <Text style={styles.voiceTag}>🎙 {creator.voice}</Text>
              ) : null}
            </View>
          </View>
          {creator.persona ? (
            <Text style={styles.personaText} numberOfLines={3}>
              {creator.persona}
            </Text>
          ) : null}
        </View>

        {/* ── 대본 생성 버튼 ── */}
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
              <Text style={styles.generateBtnText}>오늘의 숏폼 콘텐츠 생성하기</Text>
            </>
          )}
        </TouchableOpacity>

        {/* ── 생성 중 로딩 ── */}
        {generating && (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="large" color="#4A90E2" />
            <Text style={styles.loadingTitle}>AI가 대본을 작성 중입니다</Text>
            <Text style={styles.loadingSubtitle}>{creator.name}의 세계관을 담는 중...</Text>
          </View>
        )}

        {/* ── 대본 제목 카드 ── */}
        {script && !generating ? (
          <>
            <View style={styles.scriptTitleCard}>
              <View style={styles.scriptTitleRow}>
                <Text style={styles.scriptTitleLabel}>📋 오늘의 대본</Text>
                <TouchableOpacity style={styles.regenBtn} onPress={handleGenerate}>
                  <Text style={styles.regenBtnText}>↺ 재생성</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.scriptTitle}>{script.title}</Text>
              <Text style={styles.scriptMeta}>총 {script.scenes.length}개 장면</Text>
            </View>

            {/* ── 씬 카드 목록 ── */}
            {script.scenes.map((scene, idx) => {
              const accentColor = SCENE_COLORS[idx % SCENE_COLORS.length];
              return (
                <View
                  key={scene.sceneNumber ?? idx}
                  style={[styles.sceneCard, { borderLeftColor: accentColor }]}
                >
                  {/* 씬 번호 헤더 */}
                  <View style={[styles.sceneHeader, { backgroundColor: accentColor + '18' }]}>
                    <View style={[styles.sceneDot, { backgroundColor: accentColor }]} />
                    <Text style={[styles.sceneNumber, { color: accentColor }]}>
                      SCENE {pad(scene.sceneNumber ?? idx + 1)}
                    </Text>
                  </View>

                  {/* 연출 지시문 */}
                  <View style={styles.sectionBlock}>
                    <View style={styles.sectionLabelRow}>
                      <Text style={styles.sectionIconDirection}>🎭</Text>
                      <Text style={[styles.sectionLabel, styles.sectionLabelDirection]}>
                        연출 지시문
                      </Text>
                    </View>
                    <View style={styles.directionBox}>
                      <Text style={styles.directionText}>{scene.direction}</Text>
                    </View>
                  </View>

                  {/* 대사 */}
                  <View style={styles.sectionBlock}>
                    <View style={styles.sectionLabelRow}>
                      <Text style={styles.sectionIconDialogue}>💬</Text>
                      <Text style={[styles.sectionLabel, styles.sectionLabelDialogue]}>
                        대사
                      </Text>
                    </View>
                    <View style={styles.dialogueBox}>
                      <Text style={styles.dialogueText}>{scene.dialogue}</Text>
                    </View>
                  </View>

                  {/* 장면 렌더링 버튼 */}
                  <TouchableOpacity
                    style={[styles.renderBtn, { borderColor: accentColor }]}
                    onPress={() => handleRenderScene(scene.sceneNumber ?? idx + 1)}
                    activeOpacity={0.75}
                  >
                    <Text style={[styles.renderBtnText, { color: accentColor }]}>
                      🎬  이 장면 렌더링 (이미지 생성)
                    </Text>
                  </TouchableOpacity>
                </View>
              );
            })}
          </>
        ) : null}

      </ScrollView>

      {/* ── 고정 하단: 전체 합성 버튼 (대본 생성 후에만 표시) ── */}
      {script && !generating ? (
        <View style={styles.fixedFooter}>
          <TouchableOpacity
            style={styles.synthBtn}
            onPress={handleSynthesize}
            activeOpacity={0.88}
          >
            <Text style={styles.synthBtnIcon}>🎥</Text>
            <Text style={styles.synthBtnText}>전체 숏폼 영상으로 합성하기</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F5F7FA' },
  scroll: { flex: 1 },
  inner: { padding: 16, paddingBottom: 32 },
  innerWithFooter: { paddingBottom: 108 },

  // ── 프로필 카드 ───────────────────────────────────────────
  profileCard: {
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 18,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOpacity: 0.07,
    shadowRadius: 10,
    elevation: 4,
  },
  profileTop: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 14,
  },
  avatarCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#4A90E2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 20, fontWeight: '800', color: '#fff' },
  profileInfo: { flex: 1, gap: 3 },
  categoryBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#EBF4FF',
    color: '#4A90E2',
    fontSize: 11,
    fontWeight: '700',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    overflow: 'hidden',
  },
  creatorName: { fontSize: 19, fontWeight: '800', color: '#1A1A2E' },
  voiceTag: { fontSize: 12, color: '#6B7280' },
  personaText: {
    fontSize: 13,
    color: '#6B7280',
    lineHeight: 20,
    backgroundColor: '#F9FAFB',
    borderRadius: 10,
    padding: 10,
  },

  // ── 생성 버튼 ─────────────────────────────────────────────
  generateBtn: {
    backgroundColor: '#4A90E2',
    borderRadius: 16,
    paddingVertical: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginBottom: 20,
    shadowColor: '#4A90E2',
    shadowOpacity: 0.38,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
    minHeight: 64,
  },
  generateBtnDisabled: { opacity: 0.6, shadowOpacity: 0.1, elevation: 2 },
  generateBtnIcon: { fontSize: 22 },
  generateBtnText: { fontSize: 17, fontWeight: '800', color: '#fff', letterSpacing: -0.3 },

  // ── 로딩 ──────────────────────────────────────────────────
  loadingBox: { alignItems: 'center', paddingVertical: 36, gap: 12 },
  loadingTitle: { fontSize: 16, fontWeight: '700', color: '#1A1A2E' },
  loadingSubtitle: { fontSize: 13, color: '#9CA3AF' },

  // ── 대본 제목 카드 ────────────────────────────────────────
  scriptTitleCard: {
    backgroundColor: '#1A1A2E',
    borderRadius: 16,
    padding: 18,
    marginBottom: 14,
    shadowColor: '#1A1A2E',
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 6,
  },
  scriptTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  scriptTitleLabel: {
    flex: 1,
    fontSize: 12,
    fontWeight: '700',
    color: '#9CA3AF',
    letterSpacing: 0.5,
  },
  regenBtn: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 12,
  },
  regenBtnText: { fontSize: 12, fontWeight: '700', color: '#fff' },
  scriptTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#fff',
    lineHeight: 26,
    marginBottom: 8,
  },
  scriptMeta: { fontSize: 12, color: '#6B7280' },

  // ── 씬 카드 ───────────────────────────────────────────────
  sceneCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    marginBottom: 14,
    borderLeftWidth: 4,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  sceneHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
  },
  sceneDot: { width: 8, height: 8, borderRadius: 4 },
  sceneNumber: { fontSize: 12, fontWeight: '800', letterSpacing: 1 },

  // 연출 지시문 섹션
  sectionBlock: { paddingHorizontal: 16, paddingBottom: 12 },
  sectionLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 6 },
  sectionIconDirection: { fontSize: 13 },
  sectionIconDialogue: { fontSize: 13 },
  sectionLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  sectionLabelDirection: { color: '#D97706' },
  sectionLabelDialogue: { color: '#4A90E2' },

  directionBox: {
    backgroundColor: '#FFFBEB',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  directionText: {
    fontSize: 13,
    color: '#78350F',
    lineHeight: 20,
    fontStyle: 'italic',
  },

  dialogueBox: {
    backgroundColor: '#EFF6FF',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  dialogueText: {
    fontSize: 14,
    color: '#1E3A5F',
    lineHeight: 22,
  },

  // 장면 렌더링 버튼
  renderBtn: {
    marginHorizontal: 16,
    marginBottom: 16,
    paddingVertical: 11,
    borderRadius: 10,
    borderWidth: 1.5,
    alignItems: 'center',
    backgroundColor: '#FAFAFA',
  },
  renderBtnText: { fontSize: 13, fontWeight: '700' },

  // ── 고정 하단 합성 버튼 ───────────────────────────────────
  fixedFooter: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingBottom: 24,
    paddingTop: 10,
    backgroundColor: '#F5F7FA',
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
  },
  synthBtn: {
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
  synthBtnIcon: { fontSize: 22 },
  synthBtnText: { fontSize: 16, fontWeight: '800', color: '#fff', letterSpacing: -0.3 },
});
