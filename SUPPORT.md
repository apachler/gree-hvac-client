# Support

Thanks for using **gree-hvac-client**! Here's where to get help.

## Questions & how-to

- **General questions, setup help, "how do I…"** — open a
  [GitHub Discussion](https://github.com/apachler/gree-hvac-client/discussions)
  if Discussions are enabled, otherwise a
  [question issue](https://github.com/apachler/gree-hvac-client/issues/new/choose).
- **Usage** — the [README](README.md) documents every property/value and links
  the generated API reference. The [`example/`](example/) folder has runnable
  scripts (promises, async/await, polling, setting properties).
- **Protocol / property questions** ("what does `blow` do?", the `TemSen +40`
  quirk, value maps) — the full reference is in
  [`docs/PROTOCOL.md`](docs/PROTOCOL.md).

## Reporting bugs & requesting features

Use the [issue templates](https://github.com/apachler/gree-hvac-client/issues/new/choose).
A good bug report includes:

- the package version (`npm ls gree-hvac-client`) and Node.js version,
- your Gree model / firmware if known,
- a minimal reproduction (the `example/` scripts are a good starting point),
- relevant logs — set `logLevel` / `GREE_HVAC_LOG_LEVEL=debug` to capture the
  protocol exchange (redact IPs/MACs if needed).

## Security issues

Do **not** open a public issue for vulnerabilities. Follow [SECURITY.md](SECURITY.md).

## Commercial / unattended deployments

This project is maintained on a best-effort basis by volunteers. There is no
paid support tier. If you depend on it for unattended 24/7 operation, pin a
specific version and test upgrades before rolling them out.
