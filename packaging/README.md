# Deploying Keyfold

For a container deployment on a private network, `Dockerfile` builds the web UI
and both Go binaries. `compose.yml` runs the vault with Caddy, and `Caddyfile`
configures HTTPS. Set `KEYFOLD_HOST` to a name that resolves to the host from
your devices. Restrict access to TCP port 443 to the private network and trust
Caddy's internal CA on each client device.

Run from the repository root. If `make image` prints a tag other than `dev`, set
`VERSION` to that tag's version for Compose.

```sh
make image
KEYFOLD_HOST=vault.example.internal docker compose -f packaging/compose.yml up -d
```

For a host deployment, `keyfold.service` runs the server under systemd. Install
the binary at `/usr/local/bin/keyfold-server`, the built UI at
`/usr/local/share/keyfold/web`, and the unit at `/etc/systemd/system/keyfold.service`.
Replace `vault.example.internal` in the unit with your HTTPS proxy's host name.
Point that proxy at `127.0.0.1:8717` and follow the
[reverse proxy requirements](#reverse-proxy-requirements).

```sh
sudo systemctl enable --now keyfold.service
```

On first start the server logs the install token you need to create the vault
from another device.

## Scheduled backup

Use the updated `keyfold.service` for new installations. On an existing host,
add `User=keyfold` below `DynamicUser=yes` in
`/etc/systemd/system/keyfold.service` so both services use the same dynamic user.
From the repository root, install the backup script and units.

```sh
sudo install -m 0755 packaging/keyfold-backup.sh /usr/local/bin/keyfold-backup
sudo install -m 0644 packaging/keyfold-backup.service packaging/keyfold-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now keyfold-backup.timer
```

The timer runs daily with a randomized delay of up to 30 minutes and catches
up after downtime. Archives are in `/var/lib/keyfold-backups`, a directory with
mode `0700`. Each successful run keeps the 14 most recent archives, named
`keyfold-YYYYMMDDTHHMMSSZ.tar` in UTC. Copy archives off the machine regularly
to a separate storage location with restricted access.

For a manual run, use `keyfold-backup` with an account that can read the vault
and write into the backup directory. `KEYFOLD_DATA_DIR`, `KEYFOLD_BACKUP_DIR`,
and `KEYFOLD_BACKUP_KEEP` override the default vault directory (`/var/lib/keyfold`),
backup directory, and retention count.

## Reverse proxy requirements

The proxy must pass the original `Host`, whose name must be listed in
`KEYFOLD_ALLOWED_HOSTS`. It must append the connecting client's IP address to
`X-Forwarded-For`.

If a proxy on the same machine replaces `Host` with the loopback upstream and
sends no forwarding headers, Keyfold treats remote requests as local. Remote
clients can then create the vault without the install token, bypass per-client
rate limits, and retrieve the encrypted identity without enabling TOTP.

Caddy's `reverse_proxy`, used in this kit, does both by default. For nginx, set
these directives in the proxy location.

```nginx
proxy_set_header Host $host;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
```

Once Keyfold is running, check both from another device through the proxy before
you create the vault.

1. Send `GET /api/v1/alive`. HTTP 404 confirms that Keyfold treats the request
   as remote.
2. Send `GET /api/v1/status` because the alive probe is logged at debug level.
   Read the server access log with `docker compose -f packaging/compose.yml logs vault`
   for Compose or `journalctl -u keyfold` for systemd. The request's `client`
   field must show the device's IP address, confirming Keyfold uses the
   forwarded address. `127.0.0.1` or `::1` indicates the proxy's loopback address.
