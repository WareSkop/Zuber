import React, { useRef, useState } from 'react';
import {
  CheckSquare,
  Indent,
  Outdent,
  Heading,
  Link2,
  Camera,
  Image as ImageIcon,
  Plus,
  Check,
  Bold,
  Italic,
  Strikethrough,
  Highlighter,
  Code,
  List,
  ListOrdered,
  Table,
  MessageSquare,
  FileCode,
  Minus,
  Hash,
  Target,
} from 'lucide-react';
import type { LivePreviewEditorRef } from './LivePreviewEditor';
import { BottomSheet } from './BottomSheet';
import { useTranslation } from '../i18n';

export interface MobileEditBarProps {
  editorRef: React.RefObject<LivePreviewEditorRef | null>;
  onUploadImage: (file: File) => Promise<string | null>;
  onSendToTarget: () => void;
  onDone: () => void;
}

export const MobileEditBar: React.FC<MobileEditBarProps> = ({
  editorRef,
  onUploadImage,
  onSendToTarget,
  onDone,
}) => {
  const { t } = useTranslation();
  const [isHeadingOpen, setIsHeadingOpen] = useState(false);
  const [isImageOpen, setIsImageOpen] = useState(false);
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const [moreSubmenu, setMoreSubmenu] = useState<'main' | 'table' | 'callout'>('main');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    const embedTag = await onUploadImage(file);
    if (embedTag) {
      editorRef.current?.insertImageEmbed(embedTag);
    }
  };

  const handleSmartLink = async () => {
    const ed = editorRef.current;
    if (!ed) return;

    const selected = ed.getSelectedText()?.trim() || '';
    let clipboardText = '';
    try {
      if (navigator.clipboard && typeof navigator.clipboard.readText === 'function') {
        clipboardText = (await navigator.clipboard.readText()).trim();
      }
    } catch {
      // Clipboard permission may be denied; fall back gracefully
    }

    const isUrl = (val: string) => /^https?:\/\/\S+$/i.test(val);

    if (selected && isUrl(clipboardText)) {
      ed.insertExternalLink(selected, clipboardText);
      return;
    }
    if (selected && isUrl(selected)) {
      ed.insertExternalLink('Link', selected);
      return;
    }
    if (!selected && isUrl(clipboardText)) {
      ed.insertExternalLink('Link', clipboardText);
      return;
    }

    ed.insertWikiLink(true);
  };

  const openMoreSheet = () => {
    setMoreSubmenu('main');
    setIsMoreOpen(true);
  };

  const closeMoreSheet = () => {
    setIsMoreOpen(false);
    setMoreSubmenu('main');
  };

  return (
    <>
      <div
        className="mobile-edit-bar"
        role="toolbar"
        aria-label={t('mobile.editBarAria', 'Mobile editing toolbar')}
      >
        <button
          type="button"
          className="mobile-edit-bar-btn"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editorRef.current?.insertTask()}
          aria-label={t('mobile.todo', 'Todo')}
          title={t('mobile.todo', 'Todo')}
        >
          <CheckSquare size={18} />
        </button>

        <button
          type="button"
          className="mobile-edit-bar-btn"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editorRef.current?.indent()}
          aria-label={t('mobile.indent', 'Indent')}
          title={t('mobile.indent', 'Indent')}
        >
          <Indent size={18} />
        </button>

        <button
          type="button"
          className="mobile-edit-bar-btn"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setIsHeadingOpen(true)}
          aria-label={t('mobile.heading', 'Heading')}
          title={t('mobile.heading', 'Heading')}
        >
          <Heading size={18} />
        </button>

        <button
          type="button"
          className="mobile-edit-bar-btn"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            void handleSmartLink();
          }}
          aria-label={t('mobile.link', 'Link')}
          title={t('mobile.link', 'Link')}
        >
          <Link2 size={18} />
        </button>

        <button
          type="button"
          className="mobile-edit-bar-btn"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setIsImageOpen(true)}
          aria-label={t('mobile.image', 'Image / Camera')}
          title={t('mobile.image', 'Image / Camera')}
        >
          <Camera size={18} />
        </button>

        <button
          type="button"
          className="mobile-edit-bar-btn"
          onMouseDown={(e) => e.preventDefault()}
          onClick={openMoreSheet}
          aria-label={t('mobile.moreTools', 'More formatting tools')}
          title={t('mobile.moreTools', 'More formatting tools')}
        >
          <Plus size={19} />
        </button>

        <button
          type="button"
          className="mobile-edit-bar-btn mobile-edit-done-btn"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            editorRef.current?.blur();
            onDone();
          }}
          aria-label={t('common.done', 'Done')}
          title={t('common.done', 'Done')}
        >
          <Check size={18} />
          <span className="mobile-edit-done-label">{t('common.done', 'Done')}</span>
        </button>
      </div>

      {/* Hidden file inputs for image & camera */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,application/pdf"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      {/* Heading BottomSheet */}
      <BottomSheet
        isOpen={isHeadingOpen}
        onClose={() => setIsHeadingOpen(false)}
        title={t('mobile.heading', 'Heading')}
      >
        <div className="bottom-sheet-section">
          {[
            { level: 0, label: t('mobile.normalText', 'Normal Text') },
            { level: 1, label: 'H1' },
            { level: 2, label: 'H2' },
            { level: 3, label: 'H3' },
            { level: 4, label: 'H4' },
          ].map((item) => (
            <button
              key={item.level}
              type="button"
              className="bottom-sheet-action-btn"
              onClick={() => {
                setIsHeadingOpen(false);
                editorRef.current?.insertHeading(item.level);
                editorRef.current?.focus();
              }}
            >
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      </BottomSheet>

      {/* Image / Camera BottomSheet */}
      <BottomSheet
        isOpen={isImageOpen}
        onClose={() => setIsImageOpen(false)}
        title={t('mobile.image', 'Image / Camera')}
      >
        <div className="bottom-sheet-section">
          <button
            type="button"
            className="bottom-sheet-action-btn"
            onClick={() => {
              setIsImageOpen(false);
              cameraInputRef.current?.click();
            }}
          >
            <Camera size={18} />
            <span>{t('mobile.takePhoto', 'Take Photo (Camera)')}</span>
          </button>
          <button
            type="button"
            className="bottom-sheet-action-btn"
            onClick={() => {
              setIsImageOpen(false);
              fileInputRef.current?.click();
            }}
          >
            <ImageIcon size={18} />
            <span>{t('mobile.chooseImage', 'Choose Image / File')}</span>
          </button>
        </div>
      </BottomSheet>

      {/* Hybrid + More Format & Block BottomSheet */}
      <BottomSheet
        isOpen={isMoreOpen}
        onClose={closeMoreSheet}
        title={
          moreSubmenu === 'table'
            ? t('mobile.insertTable', 'Insert Table')
            : moreSubmenu === 'callout'
            ? t('mobile.insertCallout', 'Insert Callout')
            : t('mobile.formatAndBlocks', 'Format & Blocks')
        }
      >
        {moreSubmenu === 'main' && (
          <>
            {/* Top Section: 2x3 Compact Formatting Tile Grid */}
            <div className="hybrid-format-grid">
              <button
                type="button"
                className="hybrid-format-tile"
                onClick={() => {
                  closeMoreSheet();
                  editorRef.current?.applyFormat('bold');
                }}
              >
                <Bold size={18} />
                <span>{t('mobile.bold', 'Bold')}</span>
              </button>
              <button
                type="button"
                className="hybrid-format-tile"
                onClick={() => {
                  closeMoreSheet();
                  editorRef.current?.applyFormat('italic');
                }}
              >
                <Italic size={18} />
                <span>{t('mobile.italic', 'Italic')}</span>
              </button>
              <button
                type="button"
                className="hybrid-format-tile"
                onClick={() => {
                  closeMoreSheet();
                  editorRef.current?.applyFormat('strikethrough');
                }}
              >
                <Strikethrough size={18} />
                <span>{t('mobile.strike', 'Strike')}</span>
              </button>
              <button
                type="button"
                className="hybrid-format-tile"
                onClick={() => {
                  closeMoreSheet();
                  editorRef.current?.applyFormat('highlight');
                }}
              >
                <Highlighter size={18} />
                <span>{t('mobile.highlight', 'Highlight')}</span>
              </button>
              <button
                type="button"
                className="hybrid-format-tile"
                onClick={() => {
                  closeMoreSheet();
                  editorRef.current?.applyFormat('code');
                }}
              >
                <Code size={18} />
                <span>{t('mobile.inlineCode', 'Code')}</span>
              </button>
              <button
                type="button"
                className="hybrid-format-tile"
                onClick={() => {
                  closeMoreSheet();
                  editorRef.current?.outdent();
                }}
              >
                <Outdent size={18} />
                <span>{t('mobile.outdent', 'Outdent')}</span>
              </button>
            </div>

            {/* Bottom Section: Large 48px Action Rows */}
            <div className="bottom-sheet-section">
              <button
                type="button"
                className="bottom-sheet-action-btn"
                onClick={() => {
                  closeMoreSheet();
                  editorRef.current?.insertList('bullet');
                }}
              >
                <List size={18} />
                <span>{t('mobile.bulletList', 'Bulleted List')}</span>
              </button>
              <button
                type="button"
                className="bottom-sheet-action-btn"
                onClick={() => {
                  closeMoreSheet();
                  editorRef.current?.insertList('number');
                }}
              >
                <ListOrdered size={18} />
                <span>{t('mobile.numberedList', 'Numbered List')}</span>
              </button>
              <button
                type="button"
                className="bottom-sheet-action-btn"
                onClick={() => setMoreSubmenu('table')}
              >
                <Table size={18} />
                <span>{t('mobile.insertTable', 'Insert Table')}</span>
              </button>
              <button
                type="button"
                className="bottom-sheet-action-btn"
                onClick={() => setMoreSubmenu('callout')}
              >
                <MessageSquare size={18} />
                <span>{t('mobile.insertCallout', 'Insert Callout')}</span>
              </button>
              <button
                type="button"
                className="bottom-sheet-action-btn"
                onClick={() => {
                  closeMoreSheet();
                  editorRef.current?.insertCodeBlock();
                }}
              >
                <FileCode size={18} />
                <span>{t('mobile.codeBlock', 'Insert Code Block')}</span>
              </button>
              <button
                type="button"
                className="bottom-sheet-action-btn"
                onClick={() => {
                  closeMoreSheet();
                  editorRef.current?.insertHorizontalRule();
                }}
              >
                <Minus size={18} />
                <span>{t('mobile.horizontalRule', 'Horizontal Rule')}</span>
              </button>
              <button
                type="button"
                className="bottom-sheet-action-btn"
                onClick={() => {
                  closeMoreSheet();
                  editorRef.current?.insertTag(true);
                }}
              >
                <Hash size={18} />
                <span>{t('mobile.insertTag', 'Insert #Tag')}</span>
              </button>
              <button
                type="button"
                className="bottom-sheet-action-btn"
                onClick={() => {
                  closeMoreSheet();
                  onSendToTarget();
                }}
              >
                <Target size={18} />
                <span>{t('mobile.sendToTarget', 'Send to Target Note')}</span>
              </button>
            </div>
          </>
        )}

        {moreSubmenu === 'table' && (
          <div className="bottom-sheet-section">
            {[
              { rows: 2, cols: 2, label: '2 × 2' },
              { rows: 3, cols: 3, label: '3 × 3' },
              { rows: 4, cols: 4, label: '4 × 4' },
            ].map((size) => (
              <button
                key={size.label}
                type="button"
                className="bottom-sheet-action-btn"
                onClick={() => {
                  closeMoreSheet();
                  editorRef.current?.insertTable(size.rows, size.cols);
                }}
              >
                <Table size={18} />
                <span>{size.label}</span>
              </button>
            ))}
          </div>
        )}

        {moreSubmenu === 'callout' && (
          <div className="bottom-sheet-section">
            {['NOTE', 'TIP', 'WARNING', 'INFO'].map((type) => (
              <button
                key={type}
                type="button"
                className="bottom-sheet-action-btn"
                onClick={() => {
                  closeMoreSheet();
                  editorRef.current?.insertCallout(type);
                }}
              >
                <MessageSquare size={18} />
                <span>{type}</span>
              </button>
            ))}
          </div>
        )}
      </BottomSheet>
    </>
  );
};
