/** `voice` namespace dictionaries (the composer's transcribe chip and voice-input button). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'transcribe.label': '录音转写',
  'transcribe.pending': '录音转写功能开发中',
  'input.label': '语音输入',
  'input.pending': '语音输入功能开发中',
} satisfies Record<string, string>

/** The voice namespace key union. */
export type VoiceKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'transcribe.label': 'Transcribe',
  'transcribe.pending': 'Recording and transcription is not built yet',
  'input.label': 'Voice input',
  'input.pending': 'Voice input is not built yet',
} satisfies Record<VoiceKey, string>
