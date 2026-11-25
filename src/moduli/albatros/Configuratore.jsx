import { useState, useEffect } from 'react'
import { supabase, leggiTutte } from '../../lib/supabaseClient'
import Icona from '../../components/Icona'
import { categorieDi, alberoCategorie } from './calcolo'
import IconaCategoria from './IconaCategoria'
import { ICONE_CATEGORIA } from './iconeCategoria'
import CategorieSpese from './CategorieSpese'

// ============================================================
// Configuratore di Albatros: le categorie del listino (da dove arriva l'incasso) e quelle delle
// spese. Si aggiungono, si rinominano (col pulsante matita, e Salva), si ordinano. Una categoria usata non si cancella, perché
// voci e spese passate la citano: si archivia, e sparisce dalle scelte.
// Chi non è amministratore può solo aggiungere categorie.
// Anche il listino è a due livelli: una categoria con sottocategorie (gruppo) le raggruppa, come
// il Bar diviso come le spese del bar. Le sottocategorie nascono con l'icona e gli acconti della
// principale.
// ============================================================

const SEZIONI = [
  { tipo: 'listino', titolo: 'Categorie del listino', spiegazione: 'Da dove arriva l\'incasso: ogni voce del listino ne ha una.' },
  // Le spese hanno il loro editor a due livelli (CategorieSpese), con titolo e spiegazione suoi.
  { tipo: 'spesa', titolo: 'Categorie delle spese', spiegazione: '' },
];

