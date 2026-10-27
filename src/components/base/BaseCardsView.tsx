import React from 'react';
import { FileText, Folder } from 'lucide-react';
import type { BaseQueryResult, BaseRecord } from '../../base/baseEngine';
import { getPropertyValue } from '../../base/baseEngine';
import type { BaseViewConfig } from '../../base/baseConfig';

export interface BaseCardsViewProps {
  queryResult: BaseQueryResult;
  view: BaseViewConfig;
  onSelectNote: (path: string) => void;
  notes?: BaseRecord[];
}

export const BaseCardsView: React.FC<BaseCardsViewProps> = ({
  queryResult,
  view,
  onSelectNote,
  notes,
}) => {
  // If notes passed explicitly without groups, use a single group
  const groups = queryResult?.groups || [
    {
      key: 'all',
      label: 'Alle Notizen',
      records: notes || queryResult?.records || [],
    },
  ];

  const columns = queryResult?.columns || view?.order || ['file.name'];
  const displayNames = queryResult?.columnDisplayNames || {};

  return (
    <div className="base-cards-container scroller">
      {groups.map((group) => (
        <div key={group.key} className="base-group-section">
          {groups.length > 1 && (
            <div className="base-group-header">
              <span className="base-group-title">{group.label}</span>
              <span className="base-group-count">({group.records.length})</span>
            </div>
          )}
          <div className="base-cards-grid">
            {group.records.map((rec) => {
              const noteName = rec.file.name ? rec.file.name.replace(/\.md$/i, '') : rec.file.path;
              return (
                <div
                  key={rec.file.path}
                  className="base-card"
                  onClick={() => onSelectNote(rec.file.path)}
                >
                  <div className="base-card-top">
                    <div
                      className="base-card-title-link"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectNote(rec.file.path);
                      }}
                      title={rec.file.path}
                    >
                      <FileText size={16} className="base-card-icon" />
                      <span className="base-card-title">{noteName}</span>
                    </div>
                    {rec.file.folder && (
                      <span className="base-card-folder" title={rec.file.folder}>
                        <Folder size={11} className="folder-icon" />
                        <span>{rec.file.folder}</span>
                      </span>
                    )}
                  </div>

                  {rec.tags && rec.tags.length > 0 && (
                    <div className="base-card-tags">
                      {rec.tags.map((tg) => (
                        <span key={tg} className="base-tag-pill">
                          #{tg}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="base-card-props">
                    {columns
                      .filter((c) => c !== 'file.name' && c !== 'tags')
                      .map((col) => {
                        const val = getPropertyValue(rec, col);
                        if (val === undefined || val === null || val === '') return null;
                        const dName = displayNames[col] || col;
                        return (
                          <div key={col} className="base-card-prop-row">
                            <span className="base-prop-key">{dName}:</span>
                            <span className="base-prop-val">
                              {typeof val === 'boolean'
                                ? val
                                  ? '✓'
                                  : '✗'
                                : Array.isArray(val)
                                ? val.join(', ')
                                : String(val)}
                            </span>
                          </div>
                        );
                      })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
};
