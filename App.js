import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { initDb } from './src/db/schema';
import HomeScreen from './src/screens/HomeScreen';
import SessionBuilderScreen from './src/screens/SessionBuilderScreen';
import ActiveSessionScreen from './src/screens/ActiveSessionScreen';

const Stack = createStackNavigator();

export default function App() {
  const [dbReady, setDbReady] = useState(false);
  const [dbError, setDbError] = useState(null);

  useEffect(() => {
    initDb()
      .then(() => setDbReady(true))
      .catch((e) => setDbError(e.message));
  }, []);

  if (dbError) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>DB init error: {dbError}</Text>
      </View>
    );
  }

  if (!dbReady) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#3b82f6" />
        <Text style={styles.loadingText}>Loading…</Text>
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <NavigationContainer>
        <StatusBar style="dark" />
        <Stack.Navigator
          initialRouteName="Home"
          screenOptions={{
            headerStyle: { backgroundColor: '#111827' },
            headerTintColor: '#f9fafb',
            headerTitleStyle: { fontWeight: '700', fontSize: 18 },
            cardStyle: { backgroundColor: '#111827' },
          }}
        >
          <Stack.Screen
            name="Home"
            component={HomeScreen}
            options={{ title: 'Workout Tracker' }}
          />
          <Stack.Screen
            name="SessionBuilder"
            component={SessionBuilderScreen}
            options={{ title: 'New Session' }}
          />
          <Stack.Screen
            name="ActiveSession"
            component={ActiveSessionScreen}
            options={{ title: 'Active Session', headerLeft: () => null }}
          />
        </Stack.Navigator>
      </NavigationContainer>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    backgroundColor: '#111827',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    color: '#9ca3af',
    fontSize: 14,
  },
  error: {
    color: '#ef4444',
    fontSize: 14,
    paddingHorizontal: 24,
    textAlign: 'center',
  },
});
