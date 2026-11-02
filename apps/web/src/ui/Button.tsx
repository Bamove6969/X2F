import type { ButtonHTMLAttributes, ReactNode } from 'react';
import './ui.css';

// Button styles from the X2F App boards:
// - primary: the one monero-orange action per screen (TradeFund "Open in Cake Wallet", BuyerPay "I've paid").
//   It always carries data-primary, even while disabled, so a screen has exactly one (Task 15 parity).
// - secondary: the outlined button (SellOffers "Message nightowl_44").
// - quiet: the muted text button (BuyerPay "Cancel trade").
// - danger: the rose text button (BuyerPay "Open dispute").
// - danger-outline: the danger confirm, a rose wash with a rose outline (LoginApprove "No, block it";
//   visual system v2 section 10).
// - tertiary: the v2 muted 15/600 text button (LoginApprove "Not now").
export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger' | 'danger-outline' | 'tertiary';

type Common = { variant: ButtonVariant; children: ReactNode; className?: string };
type AsButton = Common & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'children'> & { href?: undefined };
type AsLink = Common & { href: string; 'aria-label'?: string };

export function Button(props: AsButton | AsLink) {
  const { variant, children, className } = props;
  const cls = ['x2f-button', `x2f-button--${variant}`, className].filter(Boolean).join(' ');
  const primary = variant === 'primary' ? { 'data-primary': '' } : {};
  if (props.href !== undefined) {
    return (
      <a className={cls} href={props.href} aria-label={props['aria-label']} {...primary}>
        {children}
      </a>
    );
  }
  const { variant: _v, children: _c, className: _cn, href: _h, type, ...rest } = props;
  return (
    <button {...rest} type={type ?? 'button'} className={cls} {...primary}>
      {children}
    </button>
  );
}
