import { useCallback, useEffect } from 'react';
import { View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import { Ionicons } from '@expo/vector-icons';
import DashboardScreen from './src/screens/DashboardScreen';
import CreatorsScreen from './src/screens/CreatorsScreen';
import StudioScreen from './src/screens/StudioScreen';

// 스플래시 화면 자동 숨김 방지 (폰트 로딩 완료 전까지 유지)
SplashScreen.preventAutoHideAsync();

const Tab = createBottomTabNavigator();

export default function App() {
  const [fontsLoaded, fontError] = useFonts({
    ...Ionicons.font,
  });

  // 폰트 로딩 완료(또는 실패) 시 스플래시 화면 해제
  const onLayoutRootView = useCallback(async () => {
    if (fontsLoaded || fontError) {
      await SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  // 폰트 로딩 중에는 null 반환 → 스플래시 화면 유지
  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    <View style={{ flex: 1 }} onLayout={onLayoutRootView}>
      <NavigationContainer>
        <Tab.Navigator>
          <Tab.Screen name="대시보드" component={DashboardScreen} />
          <Tab.Screen name="크리에이터" component={CreatorsScreen} />
          <Tab.Screen name="스튜디오" component={StudioScreen} />
        </Tab.Navigator>
      </NavigationContainer>
    </View>
  );
}
