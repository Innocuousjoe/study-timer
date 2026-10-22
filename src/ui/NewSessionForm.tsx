import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  DEFAULT_GOAL_SECONDS,
  GOAL_PRESETS_SECONDS,
  MAX_NAME_LENGTH,
  formatGoal,
} from '../timer/timerModel';
import { useTheme } from './theme';

type Props = {
  onStart: (name: string, goalSeconds: number) => void;
  onCancel?: () => void;
};

const GOAL_OPTIONS = [...GOAL_PRESETS_SECONDS, 0];

export function NewSessionForm({ onStart, onCancel }: Props) {
  const t = useTheme();
  const [name, setName] = useState('');
  const [goal, setGoal] = useState<number>(DEFAULT_GOAL_SECONDS);

  const submit = () => onStart(name, goal);

  return (
    <View style={styles.container}>
      <Text style={[styles.label, { color: t.muted }]}>
        What are you studying?
      </Text>
      <TextInput
        testID="session-name-input"
        value={name}
        onChangeText={setName}
        placeholder="e.g. Chapter 5 Review"
        placeholderTextColor={t.muted}
        maxLength={MAX_NAME_LENGTH}
        returnKeyType="go"
        onSubmitEditing={submit}
        autoFocus
        style={[
          styles.input,
          { color: t.text, backgroundColor: t.surface, borderColor: t.border },
        ]}
        accessibilityLabel="Session name"
      />

      <Text style={[styles.label, { color: t.muted }]}>Goal</Text>
      <View style={styles.chips} accessibilityRole="radiogroup">
        {GOAL_OPTIONS.map(g => {
          const selected = g === goal;
          return (
            <Pressable
              key={g}
              onPress={() => setGoal(g)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              style={[
                styles.chip,
                {
                  borderColor: selected ? t.accent : t.border,
                  backgroundColor: selected ? t.accent : t.surface,
                },
              ]}
            >
              <Text
                style={[
                  styles.chipText,
                  { color: selected ? t.accentText : t.text },
                ]}
              >
                {g === 0 ? 'No goal' : formatGoal(g)}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Pressable
        testID="start-button"
        onPress={submit}
        accessibilityRole="button"
        style={({ pressed }) => [
          styles.primary,
          { backgroundColor: t.accent, opacity: pressed ? 0.8 : 1 },
        ]}
      >
        <Text style={[styles.primaryText, { color: t.accentText }]}>
          Start Session
        </Text>
      </Pressable>

      {onCancel && (
        <Pressable
          onPress={onCancel}
          accessibilityRole="button"
          style={styles.cancel}
        >
          <Text style={[styles.cancelText, { color: t.muted }]}>Cancel</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 12 },
  label: {
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: 8,
  },
  input: {
    fontSize: 18,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
  },
  chipText: { fontSize: 15, fontWeight: '500' },
  primary: {
    marginTop: 16,
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
  },
  primaryText: { fontSize: 17, fontWeight: '700' },
  cancel: { alignItems: 'center', paddingVertical: 10 },
  cancelText: { fontSize: 16 },
});
