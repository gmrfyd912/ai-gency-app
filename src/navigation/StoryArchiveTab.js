import { createNativeStackNavigator } from '@react-navigation/native-stack';
import StoryArchiveScreen from '../screens/StoryArchiveScreen';
import StoryListScreen from '../screens/StoryListScreen';

const Stack = createNativeStackNavigator();

const headerCommon = {
  headerBackTitle: '뒤로',
  headerTintColor: '#7C3AED',
  headerTitleStyle: { fontWeight: '700' },
};

export default function StoryArchiveTab() {
  return (
    <Stack.Navigator>
      <Stack.Screen
        name="StoryArchive"
        component={StoryArchiveScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="StoryList"
        component={StoryListScreen}
        options={({ route }) => ({
          title: `${route.params?.creator?.name ?? ''} 스토리 보관함`,
          ...headerCommon,
        })}
      />
    </Stack.Navigator>
  );
}
