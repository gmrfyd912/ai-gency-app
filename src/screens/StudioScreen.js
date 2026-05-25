import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Button,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { httpsCallable } from 'firebase/functions';
import { collection, onSnapshot } from 'firebase/firestore';
import { functions, db } from '../services/firebase';

const generateGreetingFn = httpsCallable(functions, 'generateGreeting');

export default function StudioScreen() {
  const [creators, setCreators] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [name, setName] = useState('');
  const [persona, setPersona] = useState('');
  const [greeting, setGreeting] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, 'creators'), (snapshot) => {
      setCreators(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
    });
    return unsubscribe;
  }, []);

  const handleSelectCreator = (creator) => {
    setSelectedId(creator.id);
    setName(creator.name);
    setPersona(creator.persona);
    setGreeting('');
  };

  const handleGenerate = async () => {
    if (!name.trim() || !persona.trim()) {
      Alert.alert('입력 오류', '크리에이터 이름과 성격을 모두 입력해주세요.');
      return;
    }

    setLoading(true);
    setGreeting('');

    try {
      const result = await generateGreetingFn({ name: name.trim(), persona: persona.trim() });
      setGreeting(result.data.greeting);
    } catch (error) {
      Alert.alert('오류 발생', error.message || 'AI 호출 중 문제가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.inner} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>🎬 AI 영상 스튜디오</Text>
        <Text style={styles.subtitle}>크리에이터를 선택하거나 직접 입력하여 AI 인사말을 생성하세요.</Text>

        {creators.length > 0 && (
          <View style={styles.chipSection}>
            <Text style={styles.chipLabel}>소속 크리에이터</Text>
            <FlatList
              data={creators}
              keyExtractor={(item) => item.id}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chipList}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[
                    styles.chip,
                    selectedId === item.id && styles.chipSelected,
                  ]}
                  onPress={() => handleSelectCreator(item)}
                >
                  <Text
                    style={[
                      styles.chipText,
                      selectedId === item.id && styles.chipTextSelected,
                    ]}
                  >
                    {item.name}
                  </Text>
                </TouchableOpacity>
              )}
            />
          </View>
        )}

        <View style={styles.form}>
          <TextInput
            style={styles.input}
            placeholder="크리에이터 이름"
            value={name}
            onChangeText={(text) => { setName(text); setSelectedId(null); }}
          />
          <TextInput
            style={[styles.input, styles.inputMulti]}
            placeholder="성격 / 특징"
            value={persona}
            onChangeText={(text) => { setPersona(text); setSelectedId(null); }}
            multiline
          />
          <Button
            title="AI 인사말 대본 생성"
            onPress={handleGenerate}
            color="#7C3AED"
            disabled={loading}
          />
        </View>

        {loading && (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="large" color="#7C3AED" />
            <Text style={styles.loadingText}>AI가 대본을 작성 중입니다...</Text>
          </View>
        )}

        {!!greeting && !loading && (
          <View style={styles.resultBox}>
            <Text style={styles.resultLabel}>✨ 생성된 인사말</Text>
            <Text style={styles.resultText}>{greeting}</Text>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F3FF',
  },
  inner: {
    padding: 20,
    paddingBottom: 40,
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#1A1A2E',
    textAlign: 'center',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 13,
    color: '#6B7280',
    textAlign: 'center',
    marginBottom: 20,
  },
  chipSection: {
    marginBottom: 16,
  },
  chipLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#7C3AED',
    marginBottom: 8,
  },
  chipList: {
    gap: 8,
    paddingVertical: 2,
  },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#EDE9FE',
    borderWidth: 1,
    borderColor: '#C4B5FD',
  },
  chipSelected: {
    backgroundColor: '#7C3AED',
    borderColor: '#7C3AED',
  },
  chipText: {
    fontSize: 14,
    color: '#7C3AED',
    fontWeight: '500',
  },
  chipTextSelected: {
    color: '#fff',
  },
  form: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    gap: 12,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  input: {
    borderWidth: 1,
    borderColor: '#D1C4E9',
    borderRadius: 8,
    padding: 10,
    fontSize: 15,
    backgroundColor: '#FAFAFA',
  },
  inputMulti: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  loadingBox: {
    alignItems: 'center',
    marginTop: 32,
    gap: 10,
  },
  loadingText: {
    color: '#7C3AED',
    fontSize: 14,
  },
  resultBox: {
    marginTop: 28,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    borderLeftWidth: 4,
    borderLeftColor: '#7C3AED',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  resultLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#7C3AED',
    marginBottom: 10,
  },
  resultText: {
    fontSize: 16,
    lineHeight: 26,
    color: '#1A1A2E',
  },
});
