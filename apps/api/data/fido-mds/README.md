# FIDO metadata snapshot (staff and owner security keys)

Staff and owner security keys must carry `direct` attestation that chains to one of the statements
in this folder, and their AAGUID must be in the allowlist for their account kind below (Plan 2,
Task 8; P2-I5; owner's security-key rules of 2026-10-20). `fileAttestationPolicy` loads every
`*.json` here into `MetadataService` in `strict` mode with no network fetch, and reads the two
allowlists from this file: only lines of the form ``- `<aaguid>` ...`` under "Owner allowlist" and
"Staff allowlist" count.

## Source

- URL: https://mds3.fidoalliance.org/ (FIDO Alliance Metadata Service v3 BLOB, a signed JWT)
- Fetched: 2026-10-18, by hand (the server never fetches it); fetched again 2026-10-28 for the
  owner/staff split: the same BLOB (same serial and SHA-256), FIDO had not yet published a newer one
- BLOB serial `no`: 291
- nextUpdate: 2026-11-01
- SHA-256 of the downloaded BLOB: `702351da86b5c742ab053423ca38d77240b790fe9350d2e2f9187f660f2f5d09`
- The BLOB's JWT signature and certificate chain were verified with `verifyMDSBlob` from
  @simplewebauthn/server 14.0.3 (FIDO MDS root, GlobalSign Root CA - R3) before extraction.

## Extraction

Every BLOB entry with an AAGUID none of whose status reports, past or present, is
`NOT_FIDO_CERTIFIED`, `REVOKED`, `USER_VERIFICATION_BYPASS` or any `*_COMPROMISE` status (so
preview and release-candidate models are left out, and so is a model that was ever revoked or
compromised, even if a later report certifies it again), and that is one of:

- **YubiKey 5:** every attestation root certificate is Yubico's and `metadataStatement.description`
  starts with `YubiKey 5 ` (5 Series, 5 FIPS, 5 CCN, any firmware);
- **Yubico Security Key series:** every root is Yubico's and the description contains
  `Security Key` and does not start with `YubiKey` (Security Key by Yubico, Security Key NFC by
  Yubico and their Enterprise Editions, Security Key Series with NFC);
- **Google Titan:** every root is Google's (`O=Google`) and the description starts with
  `Google Titan Security Key` (only the v2 key has a FIDO2 AAGUID entry; older U2F-only Titan keys
  cannot give `packed` attestation and are refused).

Each file is that entry's `metadataStatement`, unchanged except that the image fields (`icon`,
`iconDark`, `providerLogoLight`, `providerLogoDark`) are removed (written with 2-space JSON
indentation and a final newline).

- **Staff allowlist:** all of the above (owner, 2026-10-20: certified YubiKey 5 on any firmware,
  the Yubico Security Key series or Google Titan).
- **Owner allowlist:** the YubiKey 5 entries whose `authenticatorGetInfo.firmwareVersion` is 5.7.0
  or newer (owner, 2026-10-20: YubiKey 5 on firmware 5.7 or newer only). Yubico gives each firmware
  line its own AAGUIDs, so the AAGUID tells the firmware; an entry with no stated firmware is left
  out.

## Refresh

Refresh the snapshot at least by the BLOB's `nextUpdate` (the `- nextUpdate:` line above), and at
once when FIDO publishes a status change (revocation, compromise) for an allowlisted model. From
that date on, the API writes a warning line to stderr at every start until the snapshot is
refreshed; it keeps running on the old snapshot.

### How to refresh

1. Download the BLOB by hand into a new, empty folder outside the repo, e.g.
   `curl -sSL -o /tmp/mds/blob.jwt https://mds3.fidoalliance.org/`. Expect a serial `no` above the
   one recorded here.
