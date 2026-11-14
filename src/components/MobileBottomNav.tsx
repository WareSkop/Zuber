import React, { useState } from 'react';
import {
  FolderOpen,
  Search,
  Pencil,
  Plus,
  MoreVertical,
  Code2,
  BookOpen,
  Columns,
  PanelRight,
  Maximize2,
  Edit3,
  FolderInput,
  Star,
  Trash2,
  Settings,
} from 'lucide-react';
import { BottomSheet } from './BottomSheet';
import { useTranslation } from '../i18n';
import type { EditorMode } from './LivePreviewEditor';

export interface MobileBottomNavProps {
  editorMode: EditorMode;
  canEditNote: boolean;
  hasActiveNote: boolean;
  activeNoteName?: string;
  isFavorite?: boolean;
  isResearchOpen?: boolean;
  zenMode?: boolean;
  onOpenFiles: () => void;
  onOpenSearch: () => void;
  onStartEdit: () => void;
  onQuickNote: () => void;
  onSwitchMode: (mode: EditorMode) => void;
  onToggleResearch: () => void;
  onOpenRightSidebar: () => void;
  onToggleZen: () => void;
  onRenameActive?: () => void;
  onMoveActive?: () => void;
  onToggleFavoriteActive?: () => void;
  onDeleteActive?: () => void;
  onOpenSettings: () => void;
}

