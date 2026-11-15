# AGENT INSTRUCTIONS FOR ZUBER

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
- **Normal Development & Bugfixes (Branch Pushes):**
  - Bei normalen Bugfixes und Feature-Entwicklungen wird normal auf den Branch gepusht (`git push origin main`). Dadurch erzeugt GitHub Actions automatisch das Test- und Entwicklungs-Image `ghcr.io/wareskop/zuber:dev`. Pushes auf Branches überschreiben NIEMALS das `:latest`-Image.
- **Release Command (`Create new version <VERSION>` / z. B. "Erstelle Version 0.3.0"):**
  - Erst beim expliziten Befehl zur Versionserstellung führt der Agent folgende Schritte aus:
    1. Read all entries from `CHANGELOG-UNRELEASED.md`.
    2. Move and format them into the official `CHANGELOG.md` under a new heading with the current date (e.g., `## [0.3.0] - YYYY-MM-DD`).
    3. Clear/empty `CHANGELOG-UNRELEASED.md`.
    4. Update the version number in `package.json`.
    5. Commit the release changes (e.g., `git commit -m "chore(release): bump version to 0.3.0"`).
    6. Tag the release: `git tag -a v0.3.0 -m "Release v0.3.0"`.
    7. Push branch and tag to GitHub: `git push origin main --tags`. Dadurch baut GitHub Actions das offizielle Release-Image `ghcr.io/wareskop/zuber:latest` sowie das versionierte Image `ghcr.io/wareskop/zuber:0.3.0`.

## 4. Demo Vault & User Wiki Maintenance (Mandatory for Every New Feature)
- **Public Demo Vault (`vault/`):**
  - `vault/` is tracked in Git and serves as the out-of-the-box onboarding vault seeded on fresh installations when `VAULT_DIR` is empty.
  - NEVER commit private user notes, secrets, or `.env` files into `vault/`.
  - Whenever a new user-facing feature, syntax, or workflow is added, update or add a concise, self-explanatory example in `vault/` demonstrating how to use it.
- **User Manual & GitHub Wiki (`docs/wiki/`):**
  - Whenever a new feature or significant UI change is implemented, update the corresponding chapter(s) in `docs/wiki/` (`Home.md`, `_Sidebar.md`, and numbered guides) and regenerate affected screenshots in `docs/wiki/images/` using `scripts/generate-manual-screenshots.mjs` (running against a temporary copy in `os.tmpdir()`).
  - Push updated Wiki pages and images to `https://github.com/WareSkop/Zuber.wiki.git` when Git credentials are available.
