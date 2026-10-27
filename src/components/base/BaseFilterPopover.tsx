import React from 'react';
import { Filter, Plus, Trash2, X, Folder, Tag, FileText } from 'lucide-react';
import type { BaseFilterRule, FilterOperator } from '../../base/baseConfig';
import { useTranslation } from '../../i18n';

export interface BaseFilterPopoverProps {
  isOpen: boolean;
  onClose: () => void;
  rules: BaseFilterRule[];
  onChangeRules: (rules: BaseFilterRule[]) => void;
  availableProperties: { key: string; label: string }[];
  vaultFolders: string[];
  vaultTags: string[];
}

export const BaseFilterPopover: React.FC<BaseFilterPopoverProps> = ({
  isOpen,
  onClose,
  rules,
  onChangeRules,
  availableProperties,
  vaultFolders,
  vaultTags,
}) => {
  const { t } = useTranslation();

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

      <div className="base-popover-body">
        {rules.length === 0 ? (
          <div className="base-popover-empty">
            <p>{t('base.noFilters') || 'Keine aktiven Filter. Alle Notizen werden angezeigt.'}</p>
          </div>
        ) : (
          <div className="base-filter-rule-list">
            {rules.map((rule, idx) => {
              const isSpecialFunc = rule.field === 'file.inFolder' || rule.field === 'file.hasTag';
              const isValueless = rule.operator === 'isEmpty' || rule.operator === '!isEmpty';

              return (
                <div key={rule.id} className="base-filter-rule-row">
                  {/* Field Selector */}
                  <select
                    className="base-filter-select field-select"
                    value={rule.field}
                    onChange={(e) => handleUpdateRule(idx, { field: e.target.value })}
                  >
                    <optgroup label="Funktionen & Ordner">
                      <option value="file.inFolder">📁 Liegt in Ordner... (file.inFolder)</option>
                      <option value="file.hasTag">🏷️ Hat Tag... (file.hasTag)</option>
                    </optgroup>
                    <optgroup label="Datei-Eigenschaften">
                      <option value="file.name">Dateiname (file.name)</option>
                      <option value="file.folder">Ordnerpfad (file.folder)</option>
                      <option value="file.ext">Dateiendung (file.ext)</option>
                    </optgroup>
                    {availableProperties.length > 0 && (
                      <optgroup label="Frontmatter-Eigenschaften">
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
                        <option value="==">ist</option>
                        <option value="!=">ist nicht</option>
                      </>
                    ) : (
                      <>
                        <option value="==">ist gleich (==)</option>
                        <option value="!=">ist ungleich (!=)</option>
                        <option value="contains">enthält</option>
                        <option value="startsWith">beginnt mit</option>
                        <option value="!isEmpty">ist nicht leer</option>
                        <option value="isEmpty">ist leer</option>
                        <option value=">">&gt; (größer als)</option>
                        <option value="<">&lt; (kleiner als)</option>
                        <option value=">=">&gt;= (größer gleich)</option>
                        <option value="<=">&lt;= (kleiner gleich)</option>
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
                        <option value="">(Wurzelverzeichnis)</option>
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
                          Tag auswählen...
                        </option>
                        {vaultTags.map((t) => (
                          <option key={t} value={t}>
                            #{t}
                          </option>
                        ))}
                      </select>
                    ) : isValueless ? (
                      <span className="base-filter-val-placeholder">—</span>
                    ) : (
                      <input
                        type="text"
                        className="base-filter-input"
                        placeholder="Wert..."
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
        )}
      </div>

      <div className="base-popover-footer">
        <button type="button" className="base-btn add-filter-btn" onClick={handleAddRule}>
          <Plus size={14} />
          <span>{t('base.addFilter') || 'Bedingung hinzufügen'}</span>
        </button>
      </div>
    </div>
  );
};
