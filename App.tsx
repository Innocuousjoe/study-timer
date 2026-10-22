import { createAsyncStorage } from '@react-native-async-storage/async-storage';
import { StatusBar, useColorScheme } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { liveActivity } from './src/native/liveActivity';
import { TimerScreen } from './src/ui/TimerScreen';

const storage = createAsyncStorage('study-timer');

function App() {
  const isDarkMode = useColorScheme() === 'dark';
  return (
    <SafeAreaProvider>
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
      <TimerScreen storage={storage} activities={liveActivity} />
    </SafeAreaProvider>
  );
}

export default App;
