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
Point that proxy at `127.0.0.1:8717`.

```sh
sudo systemctl enable --now keyfold.service
```

On first start the server logs the install token you need to create the vault
from another device.
