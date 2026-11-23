import { useState } from 'react'
import { formattaDataGGMMAAAA } from '../../lib/utils'
import Icona from '../../components/Icona'
import { euro, r2 } from './calcolo'
import { NATURE_ENTRATA, naturaEntrata, mittenteDi, causaleEntrataDi } from './banca'
import { classificaEntrata } from './operazioniBanca'

// ============================================================
// Le entrate del conto di Albatros, come la scheda Incassi del modulo Spese di BFM: gli stati come
// pulsanti sopra la tabella, la natura in una colonna, la modifica in linea, una riga per volta, con
// Salva e Annulla. Un'entrata è un incasso POS delle chiusure (accreditato da SumUp), un versamento
// di contanti (un trasferimento dai contanti al conto), un'altra entrata con la sua nota, o si
// ignora; finché non è niente di questo è da completare. SumUp e versamenti si riconoscono da soli
// al caricamento (operazioniBanca); un versamento è un trasferimento e resta tale: non si cambia.
// ============================================================

const CELLA = { padding: '5px 8px', verticalAlign: 'middle' };
const ETICHETTA = {
  pos: { testo: 'Incasso POS', classe: 'chiusa' },
  versamento: { testo: 'Versamento contanti', classe: 'chiusa' },
  altro: { testo: 'Altra entrata', classe: 'chiusa' },
  ignorato: { testo: 'Ignorata', classe: '' },
  null: { testo: 'Da completare', classe: 'oltre' },
};
const PULSANTI = [
  { natura: null, testo: 'Da completare', avviso: true },
  { natura: 'pos', testo: 'Incassi POS' },
  { natura: 'versamento', testo: 'Versamenti' },
  { natura: 'altro', testo: 'Altre' },
  { natura: 'ignorato', testo: 'Ignorate' },
];