// solo: 'listino' (dentro la scheda Listino) o 'spesa' (dentro Conti, e vale anche per la Cassa).
function Configuratore({ categorie, ricaricaCategorie, listino, puoCorreggere, solo }) {
  const [usiSpese, setUsiSpese] = useState({});
  const [nuove, setNuove] = useState({ listino: '', spesa: '' });
  // Il nome della sottocategoria nuova, per principale; e la principale in cui la si sta scrivendo.
  const [nuoveSotto, setNuoveSotto] = useState({});
  const [apriSotto, setApriSotto] = useState(null);
  // La categoria che si sta rinominando: una per volta, aperta col pulsante matita, scritta con Salva.
  const [inModifica, setInModifica] = useState(null);
  const [inCorso, setInCorso] = useState(false);
  // La categoria del listino di cui si sta scegliendo l'icona.
  const [sceltaIcona, setSceltaIcona] = useState(null);

  // Una categoria di spesa è usata dalle spese semplici (in testata) e dalle voci degli scontrini:
  // si conta ogni spesa una volta sola.
  const caricaUsi = async () => {
    const [{ data: spese }, { data: voci }] = await Promise.all([
      leggiTutte(() => supabase.from('albatros_spese').select('id, categoria_id').order('id')),
      leggiTutte(() => supabase.from('albatros_spese_righe').select('id, spesa_id, categoria_id').order('id')),
    ]);
    const usi = {};
    [...(spese || []).map(s => [s.categoria_id, s.id]), ...(voci || []).map(v => [v.categoria_id, v.spesa_id])].forEach(([cat, spesa]) => {
      if (cat != null) (usi[cat] = usi[cat] || new Set()).add(spesa);
    });
    setUsiSpese(Object.fromEntries(Object.entries(usi).map(([cat, ids]) => [cat, ids.size])));
  };
  useEffect(() => { caricaUsi(); }, []);

  const usiDi = (c) => (c.tipo === 'listino' ? listino.filter(v => v.categoria_id === c.id).length : usiSpese[c.id] || 0);
  const descriviUsi = (c) => {
    const n = usiDi(c);
    if (c.tipo === 'listino') return n === 1 ? '1 voce' : `${n} voci`;
    return n === 1 ? '1 spesa' : `${n} spese`;
  };

  const scrivi = async (fn) => {
    setInCorso(true);
    try {
      const { error } = await fn();
      if (error) {
        alert(error.code === '23505' ? 'Esiste già una categoria con questo nome.' : `Errore: ${error.message}`);
        return false;
      }
      await ricaricaCategorie();
      return true;
    } finally {
      setInCorso(false);
    }
  };

  const aggiungi = async (tipo) => {
    const nome = nuove[tipo].trim().replace(/\s+/g, ' ');
    if (!nome) return;
    const ordine = Math.max(0, ...categorieDi(categorie, tipo, { ancheArchiviate: true }).filter(c => c.padre_id == null).map(c => c.ordine)) + 1;
    if (await scrivi(() => supabase.from('albatros_categorie').insert([{ tipo, nome, ordine }]))) setNuove({ ...nuove, [tipo]: '' });
  };

  // Una sottocategoria del listino: la principale diventa un gruppo. Le voci già sulla principale
  // restano lì finché non si spostano, e negli Incassi si vedono a parte.
  const aggiungiSotto = async (padre) => {
    const nome = (nuoveSotto[padre.id] || '').trim().replace(/\s+/g, ' ');
    if (!nome) return;
    const figlie = categorie.filter(c => c.padre_id === padre.id);
    if (!padre.gruppo && usiDi(padre) > 0 && !window.confirm(`"${padre.nome}" diventa una categoria che raggruppa: le sue ${descriviUsi(padre)} restano su "${padre.nome}" finché non le sposti in una sottocategoria dal listino. Continuare?`)) return;
    const ok = await scrivi(async () => {
      if (!padre.gruppo) {
        const { error } = await supabase.from('albatros_categorie').update({ gruppo: true }).eq('id', padre.id);
        if (error) return { error };
      }
      return supabase.from('albatros_categorie').insert([{ tipo: padre.tipo, nome, padre_id: padre.id, gruppo: false, icona: padre.icona ?? null, ...(padre.acconti !== undefined ? { acconti: padre.acconti } : {}),
        ordine: Math.max(0, ...figlie.map(c => c.ordine || 0)) + 1 }]);
    });
    if (ok) setNuoveSotto({ ...nuoveSotto, [padre.id]: '' });
  };

  const salvaNome = async () => {
    const c = categorie.find(x => x.id === inModifica.id);
    const nome = inModifica.nome.trim().replace(/\s+/g, ' ');
    if (!nome) return alert('Scrivi il nome.');
    if (nome === c.nome) return setInModifica(null);
    if (await scrivi(() => supabase.from('albatros_categorie').update({ nome }).eq('id', c.id))) setInModifica(null);
  };

  // Sposta di un posto scambiando l'ordine con la vicina: si rinumera tutto, così anche ordini
  // uguali o con buchi tornano in sequenza.
  const sposta = async (sorelle, indice, verso) => {
    const elenco = [...sorelle];
    const altro = indice + verso;
    if (altro < 0 || altro >= elenco.length) return;
    [elenco[indice], elenco[altro]] = [elenco[altro], elenco[indice]];
    await scrivi(async () => {
      for (let i = 0; i < elenco.length; i++) {
        if (elenco[i].ordine === i + 1) continue;
        const esito = await supabase.from('albatros_categorie').update({ ordine: i + 1 }).eq('id', elenco[i].id);
        if (esito.error) return esito;
      }
      return { error: null };
    });
  };

  const cambiaIcona = async (c, icona) => {
    if (await scrivi(() => supabase.from('albatros_categorie').update({ icona }).eq('id', c.id))) setSceltaIcona(null);
  };


  // Le voci di una categoria del listino con gli acconti spenti non si offrono per un acconto.
  const cambiaAcconti = (c) => scrivi(() => supabase.from('albatros_categorie').update({ acconti: !c.acconti }).eq('id', c.id));
  // Le voci di una categoria con le ore campo (e delle sue sottocategorie) chiedono ore e tariffa speciale.
  const cambiaOreCampo = (c) => scrivi(() => supabase.from('albatros_categorie').update({ ore_campo: !c.ore_campo }).eq('id', c.id));

  const cambiaAttiva = (c) => scrivi(() => supabase.from('albatros_categorie').update({ attiva: !c.attiva }).eq('id', c.id));

  const elimina = async (c) => {
    if (categorie.some(x => x.padre_id === c.id)) return alert(`"${c.nome}" ha delle sottocategorie: cancella o archivia prima quelle.`);
    if (usiDi(c) > 0) return alert(`"${c.nome}" è usata da ${descriviUsi(c)}: non si può cancellare. Archiviala, e sparirà dalle scelte.`);
    if (!window.confirm(`Cancellare la categoria "${c.nome}"?`)) return;
    await scrivi(() => supabase.from('albatros_categorie').delete().eq('id', c.id));
  };

  return (
    <div className="albatros-pagina no-print">
      {SEZIONI.filter(x => !solo || x.tipo === solo).map(({ tipo, titolo, spiegazione }) => {
        // Le categorie delle spese sono a due livelli (principali e secondarie): hanno il loro editor.
        if (tipo === 'spesa') {
          return (
            <CategorieSpese key={tipo} categorie={categorie.filter(c => c.tipo === 'spesa')} usi={(c) => usiSpese[c.id] || 0}
              ricarica={ricaricaCategorie} puoCorreggere={puoCorreggere} />
          );
        }
        const albero = alberoCategorie(categorie, tipo, { ancheArchiviate: true });
        const righe = albero.flatMap((p, i) => [{ c: p, sorelle: albero, i, sotto: false },
          ...p.figlie.map((f, k) => ({ c: f, sorelle: p.figlie, i: k, sotto: true }))]);
        return (
          <div key={tipo} className="albatros-card">
            <h3 className="albatros-titolo">{titolo}</h3>
            <p className="descrizione-pagina" style={{ margin: '0 0 10px 0' }}>{spiegazione}</p>
            {righe.length === 0 && <p className="albatros-vuoto">Nessuna categoria.</p>}
            {righe.map(({ c, sorelle, i, sotto }) => (
              <div key={c.id}>
              <div className="albatros-riga" style={{ opacity: c.attiva ? 1 : 0.55, paddingLeft: sotto ? '28px' : 0 }}>
                {puoCorreggere && <div className="albatros-qta">
                  <button type="button" className="btn-icon-action" title="Più su" disabled={inCorso || i === 0} onClick={() => sposta(sorelle, i, -1)}>↑</button>
                  <button type="button" className="btn-icon-action" title="Più giù" disabled={inCorso || i === sorelle.length - 1} onClick={() => sposta(sorelle, i, 1)}>↓</button>
                </div>}
                {tipo === 'listino' && (
                  <button type="button" className="albatros-scelta-icona" disabled={!puoCorreggere} title={puoCorreggere ? "Scegli l'icona" : undefined}
                    onClick={() => setSceltaIcona(sceltaIcona === c.id ? null : c.id)}>
                    <IconaCategoria categoria={c} size={16} titolo={false} />
                  </button>
                )}
                <div className="albatros-riga-testo">
                  {inModifica?.id === c.id
                    ? <input type="text" value={inModifica.nome} autoFocus className="albatros-campo" onChange={(e) => setInModifica({ ...inModifica, nome: e.target.value })}
                        onKeyDown={(e) => { if (e.key === 'Enter') salvaNome(); if (e.key === 'Escape') setInModifica(null); }} />
                    : sotto ? <span><span className="albatros-tenue">› </span>{c.nome}</span> : <strong>{c.nome}</strong>}
                </div>
                <span className="albatros-tenue" style={{ fontSize: '0.78rem', whiteSpace: 'nowrap' }}>{c.gruppo ? `${c.figlie?.length || 0} sottocategorie` : descriviUsi(c)}{c.gruppo && usiDi(c) ? ` · ${descriviUsi(c)} da spostare` : ''}{c.attiva ? '' : ' · archiviata'}</span>
                {tipo === 'listino' && c.acconti !== undefined && (
                  <label className="albatros-con-icona" style={{ gap: '6px', fontSize: '0.78rem', color: '#475569', whiteSpace: 'nowrap' }} title="Sulle voci di questa categoria si può prendere un acconto">
                    Acconti
                    <span className="albatros-interruttore">
                      <input type="checkbox" checked={!!c.acconti} disabled={!puoCorreggere || inCorso} onChange={() => cambiaAcconti(c)} />
                      <span />
                    </span>
                  </label>
                )}
                {tipo === 'listino' && !sotto && c.ore_campo !== undefined && (
                  <label className="albatros-con-icona" style={{ gap: '6px', fontSize: '0.78rem', color: '#475569', whiteSpace: 'nowrap' }} title="Le voci di questa categoria dicono le ore di campo e se sono a tariffa speciale">
                    Ore campo
                    <span className="albatros-interruttore">
                      <input type="checkbox" checked={!!c.ore_campo} disabled={!puoCorreggere || inCorso} onChange={() => cambiaOreCampo(c)} />
                      <span />
                    </span>
                  </label>
                )}
                {puoCorreggere && (inModifica?.id === c.id ? <>
                            <button type="button" className="btn-accent-inline" disabled={inCorso} onClick={salvaNome} style={{ display: 'inline-flex', alignItems: 'center', fontSize: '0.78rem', padding: '3px 8px' }}><Icona nome="salva" size={13} style={{ marginRight: '4px' }} />Salva</button>
                            <button type="button" className="btn-outline-annulla" disabled={inCorso} onClick={() => setInModifica(null)} style={{ display: 'inline-flex', alignItems: 'center', fontSize: '0.78rem', padding: '3px 8px', borderRadius: '4px' }}><Icona nome="annulla" size={13} style={{ marginRight: '4px' }} />Annulla</button>
                          </>
                  : <button type="button" className="btn-icon-action" title={inModifica ? 'Finisci prima la categoria che stai modificando' : 'Rinomina'} disabled={!!inModifica} onClick={() => setInModifica({ id: c.id, nome: c.nome })}><Icona nome="modifica" size={14} style={{ marginRight: 0 }} /></button>)}
                {!sotto && c.attiva && !inModifica && (c.gruppo || puoCorreggere) && <button type="button" className="albatros-chip" disabled={inCorso} title="Dividi questa categoria in sottocategorie" onClick={() => setApriSotto(apriSotto === c.id ? null : c.id)}>+ Sotto</button>}
                {puoCorreggere && <button type="button" className="btn-icon-action" title={c.attiva ? 'Archivia' : 'Rimetti fra le scelte'} disabled={inCorso} onClick={() => cambiaAttiva(c)}><Icona nome={c.attiva ? 'archivia' : 'riporta'} size={14} style={{ marginRight: 0 }} /></button>}
                {puoCorreggere && <button type="button" className="btn-icon-action danger" title="Cancella" disabled={inCorso} onClick={() => elimina(c)}><Icona nome="elimina" size={14} style={{ marginRight: 0 }} /></button>}
              </div>
              {sceltaIcona === c.id && (
                <div className="albatros-icone-scelta">
                  {Object.entries(ICONE_CATEGORIA).map(([chiave, icona]) => (
                    <button key={chiave} type="button" className={`albatros-scelta-icona ${c.icona === chiave ? 'attiva' : ''}`} title={icona.nome} disabled={inCorso} onClick={() => cambiaIcona(c, chiave)}>
                      <IconaCategoria categoria={{ icona: chiave }} size={16} titolo={false} />
                    </button>
                  ))}
                  <button type="button" className="btn-outline-annulla" style={{ fontSize: '0.75rem', padding: '4px 8px' }} disabled={inCorso} onClick={() => cambiaIcona(c, null)}>Nessuna</button>
                </div>
              )}
              {apriSotto === c.id && !sotto && (
                <div style={{ display: 'flex', gap: '8px', margin: '6px 0 8px 28px' }}>
                  <input type="text" value={nuoveSotto[c.id] || ''} autoFocus placeholder={`Nuova sottocategoria di ${c.nome}`} className="albatros-campo" style={{ height: '34px' }}
                    onChange={(e) => setNuoveSotto({ ...nuoveSotto, [c.id]: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') aggiungiSotto(c); if (e.key === 'Escape') setApriSotto(null); }} />
                  <button type="button" className="albatros-chip" disabled={inCorso || !(nuoveSotto[c.id] || '').trim()} onClick={() => aggiungiSotto(c)}>+ Aggiungi</button>
                </div>
              )}
              </div>
            ))}
            <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
              <input type="text" value={nuove[tipo]} placeholder="Nuova categoria" className="albatros-campo"
                onChange={(e) => setNuove({ ...nuove, [tipo]: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && aggiungi(tipo)} />
              <button type="button" className="btn-accent-inline albatros-bottone" disabled={inCorso || !nuove[tipo].trim()} onClick={() => aggiungi(tipo)}>+ Categoria</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default Configuratore
