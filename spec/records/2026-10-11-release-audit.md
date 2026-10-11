# AI Host 0.3.0 release audit

Registry installation, specification, architecture, types, 156 unit tests,
build, publint, tarball inspection, and a cold installed consumer pass. The
packed production dependency graph reports zero vulnerabilities.

The complete development lockfile still reports two unpatched findings:

| Advisory                             | Package          | Path                                                           | Status                              |
| ------------------------------------ | ---------------- | -------------------------------------------------------------- | ----------------------------------- |
| CVE-2026-93687 / GHSA-vfj7-8cjw-p6xm | braces 3.0.3     | Changesets CLI → Changesets config → micromatch                | Accepted by user on 11 October 2026 |
| CVE-2026-97058 / GHSA-hp3w-g68c-fv3c | sprintf-js 1.0.3 | Changesets CLI → manypkg → read-yaml-file → js-yaml → argparse | Accepted by user on 11 October 2026 |

Both findings are tooling denial-of-service issues reached through repository
configuration parsing. Neither package enters the published AI Host runtime.
The registry reports no patched version. Any accepted exception must remain
recorded, be reviewed for the next release, and be removed when upstream fixes
become available. The exact CVE exceptions are recorded in pnpm-workspace.yaml after explicit user acceptance.

The fixable MCP SDK, URI, IP address, source-map, and proxy address findings
are resolved through the declared SDK range and recorded workspace overrides.
The complete audit gate must pass with only those accepted tooling exceptions.
