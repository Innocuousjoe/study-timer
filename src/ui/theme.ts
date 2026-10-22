import { useColorScheme } from 'react-native';

/**
 * BoldVoice brand colors (from boldvoice.com's CSS tokens and logo), used
 * as flair. The app's own accent (purple) and goal green stay as they are.
 */
export const brand = {
  /** Logo gradient, pink to orange. */
  gradientFrom: '#F5277F',
  gradientTo: '#EA7D35',
};

const light = {
  background: '#F6F5F2',
  surface: '#FFFFFF',
  text: '#1C1B1F',
  muted: '#6B6A70',
  border: '#E3E1DC',
  accent: '#3D5AFE',
  accentText: '#FFFFFF',
  success: '#2E7D32',
  danger: '#C62828',
  track: '#E6E4DF',
  warningBg: '#FFF4E0',
  warningText: '#7A4B00',
};

const dark: typeof light = {
  background: '#0F0F12',
  surface: '#1A1A1F',
  text: '#F2F1F6',
  muted: '#9C9BA3',
  border: '#2A2A31',
  accent: '#7C8CFF',
  accentText: '#0F0F12',
  success: '#66BB6A',
  danger: '#EF5350',
  track: '#2A2A31',
  warningBg: '#3A2A10',
  warningText: '#FFD18A',
};

export type Theme = typeof light;

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light;
}
