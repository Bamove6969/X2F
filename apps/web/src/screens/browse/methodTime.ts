/**
 * A payment method's times in words (owner p9-4, 8 Nov: "FYI this payment method can take up to 12
 * hours", shown where the method is picked). Minutes come from the API (`upToMin`, `payWindowMin`
 * on GET /v1/methods), never from the device.
 */

/** "90 minutes", "3 hours", "24 hours", "3 days", "1 hour 30 minutes". */
export function minutesText(min: number): string {
  if (!Number.isFinite(min) || min <= 0) return '';
  const m = Math.round(min);
  const unit = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;
  if (m < 120) return unit(m, 'minute');
  if (m >= 2880 && m % 1440 === 0) return unit(m / 1440, 'day');
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest === 0 ? unit(h, 'hour') : `${unit(h, 'hour')} ${unit(rest, 'minute')}`;
}

/** The up-front line where a method is picked. COPY-UNSIGNED (owner p9-4's words as the draft; design writes the final copy). */
export function methodUpToLine(upToMin: number): string {
  return `This payment method can take up to ${minutesText(upToMin)}.`;
}
