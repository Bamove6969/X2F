/**
 * The Terms signature pad (owner, 8 Nov 2026): a tall white box, full content width, that takes a
 * signature drawn with a finger, a pen or a mouse (pointer events; a scribble or an X is fine),
 * with a thin border and a "Sign here" baseline. **Clear** empties it. **Type your name to sign**
 * swaps it for a text field, for anyone who can't draw (keyboard and screen reader users too): the
 * typed name is the signature then. No board shows the pad yet; its wording is unsigned.
 *
 * `onChange` gets the signature (signature.ts) after every stroke, clear or keystroke, or `null`
 * while there is none. The strokes live only in this component and go nowhere but `onChange`.
 * The "Sign here" line and label are HTML over the canvas, so they are never part of the drawing.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { TermsSignature } from '@x2f/auth-client';
import { MAX_POINTS, MAX_TYPED_NAME, boxOf, drawnSignature, keepPoint, pointCount, scaleStrokes, typedSignature, type Point, type Stroke } from './signature.js';

/** The ink: dark on the white pad in either theme (the pad is paper, not a themed surface). */
const INK = '#12161c';
const LINE_WIDTH = 2.5;

export function SignaturePad({ onChange, describedBy }: { onChange: (sig: TermsSignature | null) => void; describedBy?: string }) {
  const [mode, setMode] = useState<'draw' | 'type'>('draw');
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [name, setName] = useState('');
  const canvas = useRef<HTMLCanvasElement>(null);
  const box = useRef({ width: 1, height: 1 });
  const live = useRef<Point[] | null>(null);
  const strokesRef = useRef<Stroke[]>([]);
  strokesRef.current = strokes;
  const nameId = useId();
  const nameInput = useRef<HTMLInputElement>(null);
  const typeButton = useRef<HTMLButtonElement>(null);
  /** Set when the person switched modes, so focus follows them (not on the first render). */
  const switched = useRef(false);

  /** Paints the strokes (and the stroke in progress) at the canvas's current size. */
  const paint = useCallback((all: readonly Stroke[]) => {
    const el = canvas.current;
    const ctx = el?.getContext('2d') ?? null;
    if (el === null || ctx === null) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, box.current.width, box.current.height);
    ctx.strokeStyle = INK;
    ctx.fillStyle = INK;
    ctx.lineWidth = LINE_WIDTH;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const s of all) {
      if (s.length === 0) continue;
      ctx.beginPath();
      if (s.length === 1) {
        ctx.arc(s[0]![0], s[0]![1], LINE_WIDTH / 2, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      ctx.moveTo(s[0]![0], s[0]![1]);
      for (const p of s.slice(1)) ctx.lineTo(p[0], p[1]);
      ctx.stroke();
    }
  }, []);

  /** Matches the canvas's pixels to its laid-out size; strokes drawn at another size are scaled. */
  const fit = useCallback(() => {
    const el = canvas.current;
    if (el === null) return;
    const next = boxOf(el.clientWidth || 1, el.clientHeight || 1);
    const dpr = window.devicePixelRatio || 1;
    el.width = Math.round(next.width * dpr);
    el.height = Math.round(next.height * dpr);
    const prev = box.current;
    box.current = next;
    if (strokesRef.current.length > 0 && (prev.width !== next.width || prev.height !== next.height)) {
      const scaled = scaleStrokes(strokesRef.current, prev, next);
      strokesRef.current = scaled;
      setStrokes(scaled);
      paint(scaled);
    } else paint(strokesRef.current);
  }, [paint]);

  useLayoutEffect(() => {
    if (mode !== 'draw') return;
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [fit, mode]);

  // Focus follows a switch: into the name field, or back to the button that offers it.
  useEffect(() => {
    if (!switched.current) return;
    if (mode === 'type') nameInput.current?.focus();
    else typeButton.current?.focus();
  }, [mode]);

  const switchTo = (m: 'draw' | 'type') => {
    switched.current = true;
    setMode(m);
  };

  // The signature follows the mode: the drawing on the pad, or the typed name.
  useEffect(() => {
    onChange(mode === 'draw' ? drawnSignature(strokes, box.current.width, box.current.height) : typedSignature(name));
  }, [mode, strokes, name, onChange]);

  const at = (e: ReactPointerEvent<HTMLCanvasElement>): Point => {
    const r = e.currentTarget.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  /** Keeps a stroke going when the pointer leaves the box (a browser may refuse: drawing still works). */
  const capture = (e: ReactPointerEvent<HTMLCanvasElement>, on: boolean) => {
    try {
      if (on) e.currentTarget.setPointerCapture(e.pointerId);
      else if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // No capture: the stroke ends where the pointer leaves.
    }
  };

  const down = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (pointCount(strokesRef.current) >= MAX_POINTS) return;
    e.preventDefault();
    capture(e, true);
    live.current = [at(e)];
    paint([...strokesRef.current, live.current]);
  };

  const move = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const s = live.current;
    if (s === null) return;
    e.preventDefault();
    const p = at(e);
    if (!keepPoint(s, p) || pointCount(strokesRef.current) + s.length >= MAX_POINTS) return;
    s.push(p);
    paint([...strokesRef.current, s]);
  };

  const up = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const s = live.current;
    if (s === null) return;
    live.current = null;
    capture(e, false);
    const next = [...strokesRef.current, s];
    strokesRef.current = next;
    setStrokes(next);
  };

  const clear = () => {
    live.current = null;
    strokesRef.current = [];
    setStrokes([]);
    paint([]);
  };

  if (mode === 'type') {
    return (
      <div className="x2f-sign" data-part="signature">
        <label className="x2f-label" htmlFor={nameId}>
          Type your name to sign
        </label>
        <input
          className="x2f-input x2f-sign__name"
          ref={nameInput}
          id={nameId}
          type="text"
          autoComplete="off"
          maxLength={MAX_TYPED_NAME}
          value={name}
          onChange={(e) => setName(e.target.value)}
          {...(describedBy !== undefined ? { 'aria-describedby': describedBy } : {})}
          data-part="signature-name"
        />
        <div className="x2f-sign__actions">
          <button type="button" className="x2f-start__textbutton" onClick={() => switchTo('draw')} data-part="signature-draw">
            Draw instead
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="x2f-sign" data-part="signature">
      <div className="x2f-sign__pad">
        <canvas
          ref={canvas}
          className="x2f-sign__canvas"
          role="img"
          aria-label="Signature box"
          {...(describedBy !== undefined ? { 'aria-describedby': describedBy } : {})}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          onPointerLeave={up}
          data-part="signature-pad"
          data-empty={strokes.length === 0 ? 'true' : 'false'}
        />
        <span className="x2f-sign__line" aria-hidden="true">
          <span className="x2f-sign__here">Sign here</span>
        </span>
      </div>
      <div className="x2f-sign__actions">
        <button type="button" className="x2f-start__textbutton" onClick={clear} disabled={strokes.length === 0} data-part="signature-clear">
          Clear
        </button>
        <button ref={typeButton} type="button" className="x2f-start__textbutton" onClick={() => switchTo('type')} data-part="signature-type">
          Type your name to sign
        </button>
      </div>
    </div>
  );
}
