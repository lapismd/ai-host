# Changesets

Use Changesets for public `@lapismd/ai-host` releases.

```sh
pnpm changeset
```

The release workflow creates a Version Packages pull request on `main` when
pending changesets exist. After that PR merges, the workflow builds a verified
tarball artifact. The first npm publication is manual because
`@lapismd/ai-host` is not yet registered on npm; later versions use npm trusted
publishing from `.github/workflows/release.yml`.
