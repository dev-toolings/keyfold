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

Once Keyfold is running, send `GET /api/v1/alive` through the proxy from another
device. It must return HTTP 404. Keyfold returns HTTP 200 only for a local
request, so a 200 means the proxy is hiding the remote client and must be fixed
before you create the vault.
