import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import DashboardScreen from './src/screens/DashboardScreen';
import CreatorsScreen from './src/screens/CreatorsScreen';
import StudioScreen from './src/screens/StudioScreen';

const Tab = createBottomTabNavigator();

export default function App() {
  return (
    <NavigationContainer>
      <Tab.Navigator>
        <Tab.Screen name="대시보드" component={DashboardScreen} />
        <Tab.Screen name="크리에이터" component={CreatorsScreen} />
        <Tab.Screen name="스튜디오" component={StudioScreen} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}
