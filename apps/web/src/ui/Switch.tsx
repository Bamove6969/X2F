import './ui.css';

/**
 * An on/off switch (Devices board, "One device at a time"): a real button with role="switch" and
 * aria-checked, 52×32, named by the visible label (`labelledBy`) and described by its hint
 * (`describedBy`). On is an ink track with a ground knob; off is surface-raised with a line border.
 * The 44 px tap height comes from the button box around the track.
 */
export function Switch({
  on,
  onToggle,
  labelledBy,
  describedBy,
  disabled = false,
  part,
}: {
  on: boolean;
  onToggle: () => void;
  labelledBy: string;
  describedBy?: string;
  disabled?: boolean;
  part?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      className="x2f-switch"
      data-on={on ? 'true' : 'false'}
      disabled={disabled}
      onClick={onToggle}
      data-part={part}
    >
      <span className="x2f-switch__track" aria-hidden="true">
        <span className="x2f-switch__knob" />
      </span>
    </button>
  );
}
