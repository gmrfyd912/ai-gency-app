import { createNativeStackNavigator } from '@react-navigation/native-stack';
import CreatorsScreen from '../screens/CreatorsScreen';
import CreateCreatorScreen from '../screens/CreateCreatorScreen';

const Stack = createNativeStackNavigator();

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
        options={{
          title: '새 크리에이터 영입',
          headerBackTitle: '뒤로',
          headerTintColor: '#4A90E2',
          headerTitleStyle: { fontWeight: '700' },
        }}
      />
    </Stack.Navigator>
  );
}
