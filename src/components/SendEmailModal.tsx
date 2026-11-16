import React, { useState } from 'react';
import { jsPDF } from 'jspdf';
import { FileCode2, FileText, Mail, X } from 'lucide-react';
import { api } from '../api';
import { useTranslation } from '../i18n';
import { stripZencExt } from '../crypto/folderCrypto';
import { renderReadingHtml } from '../utils/readingMode';
import { mountReadingCanvasAndBaseEmbeds } from '../utils/readingEmbeds';
import {
  captureElementToPng,
  sanitizePdfText,
  waitForEmbedsToRender,
} from '../utils/pdfExport';

export type EmailPdfNoteItem = {
  path: string;
  name: string;
  basename: string;
} & Record<string, any>;

export interface SendEmailModalProps {
  notePath: string;
  noteBody: string;
  allNotes?: EmailPdfNoteItem[];
  defaultRecipient?: string;
  attachmentLabel?: string;
  onClose: () => void;
  onSent: (recipient: string) => void;
}

async function generateClientPdfBase64(
  title: string,
  body: string,
  notePath: string,
  allNotes: EmailPdfNoteItem[],
  attachmentLabel: string
): Promise<string> {
  const html = renderReadingHtml(body, notePath, allNotes, {
    attachmentLabel,
    pageBreakLabel: 'Page Break',
  });

  // Convert rendered Reading Mode HTML into structured PDF + captured visual embeds
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 18;
  const maxWidth = pageWidth - margin * 2;
  let y = 20;

  const ensureSpace = (neededMm: number) => {
    if (y + neededMm > pageHeight - margin) {
      doc.addPage();
      y = margin;
    }
  };

  // Document title header if body doesn't start with H1
  if (!/^#\s+/m.test(body.trim())) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.setTextColor(17, 24, 39);
    const titleLines = doc.splitTextToSize(sanitizePdfText(title), maxWidth);
    doc.text(titleLines, margin, y);
    y += titleLines.length * 7.5 + 4;
  }

  if (typeof document !== 'undefined' && document.body) {
    const exportContainer = document.createElement('div');
    exportContainer.className = 'reading-view-container markdown-rendered pdf-export-capture';
    exportContainer.style.position = 'fixed';
    exportContainer.style.left = '-99999px';
    exportContainer.style.top = '0';
    exportContainer.style.width = '794px';
    exportContainer.style.background = '#ffffff';
    exportContainer.style.color = '#111827';
    exportContainer.style.padding = '24px';
    exportContainer.style.pointerEvents = 'none';
    exportContainer.style.zIndex = '-1';
    exportContainer.innerHTML = html;
    document.body.appendChild(exportContainer);

    const unmountEmbeds = mountReadingCanvasAndBaseEmbeds(exportContainer, {
      allNotes,
      notePath,
    });

    try {
      await waitForEmbedsToRender(exportContainer);

      const nodes = Array.from(exportContainer.children) as HTMLElement[];
      for (const el of nodes) {
        const tag = el.tagName.toLowerCase();
        if (el.classList.contains('print-page-break')) {
          doc.addPage();
          y = margin;
          continue;
        }

        if (
          el.classList.contains('embedded-canvas-container') ||
          el.classList.contains('embedded-base-container')
        ) {
          const captured = await captureElementToPng(el);
          if (captured && captured.width > 0 && captured.height > 0) {
            const maxImgHeight = pageHeight - margin * 2;
            let imgW = maxWidth;
            let imgH = (captured.height / captured.width) * imgW;
            if (imgH > maxImgHeight) {
              const ratio = maxImgHeight / imgH;
              imgH = maxImgHeight;
              imgW *= ratio;
            }
            ensureSpace(imgH + 4);
            doc.addImage(captured.dataUrl, 'PNG', margin, y, imgW, imgH);
            y += imgH + 5;
            continue;
          }
        }

        if (el.classList.contains('reading-pdf-embed')) {
          const calloutText = sanitizePdfText(
            el.querySelector('.print-pdf-attachment-callout')?.textContent ||
              `${attachmentLabel}: PDF`
          );
          ensureSpace(12);
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(10.5);
          doc.setTextColor(15, 23, 42);
          doc.text(`[PDF] ${calloutText}`, margin + 2, y);
          y += 8;
          continue;
        }

        const rawText = sanitizePdfText((el.textContent || '').replace(/\s+\n/g, '\n'));
        if (!rawText) continue;

        if (tag === 'h1' || tag === 'h2' || tag === 'h3') {
          const size = tag === 'h1' ? 17 : tag === 'h2' ? 14 : 12;
          const lineH = size * 0.42;
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(size);
          doc.setTextColor(17, 24, 39);
          const wrapped = doc.splitTextToSize(rawText, maxWidth);
          ensureSpace(wrapped.length * lineH + 4);
          doc.text(wrapped, margin, y);
          y += wrapped.length * lineH + 3.5;
        } else if (tag === 'pre' || el.classList.contains('codeblock-container')) {
          doc.setFont('courier', 'normal');
          doc.setFontSize(9.5);
          doc.setTextColor(31, 41, 55);
          const wrapped = doc.splitTextToSize(rawText, maxWidth - 4);
          ensureSpace(wrapped.length * 4.5 + 4);
          doc.text(wrapped, margin + 2, y);
          y += wrapped.length * 4.5 + 3;
        } else {
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(11);
          doc.setTextColor(17, 24, 39);
          const wrapped = doc.splitTextToSize(rawText, maxWidth);
          ensureSpace(wrapped.length * 5.2 + 3);
          doc.text(wrapped, margin, y);
          y += wrapped.length * 5.2 + 2.5;
        }
      }
    } finally {
      unmountEmbeds();
      exportContainer.remove();
    }
  } else {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    const wrapped = doc.splitTextToSize(sanitizePdfText(body), maxWidth);
    doc.text(wrapped, margin, y);
  }

  const dataUri = doc.output('datauristring');
  const commaIdx = dataUri.indexOf(',');
  return commaIdx >= 0 ? dataUri.slice(commaIdx + 1) : dataUri;
}

