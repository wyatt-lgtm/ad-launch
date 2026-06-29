'use client';

import { useRef, useState } from 'react';
import {
  X, UploadCloud, FileText, Loader2, CheckCircle2, AlertTriangle,
  AlertCircle, Copy, Download, Play, ArrowLeft,
} from 'lucide-react';

const LABEL = (s?: string | null) => (s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

type Row = {
  rowNumber: number;
  keyword: string;
  parsedKeyword: string;
  locationText: string;
  locationType: string;
  city: string | null;
  state: string | null;
  zip: string | null;
  priority: string;
  serviceLine: string | null;
  status: 'ready' | 'duplicate' | 'needs_review' | 'invalid' | 'over_limit';
  error: string | null;
};

const STATUS_STYLE: Record<string, string> = {
  ready: 'bg-green-100 text-green-700',
  needs_review: 'bg-amber-100 text-amber-700',
  duplicate: 'bg-gray-100 text-gray-600',
  invalid: 'bg-red-100 text-red-700',
  over_limit: 'bg-red-100 text-red-700',
};
const STATUS_ICON: Record<string, any> = {
  ready: CheckCircle2, needs_review: AlertTriangle, duplicate: Copy, invalid: AlertCircle, over_limit: AlertCircle,
};

export default function KeywordUploadModal({
  businessId, onClose, onImported, showToast,
}: {
  businessId: string;
  onClose: () => void;
  onImported: () => void;
  showToast: (ok: boolean, msg: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileType, setFileType] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [summary, setSummary] = useState<any>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<any>(null);
  const [running, setRunning] = useState(false);

  const api = (p: string) => `/api/businesses/${businessId}/search-intelligence/${p}`;

  const reset = () => {
    setFileName(null); setFileType(null); setRows(null); setSummary(null);
    setFileError(null); setImportResult(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  const handleFile = async (f: File) => {
    setFileError(null); setRows(null); setSummary(null); setImportResult(null);
    setFileName(f.name);
    if (f.size > 1024 * 1024) { setFileError('File is too large. Maximum size is 1 MB.'); return; }
    const ext = (f.name.split('.').pop() || '').toLowerCase();
    if (!['csv', 'tsv', 'txt'].includes(ext)) {
      setFileError('Unsupported file type. Upload a CSV, TSV, or TXT file.');
      return;
    }
    setPreviewing(true);
    try {
      const fd = new FormData();
      fd.append('file', f);
      const res = await fetch(api('keyword-upload/preview'), { method: 'POST', body: fd });
      const json = await res.json();
      if (!res.ok) { setFileError(json?.error || 'Could not parse file.'); setPreviewing(false); return; }
      setRows(json.rows || []);
      setSummary(json.summary || null);
      setFileType(json.fileType || null);
    } catch (e: any) {
      setFileError(e?.message || 'Upload failed.');
    }
    setPreviewing(false);
  };

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
  };

  const importableRows = (rows || []).filter((r) => r.status === 'ready' || r.status === 'needs_review');

  const doImport = async () => {
    if (importableRows.length === 0) return;
    setImporting(true);
    try {
      const res = await fetch(api('keyword-upload/import'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName, fileType, rows: importableRows }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Import failed');
      setImportResult(json.summary);
      showToast(true, `${json.summary.imported} row(s) imported`);
      onImported();
    } catch (e: any) {
      showToast(false, e?.message || 'Import failed');
    }
    setImporting(false);
  };

  const runSearch = async () => {
    setRunning(true);
    try {
      const res = await fetch(api('run'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runType: 'manual_search_intelligence' }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Failed to start run');
      showToast(true, 'Search Intelligence run queued');
      onClose();
    } catch (e: any) {
      showToast(false, e?.message || 'Failed to start run');
    }
    setRunning(false);
  };

  const downloadErrorReport = () => {
    if (!rows) return;
    // Build a formula-injection-safe CSV (every value passed through the escape).
    const esc = (v: any) => {
      let s = (v ?? '').toString();
      if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
      if (/[",\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const header = ['Row', 'Keyword', 'Parsed Location', 'Type', 'City', 'State', 'ZIP', 'Priority', 'Service Line', 'Status', 'Error/Warning'];
    const lines = [header.join(',')];
    for (const r of rows) {
      lines.push([r.rowNumber, r.keyword, r.locationText, r.locationType, r.city, r.state, r.zip, r.priority, r.serviceLine, r.status, r.error].map(esc).join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `keyword-import-report.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl my-8">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <UploadCloud className="w-5 h-5 text-blue-600" />
            <h3 className="text-lg font-bold text-gray-900">Upload Keywords</h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X className="w-5 h-5" /></button>
        </div>

        <div className="px-6 py-5">
          {/* Step 3: import done */}
          {importResult ? (
            <div className="text-center py-6">
              <CheckCircle2 className="w-14 h-14 text-green-500 mx-auto mb-3" />
              <h4 className="text-xl font-bold text-gray-900 mb-1">Import complete</h4>
              <p className="text-gray-500 mb-5">Your keywords and service areas have been added.</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 max-w-2xl mx-auto mb-6">
                <Stat label="Imported" value={importResult.imported} tone="green" />
                <Stat label="Duplicates skipped" value={importResult.duplicatesSkipped} tone="gray" />
                <Stat label="Need review" value={importResult.needsReview} tone="amber" />
                <Stat label="Invalid rejected" value={importResult.invalidRejected} tone="red" />
              </div>
              <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 max-w-2xl mx-auto">
                <p className="text-sm font-medium text-gray-800 mb-3">Ready to run Search Intelligence for these keywords?</p>
                <div className="flex items-center justify-center gap-3">
                  <button onClick={runSearch} disabled={running}
                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">
                    {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />} Run Search Intelligence
                  </button>
                  <button onClick={onClose} className="px-5 py-2.5 border border-gray-300 text-gray-700 rounded-lg text-sm font-semibold hover:bg-gray-50">Not now</button>
                </div>
              </div>
            </div>
          ) : rows ? (
            /* Step 2: preview */
            <div>
              <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <FileText className="w-4 h-4" /> <span className="font-medium text-gray-800">{fileName}</span>
                  <span className="text-gray-400">· {rows.length} row(s)</span>
                </div>
                {summary && (
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <Badge n={summary.ready} label="ready" cls="bg-green-100 text-green-700" />
                    <Badge n={summary.needsReview} label="need review" cls="bg-amber-100 text-amber-700" />
                    <Badge n={summary.duplicate} label="duplicate" cls="bg-gray-100 text-gray-600" />
                    <Badge n={summary.invalid} label="invalid" cls="bg-red-100 text-red-700" />
                  </div>
                )}
              </div>
              <div className="border border-gray-200 rounded-xl overflow-hidden overflow-x-auto max-h-[46vh] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-gray-500 text-xs uppercase sticky top-0"><tr>
                    <th className="text-left px-3 py-2">#</th>
                    <th className="text-left px-3 py-2">Keyword</th>
                    <th className="text-left px-3 py-2">Parsed Location</th>
                    <th className="text-left px-3 py-2">Type</th>
                    <th className="text-left px-3 py-2">City</th>
                    <th className="text-left px-3 py-2">State</th>
                    <th className="text-left px-3 py-2">ZIP</th>
                    <th className="text-left px-3 py-2">Priority</th>
                    <th className="text-left px-3 py-2">Service Line</th>
                    <th className="text-left px-3 py-2">Status</th>
                    <th className="text-left px-3 py-2">Error / Warning</th>
                  </tr></thead>
                  <tbody className="divide-y divide-gray-100">
                    {rows.map((r) => {
                      const Icon = STATUS_ICON[r.status] || AlertCircle;
                      return (
                        <tr key={r.rowNumber} className="hover:bg-gray-50">
                          <td className="px-3 py-2 text-gray-400">{r.rowNumber}</td>
                          <td className="px-3 py-2 font-medium text-gray-900">{r.keyword || <span className="text-red-500">—</span>}</td>
                          <td className="px-3 py-2 text-gray-700">{r.locationText || '—'}</td>
                          <td className="px-3 py-2 text-gray-500">{LABEL(r.locationType)}</td>
                          <td className="px-3 py-2 text-gray-600">{r.city || '—'}</td>
                          <td className="px-3 py-2 text-gray-600">{r.state || '—'}</td>
                          <td className="px-3 py-2 text-gray-600">{r.zip || '—'}</td>
                          <td className="px-3 py-2 text-gray-600">{LABEL(r.priority)}</td>
                          <td className="px-3 py-2 text-gray-600">{r.serviceLine || '—'}</td>
                          <td className="px-3 py-2">
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${STATUS_STYLE[r.status]}`}>
                              <Icon className="w-3 h-3" /> {LABEL(r.status)}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-xs text-gray-500 max-w-[200px]">{r.error || '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 mt-4">
                <div className="flex items-center gap-2">
                  <button onClick={reset} className="inline-flex items-center gap-1.5 px-3 py-2 text-sm text-gray-600 hover:text-gray-900"><ArrowLeft className="w-4 h-4" /> Choose another file</button>
                  <button onClick={downloadErrorReport} className="inline-flex items-center gap-1.5 px-3 py-2 text-sm text-gray-600 hover:text-gray-900"><Download className="w-4 h-4" /> Download report</button>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={onClose} className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm font-semibold hover:bg-gray-50">Cancel</button>
                  <button onClick={doImport} disabled={importing || importableRows.length === 0}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">
                    {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                    Import {importableRows.length} valid row(s)
                  </button>
                </div>
              </div>
            </div>
          ) : (
            /* Step 1: file picker */
            <div>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="w-full border-2 border-dashed border-gray-300 rounded-xl py-10 px-6 text-center hover:border-blue-400 hover:bg-blue-50/40 transition-colors">
                {previewing ? (
                  <Loader2 className="w-8 h-8 text-blue-600 animate-spin mx-auto" />
                ) : (
                  <UploadCloud className="w-10 h-10 text-gray-400 mx-auto mb-2" />
                )}
                <p className="text-sm font-medium text-gray-800">{previewing ? 'Parsing file…' : 'Click to choose a file'}</p>
                <p className="text-xs text-gray-500 mt-1">CSV, TSV or TXT · up to 30 rows · max 1 MB</p>
              </button>
              <input ref={fileRef} type="file" accept=".csv,.tsv,.txt,text/csv,text/plain,text/tab-separated-values" className="hidden" onChange={onPick} />
              {fileError && (
                <div className="mt-3 flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-sm">
                  <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" /> <span>{fileError}</span>
                </div>
              )}
              <div className="mt-5 bg-gray-50 border border-gray-200 rounded-xl p-4 text-xs text-gray-600 space-y-2">
                <p className="font-semibold text-gray-700">Accepted formats</p>
                <p><span className="font-medium">Simple CSV:</span> a <code>keyword,location</code> header, then rows like <code>Transmission Flush,Houston TX</code> or <code>Transmission Flush,77041</code>.</p>
                <p><span className="font-medium">Expanded CSV:</span> optional columns <code>keyword,city,state,zip,county,priority,service_line,market_orientation,intent</code>.</p>
                <p><span className="font-medium">Text/TSV:</span> one pair per line — <code>keyword[tab]location</code> or <code>keyword, location</code>.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Badge({ n, label, cls }: { n: number; label: string; cls: string }) {
  if (!n) return null;
  return <span className={`px-2 py-0.5 rounded-full font-medium ${cls}`}>{n} {label}</span>;
}
function Stat({ label, value, tone }: { label: string; value: number; tone: 'green' | 'gray' | 'amber' | 'red' }) {
  const toneCls = {
    green: 'text-green-600', gray: 'text-gray-700', amber: 'text-amber-600', red: 'text-red-600',
  }[tone];
  return (
    <div className="bg-gray-50 border border-gray-200 rounded-xl py-3">
      <div className={`text-2xl font-bold ${toneCls}`}>{value}</div>
      <div className="text-[11px] text-gray-500 mt-0.5">{label}</div>
    </div>
  );
}
