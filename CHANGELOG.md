# Changelog

This changelog follows Keep a Changelog and uses Semantic Versioning.

## [0.1.0] - Unreleased

### Added

- Self-hosted Go vault server with a versioned HTTP API and manual backup and restore.
- React vault UI for logins, API tokens, notes, and SSH keys, with custom fields,
  attachments, restorable value history, live TOTP codes, and vault health checks.
- `kf` CLI for vault management, password and passphrase generation, secret references,
  environment injection, and config templating.
- Imports from Keyfold, Bitwarden JSON, 1Password 1pux, and CSV. Exports to Keyfold and
  Bitwarden JSON with optional passphrase encryption.
- `kf mcp` over standard input and output for listing items, generating secrets,
  and reporting vault health without returning secret values or notes.
- Static product site in French and English.
- Loopback-only `GET /api/v1/alive` probe without a session or rate limit.
- Build version reporting through `keyfold-server -version`, `kf version`, MCP
  server metadata and `GET /api/v1/health`.
- Container image, Compose example with Caddy and a systemd unit.
- Tag-triggered release workflow for binary archives, checksums and container images.
- Daily systemd backup timer with local rotation, keeping up to 14 archives by default.

### Security

- Client-side age encryption for items and attachments using an X25519 vault
  identity wrapped with the master password using scrypt.
- Private HTTPS access through a same-machine reverse proxy and declared hosts.
- Content Security Policy, frame and MIME-sniffing protections, no referrer,
  no API caching and HSTS on declared non-loopback hosts.
- Single-use install token for vault creation outside direct loopback access.
- Email setup: with `KEYFOLD_OWNER_EMAIL` and SMTP settings, a code emailed to
  the owner lets another device create the vault and turn TOTP on, without the
  install token or an SSH tunnel.
- One `kf` agent per server URL: a local and a remote vault can be unlocked at
  the same time, for example by two MCP servers.
- In-memory challenges expire after 60 seconds. Sessions expire after 15 minutes
  of inactivity or 12 hours from creation.
- Encrypted identity downloads outside direct loopback access require TOTP to be
  enabled. With TOTP on, a valid code or live session is required to download it.
- In-memory TOTP replay protection, per-client TOTP lockouts and per-IP limits
  on remote calls to session-free vault routes.
- Opt-in breach checks that send only the first five characters of each password's
  SHA-1 hash to the Have I Been Pwned range API.
