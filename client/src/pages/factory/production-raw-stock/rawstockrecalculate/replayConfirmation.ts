export const HISTORICAL_REPLAY_CONFIRM_PHRASE = "APPLY HISTORICAL REPLAY" as const;

export function isHistoricalReplayConfirmed(value: string): boolean {
  return value === HISTORICAL_REPLAY_CONFIRM_PHRASE;
}
