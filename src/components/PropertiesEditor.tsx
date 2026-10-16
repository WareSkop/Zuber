import React, { useState } from 'react';
import {
  AlignLeft,
  Calendar,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Hash,
  List,
  Plus,
  SlidersHorizontal,
  Tag,
  Trash2,
  X,
} from 'lucide-react';
import type { FrontmatterProperty, PropertyType } from '../../shared/types';
import { normalizePropertyValue } from '../../shared/markdownUtils';

interface PropertiesEditorProps {
  properties: FrontmatterProperty[];
  allTags: string[];
  onChange: (updated: FrontmatterProperty[]) => void;
  onTagClick?: (tag: string) => void;
}

const PROPERTY_SUGGESTIONS = [
  'tags',
  'aliases',
  'status',
  'erstellt',
  'autor',
  'kategorie',
  'priorität',
  'favorit',
  'fällig',
];

export const PropertiesEditor: React.FC<PropertiesEditorProps> = ({
  properties,
  allTags,
  onChange,
  onTagClick,
}) => {
  const [collapsed, setCollapsed] = useState(false);
  const [listInputs, setListInputs] = useState<Record<number, string>>({});

  const updateProperty = (index: number, patch: Partial<FrontmatterProperty>) => {
    const next = properties.map((prop, i) => {
      if (i !== index) return prop;
      const updatedKey = patch.key !== undefined ? patch.key : prop.key;
      const updatedType = patch.type !== undefined ? patch.type : prop.type;
      const rawVal = patch.value !== undefined ? patch.value : prop.value;
      return {
        key: updatedKey,
        type: updatedType,
        value: normalizePropertyValue(updatedKey, rawVal, updatedType),
      };
    });
    onChange(next);
  };

  const removeProperty = (index: number) => {
    const next = properties.filter((_, i) => i !== index);
    onChange(next);
  };

  const addProperty = () => {
    setCollapsed(false);
    // Find an unused suggested property name or default
    const existingKeys = new Set(properties.map((p) => p.key.toLowerCase()));
    const suggestion =
      PROPERTY_SUGGESTIONS.find((s) => !existingKeys.has(s)) ||
      `eigenschaft_${properties.length + 1}`;

    const defaultType: PropertyType =
      suggestion === 'tags' || suggestion === 'aliases'
        ? 'list'
        : suggestion === 'erstellt' || suggestion === 'fällig'
          ? 'date'
          : suggestion === 'favorit'
            ? 'checkbox'
            : suggestion === 'priorität'
              ? 'number'
              : 'text';

    const defaultValue =
      defaultType === 'list'
        ? []
        : defaultType === 'date'
          ? new Date().toISOString().slice(0, 10)
          : defaultType === 'checkbox'
            ? false
            : defaultType === 'number'
              ? 1
              : '';

    onChange([
      ...properties,
      {
        key: suggestion,
        type: defaultType,
        value: defaultValue,
      },
    ]);
  };

  const handleAddChip = (index: number, rawChip: string) => {
    const cleaned = rawChip.trim().replace(/^#+/, '');
    if (!cleaned) return;
    const prop = properties[index];
    const currentList = Array.isArray(prop.value)
      ? prop.value.map(String)
      : prop.value
        ? [String(prop.value)]
        : [];
    if (!currentList.includes(cleaned)) {
      updateProperty(index, { value: [...currentList, cleaned] });
    }
    setListInputs((prev) => ({ ...prev, [index]: '' }));
  };

  const handleRemoveChip = (index: number, chipToRemove: string) => {
    const prop = properties[index];
    const currentList = Array.isArray(prop.value) ? prop.value.map(String) : [];
    updateProperty(index, {
      value: currentList.filter((c) => c !== chipToRemove),
    });
  };

  const renderTypeIcon = (key: string, type: PropertyType) => {
    const lower = key.toLowerCase();
    if (lower === 'tags' || lower === 'tag') return <Tag size={14} />;
    switch (type) {
      case 'list':
        return <List size={14} />;
      case 'date':
        return <Calendar size={14} />;
      case 'checkbox':
        return <CheckSquare size={14} />;
      case 'number':
        return <Hash size={14} />;
      default:
        return <AlignLeft size={14} />;
    }
  };

  return (
    <div className="properties-panel">
      <div className="properties-header">
        <button
          type="button"
          className="properties-toggle-btn"
          onClick={() => setCollapsed((c) => !c)}
        >
          {collapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
          <SlidersHorizontal size={14} />
          <span>Eigenschaften</span>
          <span className="properties-count-badge">{properties.length}</span>
        </button>

        <button
          type="button"
          className="properties-add-inline-btn"
          onClick={addProperty}
          title="Neue Frontmatter-Eigenschaft hinzufügen"
        >
          <Plus size={14} />
          <span>Eigenschaft hinzufügen</span>
        </button>
      </div>

      {!collapsed && (
        <div className="properties-list">
          {properties.length === 0 ? (
            <div className="properties-empty">
              <span>Keine Eigenschaften vorhanden.</span>
              <button type="button" className="btn-link" onClick={addProperty}>
                + Erste Eigenschaft anlegen
              </button>
            </div>
          ) : (
            properties.map((prop, index) => {
              const isTagProp =
                prop.key.toLowerCase() === 'tags' || prop.key.toLowerCase() === 'tag';
              const listValues = Array.isArray(prop.value)
                ? prop.value.map(String)
                : prop.value
                  ? [String(prop.value)]
                  : [];

              return (
                <div key={index} className="property-row">
                  <div className="property-key-cell">
                    <div className="property-type-selector" title="Eigenschafts-Typ ändern">
                      <span className="property-type-icon">
                        {renderTypeIcon(prop.key, prop.type)}
                      </span>
                      <select
                        aria-label="Eigenschafts-Typ"
                        value={prop.type}
                        onChange={(e) =>
                          updateProperty(index, { type: e.target.value as PropertyType })
                        }
                      >
                        <option value="text">Text</option>
                        <option value="list">Liste / Tags</option>
                        <option value="date">Datum</option>
                        <option value="checkbox">Checkbox</option>
                        <option value="number">Zahl</option>
                      </select>
                    </div>

                    <input
                      type="text"
                      className="property-key-input"
                      value={prop.key}
                      list="property-key-suggestions"
                      placeholder="Name"
                      onChange={(e) => updateProperty(index, { key: e.target.value })}
                    />
                  </div>

                  <div className="property-value-cell">
                    {prop.type === 'list' && (
                      <div className="property-chips-container">
                        {listValues.map((item) => (
                          <span
                            key={item}
                            className={`property-chip ${isTagProp ? 'tag-chip' : ''}`}
                          >
                            <span
                              className="chip-label"
                              onClick={() => isTagProp && onTagClick?.(item)}
                            >
                              {isTagProp ? `#${item.replace(/^#+/, '')}` : item}
                            </span>
                            <button
                              type="button"
                              className="chip-remove"
                              aria-label={`${item} entfernen`}
                              onClick={() => handleRemoveChip(index, item)}
                            >
                              <X size={12} />
                            </button>
                          </span>
                        ))}
                        <input
                          type="text"
                          className="property-chip-input"
                          placeholder={isTagProp ? '+ Tag (Enter)...' : '+ Wert (Enter)...'}
                          list={isTagProp ? 'vault-tag-suggestions' : undefined}
                          value={listInputs[index] || ''}
                          onChange={(e) =>
                            setListInputs((prev) => ({ ...prev, [index]: e.target.value }))
                          }
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ',') {
                              e.preventDefault();
                              handleAddChip(index, listInputs[index] || '');
                            } else if (
                              e.key === 'Backspace' &&
                              !(listInputs[index] || '') &&
                              listValues.length > 0
                            ) {
                              handleRemoveChip(index, listValues[listValues.length - 1]);
                            }
                          }}
                          onBlur={() => {
                            if ((listInputs[index] || '').trim()) {
                              handleAddChip(index, listInputs[index] || '');
                            }
                          }}
                        />
                      </div>
                    )}

                    {prop.type === 'checkbox' && (
                      <label className="property-checkbox-label">
                        <input
                          type="checkbox"
                          className="checkbox-custom"
                          checked={Boolean(prop.value)}
                          onChange={(e) =>
                            updateProperty(index, { value: e.target.checked })
                          }
                        />
                        <span className="property-checkbox-status">
                          {prop.value ? 'Aktiviert' : 'Deaktiviert'}
                        </span>
                      </label>
                    )}

                    {prop.type === 'date' && (
                      <input
                        type="date"
                        className="property-date-input"
                        value={String(prop.value || '')}
                        onChange={(e) => updateProperty(index, { value: e.target.value })}
                      />
                    )}

                    {prop.type === 'number' && (
                      <input
                        type="number"
                        className="property-number-input"
                        value={Number(prop.value ?? 0)}
                        onChange={(e) =>
                          updateProperty(index, { value: Number(e.target.value) })
                        }
                      />
                    )}

                    {prop.type === 'text' && (
                      <input
                        type="text"
                        className="property-text-input"
                        placeholder="Leer"
                        value={String(prop.value ?? '')}
                        onChange={(e) => updateProperty(index, { value: e.target.value })}
                      />
                    )}
                  </div>

                  <button
                    type="button"
                    className="property-delete-btn"
                    title="Eigenschaft löschen"
                    onClick={() => removeProperty(index)}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              );
            })
          )}

          <datalist id="property-key-suggestions">
            {PROPERTY_SUGGESTIONS.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
          <datalist id="vault-tag-suggestions">
            {allTags.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </div>
      )}
    </div>
  );
};
