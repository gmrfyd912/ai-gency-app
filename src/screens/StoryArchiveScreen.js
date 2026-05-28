import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { collection, getDocs, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '../services/firebase';

export default function StoryArchiveScreen({ navigation }) {
  const [creators, setCreators] = useState([]);
  const [storyCounts, setStoryCounts] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(collection(db, 'creators'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, async (snapshot) => {
      const list = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      setCreators(list);

      const counts = {};
      await Promise.all(
        list.map(async (creator) => {
          const seriesSnap = await getDocs(collection(db, 'creators', creator.id, 'series'));
          counts[creator.id] = seriesSnap.size;
        })
      );
      setStoryCounts(counts);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>📚 스토리 보관함</Text>

      {loading ? (
        <ActivityIndicator style={styles.loader} size="large" color="#7C3AED" />
      ) : (
        <FlatList
          data={creators}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.emptyBox}>
              <Text style={styles.emptyIcon}>📝</Text>
              <Text style={styles.emptyText}>아직 소속 크리에이터가 없습니다.</Text>
              <Text style={styles.emptyHint}>크리에이터 탭에서 먼저 크리에이터를 영입하세요.</Text>
            </View>
          }
          renderItem={({ item }) => {
            const count = storyCounts[item.id] ?? 0;
            return (
              <TouchableOpacity
                style={styles.card}
                onPress={() => navigation.navigate('StoryList', { creator: item })}
                activeOpacity={0.75}
              >
                <View style={styles.cardLeft}>
                  <View style={styles.avatarCircle}>
                    <Text style={styles.avatarText}>{item.name.charAt(0)}</Text>
                  </View>
                  <View style={styles.cardInfo}>
                    {item.category ? (
                      <Text style={styles.categoryBadge}>{item.category}</Text>
                    ) : null}
                    <Text style={styles.cardName}>{item.name}</Text>
                    <Text style={styles.cardPersona} numberOfLines={1}>{item.persona}</Text>
                  </View>
                </View>
                <View style={styles.cardRight}>
                  <View style={[styles.countBadge, count === 0 && styles.countBadgeEmpty]}>
                    <Text style={[styles.countNum, count === 0 && styles.countNumEmpty]}>
                      {count}
                    </Text>
                    <Text style={[styles.countLabel, count === 0 && styles.countLabelEmpty]}>
                      개 스토리
                    </Text>
                  </View>
                  <Text style={styles.arrow}>›</Text>
                </View>
              </TouchableOpacity>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F7FA' },
  title: {
    fontSize: 22, fontWeight: 'bold', textAlign: 'center',
    paddingTop: 20, paddingBottom: 12, color: '#1A1A2E',
  },
  loader: { marginTop: 40 },
  list: { padding: 16, gap: 10, paddingBottom: 40 },

  emptyBox: { alignItems: 'center', marginTop: 60, gap: 10 },
  emptyIcon: { fontSize: 48 },
  emptyText: { fontSize: 15, color: '#9CA3AF' },
  emptyHint: { fontSize: 13, color: '#C4C4C4', textAlign: 'center' },

  card: {
    backgroundColor: '#fff', borderRadius: 16, padding: 14,
    flexDirection: 'row', alignItems: 'center', gap: 12,
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8, elevation: 3,
  },
  cardLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatarCircle: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: '#7C3AED', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  avatarText: { fontSize: 17, fontWeight: '800', color: '#fff' },
  cardInfo: { flex: 1 },
  categoryBadge: {
    alignSelf: 'flex-start', backgroundColor: '#EDE9FE', color: '#7C3AED',
    fontSize: 10, fontWeight: '700', paddingHorizontal: 7, paddingVertical: 2,
    borderRadius: 6, overflow: 'hidden', marginBottom: 3,
  },
  cardName: { fontSize: 15, fontWeight: '800', color: '#1A1A2E', marginBottom: 2 },
  cardPersona: { fontSize: 12, color: '#9CA3AF' },
  cardRight: { alignItems: 'center', gap: 4, flexShrink: 0 },
  countBadge: {
    alignItems: 'center', backgroundColor: '#EDE9FE',
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10,
  },
  countBadgeEmpty: { backgroundColor: '#F3F4F6' },
  countNum: { fontSize: 18, fontWeight: '900', color: '#7C3AED', lineHeight: 22 },
  countNumEmpty: { color: '#D1D5DB' },
  countLabel: { fontSize: 9, fontWeight: '700', color: '#7C3AED' },
  countLabelEmpty: { color: '#D1D5DB' },
  arrow: { fontSize: 20, color: '#C4C4C4', lineHeight: 22 },
});
