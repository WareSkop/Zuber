### Added

### Changed

### Fixed
- **Upload & Download Pfadprüfung:** Falsch-positive Abweisungen von regulären Dateien und Notizen mit doppelten Punkten im Dateinamen (z. B. Notiztitel mit Auslassungszeichen `..`) behoben, indem nur noch echte Pfad-Traversierungs-Segmente (`..`) geprüft werden statt pauschal `includes('..')`.
