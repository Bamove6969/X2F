#!/usr/bin/env bash
# Fetch monerod v0.18.5.3 into .regtest/bin, verifying the release signature and checksum
# via verify-release.sh. Idempotent: exits early when the verified binary is in place.
#
# getmonero.org's hashes.txt lists only the current release, so the signed hashes.txt for
# v0.18.5.3 is fetched from the monero-site commit that published it. gpg still verifies it.
set -euo pipefail

VERSION="0.18.5.3"
# One release, one signed hashes.txt; only the tarball and its pinned hashes differ by CPU.
case "$(uname -m)" in
  x86_64)
    TARBALL="monero-linux-x64-v${VERSION}.tar.bz2"
    DIR_NAME="monero-x86_64-linux-gnu-v${VERSION}"
    EXPECTED_SHA256="3333d0e04c9cbe3023e7e2b6dd369c407f36bb8df5b05fb0a19d7685b3d56dfc"
    MONEROD_SHA256="dd29703a5a1abf76b06c917276377b16b60668362ddd1459109537e212f4148c"
    ;;
  aarch64)
    TARBALL="monero-linux-armv8-v${VERSION}.tar.bz2"
    DIR_NAME="monero-aarch64-linux-gnu-v${VERSION}"
    # Tarball hash: copied from the gpg-verified plaintext of HASHES_URL below (GOODSIG, VALIDSIG
    # primary key = EXPECTED_FPR), the same file whose x64 line matches the x64 pin above.
    EXPECTED_SHA256="1490114f795ad2f67f57bc8d167c3e2539e9f173fc46f02f70ef4abf685f8c66"
    # monerod hash: sha256sum of monerod extracted from that tarball after verify-release.sh
    # passed on it (2026-10-25, aarch64; `monerod --version` = v0.18.5.3-release).
    MONEROD_SHA256="a8d68177c55d5e1f31668e12f6a7004c5d945f683a43a5a68b309c53f1eb2a03"
    ;;
  *)
    echo "fetch-monerod: unsupported CPU architecture $(uname -m) (x86_64 and aarch64 only)" >&2
    exit 1
    ;;
esac
EXPECTED_FPR="81AC591FE9C4B65C5806AFC3F0AF4D462A0BDF92"
KEY_URL="https://raw.githubusercontent.com/monero-project/monero/master/utils/gpg_keys/binaryfate.asc"
HASHES_URL="https://raw.githubusercontent.com/monero-project/monero-site/141bec879f7fe119b4754a9d622343adf941d6c0/downloads/hashes.txt"
TARBALL_URL="https://downloads.getmonero.org/cli/${TARBALL}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${HERE}/../.." && pwd)"
BIN_DIR="${ROOT}/.regtest/bin"
FINAL_DIR="${BIN_DIR}/${DIR_NAME}"
MONEROD="${FINAL_DIR}/monerod"

# Trust the cached binary only if it matches the pinned hash of the verified release's monerod.
if [ -x "${MONEROD}" ] && [ "$(sha256sum "${MONEROD}" | cut -d' ' -f1)" = "${MONEROD_SHA256}" ]; then
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
[ -x "${WORK}/extract/${DIR_NAME}/monerod" ] || { echo "fetch-monerod: monerod missing after extract" >&2; exit 1; }
EXTRACTED="${WORK}/extract/${DIR_NAME}"
[ "$(sha256sum "${EXTRACTED}/monerod" | cut -d' ' -f1)" = "${MONEROD_SHA256}" ] || { echo "fetch-monerod: extracted monerod does not match the pinned sha256" >&2; exit 1; }
rm -rf "${FINAL_DIR}"
# mv -T fails if a concurrent run already put a directory there, instead of nesting into it.
mv -T "${EXTRACTED}" "${FINAL_DIR}"
echo "fetch-monerod: installed ${MONEROD}"
