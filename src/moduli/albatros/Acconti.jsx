import { useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import Icona from '../../components/Icona'
import { formattaDataGGMMAAAA } from '../../lib/utils'
import { r2, euro, giornataDiLavoro, METODI_ACCONTO, etichettaMetodoAcconto, etichettaStatoAcconto, accontoConfermabile, accontoSullaVoce } from './calcolo'

// ============================================================
// Gli acconti dei clienti: l'elenco, con le azioni, e le finestre per scriverne uno nuovo e per
// la disdetta. Lo usano la Giornata (quelli del giorno, e il tasto per prenderne uno nuovo: è lì
// che si sta quando il cliente paga) e la scheda Chiusure (tutti quelli da confermare, più quelli
// del periodo). I dati li legge chi lo usa, e dopo ogni cambio li rilegge
// (onCambiati).
// Tutti scrivono un acconto, lo confermano quando il suo giorno è arrivato e registrano la
// disdetta; rimettere da confermare ed eliminare spetta all'amministratore.
// ============================================================

const leggiImporto = (v) => { const n = Number(String(v ?? '').trim().replace(',', '.')); return Number.isFinite(n) ? r2(n) : NaN; };
const giornoBreve = (iso) => `${new Date(`${iso}T12:00:00`).toLocaleDateString('it-IT', { weekday: 'short' })} ${formattaDataGGMMAAAA(iso)}`;
const CLASSE_STATO = { atteso: 'da-specificare', confermato: 'chiusa', rimborsato: 'oltre', trattenuto: 'aperta' };

function Acconti({ user, listino, categorie, utenti, puoCorreggere, acconti, onCambiati, giorno, conNuovo = true, titolo = 'Acconti', vuoto = 'Nessun acconto.' }) {
  // L'acconto nuovo in scrittura, e la disdetta in corso: null = finestra chiusa.
  const [nuovo, setNuovo] = useState(null);
  const [disdetta, setDisdetta] = useState(null);
  const [inCorso, setInCorso] = useState(false);
  // Dopo aver registrato un acconto per un altro giorno: qui non compare, lo si dice.
  const [registrato, setRegistrato] = useState(null);
  const oggi = giornataDiLavoro();
  const voce = (id) => listino.find(v => v.id === id);
  // Solo le voci delle categorie su cui si prende un acconto (Configuratore): il bar no.
  const vociScelta = listino.filter(v => v.attiva && accontoSullaVoce(v, categorie)).sort((a, b) => a.nome.localeCompare(b.nome));

  const scrivi = async (fn) => {
    setInCorso(true);
    try {
      const { error } = await fn();
      if (error) { alert(`Errore: ${error.message}`); return false; }
      await onCambiati();
      return true;
    } finally {
      setInCorso(false);
    }
  };

  // Il giorno dell'evento non si propone: quasi sempre è più avanti di quello che si sta lavorando.
  const apriNuovo = () => {
    setRegistrato(null);
    setNuovo({ cliente: '', voce_id: '', data_riferimento: '', importo: '', metodo: 'contanti', data_versamento: oggi, note: '' });
  };

  const salvaNuovo = async () => {
    const cliente = nuovo.cliente.trim().replace(/\s+/g, ' ');
    const importo = leggiImporto(nuovo.importo);
    if (!cliente) return alert('Scrivi il nome del cliente.');
    if (!nuovo.voce_id) return alert('Scegli la voce del listino.');
    if (!nuovo.data_riferimento) return alert("Scegli il giorno dell'evento.");
    if (!nuovo.data_versamento) return alert("Scegli il giorno in cui è stato versato l'acconto.");
    if (!importo || importo <= 0) return alert('Importo non valido.');
    const prezzo = voce(Number(nuovo.voce_id))?.prezzo;
    if (prezzo != null && importo > r2(prezzo)
      && !window.confirm(`L'acconto (${euro(importo)}) supera il prezzo della voce (${euro(prezzo)}). Lo registro lo stesso?`)) return;
    const fatto = await scrivi(() => supabase.from('albatros_acconti').insert([{
      cliente, voce_id: Number(nuovo.voce_id), data_riferimento: nuovo.data_riferimento, data_versamento: nuovo.data_versamento,
      importo, metodo: nuovo.metodo, note: nuovo.note.trim() || null, creato_da: user.id,
    }]));
    if (!fatto) return;
    if (nuovo.data_riferimento !== giorno) setRegistrato(`Acconto di ${cliente} registrato per il ${formattaDataGGMMAAAA(nuovo.data_riferimento)}: lo ritrovi nella Giornata di quel giorno e nella scheda Chiusure.`);
    setNuovo(null);
  };

  const conferma = (a) => {
    if (!accontoConfermabile(a, oggi)) return alert(`L'acconto è per il ${formattaDataGGMMAAAA(a.data_riferimento)}: si conferma quando arriva il giorno.`);
    return scrivi(() => supabase.from('albatros_acconti')
      .update({ stato: 'confermato', esito_il: new Date().toISOString(), esito_da: user.id })
      .eq('id', a.id).eq('stato', 'atteso'));
  };

  // Il rimborso esce, di solito, da dove l'acconto era entrato.
  const apriDisdetta = (a) => setDisdetta({ acconto: a, esito: 'rimborsato', rimborso_data: oggi, rimborso_metodo: a.metodo === 'contanti' ? 'contanti' : 'conto' });

  const salvaDisdetta = async () => {
    const rimborso = disdetta.esito === 'rimborsato';
    if (rimborso && !disdetta.rimborso_data) return alert('Scegli il giorno del rimborso.');
    const fatto = await scrivi(() => supabase.from('albatros_acconti').update({
      stato: disdetta.esito, esito_il: new Date().toISOString(), esito_da: user.id,
      rimborso_data: rimborso ? disdetta.rimborso_data : null, rimborso_metodo: rimborso ? disdetta.rimborso_metodo : null,
    }).eq('id', disdetta.acconto.id).eq('stato', 'atteso'));
    if (fatto) setDisdetta(null);
  };

  const rimettiDaConfermare = (a) => {
    if (!window.confirm(`Rimettere da confermare l'acconto di ${a.cliente} (${euro(a.importo)})?`)) return;
    return scrivi(() => supabase.from('albatros_acconti')
      .update({ stato: 'atteso', esito_il: null, esito_da: null, rimborso_data: null, rimborso_metodo: null }).eq('id', a.id));
  };

  const elimina = (a) => {
    if (!window.confirm(`Eliminare l'acconto di ${a.cliente} (${euro(a.importo)})? Sparisce anche dal Cashflow.`)) return;
    return scrivi(() => supabase.from('albatros_acconti').delete().eq('id', a.id));
  };

  const ordinati = [...acconti].sort((a, b) => (a.stato === 'atteso' ? 0 : 1) - (b.stato === 'atteso' ? 0 : 1)
    || a.data_riferimento.localeCompare(b.data_riferimento) || a.id - b.id);

  return (
    <>
      <div className="albatros-testata" style={{ alignItems: 'center' }}>
        <h3 className="albatros-titolo" style={{ margin: 0 }}>{titolo}</h3>
        {conNuovo && <button type="button" className="btn-outline-annulla albatros-bottone" style={{ marginLeft: 'auto' }} onClick={apriNuovo}>+ Acconto</button>}
      </div>
      {registrato && <p className="albatros-nota" style={{ color: '#15803d' }}>{registrato}</p>}
      {ordinati.length === 0 && <p className="albatros-vuoto">{vuoto}</p>}
      {ordinati.map(a => (
        <div key={a.id} className="albatros-riga albatros-acconto">
          <div className="albatros-riga-testo">
            <strong>{giorno ? '' : `${giornoBreve(a.data_riferimento)} · `}{voce(a.voce_id)?.nome || 'Voce tolta dal listino'}</strong> · {a.cliente}
            <div className="albatros-tenue" style={{ fontSize: '0.78rem' }}>
              {etichettaMetodoAcconto(a.metodo).toLowerCase()}, versato il {formattaDataGGMMAAAA(a.data_versamento)}{utenti[a.creato_da] ? ` · ${utenti[a.creato_da]}` : ''}
              {a.stato === 'rimborsato' && ` · rimborsato il ${formattaDataGGMMAAAA(a.rimborso_data)} ${a.rimborso_metodo === 'contanti' ? 'in contanti' : 'dal conto'}`}
              {a.note && ` · ${a.note}`}
            </div>
          </div>
          <span className={`albatros-badge mini ${CLASSE_STATO[a.stato] || ''}`}>{etichettaStatoAcconto(a.stato)}</span>
          <div className="albatros-riga-importo">{euro(a.importo)}</div>
          <div className="albatros-acconto-azioni">
            {a.stato === 'atteso' && (
              <>
                <button type="button" className="btn-accent-inline albatros-bottone" disabled={inCorso || !accontoConfermabile(a, oggi)}
                  title={accontoConfermabile(a, oggi) ? "L'evento c'è stato: l'acconto entra nell'incasso della giornata" : 'Si conferma quando arriva il giorno'}
                  onClick={() => conferma(a)}><Icona nome="salva" />Conferma</button>
                <button type="button" className="btn-outline-annulla albatros-bottone" disabled={inCorso} onClick={() => apriDisdetta(a)}>Disdetta</button>
              </>
            )}
            {a.stato !== 'atteso' && puoCorreggere && (
              <button type="button" className="btn-icon-action" title="Rimetti da confermare" disabled={inCorso} onClick={() => rimettiDaConfermare(a)}><Icona nome="riporta" size={14} style={{ marginRight: 0 }} /></button>
            )}
            {puoCorreggere && (
              <button type="button" className="btn-icon-action danger" title="Elimina l'acconto" disabled={inCorso} onClick={() => elimina(a)}><Icona nome="elimina" size={14} style={{ marginRight: 0 }} /></button>
            )}
          </div>
        </div>
      ))}

      {nuovo && (
        <div className="modal-form-backdrop" onClick={() => setNuovo(null)}>
          <div className="modal-form-box albatros-overlay" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="modal-form-close" aria-label="Chiudi" onClick={() => setNuovo(null)}>✕</button>
            <h3 style={{ margin: '0 0 4px 0', fontSize: '1.1rem', color: '#0f172a' }}>Nuovo acconto</h3>
            <p className="albatros-nota" style={{ marginTop: 0 }}>Entra subito nel Cashflow. Il giorno dell'evento la voce si batte per intero e l'acconto, confermato, copre la parte già pagata.</p>
            <div className="albatros-griglia-2" style={{ marginTop: '12px' }}>
              <label className="albatros-etichetta" style={{ gridColumn: '1 / -1' }}>Cliente
                <input type="text" value={nuovo.cliente} autoFocus placeholder="Nome e cognome, o come lo conoscete" onChange={(e) => setNuovo({ ...nuovo, cliente: e.target.value })} className="albatros-campo" />
              </label>
              <label className="albatros-etichetta">Voce del listino
                <select value={nuovo.voce_id} onChange={(e) => setNuovo({ ...nuovo, voce_id: e.target.value })} className="albatros-campo">
                  <option value="">Scegli…</option>
                  {vociScelta.map(v => <option key={v.id} value={v.id}>{v.nome} · {euro(v.prezzo)}</option>)}
                </select>
              </label>
              <label className="albatros-etichetta">Giorno dell'evento
                <input type="date" value={nuovo.data_riferimento} onChange={(e) => setNuovo({ ...nuovo, data_riferimento: e.target.value })} className="albatros-campo" />
              </label>
              <label className="albatros-etichetta">Acconto €
                <input type="text" inputMode="decimal" value={nuovo.importo} placeholder="0,00" onChange={(e) => setNuovo({ ...nuovo, importo: e.target.value })} className="albatros-campo albatros-importo" />
              </label>
              <label className="albatros-etichetta">Pagato con
                <select value={nuovo.metodo} onChange={(e) => setNuovo({ ...nuovo, metodo: e.target.value })} className="albatros-campo">
                  {METODI_ACCONTO.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
              </label>
              <label className="albatros-etichetta">Versato il
                <input type="date" value={nuovo.data_versamento} onChange={(e) => setNuovo({ ...nuovo, data_versamento: e.target.value })} className="albatros-campo" />
              </label>
              <label className="albatros-etichetta">Note
                <input type="text" value={nuovo.note} placeholder="Facoltative, es. telefono" onChange={(e) => setNuovo({ ...nuovo, note: e.target.value })} className="albatros-campo" />
              </label>
            </div>
            <div style={{ display: 'flex', gap: '10px', marginTop: '16px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <button type="button" className="btn-outline-annulla albatros-bottone" onClick={() => setNuovo(null)}>Annulla</button>
              <button type="button" className="btn-accent-inline albatros-bottone" disabled={inCorso} onClick={salvaNuovo}><Icona nome="salva" />Registra l'acconto</button>
            </div>
          </div>
        </div>
      )}

      {disdetta && (
        <div className="modal-form-backdrop" onClick={() => setDisdetta(null)}>
          <div className="modal-form-box albatros-overlay" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="modal-form-close" aria-label="Chiudi" onClick={() => setDisdetta(null)}>✕</button>
            <h3 style={{ margin: '0 0 4px 0', fontSize: '1.1rem', color: '#0f172a' }}>Disdetta: acconto di {disdetta.acconto.cliente}</h3>
            <p className="albatros-nota" style={{ marginTop: 0 }}>
              {voce(disdetta.acconto.voce_id)?.nome || 'Voce'} del {formattaDataGGMMAAAA(disdetta.acconto.data_riferimento)} · {euro(disdetta.acconto.importo)} versati in {etichettaMetodoAcconto(disdetta.acconto.metodo).toLowerCase()}.
            </p>
            <div className="albatros-griglia-2" style={{ marginTop: '12px' }}>
              <label className="albatros-etichetta" style={{ gridColumn: '1 / -1' }}>L'acconto
                <select value={disdetta.esito} onChange={(e) => setDisdetta({ ...disdetta, esito: e.target.value })} className="albatros-campo">
                  <option value="rimborsato">Si restituisce (rimborso)</option>
                  <option value="trattenuto">Si trattiene</option>
                </select>
              </label>
              {disdetta.esito === 'rimborsato' && (
                <>
                  <label className="albatros-etichetta">Rimborsato il
                    <input type="date" value={disdetta.rimborso_data} onChange={(e) => setDisdetta({ ...disdetta, rimborso_data: e.target.value })} className="albatros-campo" />
                  </label>
                  <label className="albatros-etichetta">Restituito
                    <select value={disdetta.rimborso_metodo} onChange={(e) => setDisdetta({ ...disdetta, rimborso_metodo: e.target.value })} className="albatros-campo">
                      <option value="contanti">In contanti</option>
                      <option value="conto">Dal conto (bonifico, storno POS)</option>
                    </select>
                  </label>
                </>
              )}
            </div>
            <p className="albatros-nota">{disdetta.esito === 'rimborsato'
              ? 'Il rimborso esce dal Cashflow di Albatros.'
              : "Trattenuto, l'acconto resta ad Albatros: conta come incasso, senza evento."}</p>
            <div style={{ display: 'flex', gap: '10px', marginTop: '16px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <button type="button" className="btn-outline-annulla albatros-bottone" onClick={() => setDisdetta(null)}>Annulla</button>
              <button type="button" className="btn-accent-inline albatros-bottone" disabled={inCorso} onClick={salvaDisdetta}><Icona nome="salva" />Registra la disdetta</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default Acconti
