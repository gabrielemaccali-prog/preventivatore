import { useState } from 'react'
import { formattaDataGGMMAAAA } from '../../lib/utils'
import { euro, r2 } from './calcolo'
import { destinazioneMovimento } from './banca'
import { segnaIgnorato, elaboraMovimenti, controlloSaldoAlbatros } from './operazioniBanca'

// ============================================================
// I movimenti del conto di Albatros, come la scheda Banca del modulo Spese di BFM: il saldo
// ricostruito dai movimenti (e l'avviso se non torna con quello della banca), e ogni movimento con
// la sua destinazione. Un'uscita che non è una spesa si ignora; ripristinata, torna a essere una
// spesa. I dati li legge Spese.jsx (caricaBanca) e li rilegge dopo ogni cambio (onCambiati).
// ============================================================

function MovimentiBanca({ user, categorie, banca, puoCorreggere, onCambiati, nelPeriodo }) {
  const [inCorso, setInCorso] = useState(false);
  const [verso, setVerso] = useState('');
  const [cerca, setCerca] = useState('');

  const spese = banca.spese || [];
  const movimenti = banca.movimenti || [];
  const spesaDi = new Map(spese.filter(s => s.movimento_id != null).map(s => [s.movimento_id, s]));
  const spesaPerId = new Map(spese.map(s => [s.id, s]));
  const trasferimentoDi = new Set((banca.trasferimenti || []).filter(t => t.movimento_id != null).map(t => t.movimento_id));
  const destinazione = (m) => destinazioneMovimento(m, { spesaDi, trasferimentoDi, spesaPerId });
  const controllo = controlloSaldoAlbatros(banca.caricamenti, movimenti);

  const esegui = async (fn) => {
    setInCorso(true);
    try {
      await fn();
      await onCambiati();
    } catch (err) {
      alert(`Errore: ${err.message}`);
    } finally {
      setInCorso(false);
    }
  };

  const t = cerca.trim().toLowerCase();
  const visibili = movimenti
    .filter(m => nelPeriodo(m.data_contabile))
    .filter(m => !verso || (verso === 'entrate' ? Number(m.importo) > 0 : verso === 'uscite' ? Number(m.importo) < 0 : destinazione(m).classe === 'oltre'))
    .filter(m => !t || [m.tipo, m.descrizione].some(v => (v || '').toLowerCase().includes(t)))
    .sort((a, b) => b.data_contabile.localeCompare(a.data_contabile) || b.id - a.id);
  const entrate = r2(visibili.filter(m => Number(m.importo) > 0).reduce((x, m) => x + Number(m.importo), 0));
  const uscite = r2(visibili.filter(m => Number(m.importo) < 0).reduce((x, m) => x - Number(m.importo), 0));
  const senzaSpesa = movimenti.filter(m => destinazione(m).classe === 'oltre').length;

  return (
    <>
      {senzaSpesa > 0 && (
        <div className="albatros-avviso" style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '12px' }}>
          <span><strong>{senzaSpesa === 1 ? "Un'uscita senza spesa" : `${senzaSpesa} uscite senza spesa`}</strong>: di solito succede quando un caricamento si è interrotto a metà, o dopo aver tolto una spesa.</span>
          {puoCorreggere && <button type="button" className="albatros-chip albatros-chip-avviso" disabled={inCorso} onClick={() => esegui(() => elaboraMovimenti({ categorie, user }))}>Crea le spese</button>}
          <button type="button" className="albatros-chip" disabled={inCorso} onClick={() => setVerso('senza')}>Mostrale</button>
        </div>
      )}

      {!controllo && <p className="albatros-vuoto" style={{ margin: '0 0 12px 0' }}>Nessun estratto conto caricato.</p>}
      {controllo && (
        <p style={{ margin: '0 0 12px 0', fontSize: '0.9rem' }}>
          Saldo al {formattaDataGGMMAAAA(controllo.alGiorno)}: <strong>{euro(controllo.ricostruito)}</strong>
          <span className="albatros-tenue"> · ricostruito dai movimenti, partendo da {euro(controllo.partenza)} del 30/09/2026</span>
        </p>
      )}
      {controllo && controllo.differenza !== 0 && (
        <div className="albatros-avviso" style={{ marginBottom: '12px' }}>
          Il saldo non torna: la banca dice {euro(controllo.banca)} al {formattaDataGGMMAAAA(controllo.alGiorno)}, i movimenti caricati {euro(controllo.ricostruito)} (differenza {euro(controllo.differenza)}). Manca un pezzo di estratto conto, o c'è un movimento in più: carica il periodo mancante.
        </div>
      )}

      <div className="albatros-testata filtri-telefono">
        <label className="albatros-etichetta" style={{ flex: '0 1 190px' }}>Movimenti
          <select value={verso} onChange={(e) => setVerso(e.target.value)} className="albatros-campo">
            <option value="">Tutti</option>
            <option value="entrate">Entrate</option>
            <option value="uscite">Uscite</option>
            <option value="senza">Uscite senza spesa ({senzaSpesa})</option>
          </select>
        </label>
        <label className="albatros-etichetta filtro-largo" style={{ flex: '1 1 180px' }}>Cerca
          <input type="search" value={cerca} placeholder="Tipo, descrizione…" onChange={(e) => setCerca(e.target.value)} className="albatros-campo" />
        </label>
        <div style={{ marginLeft: 'auto', textAlign: 'right', fontSize: '0.88rem' }}>
          <div>Entrate <strong style={{ color: '#15803d' }}>{euro(entrate)}</strong> · Uscite <strong style={{ color: '#b91c1c' }}>{euro(uscite)}</strong></div>
          <div className="albatros-tenue">{visibili.length} movimenti</div>
        </div>
      </div>
      {visibili.length === 0 && <p className="albatros-vuoto" style={{ marginTop: '12px' }}>Nessun movimento.</p>}
      {visibili.length > 0 && (
        <div style={{ overflowX: 'auto', marginTop: '12px' }}>
          <table className="albatros-tabella tabella-schede">
            <thead><tr><th>Data</th><th>Tipo</th><th>Descrizione</th><th className="num">Importo</th><th>Destinazione</th><th></th></tr></thead>
            <tbody>
              {visibili.map(m => {
                const d = destinazione(m);
                const libera = Number(m.importo) < 0 && d.classe === 'oltre';
                return (
                  <tr key={m.id} style={{ cursor: 'default', opacity: m.ignorato ? 0.55 : 1 }}>
                    <td className="sk-sx" style={{ whiteSpace: 'nowrap' }}>{formattaDataGGMMAAAA(m.data_contabile)}{m.non_contabilizzato && <span className="albatros-badge mini aperta" style={{ marginLeft: '6px' }} title="Non ancora contabilizzata dalla banca">NC</span>}</td>
                    <td style={{ fontSize: '0.78rem', color: '#475569', maxWidth: '170px' }}>{m.tipo}</td>
                    <td className="sk-testo" style={{ maxWidth: '460px', fontSize: '0.8rem', wordBreak: 'break-word' }} title={m.descrizione}>{(m.descrizione || '—').slice(0, 160)}{(m.descrizione || '').length > 160 ? '…' : ''}</td>
                    <td className="num sk-dx" style={{ color: Number(m.importo) > 0 ? '#15803d' : '#b91c1c', fontWeight: 600 }}>{euro(m.importo)}</td>
                    <td><span className={`albatros-badge mini ${d.classe}`} style={d.classe ? undefined : { background: '#f1f5f9', color: '#64748b' }}>{d.testo}</span></td>
                    <td className="sk-azioni" style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                      {puoCorreggere && libera && !m.ignorato && <button type="button" className="albatros-chip" disabled={inCorso} onClick={() => esegui(() => segnaIgnorato(m, true, { categorie, user }))} title="Non è una spesa">Ignora</button>}
                      {puoCorreggere && m.ignorato && <button type="button" className="albatros-chip" disabled={inCorso} onClick={() => esegui(() => segnaIgnorato(m, false, { categorie, user }))}>Ripristina</button>}
                    </td>
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

export default MovimentiBanca
