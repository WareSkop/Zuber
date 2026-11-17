import React from 'react';
import { Filter, Plus, Trash2, X, Folder, Tag, FileText } from 'lucide-react';
import type { BaseFilterRule, FilterOperator } from '../../base/baseConfig';
import { useTranslation } from '../../i18n';
import { BottomSheet, useIsMobile } from '../BottomSheet';

export interface BaseFilterPopoverProps {
  isOpen: boolean;
  onClose: () => void;
  rules: BaseFilterRule[];
  onChangeRules: (rules: BaseFilterRule[]) => void;
  availableProperties: { key: string; label: string }[];
  vaultFolders: string[];
  vaultTags: string[];
  vaultNotes?: { path: string; name: string }[];
}

export const BaseFilterPopover: React.FC<BaseFilterPopoverProps> = ({
  isOpen,
  onClose,
  rules,
  onChangeRules,
  availableProperties,
  vaultFolders,
  vaultTags,
  vaultNotes = [],
}) => {
  const { t } = useTranslation();
  const isMobile = useIsMobile();

  if (!isOpen) return null;

  const handleAddRule = () => {
    const newRule: BaseFilterRule = {
      id: `rule-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      field: 'file.inFolder',
      operator: '==',
      value: vaultFolders[0] || '',
    };
    onChangeRules([...rules, newRule]);
  };

  const handleUpdateRule = (index: number, updates: Partial<BaseFilterRule>) => {
    const updated = [...rules];
    const target = { ...updated[index], ...updates };

    // Reset default value if field changed
    if (updates.field && updates.field !== updated[index].field) {
      if (updates.field === 'file.inFolder') {
        target.operator = '==';
        target.value = vaultFolders[0] || '';
      } else if (updates.field === 'file.hasTag') {
        target.operator = '==';
        target.value = vaultTags[0] || '';
      } else if (updates.field === 'file.hasLink') {
        target.operator = '==';
        target.value = vaultNotes[0]?.name || '';
      } else {
        target.operator = '==';
        target.value = '';
      }
    }

    // Clear value if operator becomes isEmpty / !isEmpty
    if (target.operator === 'isEmpty' || target.operator === '!isEmpty') {
      target.value = '';
    }

    updated[index] = target;
    onChangeRules(updated);
  };

  const handleRemoveRule = (index: number) => {
    const updated = rules.filter((_, idx) => idx !== index);
    onChangeRules(updated);
  };

  const filterBody = rules.length === 0 ? (
    <div className="base-popover-empty">
      <p>{t('base.noFilters') || 'Keine aktiven Filter. Alle Notizen werden angezeigt.'}</p>
    </div>
  ) : (
    <div className="base-filter-rule-list">
      {rules.map((rule, idx) => {
        const isSpecialFunc = rule.field === 'file.inFolder' || rule.field === 'file.hasTag' || rule.field === 'file.hasLink';
        const isValueless = rule.operator === 'isEmpty' || rule.operator === '!isEmpty';

        return (
          <div key={rule.id} className="base-filter-rule-row">
            {/* Field Selector */}
            <select
              className="base-filter-select field-select"
              value={rule.field}
              onChange={(e) => handleUpdateRule(idx, { field: e.target.value })}
            >
              <optgroup label={t('base.filterGroupFunctions')}>
                <option value="file.inFolder">{t('base.filterInFolderOption')}</option>
                <option value="file.hasTag">{t('base.filterHasTagOption')}</option>
                <option value="file.hasLink">{t('base.filterHasLinkOption')}</option>
              </optgroup>
              <optgroup label={t('base.filterGroupFileProps')}>
                <option value="file.name">{t('base.filterPropName')}</option>
                <option value="file.folder">{t('base.filterPropFolder')}</option>
                <option value="file.ext">{t('base.filterPropExt')}</option>
              </optgroup>
              {availableProperties.length > 0 && (
                <optgroup label={t('base.filterGroupFrontmatter')}>
                  {availableProperties.map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.label}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>

            {/* Operator Selector */}
            <select
              className="base-filter-select operator-select"
              value={rule.operator}
              onChange={(e) => handleUpdateRule(idx, { operator: e.target.value as FilterOperator })}
            >
              {isSpecialFunc ? (
                <>
                  <option value="==">{t('base.filterOpIs')}</option>
                  <option value="!=">{t('base.filterOpIsNot')}</option>
                </>
              ) : (
                <>
                  <option value="==">{t('base.filterOpEquals')}</option>
                  <option value="!=">{t('base.filterOpNotEquals')}</option>
                  <option value="contains">{t('base.filterOpContains')}</option>
                  <option value="startsWith">{t('base.filterOpStartsWith')}</option>
                  <option value="!isEmpty">{t('base.filterOpIsNotEmpty')}</option>
                  <option value="isEmpty">{t('base.filterOpIsEmpty')}</option>
                  <option value=">">{t('base.filterOpGt')}</option>
                  <option value="<">{t('base.filterOpLt')}</option>
                  <option value=">=">{t('base.filterOpGte')}</option>
                  <option value="<=">{t('base.filterOpLte')}</option>
                </>
              )}
            </select>

            {/* Value Input */}
            <div className="base-filter-val-wrapper">
              {rule.field === 'file.inFolder' ? (
                <select
                  className="base-filter-select val-select"
                  value={String(rule.value || '')}
                  onChange={(e) => handleUpdateRule(idx, { value: e.target.value })}
                >
                  <option value="">{t('base.filterRootFolder')}</option>
                  {vaultFolders.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              ) : rule.field === 'file.hasTag' ? (
                <select
                  className="base-filter-select val-select"
                  value={String(rule.value || '')}
                  onChange={(e) => handleUpdateRule(idx, { value: e.target.value })}
                >
                  <option value="" disabled>
                    {t('base.filterSelectTag')}
                  </option>
                  {vaultTags.map((tagItem) => (
                    <option key={tagItem} value={tagItem}>
                      #{tagItem}
                    </option>
                  ))}
                </select>
              ) : rule.field === 'file.hasLink' ? (
                <div className="base-filter-note-input-wrapper">
                  <input
                    type="text"
                    list={`datalist-notes-${rule.id}`}
                    className="base-filter-input val-input"
                    placeholder={t('base.targetNotePlaceholder')}
                    value={String(rule.value ?? '')}
                    onChange={(e) => handleUpdateRule(idx, { value: e.target.value })}
                  />
                  <datalist id={`datalist-notes-${rule.id}`}>
                    {vaultNotes.map((n) => (
                      <option key={n.path} value={n.name}>
                        {n.path}
                      </option>
                    ))}
                  </datalist>
                </div>
              ) : isValueless ? (
                <span className="base-filter-val-placeholder">—</span>
              ) : (
                <input
                  type="text"
                  className="base-filter-input"
                  placeholder={t('base.filterValuePlaceholder')}
                  value={String(rule.value ?? '')}
                  onChange={(e) => handleUpdateRule(idx, { value: e.target.value })}
                />
              )}
            </div>

            {/* Remove Button */}
            <button
              type="button"
              className="base-icon-btn remove-rule-btn"
              onClick={() => handleRemoveRule(idx)}
              title={t('common.delete') || 'Bedingung entfernen'}
            >
              <Trash2 size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );

  const filterFooterBtn = (
    <button type="button" className="base-btn add-filter-btn" onClick={handleAddRule}>
      <Plus size={14} />
      <span>{t('base.addFilter') || 'Bedingung hinzufügen'}</span>
    </button>
  );

  if (isMobile) {
    return (
      <BottomSheet
        isOpen={isOpen}
        onClose={onClose}
        title={t('base.filterTitle') || 'Filter konfigurieren'}
        footer={
          <div className="bottom-sheet-footer-actions">
            {filterFooterBtn}
            <button type="button" className="base-btn primary-btn" onClick={onClose}>
              {t('common.save', 'Speichern')}
            </button>
          </div>
        }
      >
        {filterBody}
      </BottomSheet>
    );
  }

  return (
    <div className="base-popover-container base-filter-popover" role="dialog" aria-label="Filter Konfiguration">
      <div className="base-popover-header">
        <div className="base-popover-title">
          <Filter size={15} />
          <span>{t('base.filterTitle') || 'Filter konfigurieren'}</span>
        </div>
        <button
          type="button"
          className="base-icon-btn close-btn"
          onClick={onClose}
          title={t('common.close') || 'Schließen'}
        >
          <X size={15} />
        </button>
      </div>

      <div className="base-popover-body">{filterBody}</div>

      <div className="base-popover-footer">{filterFooterBtn}</div>
    </div>
  );
};
