# Security policy

Please report suspected vulnerabilities privately through GitHub's
**Security → Report a vulnerability** flow for this repository. Do not open a
public issue containing credentials, player links, private keys, database
exports, world snapshots, or reproduction data from a real installation.

Player links contain a bearer secret that can reveal private island state.
Treat them like passwords. Owner mutations are additionally protected by the
Ed25519 key stored locally at `~/.claudilization/key.pem`.

Only the latest commit on the default branch is supported. Reports should
include the affected commit, impact, and a minimal reproduction using a local
throwaway world.
