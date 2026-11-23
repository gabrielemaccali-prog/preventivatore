import { useState, useEffect } from 'react'
import { supabase, leggiTutte } from '../../lib/supabaseClient'
import { formattaDataGGMMAAAA } from '../../lib/utils'
import Icona from '../../components/Icona'
import { euro, r2, num } from './calcolo'

// ============================================================
// Le spese con carta scritte a mano che nell'estratto conto non ci sono: non esistono (vedi
// nonInBanca), e restano solo per il dettaglio dello scontrino che qualcuna ha. Qui l'amministratore
// le toglie: il dettaglio, se c'è, passa alla spesa dalla banca che è davvero quella (proposte
// prima quelle più vicine per data e importo), e la spesa scritta a mano si elimina.
// ============================================================

const GIORNI_PROPOSTE = 20;
const giorni = (a, b) => Math.abs(new Date(`${a}T12:00:00`) - new Date(`${b}T12:00:00`)) / 86400000;

function SpeseNascoste({ speseBanca, onCambiate }) {
  const [nascoste, setNascoste] = useState([]);
  const [voci, setVoci] = useState({});
  const [aperto, setAperto] = useState(false);
  const [scelte, setScelte] = useState({});
  const [inCorso, setInCorso] = useState(false);

  const carica = async () => {
    const { data } = await leggiTutte(() => supabase.from('albatros_spese').select('*')
      .is('movimento_id', null).is('spesa_bfm_id', null).in('metodo', ['carta', 'conto']).order('data'));
    setNascoste(data || []);
    const ids = (data || []).map(s => s.id);
    const { data: righe } = ids.length ? await supabase.from('albatros_spese_righe').select('*').in('spesa_id', ids) : { data: [] };
    const mappa = {};
    (righe || []).forEach(v => { (mappa[v.spesa_id] = mappa[v.spesa_id] || []).push(v); });
    setVoci(mappa);
  };
  useEffect(() => { carica(); }, []);

  // Le spese dalla banca a cui spostare il dettaglio: entro GIORNI_PROPOSTE giorni, prima quelle
  // con l'importo più vicino, poi le più vicine per data.
  const proposte = (s) => speseBanca
    .filter(b => giorni(b.data, s.data) <= GIORNI_PROPOSTE)
    .sort((a, b) => Math.abs(num(a.importo) - num(s.importo)) - Math.abs(num(b.importo) - num(s.importo)) || giorni(a.data, s.data) - giorni(b.data, s.data));

  const esegui = async (fn) => {
    setInCorso(true);
    try {
      await fn();
      await carica();
      await onCambiate();
    } catch (err) {
      alert(`Errore: ${err.message}`);
    } finally {
      setInCorso(false);
    }
  };

  const elimina = (s) => {
    const n = (voci[s.id] || []).length;
    if (!window.confirm(`Eliminare "${s.descrizione}" di ${euro(s.importo)}${n ? ` con le sue ${n} voci di dettaglio` : ''}?`)) return;
    return esegui(async () => {
      const { error } = await supabase.from('albatros_spese').delete().eq('id', s.id);
      if (error) throw error;
    });
  };

  // Il dettaglio passa alla spesa dalla banca, che diventa uno scontrino con più categorie; le voci
  // tenute insieme non possono superarne il totale.
  const sposta = (s) => {
    const destinazione = speseBanca.find(b => String(b.id) === String(scelte[s.id] ?? proposte(s)[0]?.id));
    if (!destinazione) return alert('Scegli la spesa dalla banca a cui spostare il dettaglio.');
    return esegui(async () => {
      const { data: gia, error: e0 } = await supabase.from('albatros_spese_righe').select('importo').eq('spesa_id', destinazione.id);
      if (e0) throw e0;
      const totale = r2([...(gia || []), ...(voci[s.id] || [])].reduce((t, v) => t + num(v.importo), 0));
      if (totale > r2(destinazione.importo)) throw new Error(`Le voci arriverebbero a ${euro(totale)}, più dei ${euro(destinazione.importo)} della spesa "${destinazione.descrizione}".`);
      const { error: e1 } = await supabase.from('albatros_spese_righe').update({ spesa_id: destinazione.id }).eq('spesa_id', s.id);
      if (e1) throw e1;
      if (!destinazione.multicategoria) {
        const { error } = await supabase.from('albatros_spese').update({ multicategoria: true, categoria_id: null }).eq('id', destinazione.id);
        if (error) throw error;
      }
      const { error: e2 } = await supabase.from('albatros_spese').delete().eq('id', s.id);
      if (e2) throw e2;
    });
  };

  if (nascoste.length === 0) return null;
  return (
    <div className="albatros-avviso" style={{ marginBottom: 0 }}>
      <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
        <span><strong>{nascoste.length === 1 ? 'Una spesa con carta scritta a mano non è' : `${nascoste.length} spese con carta scritte a mano non sono`} in banca</strong>: non contano e non si vedono. Toglile, spostando prima il dettaglio dello scontrino dove c'è.</span>
        <button type="button" className="albatros-chip albatros-chip-avviso" onClick={() => setAperto(!aperto)}>{aperto ? 'Chiudi' : 'Sistemale'}</button>
      </div>
      {aperto && nascoste.map(s => {
        const n = (voci[s.id] || []).length;
        const elenco = proposte(s);
        return (
          <div key={s.id} className="albatros-riga" style={{ flexWrap: 'wrap', background: '#fff', borderRadius: '6px', padding: '8px 10px', marginTop: '8px' }}>
            <div className="albatros-riga-testo">
              <strong>{formattaDataGGMMAAAA(s.data)} · {s.descrizione}</strong> · {euro(s.importo)}
              <div className="albatros-tenue" style={{ fontSize: '0.78rem' }}>{n ? `${n} ${n === 1 ? 'voce' : 'voci'} di dettaglio` : 'senza dettaglio'}</div>
            </div>
            {n > 0 && (
              <>
                <select value={scelte[s.id] ?? String(elenco[0]?.id ?? '')} onChange={(e) => setScelte({ ...scelte, [s.id]: e.target.value })} className="albatros-campo albatros-categoria-riga" style={{ maxWidth: '320px' }}>
                  {elenco.length === 0 && <option value="">Nessuna spesa dalla banca vicina</option>}
                  {elenco.map(b => <option key={b.id} value={String(b.id)}>{formattaDataGGMMAAAA(b.data)} · {b.descrizione} · {euro(b.importo)}</option>)}
                </select>
                <button type="button" className="btn-accent-inline albatros-bottone" disabled={inCorso || elenco.length === 0} onClick={() => sposta(s)}>Sposta il dettaglio ed elimina</button>
              </>
            )}
            <button type="button" className="btn-outline-annulla albatros-bottone" disabled={inCorso} onClick={() => elimina(s)}><Icona nome="elimina" />Elimina</button>
          </div>
        );
      })}
    </div>
  );
}

export default SpeseNascoste
