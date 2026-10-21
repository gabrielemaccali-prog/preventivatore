import { useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { formattaDataGGMMAAAA } from '../../lib/utils'
import { controlloSaldi, daCompletare, euro, r2 } from '../../lib/banca'
import { elaboraMovimenti } from './operazioni'

// ============================================================
// Banca: si controlla che i saldi tornino e si vedono i movimenti con la loro destinazione.
// L'estratto conto si carica dalla scheda Spese (CaricaEstratto).
// Le entrate per ora si vedono soltanto: il loro abbinamento agli incassi è il passo successivo.
// ============================================================

function Banca({ user, regole, controparti, spese, movimenti, caricamenti, categorie, ricaricaDati, vaiA }) {
  const [inCorso, setInCorso] = useState(false);
  // Vuoto = tutti i mesi: si parte da tutti i movimenti, il mese si sceglie se serve.
  const [mese, setMese] = useState('');
  const [verso, setVerso] = useState('');
  const [cerca, setCerca] = useState('');

  const spesaDi = new Map(spese.filter(s => s.movimento_id != null).map(s => [s.movimento_id, s]));
  const spesaPerId = new Map(spese.map(s => [s.id, s]));
  const controllo = controlloSaldi(caricamenti, movimenti);
  const nonTornano = controllo.esiti.filter(x => !x.ok);

  // Ignorare un'uscita senza spesa, o ripristinarla: ripristinata, torna subito a essere una spesa
  // (regole e collegamenti si rifanno sui movimenti senza spesa).
  const segnaIgnorato = async (m, ignorato) => {
    setInCorso(true);
    try {
      const { error } = await supabase.from('banca_movimenti').update({ ignorato }).eq('id', m.id);
      if (error) return alert(`Errore: ${error.message}`);
      if (!ignorato) await elaboraMovimenti({ regole, controparti, categorie, user });
      await ricaricaDati();
    } catch (err) {
      alert(`Errore: ${err.message}`);
    } finally {
      setInCorso(false);
    }
  };

  const destinazione = (m) => {
    if (m.ignorato) return { testo: 'Ignorato', classe: '' };
    if (Number(m.importo) > 0) return { testo: 'Entrata', classe: 'chiusa' };
    const s = spesaDi.get(m.id);
    if (s) return daCompletare(s, categorie) ? { testo: 'Spesa da completare', classe: 'da-specificare' } : { testo: s.ente === 'albatros' ? 'Spesa di Albatros' : s.natura === 'operativa' ? 'Spesa operativa' : 'Spesa generale', classe: 'chiusa' };
    if (m.onere_spesa_id != null) return { testo: `Onere di: ${spesaPerId.get(m.onere_spesa_id)?.descrizione?.slice(0, 40) || 'spesa'}`, classe: 'chiusa' };
    return { testo: 'Senza spesa', classe: 'oltre' };
  };

  const t = cerca.trim().toLowerCase();
  const visibili = movimenti
    .filter(m => !mese || m.data_contabile.startsWith(mese))
    .filter(m => !verso || (verso === 'entrate' ? Number(m.importo) > 0 : verso === 'uscite' ? Number(m.importo) < 0 : destinazione(m).classe === 'oltre'))
    .filter(m => !t || [m.tipo, m.descrizione].some(v => (v || '').toLowerCase().includes(t)))
    .sort((a, b) => b.data_contabile.localeCompare(a.data_contabile) || b.id - a.id);
  const entrate = r2(visibili.filter(m => Number(m.importo) > 0).reduce((x, m) => x + Number(m.importo), 0));
  const uscite = r2(visibili.filter(m => Number(m.importo) < 0).reduce((x, m) => x - Number(m.importo), 0));
  const senzaSpesa = movimenti.filter(m => destinazione(m).classe === 'oltre').length;

  // Uscite rimaste senza spesa: di norma non ce ne sono, perché l'import le trasforma tutte. Restano
  // se un import si è interrotto a metà; qui si sistemano con lo stesso giro dell'import (oneri,
  // spese scritte a mano, regole), solo su quelle.
  const sistemaSenzaSpesa = async () => {
    setInCorso(true);
    try {
      const esito = await elaboraMovimenti({ regole, controparti, categorie, user });
      await ricaricaDati();
      alert(`Spese create: ${esito.nuove}${esito.daCompletare ? ` (${esito.daCompletare} da completare)` : ''} · collegate a spese scritte a mano: ${esito.collegate} · oneri sommati: ${esito.oneri}${esito.ignorati ? ` · ignorati: ${esito.ignorati}` : ''}.`);
    } catch (err) {
      alert(`Errore: ${err.message}`);
    } finally {
      setInCorso(false);
    }
  };

  return (
    <div className="albatros-pagina no-print">
      {senzaSpesa > 0 && (
        <div className="albatros-avviso" style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
          <span><strong>{senzaSpesa === 1 ? "Un'uscita senza spesa" : `${senzaSpesa} uscite senza spesa`}</strong>: di solito succede quando un caricamento si è interrotto a metà.</span>
          <button type="button" className="albatros-chip albatros-chip-avviso" disabled={inCorso} onClick={sistemaSenzaSpesa}>Crea le spese</button>
          <button type="button" className="albatros-chip" disabled={inCorso} onClick={() => setVerso('senza')}>Mostrale</button>
        </div>
      )}

      <div className="albatros-card">
        <div className="albatros-titolo" style={{ fontWeight: 700, color: '#0f172a', marginBottom: '8px' }}>Controllo dei saldi</div>
        {controllo.esiti.length === 0 && <p className="albatros-vuoto">Nessun estratto conto caricato.</p>}
        {controllo.esiti.length > 0 && (
          <>
            <p style={{ margin: '0 0 8px 0', fontSize: '0.9rem' }}>
              Saldo al {formattaDataGGMMAAAA(controllo.alGiorno)}: <strong>{euro(controllo.saldoAttuale)}</strong>
              <span className="albatros-tenue"> · ricostruito dai movimenti, partendo da {euro(controllo.partenza.saldo)} del {formattaDataGGMMAAAA(controllo.partenza.data)}</span>
            </p>
            {nonTornano.length > 0 && <p className="albatros-avviso" style={{ marginBottom: '8px' }}>{nonTornano.length === 1 ? 'Un caricamento non torna' : `${nonTornano.length} caricamenti non tornano`}: fra quelle date manca un pezzo di estratto conto, o c'è un movimento in più. Carica il periodo mancante.</p>}
            <div style={{ overflowX: 'auto' }}>
              <table className="albatros-tabella tabella-schede">
                <thead><tr><th>Caricato il</th><th>Periodo</th><th className="num">Saldo iniziale</th><th className="num">Saldo finale</th><th className="num">Righe nuove</th><th>Esito</th></tr></thead>
                <tbody>
                  {[...controllo.esiti].reverse().map(x => (
                    <tr key={x.caricamento.id} style={{ cursor: 'default' }}>
                      <td className="sk-sx" style={{ whiteSpace: 'nowrap' }}>{formattaDataGGMMAAAA(x.caricamento.creato_il.slice(0, 10))}<div className="albatros-tenue" style={{ fontSize: '0.75rem' }}>{x.caricamento.file_nome}</div></td>
                      <td data-etichetta="Periodo" style={{ whiteSpace: 'nowrap' }}>{formattaDataGGMMAAAA(x.caricamento.dal)} – {formattaDataGGMMAAAA(x.caricamento.al)}</td>
                      <td className="num sk-mezzo" data-etichetta="Saldo iniziale">{euro(x.caricamento.saldo_iniziale)}</td>
                      <td className="num sk-mezzo" data-etichetta="Saldo finale">{euro(x.caricamento.saldo_finale)}</td>
                      <td className="num sk-mezzo" data-etichetta="Righe nuove">{x.caricamento.righe_nuove} / {x.caricamento.righe_lette}</td>
                      <td>
                        {x.ok ? <span className="albatros-badge mini chiusa">Torna</span> : (
                          <span className="albatros-badge mini oltre" title={`Atteso: iniziale ${euro(x.attesoIniziale)}, finale ${euro(x.attesoFinale)}`}>
                            Non torna: {x.diffIniziale !== 0 ? `iniziale ${euro(x.diffIniziale)}` : ''}{x.diffIniziale !== 0 && x.diffFinale !== 0 ? ' · ' : ''}{x.diffFinale !== 0 ? `finale ${euro(x.diffFinale)}` : ''}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      <div className="albatros-card">
        <div className="albatros-testata filtri-telefono">
          <label className="albatros-etichetta" style={{ flex: '0 1 170px' }}>Mese
            <input type="month" value={mese} onChange={(e) => setMese(e.target.value)} className="albatros-campo" />
          </label>
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
          <button type="button" className="albatros-chip" style={{ alignSelf: 'flex-end' }} onClick={() => setMese('')}>Tutti i mesi</button>
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
                  const s = spesaDi.get(m.id);
                  const uscitaLibera = Number(m.importo) < 0 && !s && m.onere_spesa_id == null;
                  return (
                    <tr key={m.id} style={{ cursor: s ? 'pointer' : 'default', opacity: m.ignorato ? 0.55 : 1 }} onClick={() => s && vaiA('spese')}>
                      <td className="sk-sx" style={{ whiteSpace: 'nowrap' }}>{formattaDataGGMMAAAA(m.data_contabile)}</td>
                      <td style={{ fontSize: '0.78rem', color: '#475569', maxWidth: '170px' }}>{m.tipo}</td>
                      <td className="sk-testo" style={{ maxWidth: '460px', fontSize: '0.8rem', wordBreak: 'break-word' }} title={m.descrizione}>{(m.descrizione || '—').slice(0, 160)}{(m.descrizione || '').length > 160 ? '…' : ''}</td>
                      <td className="num sk-dx" style={{ color: Number(m.importo) > 0 ? '#15803d' : '#b91c1c', fontWeight: 600 }}>{euro(m.importo)}</td>
                      <td><span className={`albatros-badge mini ${d.classe}`} style={d.classe ? undefined : { background: '#f1f5f9', color: '#64748b' }}>{d.testo}</span></td>
                      <td className="sk-azioni" style={{ whiteSpace: 'nowrap', textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                        {uscitaLibera && !m.ignorato && <button type="button" className="albatros-chip" disabled={inCorso} onClick={() => segnaIgnorato(m, true)} title="Non è una spesa">Ignora</button>}
                        {m.ignorato && <button type="button" className="albatros-chip" disabled={inCorso} onClick={() => segnaIgnorato(m, false)}>Ripristina</button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default Banca
