#!/usr/bin/env bash
# Fetch monerod v0.18.5.3 into .regtest/bin, verifying the release signature and checksum
# via verify-release.sh. Idempotent: exits early when the verified binary is in place.
#
# Note: getmonero.org's hashes.txt lists only the current release, so once a newer Monero
# release is published this script fails closed (no matching line) until the pins are updated.
set -euo pipefail

VERSION="0.18.5.3"
TARBALL="monero-linux-x64-v${VERSION}.tar.bz2"
EXPECTED_SHA256="3333d0e04c9cbe3023e7e2b6dd369c407f36bb8df5b05fb0a19d7685b3d56dfc"
EXPECTED_FPR="81AC591FE9C4B65C5806AFC3F0AF4D462A0BDF92"
KEY_URL="https://raw.githubusercontent.com/monero-project/monero/master/utils/gpg_keys/binaryfate.asc"
HASHES_URL="https://www.getmonero.org/downloads/hashes.txt"
TARBALL_URL="https://downloads.getmonero.org/cli/${TARBALL}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${HERE}/../.." && pwd)"
BIN_DIR="${ROOT}/.regtest/bin"
FINAL_DIR="${BIN_DIR}/monero-x86_64-linux-gnu-v${VERSION}"
MONEROD="${FINAL_DIR}/monerod"

if [ -x "${MONEROD}" ]; then
  exit 0
fi

mkdir -p "${BIN_DIR}"
WORK="$(mktemp -d "${BIN_DIR}/fetch.XXXXXX")"
trap 'rm -rf "${WORK}"' EXIT

fetch() {
  curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' --tlsv1.2 --output "$2" "$1"
}
fetch "${KEY_URL}" "${WORK}/binaryfate.asc"
fetch "${HASHES_URL}" "${WORK}/hashes.txt"
fetch "${TARBALL_URL}" "${WORK}/${TARBALL}"

bash "${HERE}/verify-release.sh" "${WORK}/binaryfate.asc" "${WORK}/hashes.txt" "${WORK}/${TARBALL}" "${EXPECTED_FPR}" "${EXPECTED_SHA256}"

# Extract into a temp dir inside BIN_DIR, then move into place atomically.
mkdir "${WORK}/extract"
tar -xjf "${WORK}/${TARBALL}" -C "${WORK}/extract"
[ -x "${WORK}/extract/monero-x86_64-linux-gnu-v${VERSION}/monerod" ] || { echo "fetch-monerod: monerod missing after extract" >&2; exit 1; }
rm -rf "${FINAL_DIR}"
mv "${WORK}/extract/monero-x86_64-linux-gnu-v${VERSION}" "${FINAL_DIR}"
echo "fetch-monerod: installed ${MONEROD}"
