import qrcode from 'qrcode-generator';

/**
 * A QR code drawn as inline SVG `<rect>`s (TOTP enrolment, spec §6.2). The matrix comes from
 * `qrcode-generator` (no network, no dependencies); it is rendered as real SVG elements rather
 * than a `data:` URI image, so the strict CSP (`img-src 'self' data:`, `style-src 'self'`) and the
 * "no inline styles" rule both hold. Error-correction level M with automatic version selection.
 */
export function Qr({ value, label }: { value: string; label: string }) {
  const qr = qrcode(0, 'M');
  qr.addData(value);
  qr.make();
  const count = qr.getModuleCount();
  // A 1-module quiet zone each side keeps readers happy without a fixed pixel size.
  const quiet = 1;
  const size = count + quiet * 2;
  const cells: { x: number; y: number }[] = [];
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (qr.isDark(row, col)) cells.push({ x: col + quiet, y: row + quiet });
    }
  }
  return (
    <svg
      className="x2f-qr"
      viewBox={`0 0 ${size} ${size}`}
      width={size * 6}
      height={size * 6}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
    >
      <rect className="x2f-qr__bg" x={0} y={0} width={size} height={size} />
      {cells.map((c) => (
        <rect className="x2f-qr__cell" key={`${c.x}-${c.y}`} x={c.x} y={c.y} width={1} height={1} />
      ))}
    </svg>
  );
}
