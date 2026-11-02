import { useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import Icona from '../../components/Icona'
import { alberoCategorie } from '../../lib/banca'

// ============================================================
// L'editor di un albero di categorie a due livelli (categoria e sottocategoria), uguale per le spese
// e per gli incassi: cambia solo la tabella. Si aggiungono, si rinominano, si ordinano fra sorelle;
// una voce usata non si cancella, si archivia e sparisce dalle scelte.
// ============================================================

// L'albero di una tabella di categorie. `usi(c)` dice quante volte una voce è usata: una voce usata
// non si elimina, e una che diventa padre lo dice prima.
function EditorCategorie({ tabella, categorie, usi, ricarica, titolo, nota }) {
  const [nuove, setNuove] = useState({});
  const [nomi, setNomi] = useState({});
  const [inCorso, setInCorso] = useState(false);

  const albero = alberoCategorie(categorie, { ancheArchiviate: true });

  const scrivi = async (fn) => {
    setInCorso(true);
    try {
      const { error } = await fn();
      if (error) {
        alert(error.code === '23505' ? 'Esiste già una voce con questo nome a questo livello.' : `Errore: ${error.message}`);
        return false;
      }
      await ricarica();
      return true;
    } finally {
      setInCorso(false);
    }
  };

  // padre: null per una categoria di primo livello, altrimenti la categoria che la contiene.
  const aggiungi = async (padre) => {
    const chiave = padre?.id ?? 'radice';
    const nome = (nuove[chiave] || '').trim().replace(/\s+/g, ' ');
    if (!nome) return;
    const sorelle = padre ? padre.figlie : albero;
    // Una categoria che diventa padre: le spese che la usavano restano lì, ma tornano da completare
    // finché non si sceglie la sottocategoria. Meglio dirlo prima.
    if (padre && padre.figlie.length === 0 && usi(padre) > 0
      && !window.confirm(`"${padre.nome}" è già usata ${usi(padre) === 1 ? 'una volta' : `${usi(padre)} volte`}. Con una sottocategoria, quelle voci torneranno da completare finché non scegli la sottocategoria. Procedere?`)) return;
    if (await scrivi(() => supabase.from(tabella).insert([{ nome, padre_id: padre?.id ?? null, ordine: Math.max(0, ...sorelle.map(c => c.ordine)) + 1 }]))) {
      setNuove({ ...nuove, [chiave]: '' });
    }
  };
  const rinomina = async (c) => {
    const nome = (nomi[c.id] ?? c.nome).trim().replace(/\s+/g, ' ');
    if (!nome || nome === c.nome) return;
    await scrivi(() => supabase.from(tabella).update({ nome }).eq('id', c.id));
  };
  const sposta = async (sorelle, i, verso) => {
    const nuovo = [...sorelle];
    const j = i + verso;
    if (j < 0 || j >= nuovo.length) return;
    [nuovo[i], nuovo[j]] = [nuovo[j], nuovo[i]];
    await scrivi(async () => {
      for (const [k, c] of nuovo.entries()) {
        if (c.ordine === k + 1) continue;
        const { error } = await supabase.from(tabella).update({ ordine: k + 1 }).eq('id', c.id);
        if (error) return { error };
      }
      return { error: null };
    });
  };
  const elimina = async (c) => {
    if (!window.confirm(`Eliminare "${c.nome}"?`)) return;
    await scrivi(() => supabase.from(tabella).delete().eq('id', c.id));
  };

  const riga = (c, sorelle, i, sotto) => {
    const n = usi(c);
    const eliminabile = n === 0 && !(c.figlie?.length);
    return (
      <div className="albatros-riga" style={{ gap: '8px', opacity: c.attiva ? 1 : 0.55, flexWrap: 'wrap', paddingLeft: sotto ? '28px' : 0 }}>
        <span style={{ whiteSpace: 'nowrap' }}>
          <button type="button" className="btn-icon-action" title="Su" disabled={inCorso || i === 0} onClick={() => sposta(sorelle, i, -1)}>▲</button>
          <button type="button" className="btn-icon-action" title="Giù" disabled={inCorso || i === sorelle.length - 1} onClick={() => sposta(sorelle, i, 1)}>▼</button>
        </span>
        {sotto && <span className="albatros-tenue">›</span>}
        <input type="text" value={nomi[c.id] ?? c.nome} onChange={(e) => setNomi({ ...nomi, [c.id]: e.target.value })}
          onBlur={() => rinomina(c)} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} className="albatros-campo"
          style={{ flex: '1 1 180px', height: '34px', fontWeight: sotto ? 400 : 600 }} />
        <span className="albatros-tenue" style={{ fontSize: '0.78rem', whiteSpace: 'nowrap' }}>{n === 1 ? '1 uso' : `${n} usi`}</span>
        <button type="button" className="albatros-chip" disabled={inCorso} onClick={() => scrivi(() => supabase.from(tabella).update({ attiva: !c.attiva }).eq('id', c.id))}>
          {c.attiva ? 'Archivia' : 'Riattiva'}
        </button>
        {eliminabile && <button type="button" className="btn-icon-action danger" title="Elimina" disabled={inCorso} onClick={() => elimina(c)}><Icona nome="elimina" size={14} style={{ marginRight: 0 }} /></button>}
      </div>
    );
  };

  const nuovaVoce = (padre) => {
    const chiave = padre?.id ?? 'radice';
    return (
      <div style={{ display: 'flex', gap: '8px', marginTop: '6px', paddingLeft: padre ? '28px' : 0 }}>
        <input type="text" value={nuove[chiave] || ''} placeholder={padre ? `Nuova sottocategoria di ${padre.nome}` : 'Nuova categoria'}
          onChange={(e) => setNuove({ ...nuove, [chiave]: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && aggiungi(padre)}
          className="albatros-campo" style={{ height: '34px' }} />
        <button type="button" className={padre ? 'albatros-chip' : 'btn-accent-inline albatros-bottone'} disabled={inCorso} onClick={() => aggiungi(padre)}>+ Aggiungi</button>
      </div>
    );
  };

  return (
      <div className="albatros-card">
        <div className="albatros-titolo" style={{ fontWeight: 700, color: '#0f172a' }}>{titolo}</div>
        <p className="albatros-nota" style={{ marginTop: '2px' }}>{nota}</p>
        {albero.length === 0 && <p className="albatros-vuoto">Nessuna categoria.</p>}
        {albero.map((c, i) => (
          <div key={c.id} style={{ marginTop: '10px', paddingTop: '8px', borderTop: i ? '1px solid #f1f5f9' : 'none' }}>
            {riga(c, albero, i, false)}
            {c.figlie.map((f, k) => <div key={f.id}>{riga(f, c.figlie, k, true)}</div>)}
            {c.attiva && nuovaVoce(c)}
          </div>
        ))}
        <div style={{ marginTop: '14px' }}>{nuovaVoce(null)}</div>
      </div>
  );
}

export default EditorCategorie
