import { StyleSheet, Text, View } from 'react-native';

export default function StudioScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>🎬 AI 영상 스튜디오</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  text: {
    fontSize: 24,
    fontWeight: 'bold',
  },
});
