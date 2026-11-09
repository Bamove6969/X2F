import type { StaffRole } from '@x2f/staff';
import { Icon } from './kit.js';
import './staff.css';

/** How each role is named on the boards (StaffList's role cards; StaffOverview's "lumen.k · Owner"). */
export const ROLE_LABELS: Readonly<Record<StaffRole, string>> = {
  owner: 'Owner',
  senior: 'Senior moderator',
  mod: 'Moderator',
  helper: 'Helper',
};

/** The signed-in staff member at the foot of the nav rail (board StaffOverview): `<username> · <Role>`. */
export function RoleChip({ username, role }: { username: string; role: StaffRole }) {
  return (
    <p className="x2f-staff-chip" data-part="user-chip">
      <Icon name="shield" size={16} />
      <span className="x2f-staff-chip__name">{username}</span>
      <span className="x2f-staff-chip__role">{` · ${ROLE_LABELS[role]}`}</span>
    </p>
  );
}
