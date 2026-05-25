import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import { Ionicons } from '@expo/vector-icons';
import DashboardScreen from './src/screens/DashboardScreen';
import CreatorsStack from './src/navigation/CreatorsStack';

// 폰트 로딩 완료 전까지 스플래시 자동 숨김 방지
SplashScreen.preventAutoHideAsync();

const Tab = createBottomTabNavigator();

export default function App() {
  const [fontsLoaded, fontError] = useFonts({
    ...Ionicons.font,
  });

  // 스플래시 최소 1.5초 유지를 위한 대기 상태
  const [minDelayPassed, setMinDelayPassed] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setMinDelayPassed(true), 1500);
    return () => clearTimeout(timer);
  }, []);

  // 폰트 로딩 완료 + 최소 대기 시간 모두 충족 시 스플래시 해제
  const onLayoutRootView = useCallback(async () => {
    if ((fontsLoaded || fontError) && minDelayPassed) {
      await SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError, minDelayPassed]);

  // 두 조건 중 하나라도 미충족이면 스플래시 유지
  if ((!fontsLoaded && !fontError) || !minDelayPassed) {
    return null;
  }

  return (
    // backgroundColor: '#FFFFFF' 로 투명 겹침 현상 완전 차단
    <View style={{ flex: 1, backgroundColor: '#FFFFFF' }} onLayout={onLayoutRootView}>
      <NavigationContainer>
        <Tab.Navigator>
          <Tab.Screen
            name="대시보드"
            component={DashboardScreen}
            options={{
              tabBarIcon: ({ color, size }) => (
                <Ionicons name="home" color={color} size={size} />
              ),
            }}
          />
          <Tab.Screen
            name="크리에이터"
            component={CreatorsStack}
            options={{
              headerShown: false,
              tabBarIcon: ({ color, size }) => (
                <Ionicons name="people" color={color} size={size} />
              ),
            }}
          />
        </Tab.Navigator>
      </NavigationContainer>
    </View>
  );
}
