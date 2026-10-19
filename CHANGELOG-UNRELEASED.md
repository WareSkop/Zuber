### Added
- **Type-to-Edit für ausgewählte Canvas-Knoten (`CanvasEditor.tsx` & `CanvasShapeNode.tsx`):** Beim Tippen eines druckbaren Zeichens auf einem einzeln ausgewählten Form- oder Text-Knoten wird sofort der Inline-Editor geöffnet, der Cursor ans Textende gesetzt und das getippte Zeichen angehängt. Shortcuts wie `Ctrl+Z`, `Space` (Pan) und `Delete` bleiben uneingeschränkt funktionsfähig.

### Changed

### Fixed
- **Pfeilrichtung bei automatischer Knotenerstellung im Canvas (`CanvasEditor.tsx`):** Der Ursprungsknoten ist beim Droppen auf die freie Canvas-Fläche nun strikt als `source` und der neu erzeugte Knoten als `target` definiert, sodass die Pfeilspitze (`markerEnd`) immer verlässlich auf den neuen Knoten zeigt – selbst wenn der Drag an einem als Target typisierten Handle des Ursprungsknotens gestartet wurde.
- Dynamisches Andocken an die nächstgelegene Kante bei Auto-Erstellung von Knoten im Canvas (`CanvasEditor.tsx` via `onConnectEnd`): Berechnet den Richtungsvektor zwischen dem Ursprungsknoten und dem neu erstellten Knoten und weist der Verbindungslinie dynamisch die dem Ursprung zugewandte Seite (`top`, `bottom`, `left` oder `right`) als `targetHandle` zu, um störende Linienüberlappungen zu verhindern.
