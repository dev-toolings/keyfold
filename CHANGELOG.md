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

### Security

- Client-side age encryption for items and attachments using an X25519 vault
  identity wrapped with the master password using scrypt.
- In-memory API sessions that require a cryptographic challenge and expire after inactivity.
- Optional TOTP protection for encrypted vault identity retrieval, with replay protection
  and per-client lockouts for repeated failures.
- Opt-in breach checks that send only the first five characters of each password's
  SHA-1 hash to the Have I Been Pwned range API.
