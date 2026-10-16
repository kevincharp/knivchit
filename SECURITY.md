# Security policy

**English** | [Español](SECURITY.es.md)

## How to report a vulnerability

**Do not open a public issue.** Use GitHub's private vulnerability reporting: at <https://github.com/kevincharp/knivchit>, tab **Security** → **Report a vulnerability**. Only the maintainers can see it. There is deliberately no email address for this.

Include, if you can: version, GNOME Shell version, steps to reproduce, what an attacker gains, and a minimal proof. **Do not paste your clipboard contents or screenshots with personal data.**

## What to expect

| Time | What |
|---|---|
| 3 business days | acknowledgment |
| 10 business days | first assessment: whether it is valid, severity and plan |
| 90 days at most | fix released, or we agree a date with you |

This is a volunteer-maintained project: these are good-faith targets, not a contract. With your permission we credit you in the fix notes. Please don't disclose it until there is a fix or 90 days have passed.

## Supported versions

Only the **latest published version**, currently an early preview (alpha). It is not stable software: bugs and breaking changes between versions are possible.

## Scope and trust model

What the project promises:

- Everything is **local**: no accounts, no server, no telemetry. The app's only connection is "Check for updates", only when the user clicks it (it queries the repository's releases); the extension never uses the network. The installer also queries the releases.
- The installer **verifies the SHA-256 sums** (`SHA256SUMS`) of what it downloads before installing anything.
- The interface loads no remote content while Tauri commands are exposed.
- Clipboard contents are never written to any log.
- The extension grabs the keyboard **only while you record a shortcut**, and uses only the final combination.

What it does **not** protect against (known limits, not vulnerabilities):

- **Anyone who can run code as your user can read your local data.** The project's trust model assumes your user account is not compromised.
- **The D-Bus session bus is not confidential against other processes of your own user.** Any program running as you can call the app's and the extension's methods (for example, start a capture) or read the signals. The project does not try to defend against code already running as your user. For that reason, sensitive content (such as clipboard contents, once clipboard history exists) will travel over a private channel, not over the bus.
- An attacker with access to your account or disk can read saved captures and the local database.
- A GNOME Shell extension runs inside the Shell with its privileges: that is inherent to the platform.

In scope, for example: code execution or file reads from untrusted content, escaping the Tauri command model, bypassing the installer's checksum verification, writing outside the captures folder, leaking clipboard contents to logs or network, and privilege escalation through the extension.

Out of scope: vulnerabilities in GNOME, Tauri, WebKitGTK or dependencies (report them upstream; tell us if they affect us specially), social engineering, and attacks that already require control of the user.

## Future improvements

- **Verify release authenticity.** Today the installer checks the SHA-256 against `SHA256SUMS`, which catches a corrupt download but not a tampered release (the sums travel next to the files). The plan is to add **GitHub artifact attestations** to the packaging, so the installer or the user can verify them with `gh attestation verify`, preferring that to managing our own signing keys. Not done yet: until then, integrity rests on the repository account and on HTTPS.