function EntrateBanca({ user, banca, puoCorreggere, onCambiati, nelPeriodo }) {
  // undefined = tutte; null = da completare; altrimenti la natura.
  const [stato, setStato] = useState(undefined);
  const [cerca, setCerca] = useState('');
  const [riga, setRiga] = useState(null);
  const [inCorso, setInCorso] = useState(false);

  const trasferimentoDi = new Set((banca.trasferimenti || []).filter(t => t.movimento_id != null && t.da === 'contanti').map(t => t.movimento_id));
  const natura = (m) => naturaEntrata(m, trasferimentoDi);
  const entrate = (banca.movimenti || []).filter(m => Number(m.importo) > 0);
  const daCompletare = entrate.filter(m => natura(m) == null);
  const t = cerca.trim().toLowerCase();
  const visibili = entrate
    .filter(m => nelPeriodo(m.data_contabile))
    .filter(m => stato === undefined || natura(m) === stato)
    .filter(m => !t || [m.tipo, m.descrizione, m.entrata_nota].some(v => (v || '').toLowerCase().includes(t)))
    .sort((a, b) => b.data_contabile.localeCompare(a.data_contabile) || b.id - a.id);
  const totale = r2(visibili.reduce((x, m) => x + Number(m.importo), 0));

  const salvaRiga = async () => {
    const m = entrate.find(x => x.id === riga.id);
    if (riga.natura === 'altro' && !riga.nota.trim()) return alert("Scrivi cos'è questa entrata.");
    setInCorso(true);
    try {
      await classificaEntrata(m, riga.natura || null, riga.nota, user);
      setRiga(null);
      await onCambiati();
    } catch (err) {
      alert(`Errore nel salvataggio: ${err.message}`);
    } finally {
      setInCorso(false);
    }
  };

  return (
    <>
      {daCompletare.length > 0 && (
        <div className="albatros-avviso" style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '12px' }}>
          <span><strong>{daCompletare.length} {daCompletare.length === 1 ? 'entrata da completare' : 'entrate da completare'}</strong> ({euro(daCompletare.reduce((x, m) => x + Number(m.importo), 0))}): di' cos'è.</span>
          {stato !== null && <button type="button" className="albatros-chip albatros-chip-avviso" onClick={() => setStato(null)}>Mostrale</button>}
        </div>
      )}

      <div className="albatros-testata filtri-telefono">
        <label className="albatros-etichetta filtro-largo" style={{ flex: '1 1 180px' }}>Cerca
          <input type="search" value={cerca} placeholder="Mittente, causale…" onChange={(e) => setCerca(e.target.value)} className="albatros-campo" />
        </label>
      </div>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', marginTop: '12px' }}>
        <button type="button" className={`albatros-chip ${stato === undefined ? 'attivo' : ''}`} onClick={() => setStato(undefined)}>Tutte</button>
        {PULSANTI.map(p => (
          <button key={String(p.natura)} type="button" className={`albatros-chip ${p.avviso ? 'albatros-chip-avviso' : ''} ${stato === p.natura ? 'attivo' : ''}`}
            onClick={() => setStato(p.natura)}>{p.testo} ({entrate.filter(m => natura(m) === p.natura).length})</button>
        ))}
        <div style={{ marginLeft: 'auto', textAlign: 'right', fontSize: '0.88rem' }}>
          <div>Totale: <strong style={{ color: '#15803d' }}>{euro(totale)}</strong></div>
          <div className="albatros-tenue">{visibili.length} entrate</div>
        </div>
      </div>

      {visibili.length === 0 && <p className="albatros-vuoto" style={{ marginTop: '12px' }}>Nessuna entrata.</p>}
      {visibili.length > 0 && (
        <div style={{ overflowX: 'auto', marginTop: '12px' }}>
          <table className="albatros-tabella tabella-schede">
            <thead><tr><th>Data</th><th>Mittente</th><th>Causale</th><th>Natura</th><th className="num">Importo</th>{puoCorreggere && <th></th>}</tr></thead>
            <tbody>
              {visibili.map(m => {
                const inModifica = riga?.id === m.id;
                const e = ETICHETTA[natura(m)];
                return (
                  <tr key={m.id} className={inModifica ? 'selezionata' : ''} style={{ cursor: 'default', opacity: m.ignorato ? 0.55 : 1 }}>
                    <td className="sk-sx" style={{ ...CELLA, whiteSpace: 'nowrap' }}>{formattaDataGGMMAAAA(m.data_contabile)}</td>
                    <td style={{ ...CELLA, fontSize: '0.8rem', maxWidth: '220px' }}>{mittenteDi(m) || <span className="albatros-tenue">{m.tipo}</span>}</td>
                    <td className="sk-testo" style={{ ...CELLA, fontSize: '0.8rem', maxWidth: '340px', wordBreak: 'break-word' }} title={m.descrizione}>
                      {causaleEntrataDi(m)}
                      {m.entrata_nota && <div className="albatros-tenue">{m.entrata_nota}</div>}
                    </td>
                    <td data-etichetta="Natura" style={CELLA}>
                      {inModifica ? (
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                          <select value={riga.natura} onChange={(ev) => setRiga({ ...riga, natura: ev.target.value })} className="albatros-campo albatros-categoria-riga">
                            <option value="">Da completare</option>
                            {NATURE_ENTRATA.filter(n => n.id !== 'versamento').map(n => <option key={n.id} value={n.id}>{n.label}</option>)}
                          </select>
                          {riga.natura === 'altro' && (
                            <input type="text" value={riga.nota} placeholder={riga.natura === 'altro' ? "Cos'è, es. affitto campo ASD" : 'Nota, facoltativa'}
                              onChange={(ev) => setRiga({ ...riga, nota: ev.target.value })} className="albatros-campo albatros-categoria-riga" />
                          )}
                        </div>
                      ) : <span className={`albatros-badge mini ${e.classe}`} style={e.classe ? undefined : { background: '#f1f5f9', color: '#64748b' }}>{e.testo}</span>}
                    </td>
                    <td className="num sk-dx" style={{ ...CELLA, color: '#15803d', fontWeight: 600 }}>{euro(m.importo)}</td>
                    {puoCorreggere && (
                      <td className="sk-azioni" style={{ ...CELLA, whiteSpace: 'nowrap', textAlign: 'right' }}>
                        {inModifica ? (
                          <>
                            <button type="button" className="btn-accent-inline" disabled={inCorso} onClick={salvaRiga} style={{ display: 'inline-flex', alignItems: 'center', fontSize: '0.78rem', padding: '3px 8px', marginRight: '4px' }}><Icona nome="salva" size={13} style={{ marginRight: '4px' }} />Salva</button>
                            <button type="button" className="btn-outline-annulla" disabled={inCorso} onClick={() => setRiga(null)} style={{ display: 'inline-flex', alignItems: 'center', fontSize: '0.78rem', padding: '3px 8px', borderRadius: '4px' }}><Icona nome="annulla" size={13} style={{ marginRight: '4px' }} />Annulla</button>
                          </>
                        ) : (
                          natura(m) !== 'versamento' && <button type="button" className="btn-icon-action" title={riga ? 'Finisci prima la riga che stai modificando' : "Di' cos'è"} disabled={!!riga}
                            onClick={() => setRiga({ id: m.id, natura: natura(m) || '', nota: m.entrata_nota || '' })}><Icona nome="modifica" size={14} style={{ marginRight: 0 }} /></button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export default EntrateBanca
