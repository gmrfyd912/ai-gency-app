import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../services/firebase';

const generateSynopsisFn = httpsCallable(functions, 'generateSynopsis', { timeout: 120000 });

export default function SynopsisScreen({ route, navigation }) {
  const { creator } = route.params;
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

  useEffect(() => {
    startGeneration();
  }, []);

  const startGeneration = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await generateSynopsisFn({
        creatorId: creator.id,
        name:      creator.name,
        persona:   creator.persona,
      });
      const d = result.data;

      // 생성 완료 → 보관함의 StoryListScreen으로 자동 이동
      navigation.navigate('보관함', {
        screen: 'StoryList',
        params: {
          creator,
          initialSeriesId: d.seriesId ?? null,
        },
      });
    } catch (e) {
      setError((e?.message ?? '알 수 없는 오류가 발생했습니다.').slice(0, 160));
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {/* ── 생성 중 전체화면 오버레이 ── */}
      <Modal visible={loading} transparent animationType="fade" statusBarTranslucent>
        <View style={styles.overlayBg}>
          <View style={styles.overlayCard}>
            <ActivityIndicator size="large" color="#7C3AED" style={{ marginBottom: 16 }} />
            <Text style={styles.overlayTitle}>🔥 레전드 썰 수집 및{'\n'}10부작 기획 중...</Text>
            <Text style={styles.overlaySubtitle}>예상 대기시간: 약 40초</Text>
            <Text style={styles.overlayDetail}>
              AI가 인터넷에서 바이럴 원본을 검색하고{'\n'}전문을 추출하여 시리즈를 기획하고 있습니다
            </Text>
            <Text style={styles.overlayHint}>
              완료되면 자동으로 보관함으로 이동합니다
            </Text>
          </View>
        </View>
      </Modal>

      {/* ── 로딩 외 상태 (에러 / 대기) ── */}
      <View style={styles.root}>
        {/* 크리에이터 헤더 */}
        <View style={styles.profileRow}>
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarText}>{creator.name.charAt(0)}</Text>
          </View>
          <View style={styles.profileInfo}>
            <Text style={styles.profileName}>{creator.name}</Text>
            <Text style={styles.profileSub} numberOfLines={2}>{creator.persona}</Text>
          </View>
        </View>

        {error ? (
          /* ── 에러 상태 ── */
          <View style={styles.errorBox}>
            <Text style={styles.errorIcon}>⚠️</Text>
            <Text style={styles.errorTitle}>스토리 생성 실패</Text>
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity
              style={styles.retryBtn}
              onPress={startGeneration}
              activeOpacity={0.82}
            >
              <Text style={styles.retryBtnText}>↺ 다시 시도하기</Text>
            </TouchableOpacity>
          </View>
        ) : (
          /* ── 대기 상태 (로딩 모달 뒤에 보이는 배경) ── */
          <View style={styles.waitBox}>
            <ActivityIndicator size="large" color="#7C3AED" />
            <Text style={styles.waitText}>
              스토리 생성이 완료되면{'\n'}자동으로 보관함으로 이동합니다
            </Text>
          </View>
        )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F5F7FA' },

  // ── 로딩 오버레이 ──
  overlayBg: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.65)',
    alignItems: 'center', justifyContent: 'center', padding: 32,
  },
  overlayCard: {
    backgroundColor: '#1A1A2E', borderRadius: 24, padding: 32,
    alignItems: 'center', width: '100%',
    shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 20, elevation: 20,
  },
  overlayTitle: {
    fontSize: 20, fontWeight: '900', color: '#fff',
    textAlign: 'center', lineHeight: 28, marginBottom: 10,
  },
  overlaySubtitle: {
    fontSize: 14, fontWeight: '700', color: '#7C3AED', marginBottom: 14,
  },
  overlayDetail: {
    fontSize: 13, color: '#9CA3AF', textAlign: 'center', lineHeight: 20, marginBottom: 10,
  },
  overlayHint: {
    fontSize: 11, color: '#4B5563', textAlign: 'center',
  },

  // ── 크리에이터 헤더 ──
  profileRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#fff', borderRadius: 16, padding: 14, margin: 16,
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8, elevation: 3,
  },
  avatarCircle: {
    width: 46, height: 46, borderRadius: 23,
    backgroundColor: '#4A90E2', alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontSize: 18, fontWeight: '800', color: '#fff' },
  profileInfo: { flex: 1 },
  profileName: { fontSize: 17, fontWeight: '800', color: '#1A1A2E' },
  profileSub: { fontSize: 12, color: '#9CA3AF', marginTop: 2 },

  // ── 대기 박스 ──
  waitBox: {
    flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 32,
  },
  waitText: {
    fontSize: 14, color: '#6B7280', textAlign: 'center', lineHeight: 22,
  },

  // ── 에러 박스 ──
  errorBox: {
    flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 32,
  },
  errorIcon: { fontSize: 48 },
  errorTitle: { fontSize: 18, fontWeight: '800', color: '#1A1A2E' },
  errorText: {
    fontSize: 13, color: '#6B7280', textAlign: 'center', lineHeight: 20,
  },
  retryBtn: {
    marginTop: 8, paddingHorizontal: 32, paddingVertical: 14,
    backgroundColor: '#4A90E2', borderRadius: 14,
    shadowColor: '#4A90E2', shadowOpacity: 0.35, shadowRadius: 10, elevation: 6,
  },
  retryBtnText: { fontSize: 15, fontWeight: '800', color: '#fff' },
});
