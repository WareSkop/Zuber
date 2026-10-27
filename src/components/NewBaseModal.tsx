import React, { useState } from 'react';
import { Database, Folder, Tag, Table as TableIcon, LayoutGrid, X } from 'lucide-react';
import { useTranslation } from '../i18n';

export interface NewBaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (options: {
    name: string;
    folder: string;
    scope: 'folder' | 'tag' | 'all';
    scopeValue?: string;
    viewType: 'table' | 'cards';
  }) => Promise<void>;
  initialFolder?: string;
  vaultFolders: string[];
  vaultTags: string[];
}

export const NewBaseModal: React.FC<NewBaseModalProps> = ({
  isOpen,
  onClose,
  onCreate,
  initialFolder = '',
  vaultFolders,
  vaultTags,
}) => {
  const { t } = useTranslation();

  const [name, setName] = useState('');
  const [folder, setFolder] = useState(initialFolder);
  const [scope, setScope] = useState<'folder' | 'tag' | 'all'>('folder');
  const [scopeFolder, setScopeFolder] = useState(initialFolder || vaultFolders[0] || '');
  const [scopeTag, setScopeTag] = useState(vaultTags[0] || '');
  const [viewType, setViewType] = useState<'table' | 'cards'>('table');
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const finalName = name.trim();
    if (!finalName) return;

    setIsSubmitting(true);
    try {
      await onCreate({
        name: finalName,
        folder,
        scope,
        scopeValue: scope === 'folder' ? scopeFolder : scope === 'tag' ? scopeTag : undefined,
        viewType,
      });
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div className="modal-container new-base-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title-cluster">
            <Database size={18} className="modal-icon" />
            <h2 className="modal-title">{t('dialogs.newBaseTitle') || 'Neue Base erstellen'}</h2>
          </div>
          <button type="button" className="base-icon-btn close-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body scroller">
            {/* Base Name */}
            <div className="form-group">
              <label className="form-label">{t('base.nameLabel') || 'Name der Base:'}</label>
              <input
                type="text"
                className="base-input"
                placeholder="z. B. Server-Inventar, Projektübersicht..."
                value={name}
                autoFocus
                required
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            {/* Target Folder */}
            <div className="form-group">
              <label className="form-label">{t('base.locationLabel') || 'Speicherort im Vault:'}</label>
              <select
                className="base-select"
                value={folder}
                onChange={(e) => setFolder(e.target.value)}
              >
                <option value="">(Wurzelverzeichnis / Root)</option>
                {vaultFolders.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </div>

            {/* Scope / Filter source */}
            <div className="form-group">
              <label className="form-label">{t('base.sourceScopeLabel') || 'Bereich / Quelle einschränken:'}</label>

              <div className="radio-option-group">
                {/* Radio 1: Notes in folder */}
                <label className={`radio-card ${scope === 'folder' ? 'selected' : ''}`}>
                  <div className="radio-card-header">
                    <input
                      type="radio"
                      name="base-scope"
                      checked={scope === 'folder'}
                      onChange={() => setScope('folder')}
                    />
                    <Folder size={15} />
                    <span className="radio-title">Notizen im Ordner...</span>
                  </div>
                  {scope === 'folder' && (
                    <select
                      className="base-select sub-select"
                      value={scopeFolder}
                      onChange={(e) => setScopeFolder(e.target.value)}
                    >
                      <option value="">(Alle Ordner)</option>
                      {vaultFolders.map((f) => (
                        <option key={f} value={f}>
                          {f}
                        </option>
                      ))}
                    </select>
                  )}
                </label>

                {/* Radio 2: Notes with tag */}
                <label className={`radio-card ${scope === 'tag' ? 'selected' : ''}`}>
                  <div className="radio-card-header">
                    <input
                      type="radio"
                      name="base-scope"
                      checked={scope === 'tag'}
                      onChange={() => setScope('tag')}
                    />
                    <Tag size={15} />
                    <span className="radio-title">Notizen mit Tag...</span>
                  </div>
                  {scope === 'tag' && (
                    <select
                      className="base-select sub-select"
                      value={scopeTag}
                      onChange={(e) => setScopeTag(e.target.value)}
                    >
                      <option value="" disabled>
                        Tag auswählen...
                      </option>
                      {vaultTags.map((t) => (
                        <option key={t} value={t}>
                          #{t}
                        </option>
                      ))}
                    </select>
                  )}
                </label>

                {/* Radio 3: All notes */}
                <label className={`radio-card ${scope === 'all' ? 'selected' : ''}`}>
                  <div className="radio-card-header">
                    <input
                      type="radio"
                      name="base-scope"
                      checked={scope === 'all'}
                      onChange={() => setScope('all')}
                    />
                    <Database size={15} />
                    <span className="radio-title">Alle Notizen im gesamten Vault</span>
                  </div>
                </label>
              </div>
            </div>

            {/* Initial Layout / View Type */}
            <div className="form-group">
              <label className="form-label">{t('base.startViewLabel') || 'Start-Ansicht:'}</label>
              <div className="base-view-type-picker">
                <button
                  type="button"
                  className={`type-option-btn ${viewType === 'table' ? 'active' : ''}`}
                  onClick={() => setViewType('table')}
                >
                  <TableIcon size={16} />
                  <span>Tabelle</span>
                </button>
                <button
                  type="button"
                  className={`type-option-btn ${viewType === 'cards' ? 'active' : ''}`}
                  onClick={() => setViewType('cards')}
                >
                  <LayoutGrid size={16} />
                  <span>Karten / Cards</span>
                </button>
              </div>
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" className="base-btn secondary-btn" onClick={onClose} disabled={isSubmitting}>
              <span>{t('common.cancel') || 'Abbrechen'}</span>
            </button>
            <button type="submit" className="base-btn primary-btn" disabled={!name.trim() || isSubmitting}>
              <span>{isSubmitting ? 'Wird erstellt…' : 'Base erstellen'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
