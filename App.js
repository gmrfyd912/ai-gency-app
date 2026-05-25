import { useCallback } from 'react';
import { View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import { Ionicons, MaterialIcons, MaterialCommunityIcons, FontAwesome } from '@expo/vector-icons';
import DashboardScreen from './src/screens/DashboardScreen';
import CreatorsScreen from './src/screens/CreatorsScreen';
import StudioScreen from './src/screens/StudioScreen';

// 폰트 로딩 완료 전까지 스플래시 화면 자동 숨김 방지
SplashScreen.preventAutoHideAsync();

const Tab = createBottomTabNavigator();

export default function App() {
  // @react-navigation/bottom-tabs 내부 + 앱 전체에서 사용하는 모든 아이콘 폰트 로드
  const [fontsLoaded, fontError] = useFonts({
    ...Ionicons.font,
    ...MaterialIcons.font,
    ...MaterialCommunityIcons.font,
    ...FontAwesome.font,
  });

  // 네이티브 뷰 렌더 완료 시점에 스플래시 해제 (화면 깜빡임 방지)
  const onLayoutRootView = useCallback(async () => {
    if (fontsLoaded || fontError) {
      await SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  // 폰트 로딩 중 → null 반환으로 스플래시 화면 유지
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
