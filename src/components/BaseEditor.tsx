import React, { useState } from 'react';
import { Database, Code, Eye, FileSpreadsheet } from 'lucide-react';
import { BaseView } from './BaseView';
import { useTranslation } from '../i18n';

export interface BaseEditorProps {
  filePath: string;
  rawContent: string;
  onChange: (newYaml: string) => void;
  onSelectNote: (path: string) => void;
  allFiles: any[];
  onCellChange?: (notePath: string, key: string, value: any) => Promise<void>;
}

export const BaseEditor: React.FC<BaseEditorProps> = ({
  filePath,
  rawContent,
  onChange,
  onSelectNote,
  allFiles,
  onCellChange,
}) => {
  const { t } = useTranslation();
  const [editorMode, setEditorMode] = useState<'visual' | 'source'>('visual');

  const fileName = filePath.split('/').pop() || filePath;

  return (
    <div className="base-editor-container">
      {/* Base Editor Topbar */}
      <div className="base-editor-topbar">
        <div className="base-editor-title-cluster">
          <Database size={16} className="base-icon" />
          <span className="base-file-title" title={filePath}>
            {fileName}
          </span>
          <span className="file-ext-badge base-badge">BASE</span>
        </div>

        <div className="base-editor-mode-toggle">
          <button
            type="button"
            className={`mode-toggle-btn ${editorMode === 'visual' ? 'active' : ''}`}
            onClick={() => setEditorMode('visual')}
          >
            <Eye size={13} />
            <span>{t('base.visualView') || 'Visuelle Ansicht'}</span>
          </button>
          <button
            type="button"
            className={`mode-toggle-btn ${editorMode === 'source' ? 'active' : ''}`}
            onClick={() => setEditorMode('source')}
          >
            <Code size={13} />
            <span>{t('base.sourceView') || 'YAML-Quelltext'}</span>
          </button>
        </div>
      </div>

      {/* Editor Body */}
      <div className="base-editor-body">
        {editorMode === 'visual' ? (
          <BaseView
            yamlContent={rawContent}
            allNotes={allFiles}
            onSelectNote={onSelectNote}
            onCellChange={onCellChange}
            className="base-editor-visual-view"
          />
        ) : (
          <div className="base-source-editor">
            <textarea
              className="base-source-textarea"
              value={rawContent}
              onChange={(e) => onChange(e.target.value)}
              placeholder={'filters:\n  file.inFolder("Projekte")\nviews:\n  - type: table\n    name: "Übersicht"'}
              spellCheck={false}
            />
          </div>
        )}
      </div>
    </div>
  );
};
