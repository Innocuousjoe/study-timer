import { useColorScheme } from 'react-native';

/**
 * BoldVoice brand colors (from boldvoice.com's CSS tokens and logo), used
 * as flair. The app's own accent (purple) and goal green stay as they are.
 */
export const brand = {
  /** Logo gradient, pink to orange. */
  gradientFrom: '#F5277F',
  gradientTo: '#EA7D35',
  /** Their `--secondary`: buttons, blockquote bars, drop caps. */
  orange: '#D45530',
  /** Review stars. Decorative only; too light for text on white. */
  gold: '#FFB800',
};

const light = {
  background: '#F6F5F2',
  surface: '#FFFFFF',
  text: '#1C1B1F',
  muted: '#6B6A70',
  border: '#E3E1DC',
  accent: '#3D5AFE',
  accentText: '#FFFFFF',
  /** Solid "ledge" under pill buttons (BoldVoice's button style). */
  accentShade: '#2A3EB5',
  success: '#2E7D32',
  danger: '#C62828',
  dangerShade: '#8E1C1C',
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
  accentShade: '#4A56B8',
  success: '#66BB6A',
  danger: '#EF5350',
  dangerShade: '#9E2F2D',
  track: '#2A2A31',
  warningBg: '#3A2A10',
  warningText: '#FFD18A',
};

export type Theme = typeof light;

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light;
}
