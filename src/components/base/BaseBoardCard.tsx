import React, { useRef } from 'react';
import { FileText, Folder } from 'lucide-react';
import type { BaseRecord } from '../../base/baseEngine';
import { getPropertyValue } from '../../base/baseEngine';

export interface BaseBoardCardProps {
  record: BaseRecord;
  columns: string[];
  displayNames: Record<string, string>;
  groupByProp: string;
  swimlaneProp?: string;
  readOnly?: boolean;
  isDragging?: boolean;
  onSelectNote: (path: string) => void;
  onDragStart: (path: string, e: React.DragEvent) => void;
  onDragEnd: () => void;
}

export const BaseBoardCard: React.FC<BaseBoardCardProps> = ({
  record,
  columns,
  displayNames,
  groupByProp,
  swimlaneProp,
  readOnly = false,
  isDragging = false,
  onSelectNote,
  onDragStart,
  onDragEnd,
}) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const noteName = record.file.name ? record.file.name.replace(/\.md$/i, '') : record.file.path;

  const handleDragStart = (e: React.DragEvent) => {
    try {
      e.dataTransfer?.setData('text/plain', record.file.path);
    } catch {}
    if (e.currentTarget) {
      e.currentTarget.classList.add('is-dragging');
      (e.currentTarget as HTMLElement).style.opacity = '0.5';
    }
    onDragStart(record.file.path, e);
  };

  const handleDragEnd = (e: React.DragEvent) => {
    if (e.currentTarget) {
      e.currentTarget.classList.remove('is-dragging');
      (e.currentTarget as HTMLElement).style.opacity = '1';
    }
    if (cardRef.current) {
      cardRef.current.classList.remove('is-dragging');
      cardRef.current.style.opacity = '1';
    }
    onDragEnd();
  };

  return (
    <div
      ref={cardRef}
      className={`base-board-card ${isDragging ? 'is-dragging' : ''}`}
      draggable={!readOnly}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onClick={() => onSelectNote(record.file.path)}
    >
      {/* Card Top: Title & Folder */}
      <div className="base-card-top">
        <div
          className="base-card-title-link"
          onClick={(e) => {
            e.stopPropagation();
            onSelectNote(record.file.path);
          }}
          title={record.file.path}
        >
          <FileText size={15} className="base-card-icon" />
          <span className="base-card-title">{noteName}</span>
        </div>
        {record.file.folder && (
          <span className="base-card-folder" title={record.file.folder}>
            <Folder size={11} className="folder-icon" />
            <span>{record.file.folder}</span>
          </span>
        )}
      </div>

      {/* Card Tags */}
      {record.tags && record.tags.length > 0 && (
        <div className="base-card-tags">
          {record.tags.map((tg) => (
            <span key={tg} className="base-tag-pill">
              #{tg}
            </span>
          ))}
        </div>
      )}

      {/* Card Custom Properties */}
      <div className="base-card-props">
        {columns
          .filter((c) => c !== 'file.name' && c !== 'tags' && c !== groupByProp && c !== swimlaneProp)
          .map((c) => {
            const val = getPropertyValue(record, c);
            if (val === undefined || val === null || val === '') return null;
            const dName = displayNames[c] || c;
            return (
              <div key={c} className="base-card-prop-row">
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
};