export const MobileBottomNav: React.FC<MobileBottomNavProps> = ({
  editorMode,
  canEditNote,
  hasActiveNote,
  activeNoteName,
  isFavorite = false,
  isResearchOpen = false,
  zenMode = false,
  onOpenFiles,
  onOpenSearch,
  onStartEdit,
  onQuickNote,
  onSwitchMode,
  onToggleResearch,
  onOpenRightSidebar,
  onToggleZen,
  onRenameActive,
  onMoveActive,
  onToggleFavoriteActive,
  onDeleteActive,
  onOpenSettings,
}) => {
  const { t } = useTranslation();
  const [isMoreOpen, setIsMoreOpen] = useState(false);

  return (
    <>
      <nav
        className="mobile-bottom-nav"
        aria-label={t('mobile.navAria', 'Mobile navigation')}
      >
        <button
          type="button"
          className="mobile-bottom-nav-btn"
          onClick={onOpenFiles}
          aria-label={t('mobile.files', 'Files')}
          title={t('mobile.files', 'Files')}
        >
          <FolderOpen size={20} />
          <span className="mobile-bottom-nav-label">{t('mobile.files', 'Files')}</span>
        </button>

        <button
          type="button"
          className="mobile-bottom-nav-btn"
          onClick={onOpenSearch}
          aria-label={t('mobile.search', 'Search')}
          title={t('mobile.search', 'Search')}
        >
          <Search size={20} />
          <span className="mobile-bottom-nav-label">{t('mobile.search', 'Search')}</span>
        </button>

        {canEditNote && (
          <button
            type="button"
            className="mobile-bottom-nav-btn mobile-bottom-nav-edit-btn"
            onClick={onStartEdit}
            aria-label={t('mobile.edit', 'Edit')}
            title={t('mobile.edit', 'Edit')}
          >
            <Pencil size={20} />
            <span className="mobile-bottom-nav-label">{t('mobile.edit', 'Edit')}</span>
          </button>
        )}

        <button
          type="button"
          className="mobile-bottom-nav-btn"
          onClick={onQuickNote}
          aria-label={t('mobile.quickNote', 'New Note')}
          title={t('mobile.quickNote', 'New Note')}
        >
          <Plus size={22} />
          <span className="mobile-bottom-nav-label">{t('mobile.quickNote', 'New')}</span>
        </button>

        <button
          type="button"
          className="mobile-bottom-nav-btn"
          onClick={() => setIsMoreOpen(true)}
          aria-label={t('mobile.more', 'More')}
          title={t('mobile.more', 'More')}
        >
          <MoreVertical size={20} />
          <span className="mobile-bottom-nav-label">{t('mobile.more', 'More')}</span>
        </button>
      </nav>

      <BottomSheet
        isOpen={isMoreOpen}
        onClose={() => setIsMoreOpen(false)}
        title={activeNoteName || t('mobile.moreOptions', 'Options')}
      >
        <div className="bottom-sheet-section">
          {canEditNote && (
            <>
              {editorMode !== 'source' ? (
                <button
                  type="button"
                  className="bottom-sheet-action-btn"
                  onClick={() => {
                    setIsMoreOpen(false);
                    onSwitchMode('source');
                  }}
                >
                  <Code2 size={18} />
                  <span>{t('mobile.switchToSource', 'Source Code Mode')}</span>
                </button>
              ) : (
                <button
                  type="button"
                  className="bottom-sheet-action-btn"
                  onClick={() => {
                    setIsMoreOpen(false);
                    onSwitchMode('reading');
                  }}
                >
                  <BookOpen size={18} />
                  <span>{t('mobile.switchToReading', 'Reading Mode')}</span>
                </button>
              )}
            </>
          )}

          <button
            type="button"
            className={`bottom-sheet-action-btn ${isResearchOpen ? 'is-active' : ''}`}
            onClick={() => {
              setIsMoreOpen(false);
              onToggleResearch();
            }}
          >
            <Columns size={18} />
            <span>{t('mobile.researchSplit', 'Research Split-View')}</span>
          </button>

          <button
            type="button"
            className="bottom-sheet-action-btn"
            onClick={() => {
              setIsMoreOpen(false);
              onOpenRightSidebar();
            }}
          >
            <PanelRight size={18} />
            <span>{t('mobile.rightSidebar', 'Backlinks, Outline & Graph')}</span>
          </button>

          <button
            type="button"
            className={`bottom-sheet-action-btn ${zenMode ? 'is-active' : ''}`}
            onClick={() => {
              setIsMoreOpen(false);
              onToggleZen();
            }}
          >
            <Maximize2 size={18} />
            <span>{t('mobile.zenMode', 'Zen Mode')}</span>
          </button>
        </div>

        {hasActiveNote && (
          <div className="bottom-sheet-section">
            <div className="bottom-sheet-section-label">
              {t('mobile.fileActions', 'File Actions')}
            </div>

            {onRenameActive && (
              <button
                type="button"
                className="bottom-sheet-action-btn"
                onClick={() => {
                  setIsMoreOpen(false);
                  onRenameActive();
                }}
              >
                <Edit3 size={18} />
                <span>{t('common.rename', 'Rename')}</span>
              </button>
            )}

            {onMoveActive && (
              <button
                type="button"
                className="bottom-sheet-action-btn"
                onClick={() => {
                  setIsMoreOpen(false);
                  onMoveActive();
                }}
              >
                <FolderInput size={18} />
                <span>{t('sidebar.moveTo', 'Move to...')}</span>
              </button>
            )}

            {onToggleFavoriteActive && (
              <button
                type="button"
                className={`bottom-sheet-action-btn ${isFavorite ? 'is-active' : ''}`}
                onClick={() => {
                  setIsMoreOpen(false);
                  onToggleFavoriteActive();
                }}
              >
                <Star size={18} fill={isFavorite ? 'currentColor' : 'none'} />
                <span>
                  {isFavorite
                    ? t('sidebar.removeFromFavorites', 'Remove from Favorites')
                    : t('sidebar.addToFavorites', 'Add to Favorites')}
                </span>
              </button>
            )}

            {onDeleteActive && (
              <button
                type="button"
                className="bottom-sheet-action-btn danger"
                onClick={() => {
                  setIsMoreOpen(false);
                  onDeleteActive();
                }}
              >
                <Trash2 size={18} />
                <span>{t('common.delete', 'Delete')}</span>
              </button>
            )}
          </div>
        )}

        <div className="bottom-sheet-section">
          <button
            type="button"
            className="bottom-sheet-action-btn"
            onClick={() => {
              setIsMoreOpen(false);
              onOpenSettings();
            }}
          >
            <Settings size={18} />
            <span>{t('nav.settings', 'Settings')}</span>
          </button>
        </div>
      </BottomSheet>
    </>
  );
};
