# Agent Instructions for Knowmesh

## Mandatory Startup Routine
1. Always read the documentation in `doc/` (`README.md`, `ARCHITECTURE.md`, `API_AND_TYPES.md`, `FRONTEND_AND_EDITOR.md`, `LLM_DEVELOPER_GUIDE.md`) before modifying any code[cite: 1].
2. Never modify or delete files in the real user vault (`vault/`)[cite: 1].

## Mandatory Completion Routine (Definition of Done)
1. Run `npx vitest run` and ensure all tests pass (Exit Code 0)[cite: 1].
2. Run `npm run build` to verify the production bundle[cite: 1].
3. Update the documentation in `doc/` if any architecture, API, or UI component changed.
4. Create a clean, descriptive Git commit following Conventional Commits.
