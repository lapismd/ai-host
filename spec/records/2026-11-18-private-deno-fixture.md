# Private Deno ACP fixture retirement

Base: `5a323bc5435eb82f682ff89d285fb0258b3470a4`.
Initial qualified source snapshot: `fd5ae8f59d510d777ae49b71edd7862a204f0b6c`.
Withdrawal requalification snapshot: `d554aac346ee5978eb147ef04e8ae27d3e3686a8`.
AH-OPS-001 and AH-PKG-001 remain unchanged. This slice removes only
`tests/fixtures/acp-agent.ts`, the orphan private Deno stdin/stdout fixture from
an old operator-smoke lane. Root-only spec-validator advances from 0.2.0 to
Deno-free 0.2.1 as required before canonical checks. pnpm remains 10.32.1.

## Before/after usage and package boundary

Tracked-source searches in AI Host, AI Controller, Notes and Desktop find no
caller of the fixture path. TypeScript compiles `src`, Vitest collects `src` and
`scripts`, and the bundle entries name the public root, client, file-tools and
private MCP shim. None collects this fixture. The explicit published file list
excludes it. No mirrored file-absence test was added.

The current real acpx residency test uses its Node subprocess fixture and remains
active. AI Controller still imports execution, registry, process and MCP exports;
Notes API still imports the portable file-tools leaf. The public `deno-desktop`
bridge identity is retained. No library function, future API, service or
controller implementation is classified as removable by caller count.

Deno configuration/lock, `engines.deno`, package manager, public exports, runtime
dependencies, bridge identity and historical evidence are unchanged. The only
lock resolution change is spec-validator 0.2.0 to 0.2.1 and its integrity.

Both exact-main and candidate build/pack pass. Their 144-file tarballs differ
only in `package.json` (the development-tool pin) and the Architecture/verification
chapters.
All 129 built JavaScript/declaration files are byte-identical; both original and
candidate packages omit the private fixture. The independently installed
candidate archive passes root/client/file-tools imports, controller registry and
executor construction, and real in-memory file-tool write/read/edit acceptance.
This is portable public-export acceptance, not execution of a Deno controller,
a native app, real provider turn or service replacement.

## Source qualification

All product commands run in the exact tracked snapshot in a fresh omarchy Docker
worker, two CPUs/4 GiB, separate before/candidate pnpm stores, no host dependency
transfer, sibling override or cross-workspace cache. Node is 24.15.0 and pnpm is
10.32.1. The exact-main and candidate library-boundary/declaration/file-tools focus each
pass 14 cases;
all 156 tests across 29 files pass. Full `pnpm spec:check` passes its five lanes
(validation, architecture, tests, mdBook and exact-base spec-first). Explicit
architecture, type, build and publint commands pass separately. The owner
`packages:pack` command passes but selects no unpublished version; the separate
actual tarball builds and clean consumer above supply package-byte evidence.

The original full `pnpm check` exited 1 at its audit prefix. Running the
non-audit constituents separately did not replace or qualify that gate. After
the advisory withdrawal described below, the exact 14-case regression and the
ordinary audit, check, specification, architecture, type, test, build, publint,
pack and packed-consumer lanes all pass. Doctor passes; search explicitly falls
back to text because QMD is disabled. No discovery alias or unrelated tool
configuration is added.

The first withdrawal-requalification orchestration stopped before product
commands because the retained isolated worker already contained its validation
checkout. The ignored local harness was corrected to reuse that checkout; the
source, command matrix and assertions were unchanged. The replay above then
passed in the same isolated worker with no host fallback.

## Withdrawn advisory and preserved failed audit

The initial exact unchanged-main and candidate full audits both failed solely on high
GHSA-fc5q-39xc-vjpf / CVE-2026-112366:

- Picomatch 2.3.2 through Changesets/config/micromatch.
- Picomatch 4.0.7 directly through Vitest.

Both original production audits passed with zero findings. GitHub withdrew the
advisory at `2026-11-18T15:38:56Z`; it has no patched release and Picomatch 4.0.7
remains the latest npm version, but the registry no longer returns the advisory
to pnpm. On 2026-11-19, unchanged-main and candidate full and production audits
all exit zero with no findings. Existing recorded Changesets CVE exceptions are
unchanged. The ignored owner-specific proposal remains unapplied and is not part
of the candidate: a withdrawn finding must not create permanent exception
policy.

Raw source packs, command logs, archive equivalence, current registry metadata
and the unapplied proposal remain in `.local/deno-fixture/` in this isolated
retirement workspace. A transient SSH-agent signing warning was retained during
transport; the eventual product commands ran successfully inside Docker. No host
fallback occurred.

The [compact receipt](2026-11-18-private-deno-fixture.json) preserves the failed
gate and its exact paths alongside the later withdrawal and clean ordinary gate.
Push, hosted CI and publication remain unqualified; no runtime or audit policy is
changed by this receipt.
