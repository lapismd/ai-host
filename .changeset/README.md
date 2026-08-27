# Changesets

Use Changesets for public `@lapismd/ai-host` releases.

```sh
pnpm changeset
```

The release workflow creates a Version Packages pull request on `main` when
pending changesets exist. After that PR merges, the workflow builds a verified
tarball artifact. `@lapismd/ai-host@0.1.0` has been manually bootstrapped on
npm; later versions use npm trusted publishing from
`.github/workflows/release.yml` once the trusted publisher is configured.
