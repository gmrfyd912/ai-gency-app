import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '../services/firebase';

export default function CreatorsScreen({ navigation }) {
  const [creators, setCreators] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(collection(db, 'creators'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setCreators(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>👩‍🎤 소속 크리에이터</Text>

      {loading ? (
        <ActivityIndicator style={styles.loader} size="large" color="#4A90E2" />
      ) : (
        <FlatList
          data={creators}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.emptyBox}>
              <Text style={styles.emptyIcon}>🎤</Text>
              <Text style={styles.empty}>아직 소속 크리에이터가 없습니다.</Text>
              <Text style={styles.emptyHint}>아래 + 버튼으로 첫 크리에이터를 영입해보세요!</Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={styles.cardWrapper}>
              {/* 메인 카드 — 탭하면 스튜디오 이동 */}
              <TouchableOpacity
                style={styles.card}
                onPress={() => navigation.navigate('CreatorStudio', { creator: item })}
                activeOpacity={0.75}
              >
                <View style={styles.cardHeader}>
                  {item.category ? (
                    <Text style={styles.categoryBadge}>{item.category}</Text>
                  ) : null}
                  <Text style={styles.cardArrow}>›</Text>
                </View>
                <Text style={styles.cardName}>{item.name}</Text>
                <Text style={styles.cardPersona} numberOfLines={2}>{item.persona}</Text>
                {item.voice ? (
                  <Text style={styles.cardVoice}>🎙 {item.voice}</Text>
                ) : null}
              </TouchableOpacity>

              {/* 액션 버튼 행 */}
              <View style={styles.actionRow}>
                <TouchableOpacity
                  style={styles.actionBtn}
                  onPress={() => navigation.navigate('Synopsis', { creator: item })}
                  activeOpacity={0.75}
                >
                  <Text style={styles.actionBtnText}>✨ 새 스토리</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.actionBtn, styles.actionBtnPurple]}
                  onPress={() => navigation.navigate('StoryList', { creator: item })}
                  activeOpacity={0.75}
                >
                  <Text style={[styles.actionBtnText, styles.actionBtnTextPurple]}>📜 스토리 보관함</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.actionBtn, styles.actionBtnDark]}
                  onPress={() => navigation.navigate('Gallery', { creator: item })}
                  activeOpacity={0.75}
                >
                  <Text style={[styles.actionBtnText, styles.actionBtnTextDark]}>🎞 비디오</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        />
      )}

      {/* 플로팅 액션 버튼 */}
      <TouchableOpacity
        style={styles.fab}
        onPress={() => navigation.navigate('CreateCreator')}
      >
        <Text style={styles.fabText}>＋</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F7FA' },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    textAlign: 'center',
    paddingTop: 20,
    paddingBottom: 12,
    color: '#1A1A2E',
  },
  loader: { marginTop: 40 },
  list: { padding: 16, gap: 12, paddingBottom: 90 },

  emptyBox: { alignItems: 'center', marginTop: 60 },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  empty: { fontSize: 15, color: '#9CA3AF', marginBottom: 6 },
  emptyHint: { fontSize: 13, color: '#C4C4C4' },

  cardWrapper: { gap: 2 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  actionRow: { flexDirection: 'row', gap: 4 },
  actionBtn: {
    flex: 1, paddingVertical: 9, borderRadius: 10,
    backgroundColor: '#EBF4FF', alignItems: 'center', justifyContent: 'center',
  },
  actionBtnPurple: { backgroundColor: '#F3F0FF' },
  actionBtnDark: { backgroundColor: '#F0F4FF' },
  actionBtnText: { fontSize: 11, fontWeight: '700', color: '#4A90E2' },
  actionBtnTextPurple: { color: '#7C3AED' },
  actionBtnTextDark: { color: '#374151' },
  cardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  cardArrow: { marginLeft: 'auto', fontSize: 20, color: '#C4C4C4', lineHeight: 22 },
  categoryBadge: {
    backgroundColor: '#EBF4FF',
    color: '#4A90E2',
    fontSize: 11,
    fontWeight: '700',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    overflow: 'hidden',
  },
  cardName: { fontSize: 17, fontWeight: '700', color: '#1A1A2E', marginBottom: 4 },
  cardPersona: { fontSize: 13, color: '#6B7280', lineHeight: 20, marginBottom: 6 },
  cardVoice: { fontSize: 12, color: '#9CA3AF' },

  fab: {
    position: 'absolute',
    right: 20,
    bottom: 24,
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: '#4A90E2',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#4A90E2',
    shadowOpacity: 0.45,
    shadowRadius: 10,
    elevation: 8,
  },
  fabText: { fontSize: 28, color: '#fff', lineHeight: 32 },
});
