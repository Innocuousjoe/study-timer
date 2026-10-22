import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { brand, useTheme } from './theme';

const LEDGE = 6;

/**
 * Pill button with a solid "ledge" underneath that it presses down into:
 * BoldVoice's button style (`box-shadow: 1px 6px 0 0 <shade>`, flattening
 * on press), drawn as a shape behind the face rather than an iOS shadow so
 * it also works for outlined buttons.
 */
export function LedgeButton({
  label,
  onPress,
  variant = 'filled',
  color,
  shade,
  textColor,
  testID,
}: {
  label: string;
  onPress: () => void;
  variant?: 'filled' | 'outlined';
  color: string;
  shade: string;
  textColor: string;
  testID?: string;
}) {
  const t = useTheme();
  const filled = variant === 'filled';
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={styles.flex}
    >
      {({ pressed }) => (
        <View style={styles.wrap}>
          <View style={[styles.ledge, { backgroundColor: shade }]} />
          <View
            testID={testID ? `${testID}-face` : undefined}
            style={[
              styles.face,
              {
                borderColor: color,
                // Outlined faces still need a fill so the ledge doesn't show through.
                backgroundColor: filled ? color : t.background,
                transform: [{ translateY: pressed ? LEDGE - 1 : 0 }],
              },
            ]}
          >
            <Text style={[styles.label, { color: textColor }]}>{label}</Text>
          </View>
        </View>
      )}
    </Pressable>
  );
}

/**
 * The BoldVoice logo gradient as a thin bar, using React Native's built-in
 * CSS gradients. It stretches to its container's width; put it in a container
 * sized to the text it underlines.
 */
export function BrandGradientBar({ height = 4 }: { height?: number }) {
  return (
    <View
      style={[styles.bar, { height, borderRadius: height / 2 }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}

/** Left accent bar like BoldVoice's blog blockquotes. */
export function BrandAccentEdge(): ReactNode {
  return <View style={styles.edge} />;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  wrap: { paddingBottom: LEDGE },
  ledge: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: LEDGE,
    bottom: 0,
    borderRadius: 999,
  },
  face: {
    borderRadius: 999,
    borderWidth: 2,
    paddingVertical: 14,
    alignItems: 'center',
  },
  label: { fontSize: 17, fontWeight: '700' },
  bar: {
    alignSelf: 'stretch',
    backgroundImage: `linear-gradient(90deg, ${brand.gradientFrom}, ${brand.gradientTo})`,
  },
  edge: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
    backgroundColor: brand.orange,
  },
});
