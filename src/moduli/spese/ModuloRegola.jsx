import { useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import Icona from '../../components/Icona'
import { regolaPer, cosaManca } from '../../lib/banca'
import { applicaRegola, descriviEsito } from './operazioni'
import Classificazione from './Classificazione'

// ============================================================
// L'overlay di una regola: nuova, da modificare, o proposta da una spesa già classificata (le
// uscite che si ripetono: si classifica la prima a mano e da lì nasce la regola). Mentre la si
// scrive dice a quali movimenti già caricati si applicherebbe. Salvata, si applica subito, lei
// sola, alle spese ancora da completare che prende, riempiendo solo i campi vuoti.
// ============================================================

const idONull = (v) => (v === '' || v == null ? null : Number(v));

function ModuloRegola({ iniziale, onChiudi, onSalvata, user, regole, categorie, categorieAlbatros, controparti, spese, movimenti }) {
  const [modulo, setModulo] = useState(iniziale);
  const [inCorso, setInCorso] = useState(false);

  const prova = { ...modulo, id: -1, ordine: -1, attiva: true };
  const corrispondono = movimenti.filter(m => regolaPer(m, [prova], controparti));

  const salva = async () => {
    const nome = modulo.nome.trim();
    if (!nome) return alert('Dai un nome alla regola.');
    if (!modulo.tipo_contiene.trim() && !modulo.testo_contiene.trim() && !modulo.richiede_controparte) return alert('Scrivi almeno una condizione.');
    const spesa = modulo.azione === 'spesa';
    const operativa = spesa && modulo.ente === 'bfm' && modulo.natura === 'operativa';
    const record = {
      nome, segno: modulo.segno, tipo_contiene: modulo.tipo_contiene.trim() || null, testo_contiene: modulo.testo_contiene.trim() || null,
      azione: modulo.azione, attiva: !!modulo.attiva,
      ente: spesa ? modulo.ente || null : null,
      natura: spesa && modulo.ente === 'bfm' ? modulo.natura || null : null,
      operativa: operativa ? modulo.operativa || null : null,
      // La controparte scelta nella regola; senza, si cerca nel movimento (e si può pretendere di trovarla).
      controparte_id: operativa && modulo.operativa ? modulo.controparte_id ?? null : null,
      richiede_controparte: operativa && !!modulo.operativa && !modulo.controparte_id && !!modulo.richiede_controparte,
      categoria_id: spesa && modulo.ente === 'bfm' && modulo.natura === 'generale' ? idONull(modulo.categoria_id) : null,
      albatros_categoria_id: spesa && modulo.ente === 'albatros' ? idONull(modulo.albatros_categoria_id) : null,
      descrizione: spesa ? (modulo.descrizione.trim() || null) : null,
    };
    setInCorso(true);
    try {
      const { data: salvata, error } = modulo.id
        ? await supabase.from('spese_regole').update(record).eq('id', modulo.id).select().single()
        : await supabase.from('spese_regole').insert([{ ...record, ordine: Math.max(0, ...regole.map(r => r.ordine)) + 1 }]).select().single();
      if (error) return alert(`Errore: ${error.message}`);
      // Si applica questa regola e basta, sulle spese da completare che prende: le altre regole
      // e le spese già classificate non si toccano.
      const altre = regole.filter(r => r.id !== salvata.id);
      const esiti = salvata.azione === 'spesa'
        ? await applicaRegola({ regola: salvata, regole: [...altre, salvata], spese, movimenti, controparti, categorie, user })
        : [];
      onSalvata(salvata, salvata.azione === 'spesa' ? descriviEsito(esiti) : '');
    } catch (e) {
      alert(`Errore: ${e.message}`);
    } finally {
      setInCorso(false);
    }
  };

  // La classificazione che la regola darà, per dire se lascia la spesa ancora da completare.
  // La controparte una regola non la sceglie: la cerca nel movimento, quindi qui non conta come mancante.
  const resta = modulo.azione === 'spesa' ? cosaManca({ ...modulo, operativa: modulo.natura === 'operativa' ? modulo.operativa : null, controparte_id: 'dal movimento' }, categorie) : null;

  return (
    <div className="modal-form-backdrop" onClick={onChiudi}>
      <div className="modal-form-box albatros-overlay" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="modal-form-close" aria-label="Chiudi" onClick={onChiudi}>✕</button>
        <h3 style={{ margin: '0 0 12px 0', fontSize: '1.1rem', color: '#0f172a' }}>{modulo.id ? 'Modifica regola' : 'Nuova regola'}</h3>
        <div className="albatros-griglia-2">
          <label className="albatros-etichetta" style={{ gridColumn: '1 / -1' }}>Nome
            <input type="text" value={modulo.nome} autoFocus placeholder="Es. Affitto sede Selfeasy" onChange={(e) => setModulo({ ...modulo, nome: e.target.value })} className="albatros-campo" />
          </label>
          <label className="albatros-etichetta">Il tipo contiene
            <input type="text" value={modulo.tipo_contiene} placeholder="Es. BONIFICO|POS" onChange={(e) => setModulo({ ...modulo, tipo_contiene: e.target.value })} className="albatros-campo" />
          </label>
          <label className="albatros-etichetta">La descrizione contiene
            <input type="text" value={modulo.testo_contiene} placeholder="Es. SELFEASY" onChange={(e) => setModulo({ ...modulo, testo_contiene: e.target.value })} className="albatros-campo" />
          </label>
          <label className="albatros-etichetta">Movimenti
            <select value={modulo.segno} onChange={(e) => setModulo({ ...modulo, segno: e.target.value })} className="albatros-campo">
              <option value="uscita">Uscite</option>
              <option value="entrata">Entrate</option>
            </select>
          </label>
          <label className="albatros-etichetta">Allora
            <select value={modulo.azione} onChange={(e) => setModulo({ ...modulo, azione: e.target.value })} className="albatros-campo">
              <option value="spesa">Crea la spesa così classificata</option>
              <option value="ignora">Ignora: non è una spesa</option>
            </select>
          </label>
        </div>
        {modulo.azione === 'spesa' && (
          <div style={{ marginTop: '10px' }}>
            <Classificazione valore={modulo} onChange={setModulo} categorie={categorie} categorieAlbatros={categorieAlbatros} controparti={controparti} perRegola />
            <label className="albatros-etichetta" style={{ marginTop: '10px' }}>Descrizione della spesa
              <input type="text" value={modulo.descrizione} placeholder="Vuota = quella del movimento" onChange={(e) => setModulo({ ...modulo, descrizione: e.target.value })} className="albatros-campo" />
            </label>
            {resta && <p className="albatros-nota">Le spese di questa regola resteranno da completare: manca {resta}.</p>}
          </div>
        )}
        <p className="albatros-nota">
          {corrispondono.length === 0
            ? 'Fra i movimenti già caricati non ce n\'è nessuno che corrisponda.'
            : `Corrisponde a ${corrispondono.length} ${corrispondono.length === 1 ? 'movimento già caricato' : 'movimenti già caricati'}, per esempio: ${corrispondono.slice(0, 3).map(m => (m.descrizione || m.tipo).replace(/^.*a favore di:\s*/i, '').slice(0, 50)).join(' · ')}`}
        </p>
        <div style={{ display: 'flex', gap: '10px', marginTop: '16px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <button type="button" className="btn-outline-annulla albatros-bottone" onClick={onChiudi}>Annulla</button>
          <button type="button" className="btn-accent-inline albatros-bottone" disabled={inCorso} onClick={salva}><Icona nome="salva" />{modulo.id ? 'Salva' : 'Aggiungi regola'}</button>
        </div>
      </div>
    </div>
  );
}

export default ModuloRegola
