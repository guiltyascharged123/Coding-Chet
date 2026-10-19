import { useState } from 'react';
import { ArrowDownToLine, Loader2, Printer } from 'lucide-react';
import { download, saveBlob } from '../api';
import { filename, wordDocument, workbookDocument } from '../documents/export';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export default function DocumentActions({
  title,
  content,
  all = false,
}: {
  title: string;
  content: string;
  all?: boolean;
}) {
  const [format, setFormat] = useState('docx'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function exportFile() {
    setBusy(true);
    setError('');
    try {
      if (format === 'md') download(filename(title, 'md'), content);
      else {
        saveBlob(
          filename(title, format),
          await (format === 'docx'
            ? wordDocument(title, content)
            : workbookDocument(title, content)),
        );
      }
    } catch {
      setError('The document could not be exported. Please try again.');
    } finally {
      setBusy(false);
    }
  }
  async function print() {
    setError('');
    try {
      // Render through the same Markdown sanitizer as the document viewer, then
      // print an isolated, light paper layout without changing the dashboard.
      const { renderToStaticMarkup } = await import('react-dom/server');
      const frame = document.createElement('iframe');
      frame.title = 'Print document';
      frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
      document.body.append(frame);
      const doc = frame.contentDocument;
      if (!doc) {
        frame.remove();
        setError('Printing is unavailable in this browser.');
        return;
      }
      doc.open();
      doc.write('<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>');
      doc.close();
      doc.title = title;
      const style = doc.createElement('style');
      style.textContent =
        '@page{margin:18mm}body{font:12pt/1.55 Arial,sans-serif;color:#26333d}h1{font-size:24pt}h2{font-size:17pt;break-after:avoid}table{border-collapse:collapse;width:100%;font-size:10pt;overflow-wrap:anywhere}td,th{padding:7px;border:1px solid #aab4bc;text-align:left}th{background:#e7ebee}tr{break-inside:avoid}pre{white-space:pre-wrap}blockquote{border-left:3px solid #8795a0;padding-left:12px}';
      doc.head.append(style);
      doc.body.innerHTML = renderToStaticMarkup(
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>,
      );
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
      // Keep the frame alive until the print preview has consumed its contents.
      setTimeout(() => frame.remove(), 60000);
    } catch {
      setError('The print view could not be opened. Please try again.');
    }
  }
  return (
    <div className="document-export">
      <label className="sr-only" htmlFor={`export-${all ? 'all' : 'document'}`}>
        Download format
      </label>
      <select
        id={`export-${all ? 'all' : 'document'}`}
        value={format}
        onChange={(e) => setFormat(e.target.value)}
        aria-label="Download format"
      >
        <option value="docx">Word (.docx)</option>
        <option value="xlsx">Excel (.xlsx)</option>
        <option value="md">Markdown (.md)</option>
      </select>
      <button className="button secondary small" disabled={busy} onClick={exportFile}>
        {busy ? <Loader2 className="spin" size={16} /> : <ArrowDownToLine size={16} />}{' '}
        {all ? 'Download all' : 'Download document'}
      </button>
      <button
        className="button secondary small"
        onClick={print}
        title="Use your browser’s Save as PDF destination"
      >
        <Printer size={16} />
        Print / PDF
      </button>
      {error && <span role="alert">{error}</span>}
    </div>
  );
}
