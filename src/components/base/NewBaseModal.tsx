import React, { useState } from 'react';
import { Database, Folder, Tag, Link as LinkIcon, Table as TableIcon, LayoutGrid, X } from 'lucide-react';
import { useTranslation } from '../../i18n';

export interface NewBaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (options: {
    name: string;
    folder: string;
    scope: 'folder' | 'tag' | 'link' | 'all';
    scopeValue?: string;
    viewType: 'table' | 'cards';
  }) => Promise<void>;
  initialFolder?: string;
  vaultFolders: string[];
  vaultTags: string[];
  vaultNotes?: { path: string; name: string }[];
}

export const NewBaseModal: React.FC<NewBaseModalProps> = ({
  isOpen,
  onClose,
  onCreate,
  initialFolder = '',
  vaultFolders,
  vaultTags,
  vaultNotes = [],
}) => {
  const { t } = useTranslation();

  const [name, setName] = useState('');
  const [folder, setFolder] = useState(initialFolder);
  const [scope, setScope] = useState<'folder' | 'tag' | 'link' | 'all'>('folder');
  const [scopeFolder, setScopeFolder] = useState(initialFolder || vaultFolders[0] || '');
  const [scopeTag, setScopeTag] = useState(vaultTags[0] || '');
  const [scopeTargetNote, setScopeTargetNote] = useState(vaultNotes[0]?.name || '');
  const [viewType, setViewType] = useState<'table' | 'cards'>('table');
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const finalName = name.trim();
    if (!finalName) return;

    let scopeValue: string | undefined;
    if (scope === 'folder') scopeValue = scopeFolder;
    else if (scope === 'tag') scopeValue = scopeTag;
    else if (scope === 'link') scopeValue = scopeTargetNote;

    setIsSubmitting(true);
    try {
      await onCreate({
        name: finalName,
        folder,
        scope,
        scopeValue,
        viewType,
      });
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="new-base-modal-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div className="new-base-modal-container" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="new-base-modal-header">
          <div className="new-base-modal-title">
            <Database size={20} className="modal-title-icon" />
            <h3>{t('dialogs.newBaseTitle') || 'Neue Base erstellen'}</h3>
          </div>
          <button
            type="button"
            className="new-base-modal-close-btn"
            onClick={onClose}
            aria-label={t('base.cancel') || 'Schließen'}
          >
            <X size={18} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="new-base-modal-form">
          <div className="new-base-modal-body scroller">
            {/* 1. Base Name */}
            <div className="new-base-form-group">
              <label className="new-base-form-label">{t('base.nameLabel') || 'Name der Base:'}</label>
              <input
                type="text"
                className="new-base-input"
                placeholder="z. B. Server-Inventar, Projektübersicht..."
                value={name}
                autoFocus
                required
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            {/* 2. Target Location */}
            <div className="new-base-form-group">
              <label className="new-base-form-label">{t('base.locationLabel') || 'Speicherort im Vault:'}</label>
              <select
                className="new-base-select"
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

            {/* 3. Filter Scope / Source Options */}
            <div className="new-base-form-group">
              <label className="new-base-form-label">{t('base.sourceScopeLabel') || 'Bereich / Quelle einschränken:'}</label>

              <div className="new-base-radio-group">
                {/* Option 1: Folder */}
                <label className={`new-base-radio-card ${scope === 'folder' ? 'selected' : ''}`}>
                  <div className="new-base-radio-header">
                    <input
                      type="radio"
                      name="new-base-scope"
                      checked={scope === 'folder'}
                      onChange={() => setScope('folder')}
                    />
                    <Folder size={16} className="radio-icon" />
                    <span className="radio-label-text">Notizen im Ordner...</span>
                  </div>
                  {scope === 'folder' && (
                    <div className="new-base-radio-sub">
                      <select
                        className="new-base-select sub-control"
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
                    </div>
                  )}
                </label>

                {/* Option 2: Tag */}
                <label className={`new-base-radio-card ${scope === 'tag' ? 'selected' : ''}`}>
                  <div className="new-base-radio-header">
                    <input
                      type="radio"
                      name="new-base-scope"
                      checked={scope === 'tag'}
                      onChange={() => setScope('tag')}
                    />
                    <Tag size={16} className="radio-icon" />
                    <span className="radio-label-text">Notizen mit Tag...</span>
                  </div>
                  {scope === 'tag' && (
                    <div className="new-base-radio-sub">
                      <select
                        className="new-base-select sub-control"
                        value={scopeTag}
                        onChange={(e) => setScopeTag(e.target.value)}
                      >
                        <option value="" disabled>
                          Tag auswählen...
                        </option>
                        {vaultTags.map((tg) => (
                          <option key={tg} value={tg}>
                            #{tg}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </label>

                {/* Option 3: Linked to page (file.hasLink) */}
                <label className={`new-base-radio-card ${scope === 'link' ? 'selected' : ''}`}>
                  <div className="new-base-radio-header">
                    <input
                      type="radio"
                      name="new-base-scope"
                      checked={scope === 'link'}
                      onChange={() => setScope('link')}
                    />
                    <LinkIcon size={16} className="radio-icon" />
                    <span className="radio-label-text">
                      {t('base.scopeLinkedTo') || 'Notizen, die auf eine Seite verlinken...'}
                    </span>
                  </div>
                  {scope === 'link' && (
                    <div className="new-base-radio-sub">
                      <input
                        type="text"
                        list="new-base-target-notes-list"
                        className="new-base-input sub-control"
                        placeholder={t('base.targetNotePlaceholder') || 'Zielnotiz auswählen...'}
                        value={scopeTargetNote}
                        onChange={(e) => setScopeTargetNote(e.target.value)}
                      />
                      <datalist id="new-base-target-notes-list">
                        {vaultNotes.map((n) => (
                          <option key={n.path} value={n.name}>
                            {n.path}
                          </option>
                        ))}
                      </datalist>
                    </div>
                  )}
                </label>

                {/* Option 4: All notes */}
                <label className={`new-base-radio-card ${scope === 'all' ? 'selected' : ''}`}>
                  <div className="new-base-radio-header">
                    <input
                      type="radio"
                      name="new-base-scope"
                      checked={scope === 'all'}
                      onChange={() => setScope('all')}
                    />
                    <Database size={16} className="radio-icon" />
                    <span className="radio-label-text">Alle Notizen im gesamten Vault</span>
                  </div>
                </label>
              </div>
            </div>

            {/* 4. Starting View */}
            <div className="new-base-form-group">
              <label className="new-base-form-label">{t('base.startViewLabel') || 'Start-Ansicht:'}</label>
              <div className="new-base-view-segmented-group">
                <button
                  type="button"
                  className={`new-base-view-segment-btn ${viewType === 'table' ? 'active' : ''}`}
                  onClick={() => setViewType('table')}
                >
                  <TableIcon size={16} />
                  <span>Tabelle</span>
                </button>
                <button
                  type="button"
                  className={`new-base-view-segment-btn ${viewType === 'cards' ? 'active' : ''}`}
                  onClick={() => setViewType('cards')}
                >
                  <LayoutGrid size={16} />
                  <span>Karten / Cards</span>
                </button>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="new-base-modal-footer">
            <button
              type="button"
              className="new-base-btn new-base-btn-cancel"
              onClick={onClose}
              disabled={isSubmitting}
            >
              <span>{t('base.cancel') || 'Abbrechen'}</span>
            </button>
            <button
              type="submit"
              className="new-base-btn new-base-btn-primary"
              disabled={!name.trim() || isSubmitting}
            >
              <span>{isSubmitting ? 'Wird erstellt…' : (t('base.createBase') || 'Base erstellen')}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
