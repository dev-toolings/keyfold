# Reach Keyfold over Tailscale

This guide makes a self-hosted Keyfold vault reachable from your own devices
only (home network, phone on mobile data, laptop away from home) without
exposing it to the Internet. Tailscale builds a private encrypted network
between the devices signed in to your account. The vault host stays invisible
to everyone else.

It assumes a host installation from `packaging/README.md`: `keyfold.service`
on `127.0.0.1:8717` behind Caddy. Replace the placeholders:

| Placeholder | Meaning | How to find it |
|---|---|---|
| `<ts-name>` | The vault host's Tailscale name, such as `keyfold-lan.tail1234.ts.net` | `tailscale status --json \| jq -r .Self.DNSName` (drop the final dot) |
| `<ts-ip>` | The vault host's Tailscale IPv4 address | `tailscale ip -4` |

## 1. Prepare the Tailscale account

In the Tailscale admin console, under DNS, turn on MagicDNS and HTTPS
Certificates. Caddy needs both to serve `<ts-name>` with a trusted
certificate.

## 2. Install Tailscale on the vault host

```sh
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
tailscale ip -4
tailscale status --json | jq -r .Self.DNSName
```

`tailscale up` prints a login URL: open it and sign in with your account.

Let Caddy fetch the certificate from the local Tailscale daemon, then restart it:

```sh
echo 'TS_PERMIT_CERT_UID=caddy' | sudo tee -a /etc/default/tailscaled
sudo systemctl restart tailscaled
```

## 3. Serve the vault on the Tailscale name

Add a site block to `/etc/caddy/Caddyfile` next to the existing one. It
answers only on the Tailscale address and refuses any client outside the
tailnet ranges:

```caddyfile
https://<ts-name> {
	bind <ts-ip>

	@outside not remote_ip 100.64.0.0/10 fd7a:115c:a1e0::/48
	respond @outside 403
	reverse_proxy 127.0.0.1:8717
}
```

Caddy recognizes the `ts.net` name and gets its certificate from Tailscale (Caddy
2.5 or later). Keep Caddy as the proxy rather than `tailscale serve`: Caddy
passes the original `Host` and appends the client IP to `X-Forwarded-For`, which
Keyfold needs to tell remote clients from local ones (see "Reverse proxy
requirements" in `packaging/README.md`).

The `bind` line fails if Caddy starts before Tailscale has its address. Order
the two services and let Caddy retry:

```sh
sudo systemctl edit caddy.service
```

```ini
[Unit]
After=tailscaled.service
Wants=tailscaled.service

[Service]
Restart=on-failure
RestartSec=5s
```

## 4. Accept the new host name in Keyfold

Keyfold answers only the host names in `KEYFOLD_ALLOWED_HOSTS`. Add
`<ts-name>` to the existing value in `/etc/systemd/system/keyfold.service`,
separated by a comma:

```ini
Environment=KEYFOLD_ALLOWED_HOSTS=vault.example.internal,<ts-name>
```

```sh
sudo systemctl daemon-reload
sudo systemctl restart keyfold.service caddy.service
```

## 5. Add your devices

- **iPhone or Android**: install the Tailscale app and sign in with the same
  account. On iOS, Settings > VPN > Tailscale > Connect On Demand keeps the
  tunnel up when you leave the home network.
- **Laptop or desktop**: install Tailscale from <https://tailscale.com/download>
  and sign in, or run `sudo tailscale up` on Linux.
- **CLI**: point `kf` at the new name, for example
  `export KEYFOLD_SERVER=https://<ts-name>`.

## 6. Check

From a device in the tailnet, on mobile data with Wi-Fi off:

```sh
curl -s https://<ts-name>/api/v1/status
```

The answer is `{"initialized":...,"totp":...,"emailSetup":...}` with no
certificate warning. Then open `https://<ts-name>` in the browser. From a
device outside the tailnet, the name does not resolve or the connection times
out.

Before you create the vault through this name, run the two proxy checks from
"Reverse proxy requirements" in `packaging/README.md`.

## 7. Restrict the tailnet (optional)

By default, every device in the tailnet can reach every other. To let only
your own devices reach the vault, tag the host and limit port 443 to your
user in the tailnet policy file (admin console, Access controls):

```json
{
  "tagOwners": { "tag:keyfold": ["autogroup:admin"] },
  "grants": [
    { "src": ["autogroup:member"], "dst": ["autogroup:self"], "ip": ["*"] },
    { "src": ["autogroup:admin"], "dst": ["tag:keyfold"], "ip": ["tcp:443"] }
  ]
}
```

The policy syntax evolves: check it against Tailscale's access control
documentation before saving. Then tag the host with `sudo tailscale up --advertise-tags=tag:keyfold`.
Tagging a host signs it out of your user, so keep SSH access through the home
network until you have checked the result.
