import { Sheet } from './Sheet.js';
import './ui.css';

/**
 * The "What is this?" explainer for a payment method (spec 2.6, P3-M3): the method's one-sentence
 * `whatItIs` from its profile (Task 3), in a sheet titled with the method's name.
 */
export function MethodExplainer({
  open,
  name,
  whatItIs,
  onClose,
}: {
  open: boolean;
  name: string;
  whatItIs: string;
  onClose: () => void;
}) {
  return (
    <Sheet open={open} title={name} onClose={onClose}>
      <p className="x2f-sheet__body">{whatItIs}</p>
    </Sheet>
  );
}
