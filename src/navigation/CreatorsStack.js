import { createNativeStackNavigator } from '@react-navigation/native-stack';
import CreatorsScreen from '../screens/CreatorsScreen';
import CreateCreatorScreen from '../screens/CreateCreatorScreen';
import StudioScreen from '../screens/StudioScreen';
import SynopsisScreen from '../screens/SynopsisScreen';

const Stack = createNativeStackNavigator();

const headerCommon = {
  headerBackTitle: '뒤로',
  headerTintColor: '#4A90E2',
  headerTitleStyle: { fontWeight: '700' },
};

export default function CreatorsStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen
        name="CreatorsList"
        component={CreatorsScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="CreateCreator"
        component={CreateCreatorScreen}
        options={{ title: '새 크리에이터 영입', ...headerCommon }}
      />
      <Stack.Screen
        name="Synopsis"
        component={SynopsisScreen}
        options={({ route }) => ({
          title: `${route.params?.creator?.name ?? ''} 스토리 기획`,
          ...headerCommon,
        })}
      />
      <Stack.Screen
        name="CreatorStudio"
        component={StudioScreen}
        options={({ route }) => ({
          title: `${route.params?.creator?.name ?? ''} 스튜디오`,
          ...headerCommon,
        })}
      />
    </Stack.Navigator>
  );
}
