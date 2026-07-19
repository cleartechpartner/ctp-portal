import { useState, useEffect } from 'react';
import Papa from 'papaparse';
import { supabase } from '../lib/supabase';
import { PRIORITIES } from '../lib/prospects';

// CSV import for prospects. Client-side parse, preview with per-row
// validation, then insert-only upsert: rows never update existing clients,
// so Active clients can never be touched by an import. Dedupe is a
// case-insensitive name match against every existing client (and against
// earlier rows in the same file); matches are skipped and reported.

// The literal string [verify] means "unknown" in CTP research sheets and
// must import as null, never as text.
const scrub = (v) => {
  const s = String(v ?? '').trim();
  if (!s || s.toLowerCase() === '[verify]') return null;
  return s;
};

const normPriority = (v) =>
  PRIORITIES.find(p => p.toLowerCase() === String(v || '').trim().toLowerCase()) || 'Medium';

const STATUS_LABEL = { ok: 'Ready', skip: 'Skip', bad: 'Invalid' };

export default function ProspectImport({ myProfile, onClose, onImported, toast }) {
  const [existing, setExisting] = useState(null); // lowercase name set of every client
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState(null);
  const [parseErr, setParseErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.from('clients').select('name');
      if (error) { setParseErr('Could not load existing clients: ' + error.message); setExisting(new Set()); return; }
      setExisting(new Set((data || []).map(c => c.name.trim().toLowerCase())));
    })();
  }, []);

  const pickFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setFileName(file.name);
    setParseErr('');
    setDone(null);
    Papa.parse(file, {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: h => h.trim().toLowerCase(),
      complete: (res) => {
        const seen = new Set(existing || []);
        const out = (res.data || []).map((r) => {
          const name = scrub(r.company_name);
          // Unquoted commas in the trailing notes column overflow into
          // __parsed_extra; stitch them back so notes never truncate.
          const rawNotes = [r.notes, ...(Array.isArray(r.__parsed_extra) ? r.__parsed_extra : [])]
            .filter(x => x != null).join(',');
          const row = {
            name,
            property_type: scrub(r.type),
            segment: scrub(r.segment),
            locality: scrub(r.locality),
            ownership: scrub(r.ownership),
            website: scrub(r.website),
            phone: scrub(r.phone),
            priority: normPriority(scrub(r.priority)),
            source: scrub(r.source),
            partner_notes: scrub(rawNotes),
          };
          if (!name) return { row, status: 'bad', reason: 'Missing company_name' };
          const key = name.toLowerCase();
          if (seen.has(key)) return { row, status: 'skip', reason: 'Already exists, left untouched' };
          seen.add(key);
          return { row, status: 'ok', reason: 'Ready to import' };
        });
        setRows(out);
        const hardErrors = (res.errors || []).filter(e => e.code !== 'TooManyFields');
        if (hardErrors.length) setParseErr(`${hardErrors.length} row(s) had parse warnings; check the preview.`);
      },
      error: (e) => setParseErr(e.message),
    });
    e.target.value = '';
  };

  const doImport = async () => {
    const ok = (rows || []).filter(r => r.status === 'ok');
    if (!ok.length) return;
    setBusy(true);
    try {
      // Insert only. Every row lands as a fresh prospect at the top of the
      // pipeline; nothing here can modify an existing clients row.
      const payload = ok.map(({ row }) => ({ ...row, client_status: 'prospect', pipeline_stage: 'New' }));
      const { data: created, error } = await supabase.from('clients').insert(payload).select('id, name');
      if (error) throw new Error(error.message);

      const interactions = (created || []).map(c => ({
        client_id: c.id,
        kind: 'import',
        title: 'Added from CSV import',
        body: fileName,
        created_by: myProfile?.id || null,
        metadata: { file: fileName },
      }));
      if (interactions.length) {
        const { error: iErr } = await supabase.from('interactions').insert(interactions);
        if (iErr) throw new Error('Prospects created, but logging the import failed: ' + iErr.message);
      }

      setDone({
        imported: (created || []).length,
        skipped: rows.filter(r => r.status === 'skip').length,
        invalid: rows.filter(r => r.status === 'bad').length,
      });
      onImported();
    } catch (e) { toast('Import failed: ' + e.message); }
    setBusy(false);
  };

  const okCount = (rows || []).filter(r => r.status === 'ok').length;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal pr-import-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Import prospects from CSV</h3>
          <button type="button" className="link-btn" onClick={onClose}>Close</button>
        </div>

        {done ? (
          <>
            <div className="auth-ok">
              Imported {done.imported} prospect{done.imported === 1 ? '' : 's'}.
              {done.skipped > 0 && ` Skipped ${done.skipped} already in the portal.`}
              {done.invalid > 0 && ` ${done.invalid} invalid row${done.invalid === 1 ? '' : 's'} ignored.`}
            </div>
            <div className="modal-foot">
              <button className="btn sm" onClick={onClose}>Done</button>
            </div>
          </>
        ) : (
          <>
            <div className="sub" style={{ marginBottom: 12 }}>
              Expected columns: company_name, type, segment, locality, ownership, website, phone,
              priority, source, notes. Fields marked [verify] import as empty. Existing clients are
              never overwritten; matching names are skipped.
            </div>

            <label className="btn sm gh" style={{ cursor: existing ? 'pointer' : 'wait', display: 'inline-block' }}>
              {rows ? 'Choose a different file' : 'Choose CSV file'}
              <input type="file" hidden accept=".csv,text/csv" onChange={pickFile} disabled={!existing || busy} />
            </label>
            {fileName && <span className="sub" style={{ marginLeft: 10 }}>{fileName}</span>}

            {parseErr && <div className="auth-err" style={{ marginTop: 12 }}>{parseErr}</div>}

            {rows && (
              <>
                <div className="sub" style={{ marginTop: 14 }}>
                  <b>{rows.length}</b> row{rows.length === 1 ? '' : 's'} parsed · <b>{okCount}</b> ready ·{' '}
                  {rows.filter(r => r.status === 'skip').length} skipped · {rows.filter(r => r.status === 'bad').length} invalid
                </div>
                <div style={{ maxHeight: '44vh', overflow: 'auto', marginTop: 4 }}>
                  <table className="pr-import-tbl">
                    <thead>
                      <tr><th>#</th><th>Company</th><th>Locality</th><th>Priority</th><th>Notes</th><th>Status</th></tr>
                    </thead>
                    <tbody>
                      {rows.map((r, i) => (
                        <tr key={i} className={r.status === 'ok' ? '' : 'skip'}>
                          <td>{i + 1}</td>
                          <td>{r.row.name || '(blank)'}</td>
                          <td>{r.row.locality || ''}</td>
                          <td>{r.row.priority}</td>
                          <td>{(r.row.partner_notes || '').slice(0, 60)}{(r.row.partner_notes || '').length > 60 ? '...' : ''}</td>
                          <td>
                            <span className={`pr-import-status ${r.status}`} title={r.reason}>{STATUS_LABEL[r.status]}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="modal-foot">
                  <button className="btn gh sm" onClick={onClose} disabled={busy}>Cancel</button>
                  <button className="btn sm" onClick={doImport} disabled={busy || !okCount}>
                    {busy ? 'Importing...' : `Import ${okCount} prospect${okCount === 1 ? '' : 's'}`}
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
