### Added

### Changed

### Fixed
- Dynamisches Andocken an die nächstgelegene Kante bei Auto-Erstellung von Knoten im Canvas (`CanvasEditor.tsx` via `onConnectEnd`): Berechnet den Richtungsvektor zwischen dem Ursprungsknoten und dem neu erstellten Knoten und weist der Verbindungslinie dynamisch die dem Ursprung zugewandte Seite (`top`, `bottom`, `left` oder `right`) als `targetHandle` zu, um störende Linienüberlappungen zu verhindern.
