import { useState } from 'react'
import { alberoCategorie, cercaCategorie, percorsoCategoria, ENTI, NATURE, OPERATIVE } from '../../lib/banca'

// ============================================================
// La classificazione di una spesa (o di quella che una regola dà), un passo alla volta: ogni
// scelta apre la successiva e azzera quelle che non hanno più senso.
//   BFM o Albatros → per Albatros la sua categoria; per BFM operativa o generale →
//   operativa: il tipo (bubbler, campo, fornitore) e la controparte; generale: la categoria.
// Nelle regole la controparte non si sceglie: si chiede di riconoscerla nel movimento.
// ============================================================

const VUOTA = { ente: null, natura: null, operativa: null, controparte_id: null, categoria_id: null, albatros_categoria_id: null };
const valoreSelect = (v) => (v == null ? '' : String(v));
// Le tendine nella riga di una tabella: basse e strette, una accanto all'altra.
const STILE_COMPATTO = { height: '26px', padding: '2px 6px', fontSize: '0.78rem', width: 'auto', maxWidth: '170px' };

// La categoria, all'ultimo livello: le categorie con sottocategorie fanno da gruppo, quelle senza si
// scelgono direttamente. Scrivendo nella ricerca la tendina si restringe, e se resta una voce sola
// è già scelta, con tutto il suo percorso.
export function SceltaCategoria({ categorie, valore, onChange, vuoto = 'Scegli…', compatta = false }) {
  const [cerca, setCerca] = useState('');
  const trovate = new Set(cercaCategorie(categorie, cerca).map(c => c.id));
  const albero = alberoCategorie(categorie);
  const scrivi = (testo) => {
    setCerca(testo);
    const risultati = cercaCategorie(categorie, testo);
    if (testo.trim() && risultati.length === 1 && risultati[0].id !== valore) onChange(risultati[0].id);
  };
  // La voce scelta resta in elenco anche se archiviata o fuori dalla ricerca.
  const scelta = valore != null && !trovate.has(valore) ? (categorie || []).find(c => c.id === valore) : null;
  // Nella riga non c'è la ricerca: la tendina basta, e la riga resta bassa.
  const classe = compatta ? 'table-input' : 'albatros-campo';
  return (
    <div style={{ display: 'flex', gap: '6px' }}>
      {!compatta && <input type="search" value={cerca} placeholder="Cerca…" onChange={(e) => scrivi(e.target.value)} className={classe} style={{ flex: '0 1 110px' }} />}
      <select value={valoreSelect(valore)} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))} className={classe}
        style={compatta ? STILE_COMPATTO : { flex: '1 1 auto', minWidth: 0 }}>
        <option value="">{albero.length === 0 ? 'Nessuna categoria: creale nel Configuratore' : vuoto}</option>
        {scelta && <option value={scelta.id}>{percorsoCategoria(categorie, scelta.id)}</option>}
        {albero.map(c => (c.figlie.length
          ? (c.figlie.some(f => trovate.has(f.id)) && (
            <optgroup key={c.id} label={c.nome}>
              {c.figlie.filter(f => trovate.has(f.id)).map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}
            </optgroup>
          ))
          : (trovate.has(c.id) && <option key={c.id} value={c.id}>{c.nome}</option>)))}
      </select>
    </div>
  );
}

// compatta: per la riga di una tabella (modifica inline). Le tendine stanno una accanto all'altra,
// senza etichette: la prima voce di ognuna dice cosa si sceglie.
function Classificazione({ valore, onChange, categorie, categorieAlbatros, controparti, perRegola = false, compatta = false }) {
  const v = { ...VUOTA, ...valore };
  const cambia = (patch) => onChange({ ...v, ...patch });
  const tendina = (elenco, scelto, onScegli, vuoto) => (
    <select value={valoreSelect(scelto)} onChange={(e) => onScegli(e.target.value === '' ? null : e.target.value)}
      className={compatta ? 'table-input' : 'albatros-campo'} style={compatta ? STILE_COMPATTO : undefined}>
      <option value="">{vuoto}</option>
      {elenco.map(x => <option key={x.id} value={x.id}>{x.label ?? x.nome}</option>)}
    </select>
  );
  // Un campo: con la sua etichetta nell'overlay, da solo nella riga.
  const campo = (titolo, contenuto, stile) => (compatta
    ? <div key={titolo}>{contenuto}</div>
    : <label key={titolo} className="albatros-etichetta" style={stile}>{titolo}{contenuto}</label>);
  const tipo = OPERATIVE.find(o => o.id === v.operativa);
  const vuoto = (testo) => (compatta ? `${testo}…` : 'Da scegliere');

  return (
    <div className={compatta ? undefined : 'albatros-griglia-2'} style={compatta ? { display: 'flex', flexWrap: 'wrap', gap: '4px', alignItems: 'center' } : undefined}>
      {campo('Di chi è', tendina(ENTI, v.ente, (ente) => cambia({ ...VUOTA, ente }), vuoto('Di chi è')))}
      {v.ente === 'albatros' && campo('Categoria in Albatros',
        tendina(categorieAlbatros.filter(c => c.attiva || c.id === v.albatros_categoria_id), v.albatros_categoria_id,
          (id) => cambia({ albatros_categoria_id: id == null ? null : Number(id) }), vuoto('Categoria Albatros')))}
      {v.ente === 'bfm' && campo('Che costo è',
        tendina(NATURE, v.natura, (natura) => cambia({ natura, operativa: null, controparte_id: null, categoria_id: null }), vuoto('Che costo è')))}
      {v.ente === 'bfm' && v.natura === 'operativa' && campo('Tipo',
        tendina(OPERATIVE, v.operativa, (operativa) => cambia({ operativa, controparte_id: null }), vuoto('Tipo')))}
      {/* Nella regola la controparte o si sceglie (sempre quella), o si lascia "dal movimento":
          allora si cerca per nome nel bonifico, e si può chiedere che la regola valga solo se la trova. */}
      {v.ente === 'bfm' && v.natura === 'operativa' && tipo && campo(tipo.controparte,
        // Si propongono solo le controparti attive; quella già scelta resta, anche se disattiva.
        tendina((controparti?.[tipo.id] || []).filter(x => x.attivo !== false || String(x.id) === String(v.controparte_id)), v.controparte_id,
          (controparte_id) => cambia(perRegola ? { controparte_id, richiede_controparte: controparte_id ? false : v.richiede_controparte } : { controparte_id }),
          perRegola ? 'Riconosci dal movimento' : compatta ? `${tipo.controparte} non indicato` : 'Non indicato'))}
      {v.ente === 'bfm' && v.natura === 'operativa' && tipo && perRegola && !v.controparte_id && (
        <label className="albatros-etichetta" style={{ justifyContent: 'flex-end' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '8px', minHeight: '40px', fontWeight: 400 }}>
            <input type="checkbox" checked={!!v.richiede_controparte} onChange={(e) => cambia({ richiede_controparte: e.target.checked })} />
            Solo se nel movimento riconosco il {tipo.controparte.toLowerCase()}
          </span>
        </label>
      )}
      {v.ente === 'bfm' && v.natura === 'generale' && campo('Categoria',
        <SceltaCategoria categorie={categorie} valore={v.categoria_id} onChange={(categoria_id) => cambia({ categoria_id })} compatta={compatta} vuoto={compatta ? 'Categoria…' : 'Scegli…'} />,
        { gridColumn: '1 / -1' })}
    </div>
  );
}

export default Classificazione
