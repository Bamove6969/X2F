import { type ProofExpected, posterDateLine, redact } from '@x2f/proof';
import { type PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from 'react';
import { hiddenByUploader, uploadPrompts } from '../../proof/uploaderChecks.js';
import { type EditorRegion, type PreparedProof, PROOF_NO_AUTO_CHECK, manualRegion } from '../../proof/upload.js';
import { Button } from '../../ui/Button.js';
import { Notice } from '../../ui/Notice.js';
import { ProofHiddenByYou, ProofNoAmount, ProofNotCurrent } from './ProofPrompts.js';
import './proof.css';

// DESIGNER-REVIEW: the whole editor. Plan 5 Task 15's "Check your proof" has no board yet (plan,
// owner item 13): built from the kit (Notice, Button, the proof prompts) as the plan describes it:
// the photo with frosted regions, "Add blur" / tap a region to remove it, the best-effort line,
// Send proof primary, Choose another. All copy COPY-UNSIGNED unless it is the board's.
//
// The preview is drawn on a <canvas> from the pixels with the current regions ALREADY burned in
// (the same `redact` the send uses), so what the buyer checks is what is sent. The picture never
// goes into an <img>, a URL or the DOM as data (proof-render-tripwire.test.ts).

// The board's line (BuyerPay.dc.html, the proof tip).
export const PROOF_BEST_EFFORT =
  'Our system does its best to blur out private, personal and confidential information automatically, but please double-check every detail yourself before you send it.';
// COPY-UNSIGNED: how to use the editor.
export const BLUR_HOW = 'Tap a blurred area to remove it. Tap Add blur, then drag over anything else private.';

export function BlurEditor({
  prepared,
  expected,
  busy = false,
  onSend,
  onChooseAnother,
}: {
  prepared: PreparedProof;
  expected: ProofExpected;
  busy?: boolean;
  /** The regions to burn in, and item 64's explanation (null when no pop-up asked for one). */
  onSend: (regions: EditorRegion[], explanation: string | null) => void;
  onChooseAnother: () => void;
}) {
  const { width, height } = prepared;
  const [regions, setRegions] = useState<EditorRegion[]>(() => [...prepared.auto]);
  const [drawing, setDrawing] = useState(false);
  const [popup, setPopup] = useState<'not-current' | 'no-amount' | null>(null);
  const from = useRef<{ x: number; y: number } | null>(null);
  const surface = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  const manual = regions.filter((r) => r.source === 'manual');
  const takenAt = prepared.photoTakenAt === null ? null : new Date(prepared.photoTakenAt);
  const prompts = useMemo(() => uploadPrompts(prepared.words, expected, manual, takenAt), [prepared.words, expected, manual, takenAt?.getTime()]); // eslint-disable-line react-hooks/exhaustive-deps
  const ownHidden = hiddenByUploader(manual, prepared.amount, prepared.memo);
  const dateLine = posterDateLine(prompts.date);

  // Re-verify Z2: the preview holds the picture (unblurred wherever the buyer took the blur off);
  // when the editor goes it is cleared and shrunk to nothing rather than left to GC.
  useEffect(() => {
    const el = canvas.current;
    return () => {
      if (el === null) return;
      el.getContext('2d')?.clearRect(0, 0, el.width, el.height);
      el.width = 0;
      el.height = 0;
    };
  }, []);

  // The preview: the pixels with the current regions burned in, on this device only.
  useEffect(() => {
    const ctx = canvas.current?.getContext('2d') ?? null;
    if (ctx === null || typeof ImageData === 'undefined') return;
    const copy = new Uint8ClampedArray(prepared.rgba);
    redact(copy, width, height, regions);
    ctx.putImageData(new ImageData(copy, width, height), 0, 0);
    copy.fill(0);
  }, [prepared.rgba, width, height, regions]);

  /** A pointer position in picture pixels. */
  const at = (e: ReactPointerEvent): { x: number; y: number } => {
    const r = surface.current?.getBoundingClientRect();
    const sx = r && r.width > 0 ? width / r.width : 1;
    const sy = r && r.height > 0 ? height / r.height : 1;
    return { x: (e.clientX - (r?.left ?? 0)) * sx, y: (e.clientY - (r?.top ?? 0)) * sy };
  };
  const down = (e: ReactPointerEvent) => {
    if (!drawing) return;
    from.current = at(e);
    (e.currentTarget as Element & { setPointerCapture?: (id: number) => void }).setPointerCapture?.(e.pointerId);
  };
  const up = (e: ReactPointerEvent) => {
    const start = from.current;
    from.current = null;
    if (!drawing || start === null) return;
    const r = manualRegion(start, at(e), width, height);
    if (r !== null) {
      setRegions((rs) => [...rs, r]);
      setDrawing(false);
    }
  };

  const send = () => {
    if (busy) return;
    if (prompts.popup !== null) {
      setPopup(prompts.popup);
      return;
    }
    onSend(regions, null);
  };

  const pct = (v: number, of: number) => `${(v / of) * 100}%`;

  return (
    <section className="x2f-stack x2f-blur" data-part="blur-editor" aria-label="Check your proof">
      {/* COPY-UNSIGNED: the title. */}
      <h2 className="x2f-blur__title">Check your proof</h2>
      {prepared.ocrOk ? null : (
        <Notice tone="caution" live="status" data-part="proof-no-auto-check">
          {PROOF_NO_AUTO_CHECK}
        </Notice>
      )}
      <p className="x2f-note" data-part="proof-best-effort">
        {PROOF_BEST_EFFORT}
      </p>
      <div
        ref={surface}
        className="x2f-blur__surface"
        data-part="blur-surface"
        data-drawing={drawing || undefined}
        style={{ aspectRatio: `${width} / ${height}` }}
        onPointerDown={down}
        onPointerUp={up}
        onPointerCancel={() => (from.current = null)}
      >
        <canvas ref={canvas} className="x2f-blur__preview" data-part="blur-preview" width={width} height={height} aria-label="Your proof, as it will be sent" role="img" />
        {regions.map((r) => (
          <button
            key={r.id}
            type="button"
            className="x2f-blur__region"
            data-part="blur-region"
            data-source={r.source}
            aria-label="Remove blur"
            disabled={drawing || busy}
            style={{ left: pct(r.x0, width), top: pct(r.y0, height), width: pct(r.x1 - r.x0, width), height: pct(r.y1 - r.y0, height) }}
            onClick={() => setRegions((rs) => rs.filter((x) => x.id !== r.id))}
          />
        ))}
      </div>
      <p className="x2f-note">{drawing ? 'Drag over the part to blur.' : BLUR_HOW}</p>
      <ProofHiddenByYou hidden={ownHidden} />
      {dateLine ? (
        <Notice tone="caution" live="status" data-part="proof-date-line">
          {dateLine.text}
        </Notice>
      ) : null}
      {/* NEEDS_BRANCH_PROOF_CODE: wip/lead-proof-code's proofCodeNotice(ownHidden) is sent with the proof (AddProof). */}
      <div className="x2f-stack">
        <Button variant="secondary" data-part="add-blur" aria-pressed={drawing} disabled={busy} onClick={() => setDrawing((d) => !d)}>
          {drawing ? 'Cancel' : 'Add blur'}
        </Button>
        <Button variant="primary" data-part="send-proof" disabled={busy || drawing} onClick={send}>
          {busy ? 'Sending…' : 'Send proof'}
        </Button>
        <Button variant="quiet" disabled={busy} onClick={onChooseAnother}>
          Choose another
        </Button>
      </div>
      {popup === 'not-current' ? (
        <ProofNotCurrent
          onRedo={() => {
            setPopup(null);
            onChooseAnother();
          }}
        />
      ) : null}
      {popup === 'no-amount' ? (
        <ProofNoAmount
          onSend={(explanation) => {
            setPopup(null);
            onSend(regions, explanation);
          }}
          onChooseAnother={() => {
            setPopup(null);
            onChooseAnother();
          }}
          onClose={() => setPopup(null)}
        />
      ) : null}
    </section>
  );
}
