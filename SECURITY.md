# Security Policy

## Supported versions

Only the latest 0.x release receives security fixes.

## Reporting a vulnerability

Open the [Security tab](https://github.com/dev-toolings/keyfold/security) and
select **Report a vulnerability** to submit a private report. Do not use a
public issue.

Include the affected version, steps to reproduce the vulnerability, and its
impact. Use test data in the report and leave out real vault secrets.

The maintainer will acknowledge your report, investigate it, and work on a fix
for confirmed vulnerabilities. If you would like credit in the advisory,
include that preference in your report.

## Scope

The Go server, `kf` CLI, `kf mcp` server, and React web UI are in scope,
including the encryption and session behavior described in the README's
[Security model](README.md#security-model). This covers client-side age
encryption, the vault identity wrapped with the master password, and
in-memory sessions established by decrypting a challenge.

### Out of scope

- An already compromised machine or an attacker with access to an unlocked
  session.
- A stolen disk. The server stores the TOTP secret in cleartext in
  `data/totp.json`. TOTP does not protect a stolen disk.
- Weak master passwords.
- Content on the public product site.
