import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Linking,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { ResizeMode, Video } from 'expo-av';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { db } from '../services/firebase';

const seriesCol = (creatorId) => collection(db, 'creators', creatorId, 'series');
const episodesCol = (creatorId, seriesId) =>
  collection(db, 'creators', creatorId, 'series', seriesId, 'episodes');

export default function GalleryScreen({ route, navigation }) {
  const { creator } = route.params;
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadVideos();
  }, []);

  // ── 모든 시리즈 → 에피소드 순회하여 videoUrl 있는 것만 수집 ──
  const loadVideos = async () => {
    setLoading(true);
    try {
      const seriesSnap = await getDocs(
        query(seriesCol(creator.id), orderBy('createdAt', 'desc'))
      );

      const allVideos = [];
      for (const seriesDoc of seriesSnap.docs) {
        const seriesData = seriesDoc.data();
        const epSnap = await getDocs(
          query(episodesCol(creator.id, seriesDoc.id), orderBy('createdAt', 'desc'))
        );
        for (const epDoc of epSnap.docs) {
          const ep = epDoc.data();
          if (ep.videoUrl) {
            allVideos.push({
              id: epDoc.id,
              seriesId: seriesDoc.id,
              seriesTitle: seriesData.title ?? '시리즈',
              originalTitle: seriesData.originalTitle ?? '',
              originalReference: seriesData.originalReference ?? '',
              originalReferenceUrl: seriesData.originalReferenceUrl ?? null,
              episodeNumber: ep.episodeNumber ?? 1,
              episodeTitle: ep.title ?? '',
              videoUrl: ep.videoUrl,
            });
          }
        }
      }
      setVideos(allVideos);
    } catch (e) {
      console.error('갤러리 로드 실패:', e.message);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingScreen}>
        <ActivityIndicator size="large" color="#7C3AED" />
        <Text style={styles.loadingText}>보관함을 불러오는 중...</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <FlatList
        data={videos}
        keyExtractor={(item) => `${item.seriesId}_${item.id}`}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View style={styles.headerRow}>
            <Text style={styles.headerTitle}>🎞 소속사 비디오 보관함</Text>
            <TouchableOpacity style={styles.refreshBtn} onPress={loadVideos}>
              <Text style={styles.refreshBtnText}>↺ 새로고침</Text>
            </TouchableOpacity>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.emptyBox}>
            <Text style={styles.emptyIcon}>🎬</Text>
            <Text style={styles.emptyText}>아직 완성된 영상이 없습니다.</Text>
            <Text style={styles.emptyHint}>스튜디오에서 🚀 통짜 빌드를 눌러 영상을 제작해보세요!</Text>
            <TouchableOpacity
              style={styles.goStudioBtn}
              onPress={() => navigation.navigate('CreatorStudio', { creator })}
            >
              <Text style={styles.goStudioBtnText}>스튜디오로 이동</Text>
            </TouchableOpacity>
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.videoCard}>
            {/* 메타 정보 */}
            <View style={styles.cardMeta}>
              <View style={styles.cardMetaLeft}>
                <Text style={styles.seriesTitle} numberOfLines={1}>{item.seriesTitle}</Text>
                <Text style={styles.episodeLabel}>EP.{item.episodeNumber} {item.episodeTitle}</Text>
              </View>
              <View style={styles.epBadge}>
                <Text style={styles.epBadgeText}>완성</Text>
              </View>
            </View>

            {/* 원본 출처 */}
            {(item.originalTitle || item.originalReference) ? (
              <TouchableOpacity
                style={styles.refRow}
                activeOpacity={item.originalReferenceUrl ? 0.65 : 1}
                onPress={() =>
                  item.originalReferenceUrl &&
                  Linking.openURL(item.originalReferenceUrl).catch(() => {})
                }
                disabled={!item.originalReferenceUrl}
              >
                <Text style={styles.refIcon}>🔍</Text>
                <View style={{ flex: 1 }}>
                  {item.originalTitle ? (
                    <Text style={styles.refTitle} numberOfLines={1}>{item.originalTitle}</Text>
                  ) : null}
                  {item.originalReference ? (
                    <Text style={styles.refText} numberOfLines={1}>{item.originalReference}</Text>
                  ) : null}
                  {item.originalReferenceUrl ? (
                    <Text style={styles.refLink}>🔗 원본 링크</Text>
                  ) : null}
                </View>
              </TouchableOpacity>
            ) : null}

            {/* 비디오 플레이어 */}
            <Video
              source={{ uri: item.videoUrl }}
              style={styles.videoPlayer}
              useNativeControls
              resizeMode={ResizeMode.COVER}
              shouldPlay={false}
            />
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F5F7FA' },
  loadingScreen: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, backgroundColor: '#F5F7FA' },
  loadingText: { fontSize: 14, color: '#6B7280' },

  list: { padding: 16, paddingBottom: 40, gap: 16 },

  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  headerTitle: { flex: 1, fontSize: 18, fontWeight: '800', color: '#1A1A2E' },
  refreshBtn: { paddingHorizontal: 12, paddingVertical: 6, backgroundColor: '#EEF2FF', borderRadius: 10 },
  refreshBtnText: { fontSize: 12, fontWeight: '700', color: '#7C3AED' },

  emptyBox: { alignItems: 'center', marginTop: 60, gap: 10 },
  emptyIcon: { fontSize: 52 },
  emptyText: { fontSize: 15, color: '#6B7280', fontWeight: '600' },
  emptyHint: { fontSize: 13, color: '#9CA3AF', textAlign: 'center', lineHeight: 20 },
  goStudioBtn: { marginTop: 8, paddingHorizontal: 24, paddingVertical: 12, backgroundColor: '#7C3AED', borderRadius: 14 },
  goStudioBtnText: { fontSize: 14, fontWeight: '800', color: '#fff' },

  videoCard: {
    backgroundColor: '#1A1A2E',
    borderRadius: 20,
    overflow: 'hidden',
    shadowColor: '#1A1A2E',
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 6,
  },
  cardMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 6,
  },
  cardMetaLeft: { flex: 1 },
  seriesTitle: { fontSize: 14, fontWeight: '800', color: '#fff', marginBottom: 2 },
  episodeLabel: { fontSize: 12, color: '#9CA3AF' },
  epBadge: { backgroundColor: '#7C3AED', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  epBadgeText: { fontSize: 11, fontWeight: '700', color: '#fff' },

  refRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, paddingHorizontal: 16, paddingBottom: 10 },
  refIcon: { fontSize: 12, marginTop: 1 },
  refTitle: { fontSize: 12, fontWeight: '700', color: '#D1D5DB', marginBottom: 1 },
  refText: { fontSize: 11, color: '#9CA3AF' },
  refLink: { fontSize: 10, color: '#818CF8', textDecorationLine: 'underline', marginTop: 3 },

  videoPlayer: { width: '100%', aspectRatio: 9 / 16, backgroundColor: '#000' },
});
