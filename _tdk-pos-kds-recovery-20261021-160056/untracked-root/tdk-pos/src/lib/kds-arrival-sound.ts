export const KDS_ARRIVAL_SOUND_KEYS = ["default", "bell", "chime"] as const;
export type KdsArrivalSoundKey = (typeof KDS_ARRIVAL_SOUND_KEYS)[number];
export type KdsArrivalSoundSettings = {
  enabled: boolean;
  soundKey: KdsArrivalSoundKey;
  repeat: 1 | 2 | 3;
};

export const DEFAULT_KDS_ARRIVAL_SOUND_SETTINGS: KdsArrivalSoundSettings = {
  enabled: true,
  soundKey: "default",
  repeat: 1,
};

export const KDS_ARRIVAL_SOUND_SETTING_KEYS = {
  enabled: "kds_arrival_sound_enabled",
  soundKey: "kds_arrival_sound_key",
  repeat: "kds_arrival_sound_repeat",
} as const;

export function isKdsArrivalSoundKey(value: unknown): value is KdsArrivalSoundKey {
  return typeof value === "string" && KDS_ARRIVAL_SOUND_KEYS.includes(value as KdsArrivalSoundKey);
}

export function parseKdsArrivalSoundSettings(values: Map<string, string>): KdsArrivalSoundSettings {
  const enabled = values.get(KDS_ARRIVAL_SOUND_SETTING_KEYS.enabled);
  const soundKey = values.get(KDS_ARRIVAL_SOUND_SETTING_KEYS.soundKey);
  const repeat = Number(values.get(KDS_ARRIVAL_SOUND_SETTING_KEYS.repeat));
  return {
    enabled: enabled === undefined ? DEFAULT_KDS_ARRIVAL_SOUND_SETTINGS.enabled : enabled === "1",
    soundKey: isKdsArrivalSoundKey(soundKey) ? soundKey : DEFAULT_KDS_ARRIVAL_SOUND_SETTINGS.soundKey,
    repeat: repeat === 2 || repeat === 3 ? repeat : DEFAULT_KDS_ARRIVAL_SOUND_SETTINGS.repeat,
  };
}

/** Creates a short local Web Audio notification; no external asset or URL is used. */
export function scheduleKdsArrivalSound(context: AudioContext, soundKey: KdsArrivalSoundKey, repeatCount: number) {
  const notes: Record<KdsArrivalSoundKey, number[]> = {
    default: [880, 660],
    bell: [1046.5],
    chime: [659.25, 783.99, 987.77],
  };
  const oscillators: OscillatorNode[] = [];
  const safeRepeatCount = Math.max(1, Math.min(30, Math.floor(repeatCount)));
  const noteGap = 0.19;
  const sequenceGap = 0.3;
  const startAt = context.currentTime + 0.02;

  for (let repeatIndex = 0; repeatIndex < safeRepeatCount; repeatIndex += 1) {
    notes[soundKey].forEach((frequency, noteIndex) => {
      const at = startAt + repeatIndex * (notes[soundKey].length * noteGap + sequenceGap) + noteIndex * noteGap;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency, at);
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.075, at + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.16);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(at);
      oscillator.stop(at + 0.17);
      oscillators.push(oscillator);
    });
  }
  return oscillators;
}

export function collectNewKdsOrderIds(tasks: Array<{ orderId: number; status: string }>, knownOrderIds: Set<number>) {
  return new Set(tasks
    .filter(task => task.status === "WAITING" && !knownOrderIds.has(task.orderId))
    .map(task => task.orderId));
}
