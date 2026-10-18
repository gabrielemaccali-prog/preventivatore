import { useState, useEffect, useMemo, Fragment } from 'react'
import * as XLSX from 'xlsx'
import { supabase, leggiTutte } from '../../lib/supabaseClient'
import { costruisciClienti } from '../../lib/clienti'
import { formattaDataGGMMAAAA } from '../../lib/utils'
import { etichettaStatoPren, etichettaStatoVoucher, etichettaStatoPreventivo, classeBadgeStato } from '../../lib/costanti'
import { useOrdinamentoTabella } from '../../lib/ordinamentoTabella'

// Anagrafica clienti in sola lettura: si ricostruisce ogni volta da preventivi, prenotazioni e
// voucher (vedi lib/clienti.js). Per correggere un dato si corregge il documento da cui viene.

const stileInput = { height: '36px', boxSizing: 'border-box', padding: '6px 10px', fontSize: '0.85rem', border: '1px solid #ccc', borderRadius: '4px' };
const testoVuoto = <span style={{ color: '#cbd5e1' }}>—</span>;
const euro = (n) => `€${(Number(n) || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const ETICHETTA_FONTE = { preventivo: 'Preventivo', prenotazione: 'Prenotazione', voucher: 'Voucher' };
const etichettaStato = (d) => (d.fonte === 'prenotazione' ? etichettaStatoPren(d.stato)
  : d.fonte === 'voucher' ? etichettaStatoVoucher(d.stato) : etichettaStatoPreventivo(d.stato));
const oggiIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

function Clienti() {
  const [dati, setDati] = useState({ prenotazioni: [], voucher: [], preventivi: [] });
  const [caricamento, setCaricamento] = useState(true);
  const [errore, setErrore] = useState(null);
  const [cerca, setCerca] = useState('');
  const [filtroTipo, setFiltroTipo] = useState('');
  // Di norma si guarda chi ha comprato: chi ha chiesto solo un preventivo è un contatto.
  const [filtroRelazione, setFiltroRelazione] = useState('clienti');
  const [espanso, setEspanso] = useState(null);

  useEffect(() => {
    (async () => {
      const [pr, vc, pv] = await Promise.all([
        leggiTutte(() => supabase.from('prenotazioni').select('*').order('id')),
        leggiTutte(() => supabase.from('voucher').select('*').order('codice')),
        leggiTutte(() => supabase.from('preventivi').select('codice, dataEmissione, destinazione, periodo, stato, nomeReferente, emailReferente, telefonoReferente').order('codice')),
      ]);
      const err = pr.error || vc.error || pv.error;
      setErrore(err ? err.message : null);
      setDati({ prenotazioni: pr.data || [], voucher: vc.data || [], preventivi: pv.data || [] });
      setCaricamento(false);
    })();
  }, []);

  const clienti = useMemo(() => costruisciClienti(dati), [dati]);

  const COLONNE = [
    { chiave: 'nome', label: 'Cliente', valore: (c) => c.denominazione },
    { chiave: 'tipo', label: 'Tipo', valore: (c) => c.tipo },
    { chiave: 'email', label: 'Email', valore: (c) => c.emails[0] || '' },
    { chiave: 'tel', label: 'Telefono', valore: (c) => c.telefoni[0] || '' },
    { chiave: 'piva', label: 'P.IVA', valore: (c) => c.piva },
    { chiave: 'cf', label: 'Codice fiscale', valore: (c) => c.cf },
    { chiave: 'citta', label: 'Comune', valore: (c) => c.citta },
    { chiave: 'prev', label: 'Prev.', stile: { textAlign: 'right' }, valore: (c) => c.preventivi },
    { chiave: 'pren', label: 'Pren.', stile: { textAlign: 'right' }, valore: (c) => c.prenotazioni },
    { chiave: 'vouch', label: 'Voucher', stile: { textAlign: 'right' }, valore: (c) => c.voucher },
    { chiave: 'speso', label: 'Speso', stile: { textAlign: 'right' }, valore: (c) => c.speso },
  ];
  const { ordina, propsTestata, frecciaOrdinamento } = useOrdinamentoTabella(
    Object.fromEntries(COLONNE.map(c => [c.chiave, c.valore]))
  );

  const visibili = clienti.filter(c => {
    if (filtroTipo && c.tipo !== filtroTipo) return false;
    const haComprato = c.prenotazioni + c.voucher > 0;
    if (filtroRelazione === 'clienti' && !haComprato) return false;
    if (filtroRelazione === 'contatti' && haComprato) return false;
    const t = cerca.trim().toLowerCase();
    if (t && ![c.denominazione, ...c.referenti, ...c.emails, ...c.telefoni, c.piva, c.cf, c.citta]
      .some(v => (v || '').toLowerCase().includes(t))) return false;
    return true;
  });
  const senzaFatturazione = visibili.filter(c => c.prenotazioni + c.voucher > 0 && !c.datiFatturazione).length;

  const esporta = () => {
    const righe = ordina(visibili).map(c => ({
      'Cliente': c.denominazione,
      'Tipo': c.tipo === 'azienda' ? 'Azienda' : 'Privato',
      'Referenti': c.referenti.join(', '),
      'Email': c.emails.join(', '),
      'Telefono': c.telefoni.join(', '),
      'P.IVA': c.piva, 'Codice fiscale': c.cf, 'SDI': c.sdi,
      'Indirizzo': c.indirizzo, 'CAP': c.cap, 'Comune': c.citta, 'Provincia': c.provincia,
      'Preventivi': c.preventivi, 'Prenotazioni': c.prenotazioni, 'Voucher': c.voucher,
      'Speso': c.speso,
      'Primo contatto': formattaDataGGMMAAAA(c.primoContatto), 'Ultima attività': formattaDataGGMMAAAA(c.ultimaAttivita),
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(righe), 'Clienti');
    XLSX.writeFile(wb, `Anagrafica_clienti_${oggiIso()}.xlsx`);
  };

  const cella = { padding: '9px 12px', verticalAlign: 'middle' };

  return (
    <div className="schermata-admin no-print" style={{ padding: '20px' }}>
      <h2>Clienti</h2>
      <p className="descrizione-pagina">
        Chi ci ha chiesto un preventivo, prenotato una partita o comprato un voucher, ricostruito dai documenti.
        Due documenti sono dello stesso cliente se hanno in comune <strong>P.IVA</strong>, <strong>codice fiscale</strong>,{' '}
        <strong>email</strong> o <strong>telefono</strong>, o se la prenotazione nasce da quel preventivo.
        I dati si leggono dal documento più recente che li ha: per correggerli si corregge il documento.
      </p>

      {errore && (
        <div style={{ margin: '14px 0', padding: '12px 16px', background: '#fdecea', border: '1px solid #f5c2c0', borderLeft: '4px solid #c62828', borderRadius: '4px', fontSize: '0.85rem' }}>
          Non è stato possibile leggere tutti i documenti: <em>{errore}</em>
        </div>
      )}

      {!caricamento && senzaFatturazione > 0 && (
        <div style={{ margin: '14px 0', padding: '12px 16px', background: '#e1f5fe', border: '1px solid #7dd3fc', borderLeft: '4px solid #0288d1', borderRadius: '4px', fontSize: '0.85rem', color: '#01579b' }}>
          <strong>{senzaFatturazione}</strong> {senzaFatturazione === 1 ? 'cliente che ha comprato non ha' : 'clienti che hanno comprato non hanno'} ancora
          codice fiscale (o P.IVA) e indirizzo: sono segnati con un punto arancione.
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '15px 0', gap: '10px', flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0 }}>{caricamento ? 'Caricamento…' : `Clienti (${visibili.length}${visibili.length !== clienti.length ? ` di ${clienti.length}` : ''})`}</h3>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          <select value={filtroRelazione} onChange={(e) => setFiltroRelazione(e.target.value)} style={stileInput}>
            <option value="clienti">Hanno comprato</option>
            <option value="contatti">Solo preventivi</option>
            <option value="">Tutti</option>
          </select>
          <select value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)} style={stileInput}>
            <option value="">Aziende e privati</option>
            <option value="azienda">Aziende</option>
            <option value="privato">Privati</option>
          </select>
          <input type="text" placeholder="Cerca nome, email, telefono, CF…" value={cerca} onChange={(e) => setCerca(e.target.value)} style={{ ...stileInput, width: '240px' }} />
          <button className="btn-preventivo" style={{ width: 'auto', marginTop: 0, padding: '8px 16px' }} disabled={visibili.length === 0} onClick={esporta}>Esporta Excel</button>
        </div>
      </div>

      <div className="admin-table-box" style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: '8px', maxHeight: 'none', overflowY: 'visible', overflowX: 'auto' }}>
        <table style={{ width: '100%', minWidth: '1120px', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
          <thead>
            <tr style={{ background: '#f5f5f5', borderBottom: '2px solid #ddd' }}>
              {COLONNE.map(c => {
                const { style: stileOrdinabile, ...propsOrdinabile } = propsTestata(c.chiave);
                return (
                  <th key={c.chiave} {...propsOrdinabile} style={{ padding: '10px 12px', color: '#444', ...c.stile, ...stileOrdinabile }}>
                    {c.label}{frecciaOrdinamento(c.chiave)}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {ordina(visibili).map(c => {
              const aperto = espanso === c.id;
              const altri = (lista) => (lista.length > 1 ? <span style={{ color: '#94a3b8' }} title={lista.slice(1).join('\n')}> +{lista.length - 1}</span> : null);
              return (
                <Fragment key={c.id}>
                  <tr onClick={() => setEspanso(aperto ? null : c.id)} style={{ borderBottom: '1px solid #eee', cursor: 'pointer', background: aperto ? '#f0f9ff' : undefined }}>
                    <td style={cella}>
                      <strong>{c.denominazione || testoVuoto}</strong>
                      {c.prenotazioni + c.voucher > 0 && !c.datiFatturazione && (
                        <span title="Mancano codice fiscale (o P.IVA) e indirizzo per fatturare" style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: '#f0a000', marginLeft: '6px' }} />
                      )}
                      {c.referenti.length > 0 && <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{c.referenti.join(', ')}</div>}
                    </td>
                    <td style={{ ...cella, color: '#555' }}>{c.tipo === 'azienda' ? 'Azienda' : 'Privato'}</td>
                    <td style={{ ...cella, color: '#555' }}>{c.emails[0] || testoVuoto}{altri(c.emails)}</td>
                    <td style={{ ...cella, color: '#555', whiteSpace: 'nowrap' }}>{c.telefoni[0] || testoVuoto}{altri(c.telefoni)}</td>
                    <td style={{ ...cella, color: '#555', fontFamily: 'monospace', fontSize: '0.8rem' }}>{c.piva || testoVuoto}</td>
                    <td style={{ ...cella, color: '#555', fontFamily: 'monospace', fontSize: '0.8rem' }}>{c.cf || testoVuoto}</td>
                    <td style={{ ...cella, color: '#555' }}>{c.citta ? `${c.citta}${c.provincia ? ` (${c.provincia})` : ''}` : testoVuoto}</td>
                    <td style={{ ...cella, textAlign: 'right', color: c.preventivi ? '#334155' : '#cbd5e1' }}>{c.preventivi}</td>
                    <td style={{ ...cella, textAlign: 'right', color: c.prenotazioni ? '#334155' : '#cbd5e1' }}>{c.prenotazioni}</td>
                    <td style={{ ...cella, textAlign: 'right', color: c.voucher ? '#334155' : '#cbd5e1' }}>{c.voucher}</td>
                    <td style={{ ...cella, textAlign: 'right', whiteSpace: 'nowrap' }}>{c.speso ? euro(c.speso) : testoVuoto}</td>
                  </tr>
                  {aperto && (
                    <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                      <td colSpan={COLONNE.length} style={{ padding: '12px 18px' }}>
                        <div style={{ display: 'flex', gap: '28px', flexWrap: 'wrap', fontSize: '0.8rem', color: '#334155', marginBottom: '10px' }}>
                          {c.indirizzo && <span><strong>Indirizzo:</strong> {c.indirizzo}, {[c.cap, c.citta, c.provincia && `(${c.provincia})`].filter(Boolean).join(' ')}</span>}
                          {c.sdi && <span><strong>SDI:</strong> {c.sdi}</span>}
                          {c.emails.length > 1 && <span><strong>Email:</strong> {c.emails.join(', ')}</span>}
                          {c.telefoni.length > 1 && <span><strong>Telefoni:</strong> {c.telefoni.join(', ')}</span>}
                          {c.primoContatto && <span><strong>Primo contatto:</strong> {formattaDataGGMMAAAA(c.primoContatto)}</span>}
                          {c.ultimaAttivita && <span><strong>Ultima attività:</strong> {formattaDataGGMMAAAA(c.ultimaAttivita)}</span>}
                        </div>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                          <tbody>
                            {c.documenti.map(d => (
                              <tr key={`${d.fonte}|${d.rif}`} style={{ borderTop: '1px solid #e2e8f0' }}>
                                <td style={{ padding: '5px 8px', width: '110px', color: '#64748b' }}>{ETICHETTA_FONTE[d.fonte]}</td>
                                <td style={{ padding: '5px 8px', width: '130px', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{d.rif}</td>
                                <td style={{ padding: '5px 8px', width: '95px', whiteSpace: 'nowrap' }}>{formattaDataGGMMAAAA(d.data)}</td>
                                <td style={{ padding: '5px 8px' }}>{d.descrizione || testoVuoto}</td>
                                <td style={{ padding: '5px 8px', width: '130px' }}>
                                  {d.stato && <span className={`badge-stato badge-mini ${classeBadgeStato(d.stato)}`}>{etichettaStato(d)}</span>}
                                </td>
                                <td style={{ padding: '5px 8px', width: '100px', textAlign: 'right' }}>{d.importo ? euro(d.importo) : ''}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {!caricamento && visibili.length === 0 && (
              <tr><td colSpan={COLONNE.length} style={{ padding: '20px', textAlign: 'center', color: '#666' }}>
                {clienti.length === 0 ? 'Nessun cliente nei documenti.' : 'Nessun cliente corrisponde ai filtri.'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default Clienti
