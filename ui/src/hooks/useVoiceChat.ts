import { useCallback, useState } from "react";
import type { AwarenessEntry } from "../types";

type VoiceState = "idle" | "connecting" | "listening" | "transcribing" | "thinking" | "speaking" | "error";
type VoiceMode = "realtime" | "turn";

interface VoiceChatState {
  state: VoiceState;
  mode: VoiceMode;
  setMode: (mode: VoiceMode) => void;
  localEntries: AwarenessEntry[];
  assistantText: string;
  cloudEvent: string;
  partial: string;
  transcript: string;
  error: string | null;
  start: () => void;
  stop: () => void;
}

export function useVoiceChat(_input: { contextEntries: AwarenessEntry[] }): VoiceChatState {
  const [mode, setMode] = useState<VoiceMode>("turn");
  const state: VoiceState = "idle";
  const noop = useCallback(() => undefined, []);

  return {
    state,
    mode,
    setMode,
    localEntries: [] as AwarenessEntry[],
    assistantText: "",
    cloudEvent: "",
    partial: "",
    transcript: "",
    error: null as string | null,
    start: noop,
    stop: noop,
  };
}
