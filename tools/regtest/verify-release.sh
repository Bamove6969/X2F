#!/usr/bin/env bash
# Usage: verify-release.sh KEY_FILE HASHES_FILE TARBALL EXPECTED_FPR EXPECTED_SHA256
# Exits 0 only if: the key file contains EXPECTED_FPR, HASHES_FILE carries a good,
# non-expired, non-revoked signature by exactly that primary key, the verified text lists
# EXPECTED_SHA256 for the tarball's name, and the tarball has that SHA-256.
set -euo pipefail

if [ "$#" -ne 5 ]; then
  echo "usage: verify-release.sh KEY_FILE HASHES_FILE TARBALL EXPECTED_FPR EXPECTED_SHA256" >&2
  exit 2
fi
KEY_FILE="$1"
HASHES_FILE="$2"
TARBALL="$3"
EXPECTED_FPR="$4"
EXPECTED_SHA256="$5"
NAME="$(basename "${TARBALL}")"

GNUPGHOME="$(mktemp -d)"
WORK="$(mktemp -d)"
chmod 700 "${GNUPGHOME}"
export GNUPGHOME
trap 'gpgconf --homedir "${GNUPGHOME}" --kill all >/dev/null 2>&1 || true; rm -rf "${GNUPGHOME}" "${WORK}"' EXIT

fail() { echo "verify-release: $1" >&2; exit 1; }

gpg --batch --quiet --import "${KEY_FILE}" 2>/dev/null || fail "cannot import key"
FPRS="$(gpg --batch --with-colons --fingerprint | awk -F: '$1 == "fpr" { print $10 }')"
printf '%s\n' "${FPRS}" | grep -qx "${EXPECTED_FPR}" || fail "key fingerprint is not ${EXPECTED_FPR}"

# Decrypting a clearsigned file writes the verified plaintext and reports signature status.
# gpg's exit code is deliberately not trusted on its own: the status lines decide.
STATUS="$(gpg --batch --status-fd 1 --output "${WORK}/plain.txt" --decrypt "${HASHES_FILE}" 2>/dev/null || true)"
BAD="$(printf '%s\n' "${STATUS}" | awk '$1 == "[GNUPG:]" && $2 ~ /^(EXPKEYSIG|REVKEYSIG|BADSIG|ERRSIG|EXPSIG)$/ { print $2; exit }')"
[ -z "${BAD}" ] || fail "signature rejected (${BAD}): bad, expired, revoked or unverifiable"
printf '%s\n' "${STATUS}" | grep -q '^\[GNUPG:\] GOODSIG ' || fail "no good signature (GOODSIG missing)"
# VALIDSIG field 11 (awk $12) is the primary key fingerprint, even when a subkey signed.
PRIMARY="$(printf '%s\n' "${STATUS}" | awk '$1 == "[GNUPG:]" && $2 == "VALIDSIG" { print $12 }')"
[ "${PRIMARY}" = "${EXPECTED_FPR}" ] || fail "signing key is not ${EXPECTED_FPR}"

# Only the verified plaintext is trusted for the hash line.
LINE="$(grep -E "^[0-9a-f]{64}  ${NAME}\$" "${WORK}/plain.txt" || true)"
[ "${LINE}" = "${EXPECTED_SHA256}  ${NAME}" ] || fail "signed hashes do not list ${EXPECTED_SHA256} for ${NAME}"

ACTUAL="$(sha256sum "${TARBALL}" | awk '{ print $1 }')"
[ "${ACTUAL}" = "${EXPECTED_SHA256}" ] || fail "tarball sha256 mismatch"
