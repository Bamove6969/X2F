import { useEffect, useRef, useState } from 'react';
import { certifyDevice, myDevices } from '../api.js';
import { indexedDbDeviceBackend, staffDeviceKey, type StaffDeviceKey } from '../device/deviceKey.js';
import { faultText } from '../refusals.js';
import { KeyTapDialog } from './KeyTapDialog.js';
import { Button, Notice } from './kit.js';

/**
 * Chat membership design task 8: whether this browser's device key is certified, and the way to
 * certify it with a security-key tap bound to exactly its keys. A disputed chat opens only on a
 * certified device (design task 9). No board yet: DESIGNER-REVIEW. Every string is COPY-UNSIGNED.
 */
export function DeviceCard({ onReady, load = () => staffDeviceKey(indexedDbDeviceBackend()), notCertified = false }: {
  onReady?: (k: StaffDeviceKey) => void;
  load?: () => Promise<StaffDeviceKey>;
  /**
   * Review N4: the moderation process answered `device-not-certified` for this device (it revoked it,
   * say after a switch-off or a security reset): show the confirm step whatever the API lists.
   */
  notCertified?: boolean;
}) {
  const [key, setKey] = useState<StaffDeviceKey | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [certified, setCertified] = useState<boolean | null>(null);
  const [tapping, setTapping] = useState(false);
  const [fault, setFault] = useState<string | null>(null);
  // Cleared once this device is confirmed again here.
  const refusedRef = useRef(notCertified);

  const refresh = async (k: StaffDeviceKey): Promise<void> => {
    const list = await myDevices();
    setMe(list.accountId);
    const ok = list.devices.some((d) => d.deviceKeyId === k.deviceKeyId) && !refusedRef.current;
    setCertified(ok);
    if (ok) onReady?.(k);
  };

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const k = await load();
        if (!live) return;
        setKey(k);
        await refresh(k);
      } catch (e) {
        // COPY-UNSIGNED. not-a-refusal: a browser fault (no IndexedDB or WebCrypto), not a rule about the person
        if (live) setFault(faultText(e, 'This browser cannot keep a device key. Use another browser to read chats.'));
      }
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (fault !== null) return <Notice tone="danger" data-part="device-fault">{fault}</Notice>;
  if (key === null || certified === null || me === null) return null;
  if (certified) return <p data-part="device-certified">This device can open disputed chats.</p>; // COPY-UNSIGNED
  return (
    <div className="x2f-stack" data-part="device-uncertified">
      {/* COPY-UNSIGNED */}
      <p>To read a disputed chat on this device, confirm it with your security key first.</p>
      <Button variant="primary" onClick={() => setTapping(true)}>Confirm this device</Button>
      {tapping ? (
        <KeyTapDialog
          intent={{ kind: 'certify-device', accountId: me, deviceKeyId: key.deviceKeyId, signPublic: key.signPublic, boxPublic: key.boxPublic }}
          title="Confirm this device" // COPY-UNSIGNED
          body="Your key confirms that this browser may receive the keys of the disputed chats you open, for one year." // COPY-UNSIGNED
          labels={{ accountId: 'you', deviceKeyId: 'this device', signPublic: "this device's signing key", boxPublic: "this device's lock key" }} // COPY-UNSIGNED
          onCancel={() => setTapping(false)}
          onDone={(tapId) => {
            setTapping(false);
            void certifyDevice(key.signPublic, key.boxPublic, tapId)
              .then(() => {
                refusedRef.current = false;
                return refresh(key);
              })
              .catch((e: unknown) => setFault(faultText(e, 'This device was not confirmed. Try again.'))); // COPY-UNSIGNED
          }}
        />
      ) : null}
    </div>
  );
}
