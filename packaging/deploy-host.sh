#!/bin/sh
# Updates a host installation (keyfold.service, see README.md) over ssh: builds
# kf, keyfold-server and the web UI here for the host's architecture, installs
# them, restarts the service and checks that the vault answers. The vault data
# is never touched.
#
# Usage: deploy-host.sh <ssh destination> <vault URL> <version> <commit>
# VAULT_CA: optional CA file to check the vault's HTTPS certificate with (a
# private CA such as Caddy's internal one).
set -eu

if [ $# -ne 4 ]; then
	echo "usage: $0 <ssh destination> <vault URL> <version> <commit>" >&2
	exit 2
fi
host=$1 url=${2%/} version=$3 commit=$4

case $(ssh -o BatchMode=yes "$host" uname -m) in
x86_64) arch=amd64 ;;
aarch64 | arm64) arch=arm64 ;;
*) echo "deploy: unsupported architecture on $host" >&2; exit 1 ;;
esac

out=$(mktemp -d)
trap 'rm -rf "$out"' EXIT
trap 'exit 130' INT TERM
ldflags="-X keyfold/internal/version.Version=$version -X keyfold/internal/version.Commit=$commit"
CGO_ENABLED=0 GOOS=linux GOARCH=$arch go build -ldflags "$ldflags" -o "$out/kf" ./apps/kf
CGO_ENABLED=0 GOOS=linux GOARCH=$arch go build -ldflags "$ldflags" -o "$out/keyfold-server" ./apps/keyfold-server
(cd apps/web && bunx tsc --noEmit && bunx vite build --outDir "$out/web" --emptyOutDir --logLevel warn)

# Everything is staged next to its target first (.new), then switched by
# renames and the service restarted: a failure while staging leaves the host as
# it was, and a rerun finishes a deployment cut short.
tar -C "$out" -czf - . | ssh -o BatchMode=yes "$host" '
set -eu
d=$(mktemp -d)
trap "rm -rf \"$d\"" EXIT
tar -xzf - -C "$d"
share=/usr/local/share/keyfold
# A run cut short between the two renames below left the UI in web.old: put it back.
if [ ! -e "$share/web" ] && [ -e "$share/web.old" ]; then sudo -n mv "$share/web.old" "$share/web"; fi
sudo -n install -m 0755 -o root -g root "$d/keyfold-server" /usr/local/bin/keyfold-server.new
sudo -n install -m 0755 -o root -g root "$d/kf" /usr/local/bin/kf.new
sudo -n rm -rf "$share/web.new" "$share/web.old"
sudo -n cp -r "$d/web" "$share/web.new"
sudo -n chown -R root:root "$share/web.new"
sudo -n chmod -R u=rwX,go=rX "$share/web.new"
sudo -n mv /usr/local/bin/keyfold-server.new /usr/local/bin/keyfold-server
sudo -n mv /usr/local/bin/kf.new /usr/local/bin/kf
if [ -e "$share/web" ]; then sudo -n mv "$share/web" "$share/web.old"; fi
sudo -n mv "$share/web.new" "$share/web"
sudo -n rm -rf "$share/web.old"
sudo -n systemctl restart keyfold.service
sleep 2
systemctl is-active --quiet keyfold.service || { echo "keyfold.service is not running: journalctl -u keyfold.service" >&2; exit 1; }
/usr/local/bin/kf version
'

if [ -n "${VAULT_CA:-}" ]; then
	curl -fsS --max-time 10 --cacert "$VAULT_CA" "$url/api/v1/status"
else
	curl -fsS --max-time 10 "$url/api/v1/status"
fi
echo
