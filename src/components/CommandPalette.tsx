import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Search, CornerDownLeft, ArrowUpDown } from 'lucide-react';
import { useTranslation } from '../i18n';

export interface CommandItem {
  id: string;
  title: string;
  category: string;
  shortcut?: string;
  icon?: React.ReactNode;
  keywords?: string[];
  action: () => void;
}

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  commands: CommandItem[];
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  isOpen,
  onClose,
  commands,
}) => {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Filter commands by search term
  const filteredCommands = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return commands;

    return commands.filter((cmd) => {
      const inTitle = cmd.title.toLowerCase().includes(q);
      const inCategory = cmd.category.toLowerCase().includes(q);
      const inShortcut = cmd.shortcut ? cmd.shortcut.toLowerCase().includes(q) : false;
      const inKeywords = cmd.keywords ? cmd.keywords.some((k) => k.toLowerCase().includes(q)) : false;
      return inTitle || inCategory || inShortcut || inKeywords;
    });
  }, [commands, search]);

  // Reset search and selection on open
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
    if (selectedIndex >= filteredCommands.length) {
      setSelectedIndex(Math.max(0, filteredCommands.length - 1));
    }
  }, [filteredCommands.length, selectedIndex]);

  // Scroll active item into view
  useEffect(() => {
    if (!listRef.current) return;
    const activeEl = listRef.current.querySelector<HTMLElement>(`.cmd-item.is-selected`);
    if (activeEl) {
      activeEl.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  if (!isOpen) return null;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % Math.max(1, filteredCommands.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) =>
        prev - 1 < 0 ? Math.max(0, filteredCommands.length - 1) : prev - 1
      );
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const cmd = filteredCommands[selectedIndex];
      if (cmd) {
        onClose();
        cmd.action();
      }
    }
  };

  const handleExecute = (cmd: CommandItem) => {
    onClose();
    cmd.action();
  };

  return (
    <div className="command-palette-backdrop" onClick={onClose}>
      <div
        className="command-palette-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Befehlspalette"
      >
        <div className="command-palette-search-wrapper">
          <Search size={18} className="command-palette-search-icon" />
          <input
            ref={inputRef}
            type="text"
            className="command-palette-input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('commandPalette.placeholder')}
          />
          <kbd className="command-palette-esc-badge" onClick={onClose}>
            ESC
          </kbd>
        </div>

        <div className="command-palette-list" ref={listRef}>
          {filteredCommands.length === 0 ? (
            <div className="command-palette-empty">
              {t('commandPalette.noResults', { search })}
            </div>
          ) : (
            filteredCommands.map((cmd, idx) => {
              const isSelected = idx === selectedIndex;
              return (
                <div
                  key={cmd.id}
                  className={`cmd-item ${isSelected ? 'is-selected' : ''}`}
                  onClick={() => handleExecute(cmd)}
                  onMouseEnter={() => setSelectedIndex(idx)}
                >
                  <span className="cmd-item-icon">{cmd.icon}</span>
                  <div className="cmd-item-info">
                    <span className="cmd-item-title">{cmd.title}</span>
                    <span className="cmd-item-category">{cmd.category}</span>
                  </div>
                  {cmd.shortcut && (
                    <kbd className="cmd-item-shortcut">{cmd.shortcut}</kbd>
                  )}
                </div>
              );
            })
          )}
        </div>

        <div className="command-palette-footer">
          <span className="command-palette-tip">
            <ArrowUpDown size={12} />
            <span>{t('commandPalette.navigateHint')}</span>
          </span>
          <span className="command-palette-tip">
            <CornerDownLeft size={12} />
            <span>{t('commandPalette.executeHint')}</span>
          </span>
          <span className="command-palette-tip">
            <kbd>ESC</kbd>
            <span>{t('commandPalette.closeHint')}</span>
          </span>
        </div>
      </div>
    </div>
  );
};
