import { Pressable, StyleSheet, Text, View } from 'react-native';
import { brand } from './theme';

/**
 * Pill button, flush, like BoldVoice's live `.home-btn` (40px radius, no lip
 * at rest). Their hover lift doesn't exist on touch, so pressing gives the
 * usual dim-and-shrink feedback instead.
 */
export function PillButton({
  label,
  onPress,
  variant = 'filled',
  color,
  textColor,
  testID,
}: {
  label: string;
  onPress: () => void;
  variant?: 'filled' | 'outlined';
  color: string;
  textColor: string;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={styles.flex}
    >
      {({ pressed }) => (
        <View
          testID={testID ? `${testID}-face` : undefined}
          style={[
            styles.face,
            { borderColor: color },
            variant === 'filled' ? { backgroundColor: color } : styles.outlined,
            pressed && styles.pressed,
          ]}
        >
          <Text style={[styles.label, { color: textColor }]}>{label}</Text>
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

const styles = StyleSheet.create({
  flex: { flex: 1 },
  face: {
    borderRadius: 999,
    borderWidth: 2,
    paddingVertical: 14,
    alignItems: 'center',
  },
  outlined: { backgroundColor: 'transparent' },
  pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
  label: { fontSize: 17, fontWeight: '700' },
  bar: {
    alignSelf: 'stretch',
    backgroundImage: `linear-gradient(90deg, ${brand.gradientFrom}, ${brand.gradientTo})`,
  },
});
