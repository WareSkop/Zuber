import React, { useState, useEffect, useRef, useMemo } from 'react';
import { LayoutTemplate, Search, X, Folder, ArrowRight, FileText } from 'lucide-react';
import { useTranslation } from '../i18n';

export interface TemplateItem {
  path: string;
  name: string;
  basename?: string;
  folder?: string;
}

export interface TemplateSelectModalProps {
  isOpen: boolean;
  onClose: () => void;
  templates: TemplateItem[];
  onSelectTemplate: (templatePath: string) => void;
}

export const TemplateSelectModal: React.FC<TemplateSelectModalProps> = ({
  isOpen,
  onClose,
  templates,
  onSelectTemplate,
}) => {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Filter templates by search query
  const filteredTemplates = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return templates;
    return templates.filter((tpl) => {
      const matchName = tpl.name.toLowerCase().includes(q);
      const matchPath = tpl.path.toLowerCase().includes(q);
      const matchBase = tpl.basename ? tpl.basename.toLowerCase().includes(q) : false;
      return matchName || matchPath || matchBase;
    });
  }, [templates, search]);

  // Autofocus and reset on open
  useEffect(() => {
    if (isOpen) {
      setSearch('');
      setSelectedIndex(0);
      setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
    }
  }, [isOpen]);

  // Keep selected index within bounds
  useEffect(() => {
    if (selectedIndex >= filteredTemplates.length) {
      setSelectedIndex(Math.max(0, filteredTemplates.length - 1));
    }
  }, [filteredTemplates.length, selectedIndex]);

  // Auto-scroll selected item into view
  useEffect(() => {
    if (listRef.current) {
      const activeEl = listRef.current.querySelector<HTMLElement>('.template-item.is-selected');
      if (activeEl) {
        activeEl.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [selectedIndex]);

  if (!isOpen) return null;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => Math.min(prev + 1, filteredTemplates.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredTemplates[selectedIndex]) {
        onSelectTemplate(filteredTemplates[selectedIndex].path);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div className="template-modal-overlay" onClick={onClose}>
      <div
        className="template-modal-container"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Modal Header */}
        <div className="template-modal-header">
          <div className="template-modal-title">
            <LayoutTemplate size={18} className="template-modal-icon" />
            <span>{t('templates.title') || 'Vorlage auswählen'}</span>
          </div>
          <button
            type="button"
            className="template-modal-close"
            onClick={onClose}
            aria-label={t('common.close')}
          >
            <X size={16} />
          </button>
        </div>

        {/* Search Input Box */}
        <div className="template-modal-search-box">
          <Search size={15} className="template-search-icon" />
          <input
            ref={inputRef}
            type="text"
            className="template-search-input"
            placeholder={t('templates.searchPlaceholder') || 'Vorlagen durchsuchen...'}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setSelectedIndex(0);
            }}
          />
        </div>

        {/* Template List */}
        <div className="template-modal-list scroller" ref={listRef}>
          {templates.length === 0 ? (
            <div className="template-modal-empty">
              <LayoutTemplate size={32} className="template-empty-icon" />
              <p>{t('templates.noTemplatesFound')}</p>
            </div>
          ) : filteredTemplates.length === 0 ? (
            <div className="template-modal-no-results">
              <p>{t('sidebar.noResults') || 'Keine Treffer gefunden.'}</p>
            </div>
          ) : (
            filteredTemplates.map((tpl, idx) => {
              const isSelected = idx === selectedIndex;
              const displayName = tpl.basename || tpl.name.replace(/\.md$/i, '');
              const folder = tpl.path.includes('/')
                ? tpl.path.slice(0, tpl.path.lastIndexOf('/'))
                : '/';

              return (
                <div
                  key={tpl.path}
                  className={`template-item ${isSelected ? 'is-selected' : ''}`}
                  onClick={() => onSelectTemplate(tpl.path)}
                  onMouseEnter={() => setSelectedIndex(idx)}
                >
                  <div className="template-item-left">
                    <FileText size={15} className="template-item-icon" />
                    <div className="template-item-info">
                      <span className="template-item-name">{displayName}</span>
                      <span className="template-item-folder">
                        <Folder size={11} />
                        {folder}
                      </span>
                    </div>
                  </div>
                  <ArrowRight size={14} className="template-item-arrow" />
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