2. Run `npm run refresh -w @x2f/fido-mds -- /tmp/mds/blob.jwt "$PWD/apps/api/data/fido-mds"` from
   the repo root (`tools/fido-mds/refresh.ts`). It verifies the BLOB with `verifyMDSBlob` (chain
   to the FIDO MDS root and JWT signature; it stops on failure), applies the rules under
   "Extraction", writes the statements, deletes statements no longer kept, and rewrites the serial,
   `nextUpdate` and SHA-256 lines and both allowlists below. Run on the BLOB recorded above, it
   reproduces this folder byte for byte.
3. Update the "Fetched" line by hand. If FIDO still serves the same serial after `nextUpdate`, say
   so there ("checked YYYY-MM-DD, still serial N") and leave the warning in place.
4. Review `git diff`: allowlist lines added or dropped, and every change to a statement's
   `attestationRootCertificates`. Run the API's attestation tests (`apps/api/test/attestation.test.ts`).
   Do not commit the BLOB or the decoded payload.

## Owner allowlist

- `3aa78eb1-ddd8-46a8-a821-8f8ec57a7bd5` YubiKey 5 CCN Series with NFC (FIDO_CERTIFIED_L2; firmware 5.7.4)
- `eb7ef748-cbe0-4b40-b8f6-07bd2d592d35` YubiKey 5 CCN Series with NFC (Consumer Profile) (FIDO_CERTIFIED_L2; firmware 5.8.0)
- `3ec9c8d3-a5a7-415b-a7b5-f1d606368d3f` YubiKey 5 CCN Series with NFC (Enterprise Profile) (FIDO_CERTIFIED_L2; firmware 5.8.0)
- `4fc84f16-2545-4e53-b8fc-7bf4d7282a10` YubiKey 5 CCN Series with NFC (Enterprise Profile) (FIDO_CERTIFIED_L2; firmware 5.7.4)
- `57f7de54-c807-4eab-b1c6-1c9be7984e92` YubiKey 5 FIPS Series (FIDO_CERTIFIED_L2; firmware 5.7.4)
- `905b4cb4-ed6f-4da9-92fc-45e0d4e9b5c7` YubiKey 5 FIPS Series (Enterprise Profile) (FIDO_CERTIFIED_L2; firmware 5.7.4)
- `7b96457d-e3cd-432b-9ceb-c9fdd7ef7432` YubiKey 5 FIPS Series with Lightning (FIDO_CERTIFIED_L2; firmware 5.7.4)
- `3a662962-c6d4-4023-bebb-98ae92e78e20` YubiKey 5 FIPS Series with Lightning (Enterprise Profile) (FIDO_CERTIFIED_L2; firmware 5.7.4)
- `fcc0118f-cd45-435b-8da1-9782b2da0715` YubiKey 5 FIPS Series with NFC (FIDO_CERTIFIED_L2; firmware 5.7.4)
- `79f3c8ba-9e35-484b-8f47-53a5a0f5c630` YubiKey 5 FIPS Series with NFC (Enterprise Profile) (FIDO_CERTIFIED_L2; firmware 5.7.4)
- `19083c3d-8383-4b18-bc03-8f1c9ab2fd1b` YubiKey 5 Series (FIDO_CERTIFIED_L2, FIDO_CERTIFIED_L1; firmware 5.7.1)
- `ff4dac45-ede8-4ec2-aced-cf66103f4335` YubiKey 5 Series (FIDO_CERTIFIED_L2; firmware 5.7.4)
- `0a357157-9b18-4c8a-920e-d156e972b2f8` YubiKey 5 Series (Consumer Profile) (FIDO_CERTIFIED_L2; firmware 5.8.0)
- `20ac7a17-c814-4833-93fe-539f0d5e3389` YubiKey 5 Series (Enterprise Profile) (FIDO_CERTIFIED_L2; firmware 5.7.1)
- `4599062e-6926-4fe7-9566-9e8fb1aedaa0` YubiKey 5 Series (Enterprise Profile) (FIDO_CERTIFIED_L2; firmware 5.7.4)
- `524de2de-982f-49b4-a769-2b5e3b73ad79` YubiKey 5 Series (Enterprise Profile) (FIDO_CERTIFIED_L2; firmware 5.8.0)
- `24673149-6c86-42e7-98d9-433fb5b73296` YubiKey 5 Series with Lightning (FIDO_CERTIFIED_L2; firmware 5.7.4)
- `a02167b9-ae71-4ac7-9a07-06432ebb6f1c` YubiKey 5 Series with Lightning (FIDO_CERTIFIED_L2, FIDO_CERTIFIED_L1; firmware 5.7.1)
- `03012cb7-4fb2-42e7-9e8d-a81f10e2a5e9` YubiKey 5 Series with Lightning (Consumer Profile) (FIDO_CERTIFIED_L2; firmware 5.8.0)
- `3b24bf49-1d45-4484-a917-13175df0867b` YubiKey 5 Series with Lightning (Enterprise Profile) (FIDO_CERTIFIED_L2; firmware 5.7.4)
- `b90e7dc1-316e-4fee-a25a-56a666a670fe` YubiKey 5 Series with Lightning (Enterprise Profile) (FIDO_CERTIFIED_L2; firmware 5.7.1)
- `c3479970-e58a-4f70-836f-853bf42fb063` YubiKey 5 Series with Lightning (Enterprise Profile) (FIDO_CERTIFIED_L2; firmware 5.8.0)
- `a25342c0-3cdc-4414-8e46-f4807fca511c` YubiKey 5 Series with NFC (FIDO_CERTIFIED_L2, FIDO_CERTIFIED_L1; firmware 5.7.1)
- `d7781e5d-e353-46aa-afe2-3ca49f13332a` YubiKey 5 Series with NFC (FIDO_CERTIFIED_L2; firmware 5.7.4)
- `f4ce5fc0-57d3-46f5-a736-efb7d5bc63b5` YubiKey 5 Series with NFC (Consumer Profile) (FIDO_CERTIFIED_L2; firmware 5.8.0)
- `7dab85a5-d16d-4eaf-a7ef-4c1385b151c5` YubiKey 5 Series with NFC (Consumer Profile) KVZR57-2 (FIDO_CERTIFIED_L2; firmware 5.8.0)
- `1ac71f64-468d-4fe0-bef1-0e5f2f551f18` YubiKey 5 Series with NFC (Enterprise Profile) (FIDO_CERTIFIED_L2; firmware 5.7.1)
- `41e39911-c669-4811-b860-c6ad0b411b96` YubiKey 5 Series with NFC (Enterprise Profile) (FIDO_CERTIFIED_L2; firmware 5.8.0)
- `6ab56fad-881f-4a43-acb2-0be065924522` YubiKey 5 Series with NFC (Enterprise Profile) (FIDO_CERTIFIED_L2; firmware 5.7.4)
- `662ef48a-95e2-4aaa-a6c1-5b9c40375824` YubiKey 5 Series with NFC - Enhanced PIN (FIDO_CERTIFIED_L2; firmware 5.7.4)
- `b2c1a50b-dad8-4dc7-ba4d-0ce9597904bc` YubiKey 5 Series with NFC - Enhanced PIN (Enterprise Profile) (FIDO_CERTIFIED_L2; firmware 5.7.4)
- `0ebd9f2c-f685-441c-8c3e-a02a234a840a` YubiKey 5 Series with NFC Enhanced PIN (Consumer Profile) (FIDO_CERTIFIED_L2; firmware 5.8.0)
- `9a3f2abd-a73d-439c-9ee7-1b53a857eaa7` YubiKey 5 Series with NFC Enhanced PIN (Enterprise Profile) (FIDO_CERTIFIED_L2; firmware 5.8.0)
- `9eb7eabc-9db5-49a1-b6c3-555a802093f4` YubiKey 5 Series with NFC KVZR57 (FIDO_CERTIFIED_L2; firmware 5.7.4)

