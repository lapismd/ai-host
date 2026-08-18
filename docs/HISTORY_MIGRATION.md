# History Migration

## Boundary and source

- Source repository: `lapismd/lapis-notes`
- Extraction boundary: `7e61dc7d42f47ff1b24b29c7b2d2774912dd3bd9`
- Temporary exported source bookmark: `ai-host-extraction-base`
- Filtered repository: `lapismd/ai-host`
- Filtered initial `main`: `88bbd5ae5084e432b1819139c2ad64576963fc09`

## Filter rules

The fresh temporary clone selected every historical path explicitly because
`git-filter-repo` does not infer renames:

- `packages/ai-host/` to the repository root

No filtering ran in either working repository. Mixed Lapis specification
chapters were not filtered; host-owned requirements were copied into this
repository as `AH-*` IDs after the extract.

## Representative mappings

| Source commit | Filtered commit | Meaning |
| --- | --- | --- |
| `cfac44b739b131774f0432d93aa84186931b6069` | `88bbd5ae5084e432b1819139c2ad64576963fc09` | Verify remote app-tool bridge |
| `5fc5620e341768016c451d3ecfde540818072d7a` | `d576898d8024aa4556fc749cc8364aa236839165` | Integrate app tools with native agent bindings |
| `3d9e0aba3cedcf01b427d75fe25aa6fd0f7bf83b` | `ccacd6fae0acc04a55519086ad634b15a75c644a` | Add a standalone ai-host |

## Requirement ID mapping

| Source ID | Standalone ID | Chapter |
| --- | --- | --- |
| LN-PKG-069 | AH-PKG-001 | architecture |
| LN-PKG-080 / LN-ARCH-060 host half | AH-PKG-002 | architecture |
| LN-AI-042 | AH-CLI-001 | protocol |
| LN-AI-043 | AH-WS-001 | protocol |
| LN-AI-044 host half | AH-WS-002 | protocol |
| LN-DESK-040 | AH-WS-003 | protocol |
| LN-AI-074 / LN-DESK-043 host half | AH-PROTO-001 | protocol |
| LN-AI-061 | AH-ACP-001 | executor |
| LN-AI-067 / LN-DESK-039 | AH-ACP-002 | executor |
| LN-DESK-034 / LN-DESK-035 | AH-ACP-003 | executor |
| LN-DESK-046 / LN-DESK-047 host half | AH-MCP-001 | executor |

## Audit

- Source commits touching the selected paths at the boundary: 8
- Filtered commits on initial `main`: 8
- Files at the filtered tip: 29
- `git fsck --full`: passed
- `git log --follow -- src/index.ts`: retains the host implementation lineage
- `.git/filter-repo/commit-map`: retained locally for the complete mapping

The source package must not be removed from Lapis until the standalone package,
history audit, and consumer cutover are verified.
