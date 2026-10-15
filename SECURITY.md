# Security

Human Use is a single-user application designed to run on the same machine as
its browser and API client. It binds to 127.0.0.1, checks Host and Origin, and
uses a local Bearer token for AI API requests. The browser session and API token
are workflow boundaries, not independent proof of a person's identity.

Keep the service on the loopback interface. Public hosting, reverse proxies,
shared access, and multi-user deployments are outside the current supported scope.

The data directory contains work orders, evidence, archive packages, and an
API token. Back up and protect the whole directory as private data. Git ignore
rules reduce accidental inclusion; inspect staged files before publishing.

Connecting a cloud AI client can send the contents it reads to that client's
model provider. Local application storage does not make an external AI client local.
Package hashes check content consistency; they do not prove physical actions,
sign a person's identity, or protect against an attacker who controls the machine.

## Reporting a vulnerability

If the repository's Security tab offers **Report a vulnerability**, use that
private channel. Otherwise, open an issue requesting a private reporting channel
without including exploit details, tokens, work orders, or private attachments.
There is no published response-time guarantee. Fixes target the current main branch.