export const SendEmailModal: React.FC<SendEmailModalProps> = ({
  notePath,
  noteBody,
  allNotes = [],
  defaultRecipient = '',
  attachmentLabel = 'Attachment',
  onClose,
  onSent,
}) => {
  const { t } = useTranslation();
  const cleanTitle = (stripZencExt(notePath).split('/').pop() || 'Note').replace(/\.md$/i, '');

  const [to, setTo] = useState(defaultRecipient);
  const [subject, setSubject] = useState(cleanTitle);
  const [message, setMessage] = useState('');
  const [format, setFormat] = useState<'md' | 'pdf'>('md');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanTo = to.trim();
    if (!cleanTo) {
      setError(t('email.toRequired'));
      return;
    }

    setBusy(true);
    setError(null);
    try {
      let pdfBase64: string | undefined;
      if (format === 'pdf') {
        pdfBase64 = await generateClientPdfBase64(
          cleanTitle,
          noteBody,
          notePath,
          allNotes,
          attachmentLabel
        );
      }

      await api.sendNoteByEmail({
        notePath: stripZencExt(notePath),
        to: cleanTo,
        subject: subject.trim() || cleanTitle,
        message: message.trim() || undefined,
        format,
        pdfBase64,
      });
      onSent(cleanTo);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send email');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-dialog send-email-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Mail size={18} />
            <span>{t('email.modalTitle')}</span>
          </h3>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="send-email-form">
          <div className="settings-field">
            <label htmlFor="email-to">{t('email.to')}</label>
            <input
              id="email-to"
              type="text"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder={t('email.toPlaceholder')}
              autoFocus
            />
          </div>

          <div className="settings-field">
            <label htmlFor="email-subject">{t('email.subject')}</label>
            <input
              id="email-subject"
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </div>

          <div className="settings-field">
            <label>{t('email.format')}</label>
            <div className="email-format-pills">
              <button
                type="button"
                className={`email-format-pill ${format === 'md' ? 'active' : ''}`}
                onClick={() => setFormat('md')}
              >
                <FileCode2 size={14} />
                <span>{t('email.formatMd')}</span>
              </button>
              <button
                type="button"
                className={`email-format-pill ${format === 'pdf' ? 'active' : ''}`}
                onClick={() => setFormat('pdf')}
              >
                <FileText size={14} />
                <span>{t('email.formatPdf')}</span>
              </button>
            </div>
          </div>

          <div className="settings-field">
            <label htmlFor="email-message">{t('email.message')}</label>
            <textarea
              id="email-message"
              rows={3}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={t('email.messagePlaceholder')}
            />
          </div>

          {error && <div className="settings-feedback error">{error}</div>}

          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>
              {t('common.cancel')}
            </button>
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? t('email.sendingBtn') : t('email.sendBtn')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
