# Security Policy

## Supported versions

Security fixes are applied to the **latest released version** on npm. Older
versions are not maintained — please upgrade to the latest release before
reporting an issue.

| Version        | Supported          |
| -------------- | ------------------ |
| latest release | :white_check_mark: |
| older          | :x:                |

## Reporting a vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, report them privately through GitHub's
[**Private Vulnerability Reporting**](https://github.com/apachler/gree-hvac-client/security/advisories/new):

1. Go to the **Security** tab of the repository.
2. Click **Report a vulnerability**.
3. Provide a clear description, affected versions, and reproduction steps.

> Maintainer setup: enable *Settings → Code security → Private vulnerability
> reporting* so the link above is active.

You can expect an initial acknowledgement within **5 business days**. Once the
issue is confirmed and a fix is prepared, we will coordinate a release and credit
you in the advisory (unless you prefer to remain anonymous).

## Scope & threat model

This library speaks Gree's UDP/AES LAN protocol to air-conditioner units. Things
worth keeping in mind when assessing reports:

- The Gree protocol uses **vendor-fixed generic keys** (`a3K8Bx%2r8Y7#xDh` for
  AES-ECB, `{yxAHAY_Lm6pbC/<` for AES-GCM) for the discovery/bind handshake.
  These are part of the documented protocol, **not** secrets — every Gree client
  and device ships them. After `bindok` both sides switch to a per-device key.
- The protocol has **no transport authentication** beyond the bind key
  exchange. Run it on a trusted LAN segment; do not expose device UDP ports to
  untrusted networks.
- This is a **client library**: it opens a UDP socket and sends/receives
  datagrams. It does not listen on privileged ports, write to disk, or execute
  remote input. Untrusted input arrives only as datagrams from the device.

Reports about the fixed generic keys (which are inherent to the Gree protocol
and shared by all implementations) are considered **out of scope**.
