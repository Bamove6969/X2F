import { attestationKeys } from '@x2f/trade';
import { indexedDbDeviceBackend } from './deviceKey.js';
import { ChatKeeper, serveChatKeeper, type Endpoint } from './keeper.js';

/**
 * Design build task 10: the staff-web chat key worker (a dedicated module Worker the page starts
 * with `new Worker(new URL('../keys/chatWorker.ts', import.meta.url), { type: 'module' })`, see
 * chat/client.ts). Everything that touches a chat key or this browser's device secrets runs here
 * (keeper.ts). Its pinned moderation keys are its own build's VITE_MOD_SIGNING_PUBLIC.
 */
const pinned: string = (import.meta.env?.VITE_MOD_SIGNING_PUBLIC as string | undefined) ?? '';
serveChatKeeper(new ChatKeeper({ backend: indexedDbDeviceBackend(), modKeys: attestationKeys(pinned) }), self as unknown as Endpoint);
