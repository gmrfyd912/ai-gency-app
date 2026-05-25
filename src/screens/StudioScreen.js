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

export default function StudioScreen({ route }) {
  const { creator } = route.params;
  const [content, setContent] = useState('');
  const [generating, setGenerating] = useState(false);

  const handleGenerate = async () => {
    setGenerating(true);
    setContent('');
    try {
      const result = await generateContentFn({
        name: creator.name,
        prompt: creator.persona,
      });
      setContent(result.data.content);
    } catch (e) {
      Alert.alert('생성 실패', e.message);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.inner}>

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

      {/* ── 콘텐츠 생성 버튼 ── */}
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

      {/* ── 생성된 대본 카드 ── */}
      {content && !generating ? (
        <View style={styles.contentCard}>
          <View style={styles.contentCardHeader}>
            <Text style={styles.contentCardIcon}>📄</Text>
            <Text style={styles.contentCardTitle}>생성된 대본</Text>
            <TouchableOpacity
              style={styles.regenBtn}
              onPress={handleGenerate}
            >
              <Text style={styles.regenBtnText}>↺ 재생성</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.divider} />
          <Text style={styles.contentText}>{content}</Text>
        </View>
      ) : null}

    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F7FA' },
  inner: { padding: 16, paddingBottom: 48 },

  // 프로필 카드
  profileCard: {
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 18,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOpacity: 0.08,
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
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#4A90E2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 22,
    fontWeight: '800',
    color: '#fff',
  },
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
  creatorName: {
    fontSize: 20,
    fontWeight: '800',
    color: '#1A1A2E',
  },
  voiceTag: {
    fontSize: 12,
    color: '#6B7280',
  },
  personaText: {
    fontSize: 13,
    color: '#6B7280',
    lineHeight: 20,
    backgroundColor: '#F9FAFB',
    borderRadius: 10,
    padding: 10,
  },

  // 생성 버튼
  generateBtn: {
    backgroundColor: '#4A90E2',
    borderRadius: 16,
    paddingVertical: 20,
    paddingHorizontal: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginBottom: 20,
    shadowColor: '#4A90E2',
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
    minHeight: 66,
  },
  generateBtnDisabled: {
    opacity: 0.65,
    shadowOpacity: 0.1,
  },
  generateBtnIcon: { fontSize: 22 },
  generateBtnText: {
    fontSize: 17,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: -0.3,
  },

  // 로딩
  loadingBox: {
    alignItems: 'center',
    paddingVertical: 36,
    gap: 12,
  },
  loadingTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1A1A2E',
  },
  loadingSubtitle: {
    fontSize: 13,
    color: '#9CA3AF',
  },

  // 대본 카드
  contentCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 18,
    shadowColor: '#000',
    shadowOpacity: 0.07,
    shadowRadius: 10,
    elevation: 4,
    borderLeftWidth: 4,
    borderLeftColor: '#4A90E2',
  },
  contentCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 12,
  },
  contentCardIcon: { fontSize: 18 },
  contentCardTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    color: '#1A1A2E',
  },
  regenBtn: {
    backgroundColor: '#EBF4FF',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 12,
  },
  regenBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#4A90E2',
  },
  divider: {
    height: 1,
    backgroundColor: '#F3F4F6',
    marginBottom: 14,
  },
  contentText: {
    fontSize: 14,
    lineHeight: 24,
    color: '#374151',
  },
});
