/**
 * An English ordinal for "the second time", "the 21st time" in conversation lines.
 *
 * Two to four are written as words, as the lines always read; from five on the number
 * takes its suffix. One copy for the whole window: the transcript, the chat workspace
 * and the instruction lines each had their own, and all three wrote "21th".
 */
export function ordinal(value: number): string {
  if (value === 2) {
    return 'second';
  }
  if (value === 3) {
    return 'third';
  }
  if (value === 4) {
    return 'fourth';
  }
  const lastTwo = value % 100;
  const last = value % 10;
  const suffix = lastTwo >= 11 && lastTwo <= 13 ? 'th' : last === 1 ? 'st' : last === 2 ? 'nd' : last === 3 ? 'rd' : 'th';
  return `${String(value)}${suffix}`;
}
