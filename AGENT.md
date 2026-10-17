# AGENT INSTRUCTIONS FOR KNOWMESH

## 1. Startup Routine
- Always read the documentation in `doc/` before modifying code.
- Never modify or delete files in the real user vault (`vault/`).

## 2. Definition of Done (DoD)
- Run `npx vitest run` and ensure all tests pass (Exit Code 0).
- Run `npm run build` to verify the production bundle.
- Update documentation in `doc/` if architecture, APIs, or UI change.
- Follow Conventional Commits for all Git messages (`feat:`, `fix:`, `chore:`, `refactor:`).

## 3. Versioning & Changelog Workflow (Temporary Changelog & Release Command)
- **Temporary Changelog (`CHANGELOG-UNRELEASED.md`):** 
  - Every time code is modified, added, or a bug is fixed, the agent MUST automatically append a short bullet point describing the change into an unreleased temporary changelog file named `CHANGELOG-UNRELEASED.md` (grouped under `### Added`, `### Fixed`, `### Changed`).
- **Release Command (`Create new version <VERSION>`):**
  - When the user explicitly requests a new version release (e.g., "Create version 0.2.0"), the agent must:
    1. Read all entries from `CHANGELOG-UNRELEASED.md`.
    2. Move and format them into the official `CHANGELOG.md` under a new heading with the current date (e.g., `## [0.2.0] - YYYY-MM-DD`).
    3. Clear/empty `CHANGELOG-UNRELEASED.md`.
    4. Update the version number in `package.json`.
    5. Commit, tag (e.g., `v0.2.0`), push to Codeberg, and update the Docker image via script.
