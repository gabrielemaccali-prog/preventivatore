import { useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import Icona from '../../components/Icona'
import { formattaDataGGMMAAAA } from '../../lib/utils'
import {
  cosaManca, daCompletare, daRiconciliare, oneriDi, nonInBanca, euro, r2, METODI, ENTI, OPERATIVE, etichetta,
  percorsoCategoria, nomeControparte, regolaDaSpesa, regolaPer, alberoCategorie, REGOLA_VUOTA,
} from '../../lib/banca'
import { allineaAlbatros } from './operazioni'
import Classificazione from './Classificazione'
import ModuloRegola from './ModuloRegola'
import CaricaEstratto from './CaricaEstratto'

// ============================================================
// L'elenco delle spese. In cima l'avviso di quelle da completare, con quello che manca: di chi è
// (BFM o Albatros), che costo è (operativo o generale), il tipo o la categoria. Si completano
// aprendole. Una spesa scritta a mano si classifica tutta subito; una nata dalla banca può restare
// da completare. Di quelle nate dalla banca l'importo non si cambia: è quello del movimento. Se
// non era una spesa (un giroconto) si ignora il movimento, e la spesa sparisce.
// Da una spesa nata dalla banca si crea una regola per le uscite uguali che verranno.
// ============================================================

const leggiImporto = (v) => { const n = Number(String(v ?? '').trim().replace(',', '.')); return Number.isFinite(n) ? r2(n) : NaN; };
// Le celle dell'elenco: più basse di quelle standard, perché le righe sono tante.
const CELLA = { padding: '5px 8px', verticalAlign: 'middle' };
// Le spese nuove nascono solo dall'estratto conto: scritte anche a mano, la stessa spesa
// rischierebbe di comparire due volte quando arriva il suo movimento. Quelle a mano già registrate
// restano, e si modificano come le altre.

function ElencoSpese(props) {
  const { user, categorie, categorieAlbatros, controparti, regole, spese, movimenti, ricaricaDati, ricaricaConfigurazione } = props;
  // Vuoto = tutti i mesi: si parte da tutte le spese, il mese si sceglie se serve.
  const [mese, setMese] = useState('');
  const [filtroEnte, setFiltroEnte] = useState('');
  const [filtroCategoria, setFiltroCategoria] = useState('');
  // '' = tutte, 'completare' = da completare, 'riconciliare' = operative, 'nonbanca' = pagate dal
  // conto ma non ancora nell'estratto
  const [filtroStato, setFiltroStato] = useState('');
  const [cerca, setCerca] = useState('');
  const [modulo, setModulo] = useState(null);
  const [regola, setRegola] = useState(null);
  const [esito, setEsito] = useState('');
  const [inCorso, setInCorso] = useState(false);
  // Modifica inline: una riga per volta, aperta col suo pulsante. Qui c'è la riga che si sta
  // cambiando (descrizione e classificazione); si scrive solo premendo Salva.
  const [riga, setRiga] = useState(null);

  const movimentoDi = (s) => movimenti.find(m => m.id === s.movimento_id);
  const totaleSpesa = (s) => r2(Number(s.importo) + oneriDi(s, movimenti));

  const daCompletareTutte = spese.filter(s => daCompletare(s, categorie));
  const daRiconciliareTutte = spese.filter(daRiconciliare);
  const nonInBancaTutte = spese.filter(nonInBanca);
  const t = cerca.trim().toLowerCase();
  // Il filtro di categoria vale sulla categoria scelta o su tutte le sue sottocategorie.
  const inCategoria = (s) => {
    if (!filtroCategoria) return true;
    if (filtroCategoria === 'nessuna') return s.ente === 'bfm' && s.natura === 'generale' && s.categoria_id == null;
    const id = Number(filtroCategoria);
    return s.categoria_id === id || categorie.find(c => c.id === s.categoria_id)?.padre_id === id;
  };
  const visibili = spese
    .filter(s => (filtroStato === 'completare' ? daCompletare(s, categorie)
      : filtroStato === 'riconciliare' ? daRiconciliare(s)
        : filtroStato === 'nonbanca' ? nonInBanca(s) : true))
    .filter(s => !mese || s.data.startsWith(mese))
    .filter(s => !filtroEnte || (filtroEnte === 'nessuno' ? !s.ente : s.ente === filtroEnte))
    .filter(inCategoria)
    .filter(s => !t || [s.descrizione, s.beneficiario, s.note, movimentoDi(s)?.descrizione].some(v => (v || '').toLowerCase().includes(t)))
    .sort((a, b) => b.data.localeCompare(a.data) || b.id - a.id);
  const totale = r2(visibili.reduce((x, s) => x + totaleSpesa(s), 0));
  const totaleOneri = r2(visibili.reduce((x, s) => x + oneriDi(s, movimenti), 0));

  const scrivi = async (fn) => {
    setInCorso(true);
    try {
      const { error } = await fn();
      if (error) { alert(`Errore nel salvataggio: ${error.message}`); return false; }
      await allineaAlbatros(user);
      await ricaricaDati();
      return true;
    } catch (e) {
      alert(`Errore: ${e.message}`);
      return false;
    } finally {
      setInCorso(false);
    }
  };

  const salva = async () => {
    const banca = modulo.origine === 'banca';
    const importo = leggiImporto(modulo.importo);
    const descrizione = modulo.descrizione.trim();
    if (!modulo.data) return alert('Scegli la data.');
    if (!descrizione) return alert('Scrivi cosa è stato pagato.');
    if (!banca && (!importo || importo <= 0)) return alert('Importo non valido.');
    // Chi la scrive a mano sa cos'è: la classificazione si completa subito.
    const manca = cosaManca(modulo, categorie);
    if (!banca && manca) return alert(`Manca ${manca}.`);
    const record = {
      data: modulo.data, descrizione, beneficiario: modulo.beneficiario.trim() || null, note: modulo.note.trim() || null,
      ente: modulo.ente, natura: modulo.natura, operativa: modulo.operativa, controparte_id: modulo.controparte_id,
      categoria_id: modulo.categoria_id, albatros_categoria_id: modulo.albatros_categoria_id,
      ...(banca ? {} : { importo, metodo: modulo.metodo }),
    };
    // Il beneficiario di un'operativa è la sua controparte, se non è stato scritto altro.
    if (!record.beneficiario && record.controparte_id) record.beneficiario = nomeControparte(controparti, record.operativa, record.controparte_id);
    if (await scrivi(() => supabase.from('spese').update(record).eq('id', modulo.id))) setModulo(null);
  };

  // La riga in modifica si salva tutta insieme, e solo col pulsante Salva: descrizione e
  // classificazione. Può restare classificata a metà: è "da completare" finché non si arriva in fondo.
  const modificaRiga = (s) => setRiga({ ...s });
  const salvaRiga = async () => {
    const s = spese.find(x => x.id === riga.id);
    const descrizione = (riga.descrizione || '').trim();
    if (!descrizione) return alert('Scrivi cosa è stato pagato.');
    const record = {
      descrizione,
      ente: riga.ente, natura: riga.natura, operativa: riga.operativa, controparte_id: riga.controparte_id,
      categoria_id: riga.categoria_id, albatros_categoria_id: riga.albatros_categoria_id,
    };
    // Il beneficiario segue la controparte, se era vuoto o era quella di prima.
    if (record.controparte_id && (!s.beneficiario || s.beneficiario === nomeControparte(controparti, s.operativa, s.controparte_id))) {
      record.beneficiario = nomeControparte(controparti, record.operativa, record.controparte_id);
    }
    if (await scrivi(() => supabase.from('spese').update(record).eq('id', riga.id))) setRiga(null);
  };

  // Come si legge la classificazione in una riga che non si sta modificando.
  const classificazioneDi = (s) => {
    if (s.ente === 'albatros') return `Albatros · ${categorieAlbatros.find(c => c.id === s.albatros_categoria_id)?.nome || '…'}`;
    if (s.ente !== 'bfm') return '';
    if (s.natura === 'operativa') {
      const chi = s.operativa ? nomeControparte(controparti, s.operativa, s.controparte_id) : null;
      return `BFM · ${etichetta(OPERATIVE, s.operativa) || 'operativa'}${chi ? ` · ${chi}` : ''}`;
    }
    if (s.natura === 'generale') return `BFM · ${percorsoCategoria(categorie, s.categoria_id) || 'generale'}`;
    return 'BFM';
  };

  const elimina = async (s) => {
    if (!window.confirm(`Eliminare la spesa "${s.descrizione}" di ${euro(s.importo)}?`)) return;
    if (await scrivi(() => supabase.from('spese').delete().eq('id', s.id))) setModulo(null);
  };

  // Il movimento non era una spesa: si segna ignorato e la spesa nata da lui se ne va (con i suoi
  // oneri, che tornano liberi e si possono ignorare a loro volta dalla scheda Banca).
  const ignoraMovimento = async (s) => {
    if (!window.confirm('Questo movimento non è una spesa? La spesa si elimina e il movimento resta in Banca come ignorato.')) return;
    const ok = await scrivi(async () => {
      const r = await supabase.from('banca_movimenti').update({ ignorato: true }).eq('id', s.movimento_id);
      return r.error ? r : supabase.from('spese').delete().eq('id', s.id);
    });
    if (ok) setModulo(null);
  };

  // Una spesa scritta a mano collegata per sbaglio al movimento: torna "non ancora in banca".
  const scollega = async (s) => {
    if (await scrivi(() => supabase.from('spese').update({ movimento_id: null }).eq('id', s.id))) setModulo(null);
  };

  const apri = (s) => setModulo({ ...s, importo: String(r2(s.importo)).replace('.', ','), beneficiario: s.beneficiario || '', note: s.note || '' });

  // Dalla spesa aperta, con la classificazione che ha adesso nell'overlay, una regola per le uscite uguali.
  const creaRegola = () => {
    const m = movimentoDi(modulo);
    setRegola({ ...REGOLA_VUOTA, ...regolaDaSpesa(modulo, m) });
  };

  const movAperto = modulo?.movimento_id ? movimentoDi(modulo) : null;  // Le altre spese della banca, ancora da completare, che la regola proposta prenderebbe: dice se vale la pena farla.
  const simili = movAperto && modulo.origine === 'banca'
    ? spese.filter(s => s.id !== modulo.id && s.origine === 'banca' && daCompletare(s, categorie)
      && (() => { const m = movimentoDi(s); return m && regolaPer(m, [{ ...regolaDaSpesa(modulo, movAperto), id: -1, ordine: -1 }], controparti); })()).length
    : 0;

  return (
    <div className="albatros-pagina no-print">
      <CaricaEstratto {...props} />

      {daCompletareTutte.length > 0 && (
        <div className="albatros-avviso" style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
          <span><strong>{daCompletareTutte.length} {daCompletareTutte.length === 1 ? 'spesa da completare' : 'spese da completare'}</strong> ({euro(daCompletareTutte.reduce((x, s) => x + totaleSpesa(s), 0))}): manca la classificazione.</span>
          {filtroStato !== 'completare' && <button type="button" className="albatros-chip albatros-chip-avviso" onClick={() => setFiltroStato('completare')}>Mostrale</button>}
        </div>
      )}
      {esito && <p className="albatros-nota" style={{ color: '#166534', margin: 0 }}>{esito}</p>}

      <div className="albatros-card">
        <div className="albatros-testata filtri-telefono">
          <label className="albatros-etichetta" style={{ flex: '0 1 170px' }}>Mese
            <input type="month" value={mese} onChange={(e) => setMese(e.target.value)} className="albatros-campo" />
          </label>
          <label className="albatros-etichetta" style={{ flex: '0 1 150px' }}>Di chi
            <select value={filtroEnte} onChange={(e) => setFiltroEnte(e.target.value)} className="albatros-campo">
              <option value="">Tutte</option>
              {ENTI.map(e => <option key={e.id} value={e.id}>{e.label}</option>)}
              <option value="nessuno">Da scegliere</option>
            </select>
          </label>
          <label className="albatros-etichetta" style={{ flex: '0 1 210px' }}>Categoria
            <select value={filtroCategoria} onChange={(e) => setFiltroCategoria(e.target.value)} className="albatros-campo">
              <option value="">Tutte</option>
              {alberoCategorie(categorie, { ancheArchiviate: true }).map(c => [
                <option key={c.id} value={c.id}>{c.nome}</option>,
                ...c.figlie.map(f => <option key={f.id} value={f.id}>{`  › ${f.nome}`}</option>),
              ])}
              <option value="nessuna">Generali senza categoria</option>
            </select>
          </label>
          <label className="albatros-etichetta filtro-largo" style={{ flex: '1 1 180px' }}>Cerca
            <input type="search" value={cerca} placeholder="Descrizione, beneficiario…" onChange={(e) => setCerca(e.target.value)} className="albatros-campo" />
          </label>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', marginTop: '12px' }}>
          <button type="button" className={`albatros-chip ${filtroStato === '' ? 'attivo' : ''}`} onClick={() => setFiltroStato('')}>Tutte</button>
          <button type="button" className={`albatros-chip albatros-chip-avviso ${filtroStato === 'completare' ? 'attivo' : ''}`} disabled={!daCompletareTutte.length && filtroStato !== 'completare'} onClick={() => setFiltroStato('completare')}>Da completare ({daCompletareTutte.length})</button>
          <button type="button" className={`albatros-chip ${filtroStato === 'riconciliare' ? 'attivo' : ''}`} disabled={!daRiconciliareTutte.length && filtroStato !== 'riconciliare'} onClick={() => setFiltroStato('riconciliare')} title="Costi operativi: compensi, campi e fornitori, da abbinare ai loro consuntivi">Operative da riconciliare ({daRiconciliareTutte.length})</button>
          <button type="button" className={`albatros-chip ${filtroStato === 'nonbanca' ? 'attivo' : ''}`} disabled={!nonInBancaTutte.length && filtroStato !== 'nonbanca'} onClick={() => setFiltroStato('nonbanca')} title="Scritte a mano come pagate dal conto, ma non ancora comparse nell'estratto conto">Non ancora in banca ({nonInBancaTutte.length})</button>
          <div style={{ marginLeft: 'auto', textAlign: 'right', fontSize: '0.88rem' }}>
            <div>Totale: <strong>{euro(totale)}</strong></div>
            {totaleOneri > 0 && <div className="albatros-tenue">di cui oneri bancari {euro(totaleOneri)}</div>}
          </div>
        </div>

        {visibili.length === 0 && <p className="albatros-vuoto" style={{ marginTop: '12px' }}>Nessuna spesa.</p>}
        {visibili.length > 0 && (
          <div style={{ overflowX: 'auto', marginTop: '12px' }}>
            <table className="albatros-tabella tabella-schede">
              <thead>
                <tr><th>Data</th><th>Cosa</th><th>Origine</th><th>Classificazione</th><th className="num">Importo</th><th></th></tr>
              </thead>
              <tbody>
                {visibili.map(s => {
                  const oneri = oneriDi(s, movimenti);
                  const inModifica = riga?.id === s.id;
                  const mostrata = inModifica ? riga : s;
                  const mancaOra = cosaManca(mostrata, categorie);
                  return (
                    <tr key={s.id} onClick={() => !riga && apri(s)} className={inModifica ? 'selezionata' : ''} style={{ cursor: riga ? 'default' : 'pointer' }}>
                      <td className="sk-sx" style={{ ...CELLA, whiteSpace: 'nowrap' }}>{formattaDataGGMMAAAA(s.data)}</td>
                      <td className="sk-testo" style={{ ...CELLA, minWidth: inModifica ? '220px' : undefined, maxWidth: '340px' }}>
                        {inModifica ? (
                          <input type="text" className="table-input" value={riga.descrizione} autoFocus onClick={(e) => e.stopPropagation()}
                            onChange={(e) => setRiga({ ...riga, descrizione: e.target.value })}
                            onKeyDown={(e) => { if (e.key === 'Escape') setRiga(null); }}
                            style={{ height: '26px', padding: '2px 6px', fontSize: '0.82rem' }} />
                        ) : (
                          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={s.descrizione}>{s.descrizione}</div>
                        )}
                      </td>
                      <td style={CELLA}>
                        <span className="albatros-badge mini" style={{ background: '#f1f5f9', color: '#475569' }}>{s.origine === 'banca' ? 'Da banca' : 'A mano'}</span>
                        {nonInBanca(s) && <span className="albatros-badge mini aperta" title="Pagata dal conto, ma non ancora nell'estratto conto">Non in banca</span>}
                        {s.ente === 'albatros' && <span className="albatros-badge mini chiusa" title="Compare anche fra le spese di Albatros, pagata da BFM">Anche in Albatros</span>}
                        {/* Il bubbler (o il campo, il fornitore) si vede già nella classificazione: qui solo un beneficiario scritto a mano. */}
                        {s.beneficiario && !s.controparte_id && <div className="albatros-tenue" style={{ fontSize: '0.75rem', whiteSpace: 'nowrap', marginTop: '2px' }}>{s.beneficiario}</div>}
                      </td>
                      <td data-etichetta="Classificazione" style={{ ...CELLA, fontSize: '0.8rem' }} onClick={(e) => inModifica && e.stopPropagation()}>
                        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                          {inModifica
                            ? <Classificazione compatta valore={riga} onChange={(v) => setRiga({ ...riga, ...v })}
                              categorie={categorie} categorieAlbatros={categorieAlbatros} controparti={controparti} />
                            : classificazioneDi(s) && <span>{classificazioneDi(s)}</span>}
                          {mancaOra && <span className="albatros-badge mini da-specificare" title={`Manca ${mancaOra}`}>Da completare</span>}
                          {!mancaOra && daRiconciliare(mostrata) && <span className="albatros-badge mini aperta" title="Andrà abbinata al suo consuntivo">Da riconciliare</span>}
                        </div>
                      </td>
                      <td className="num sk-dx" style={CELLA} title={oneri > 0 ? `${euro(s.importo)} di spesa + ${euro(oneri)} di oneri bancari` : undefined}>
                        {oneri > 0 && <span className="albatros-tenue">{euro(oneri)} + </span>}
                        <strong>{euro(s.importo)}</strong>
                      </td>
                      <td className="sk-azioni" style={{ ...CELLA, whiteSpace: 'nowrap', textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                        {inModifica ? (
                          <>
                            <button type="button" className="btn-accent-inline" disabled={inCorso} onClick={salvaRiga} style={{ display: 'inline-flex', alignItems: 'center', fontSize: '0.78rem', padding: '3px 8px', marginRight: '4px' }}><Icona nome="salva" size={13} style={{ marginRight: '4px' }} />Salva</button>
                            <button type="button" className="btn-outline-annulla" disabled={inCorso} onClick={() => setRiga(null)} style={{ display: 'inline-flex', alignItems: 'center', fontSize: '0.78rem', padding: '3px 8px', borderRadius: '4px' }}><Icona nome="annulla" size={13} style={{ marginRight: '4px' }} />Annulla</button>
                          </>
                        ) : (
                          <>
                            <button type="button" className="btn-icon-action" title={riga ? 'Finisci prima la riga che stai modificando' : 'Modifica descrizione e classificazione'} disabled={!!riga} onClick={() => modificaRiga(s)} style={{ marginRight: '4px' }}><Icona nome="modifica" size={14} style={{ marginRight: 0 }} /></button>
                            <button type="button" className="btn-icon-action" title="Apri la spesa" disabled={!!riga} onClick={() => apri(s)}><Icona nome="apri" size={14} style={{ marginRight: 0 }} /></button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modulo && !regola && (
        <div className="modal-form-backdrop" onClick={() => setModulo(null)}>
          <div className="modal-form-box albatros-overlay" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="modal-form-close" aria-label="Chiudi" onClick={() => setModulo(null)}>✕</button>
            <h3 style={{ margin: '0 0 12px 0', fontSize: '1.1rem', color: '#0f172a' }}>Modifica spesa</h3>
            {movAperto && (
              <div className="albatros-nota" style={{ margin: '0 0 12px 0', padding: '8px 10px', background: '#f8fafc', borderRadius: '6px' }}>
                <strong>Dall'estratto conto</strong> · {formattaDataGGMMAAAA(movAperto.data_contabile)} · {movAperto.tipo} · {euro(-Number(movAperto.importo))}
                <div style={{ marginTop: '4px', wordBreak: 'break-word' }}>{movAperto.descrizione || '—'}</div>                {oneriDi(modulo, movimenti) > 0 && <div style={{ marginTop: '4px' }}>Oneri bancari: <strong>{euro(oneriDi(modulo, movimenti))}</strong> · uscito dal conto in tutto {euro(-Number(movAperto.importo) + oneriDi(modulo, movimenti))}</div>}
              </div>
            )}

            <Classificazione valore={modulo} onChange={(v) => setModulo({ ...modulo, ...v })} categorie={categorie} categorieAlbatros={categorieAlbatros} controparti={controparti} />

            <div className="albatros-griglia-2" style={{ marginTop: '10px' }}>
              <label className="albatros-etichetta">Data
                <input type="date" value={modulo.data} onChange={(e) => setModulo({ ...modulo, data: e.target.value })} className="albatros-campo" />
              </label>
              <label className="albatros-etichetta">Importo €
                <input type="text" inputMode="decimal" value={modulo.importo} placeholder="0,00" disabled={modulo.origine === 'banca'} onChange={(e) => setModulo({ ...modulo, importo: e.target.value })} className="albatros-campo albatros-importo" />
              </label>
              <label className="albatros-etichetta" style={{ gridColumn: '1 / -1' }}>Cosa
                <input type="text" value={modulo.descrizione} autoFocus={!modulo.id} placeholder="Es. affitto box ottobre" onChange={(e) => setModulo({ ...modulo, descrizione: e.target.value })} className="albatros-campo" />
              </label>
              <label className="albatros-etichetta">Beneficiario
                <input type="text" value={modulo.beneficiario} placeholder="Facoltativo" onChange={(e) => setModulo({ ...modulo, beneficiario: e.target.value })} className="albatros-campo" />
              </label>
              <label className="albatros-etichetta">Pagata con
                <select value={modulo.metodo} disabled={modulo.origine === 'banca'} onChange={(e) => setModulo({ ...modulo, metodo: e.target.value })} className="albatros-campo">
                  {METODI.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
              </label>
              <label className="albatros-etichetta" style={{ gridColumn: '1 / -1' }}>Note
                <input type="text" value={modulo.note} placeholder="Facoltative" onChange={(e) => setModulo({ ...modulo, note: e.target.value })} className="albatros-campo" />
              </label>
            </div>
            {modulo.ente === 'albatros' && <p className="albatros-nota">Compare anche fra le spese di Albatros, pagata da BFM, con gli oneri bancari compresi. È lo stesso costo: non si conta due volte.</p>}
            {modulo.origine === 'manuale' && modulo.metodo === 'conto' && !modulo.movimento_id && <p className="albatros-nota">Pagata dal conto: quando arriverà nell'estratto conto il movimento con lo stesso importo (entro qualche giorno) le si collegherà da solo.</p>}
            {movAperto && modulo.ente && (
              <p className="albatros-nota" style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                <span>Si ripete? Una regola la classificherà da sola le prossime volte{simili > 0 ? `, e completa subito altre ${simili} ${simili === 1 ? 'spesa uguale' : 'spese uguali'}` : ''}.</span>
                <button type="button" className="albatros-chip" onClick={creaRegola}>Crea una regola</button>
              </p>
            )}
            <div style={{ display: 'flex', gap: '10px', marginTop: '16px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              {modulo.id && modulo.origine === 'banca' && <button type="button" className="btn-outline-annulla albatros-bottone" style={{ marginRight: 'auto' }} disabled={inCorso} onClick={() => ignoraMovimento(modulo)}>Non è una spesa</button>}
              {modulo.id && modulo.origine === 'manuale' && modulo.movimento_id && <button type="button" className="btn-outline-annulla albatros-bottone" disabled={inCorso} onClick={() => scollega(modulo)}>Scollega dal movimento</button>}
              {modulo.id && modulo.origine === 'manuale' && <button type="button" className="btn-icon-action danger" title="Elimina" style={{ marginRight: 'auto' }} disabled={inCorso} onClick={() => elimina(modulo)}><Icona nome="elimina" size={16} style={{ marginRight: 0 }} /></button>}
              <button type="button" className="btn-outline-annulla albatros-bottone" onClick={() => setModulo(null)}>Annulla</button>
              <button type="button" className="btn-accent-inline albatros-bottone" disabled={inCorso} onClick={salva}><Icona nome="salva" />Salva</button>
            </div>
          </div>
        </div>
      )}

      {regola && (
        <ModuloRegola {...props} regole={regole} iniziale={regola}
          onChiudi={() => setRegola(null)}
          onSalvata={async (salvata, testo) => {
            // La spesa da cui nasce la regola si salva con la classificazione scelta, se è cambiata.
            setRegola(null);
            await salva();
            setEsito(`Regola "${salvata.nome}" creata. ${testo}`);
            await ricaricaConfigurazione();
            await ricaricaDati();
          }} />
      )}
    </div>
  );
}

export default ElencoSpese