## Staff allowlist

- `24083bcb-3034-4867-99de-a3b52e1d426a` Enterprise Security Key Series with NFC (Consumer Profile) (FIDO_CERTIFIED_L2; firmware 5.8.0)
- `ab7d1767-3fa0-4388-b6c4-feef7a844809` Enterprise Security Key Series with NFC (Enterprise Profile) (FIDO_CERTIFIED_L2; firmware 5.8.0)
- `42b4fb4a-2866-43b2-9bf7-6c6669c2e5d3` Google Titan Security Key v2 (FIDO_CERTIFIED_L1; firmware not stated)
- `a4e9fc6d-4cbe-4758-b8ba-37598bb5bbaa` Security Key NFC by Yubico (FIDO_CERTIFIED_L2, FIDO_CERTIFIED_L1; firmware 5.4.3)
- `b7d3f68e-88a6-471e-9ecf-2df26d041ede` Security Key NFC by Yubico (FIDO_CERTIFIED_L2; firmware 5.7.4)
- `e77e3c64-05e3-428b-8824-0cbeb04b829d` Security Key NFC by Yubico (FIDO_CERTIFIED_L2, FIDO_CERTIFIED_L1; firmware 5.7.1)
- `0bb43545-fd2c-4185-87dd-feb0b2916ace` Security Key NFC by Yubico - Enterprise Edition (FIDO_CERTIFIED_L2, FIDO_CERTIFIED_L1; firmware 5.4.3)
- `47ab2fb4-66ac-4184-9ae1-86be814012d5` Security Key NFC by Yubico - Enterprise Edition (FIDO_CERTIFIED_L2, FIDO_CERTIFIED_L1; firmware 5.7.1)
- `ed042a3a-4b22-4455-bb69-a267b652ae7e` Security Key NFC by Yubico - Enterprise Edition (FIDO_CERTIFIED_L2; firmware 5.7.4)
- `72c6b72d-8512-4c66-8359-9d3d10d9222f` Security Key NFC by Yubico - Enterprise Edition (Enterprise Profile) (FIDO_CERTIFIED_L2; firmware 5.7.4)
- `9ff4cc65-6154-4fff-ba09-9e2af7882ad2` Security Key NFC by Yubico - Enterprise Edition (Enterprise Profile) (FIDO_CERTIFIED_L2; firmware 5.7.1)
- `0f083f18-4105-43a8-ad69-24e812e38141` Security Key Series with NFC (Consumer Profile) (FIDO_CERTIFIED_L2; firmware 5.8.0)
- `b92c3f9a-c014-4056-887f-140a2501163b` Security Key by Yubico (FIDO_CERTIFIED_L1; firmware not stated)
- `f8a011f3-8c0a-4d15-8006-17111f9edc7d` Security Key by Yubico (FIDO_CERTIFIED_L1; firmware not stated)
- `149a2021-8ef6-4133-96b8-81f8d5b7f1f5` Security Key by Yubico with NFC (FIDO_CERTIFIED_L1; firmware not stated)
- `6d44ba9b-f6ec-2e49-b930-0c8fe920cb73` Security Key by Yubico with NFC (FIDO_CERTIFIED_L1; firmware not stated)
- `3aa78eb1-ddd8-46a8-a821-8f8ec57a7bd5` YubiKey 5 CCN Series with NFC (FIDO_CERTIFIED_L2; firmware 5.7.4)
- `eb7ef748-cbe0-4b40-b8f6-07bd2d592d35` YubiKey 5 CCN Series with NFC (Consumer Profile) (FIDO_CERTIFIED_L2; firmware 5.8.0)
- `3ec9c8d3-a5a7-415b-a7b5-f1d606368d3f` YubiKey 5 CCN Series with NFC (Enterprise Profile) (FIDO_CERTIFIED_L2; firmware 5.8.0)
- `4fc84f16-2545-4e53-b8fc-7bf4d7282a10` YubiKey 5 CCN Series with NFC (Enterprise Profile) (FIDO_CERTIFIED_L2; firmware 5.7.4)
- `57f7de54-c807-4eab-b1c6-1c9be7984e92` YubiKey 5 FIPS Series (FIDO_CERTIFIED_L2; firmware 5.7.4)
- `73bb0cd4-e502-49b8-9c6f-b59445bf720b` YubiKey 5 FIPS Series (FIDO_CERTIFIED_L2, FIDO_CERTIFIED_L1; firmware 5.4.2)
- `905b4cb4-ed6f-4da9-92fc-45e0d4e9b5c7` YubiKey 5 FIPS Series (Enterprise Profile) (FIDO_CERTIFIED_L2; firmware 5.7.4)
- `7b96457d-e3cd-432b-9ceb-c9fdd7ef7432` YubiKey 5 FIPS Series with Lightning (FIDO_CERTIFIED_L2; firmware 5.7.4)
- `85203421-48f9-4355-9bc8-8a53846e5083` YubiKey 5 FIPS Series with Lightning (FIDO_CERTIFIED_L2, FIDO_CERTIFIED_L1; firmware 5.4.2)
- `3a662962-c6d4-4023-bebb-98ae92e78e20` YubiKey 5 FIPS Series with Lightning (Enterprise Profile) (FIDO_CERTIFIED_L2; firmware 5.7.4)
- `c1f9a0bc-1dd2-404a-b27f-8e29047a43fd` YubiKey 5 FIPS Series with NFC (FIDO_CERTIFIED_L2, FIDO_CERTIFIED_L1; firmware 5.4.2)
- `fcc0118f-cd45-435b-8da1-9782b2da0715` YubiKey 5 FIPS Series with NFC (FIDO_CERTIFIED_L2; firmware 5.7.4)
- `79f3c8ba-9e35-484b-8f47-53a5a0f5c630` YubiKey 5 FIPS Series with NFC (Enterprise Profile) (FIDO_CERTIFIED_L2; firmware 5.7.4)
- `19083c3d-8383-4b18-bc03-8f1c9ab2fd1b` YubiKey 5 Series (FIDO_CERTIFIED_L2, FIDO_CERTIFIED_L1; firmware 5.7.1)
- `cb69481e-8ff7-4039-93ec-0a2729a154a8` YubiKey 5 Series (FIDO_CERTIFIED_L1; firmware not stated)
- `ee882879-721c-4913-9775-3dfcce97072a` YubiKey 5 Series (FIDO_CERTIFIED_L1; firmware 5.4.2)
- `ff4dac45-ede8-4ec2-aced-cf66103f4335` YubiKey 5 Series (FIDO_CERTIFIED_L2; firmware 5.7.4)
- `0a357157-9b18-4c8a-920e-d156e972b2f8` YubiKey 5 Series (Consumer Profile) (FIDO_CERTIFIED_L2; firmware 5.8.0)
- `20ac7a17-c814-4833-93fe-539f0d5e3389` YubiKey 5 Series (Enterprise Profile) (FIDO_CERTIFIED_L2; firmware 5.7.1)
- `4599062e-6926-4fe7-9566-9e8fb1aedaa0` YubiKey 5 Series (Enterprise Profile) (FIDO_CERTIFIED_L2; firmware 5.7.4)
- `524de2de-982f-49b4-a769-2b5e3b73ad79` YubiKey 5 Series (Enterprise Profile) (FIDO_CERTIFIED_L2; firmware 5.8.0)
- `24673149-6c86-42e7-98d9-433fb5b73296` YubiKey 5 Series with Lightning (FIDO_CERTIFIED_L2; firmware 5.7.4)
- `a02167b9-ae71-4ac7-9a07-06432ebb6f1c` YubiKey 5 Series with Lightning (FIDO_CERTIFIED_L2, FIDO_CERTIFIED_L1; firmware 5.7.1)
- `c5ef55ff-ad9a-4b9f-b580-adebafe026d0` YubiKey 5 Series with Lightning (FIDO_CERTIFIED_L1; firmware 5.4.2)
- `03012cb7-4fb2-42e7-9e8d-a81f10e2a5e9` YubiKey 5 Series with Lightning (Consumer Profile) (FIDO_CERTIFIED_L2; firmware 5.8.0)
- `3b24bf49-1d45-4484-a917-13175df0867b` YubiKey 5 Series with Lightning (Enterprise Profile) (FIDO_CERTIFIED_L2; firmware 5.7.4)
- `b90e7dc1-316e-4fee-a25a-56a666a670fe` YubiKey 5 Series with Lightning (Enterprise Profile) (FIDO_CERTIFIED_L2; firmware 5.7.1)
- `c3479970-e58a-4f70-836f-853bf42fb063` YubiKey 5 Series with Lightning (Enterprise Profile) (FIDO_CERTIFIED_L2; firmware 5.8.0)
- `2fc0579f-8113-47ea-b116-bb5a8db9202a` YubiKey 5 Series with NFC (FIDO_CERTIFIED_L1; firmware 5.4.2)
- `a25342c0-3cdc-4414-8e46-f4807fca511c` YubiKey 5 Series with NFC (FIDO_CERTIFIED_L2, FIDO_CERTIFIED_L1; firmware 5.7.1)
- `d7781e5d-e353-46aa-afe2-3ca49f13332a` YubiKey 5 Series with NFC (FIDO_CERTIFIED_L2; firmware 5.7.4)
- `fa2b99dc-9e39-4257-8f92-4a30d23c4118` YubiKey 5 Series with NFC (FIDO_CERTIFIED_L1; firmware not stated)
- `f4ce5fc0-57d3-46f5-a736-efb7d5bc63b5` YubiKey 5 Series with NFC (Consumer Profile) (FIDO_CERTIFIED_L2; firmware 5.8.0)
- `7dab85a5-d16d-4eaf-a7ef-4c1385b151c5` YubiKey 5 Series with NFC (Consumer Profile) KVZR57-2 (FIDO_CERTIFIED_L2; firmware 5.8.0)
- `1ac71f64-468d-4fe0-bef1-0e5f2f551f18` YubiKey 5 Series with NFC (Enterprise Profile) (FIDO_CERTIFIED_L2; firmware 5.7.1)
- `41e39911-c669-4811-b860-c6ad0b411b96` YubiKey 5 Series with NFC (Enterprise Profile) (FIDO_CERTIFIED_L2; firmware 5.8.0)
- `6ab56fad-881f-4a43-acb2-0be065924522` YubiKey 5 Series with NFC (Enterprise Profile) (FIDO_CERTIFIED_L2; firmware 5.7.4)
- `662ef48a-95e2-4aaa-a6c1-5b9c40375824` YubiKey 5 Series with NFC - Enhanced PIN (FIDO_CERTIFIED_L2; firmware 5.7.4)
- `b2c1a50b-dad8-4dc7-ba4d-0ce9597904bc` YubiKey 5 Series with NFC - Enhanced PIN (Enterprise Profile) (FIDO_CERTIFIED_L2; firmware 5.7.4)
- `0ebd9f2c-f685-441c-8c3e-a02a234a840a` YubiKey 5 Series with NFC Enhanced PIN (Consumer Profile) (FIDO_CERTIFIED_L2; firmware 5.8.0)
- `9a3f2abd-a73d-439c-9ee7-1b53a857eaa7` YubiKey 5 Series with NFC Enhanced PIN (Enterprise Profile) (FIDO_CERTIFIED_L2; firmware 5.8.0)
- `9eb7eabc-9db5-49a1-b6c3-555a802093f4` YubiKey 5 Series with NFC KVZR57 (FIDO_CERTIFIED_L2; firmware 5.7.4)
