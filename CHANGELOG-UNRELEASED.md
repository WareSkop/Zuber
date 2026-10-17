### Changed
- Enhanced Docker publication script to automatically tag and push both `:latest` and `:v<version>` packages to Codeberg Container Registry.

### Fixed
- Fixed new devices (e.g., Chromebook) showing an empty offline Vault after login and failing to sync newly created notes to the server because `SyncEngine` remained in `offline` state after authentication.
- Fixed offline mode file & folder creation where creating a second note or folder could collide with default names, get delayed by pending auto-save timers or network timeouts, or fail to reconcile into the local IndexedDB file tree.
