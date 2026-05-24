import { StyleSheet, Text, View } from 'react-native';

export default function CreatorsScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>👩‍🎤 소속 크리에이터 관리</Text>
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
