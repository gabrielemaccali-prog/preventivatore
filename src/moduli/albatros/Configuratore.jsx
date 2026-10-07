import { useState, useEffect } from 'react'
import { supabase, leggiTutte } from '../../lib/supabaseClient'
import Icona from '../../components/Icona'
import { categorieDi } from './calcolo'
import IconaCategoria from './IconaCategoria'
import { ICONE_CATEGORIA } from './iconeCategoria'

// ============================================================
// Configuratore di Albatros: le categorie del listino (da dove arriva l'incasso) e quelle delle
// spese. Si aggiungono, si rinominano, si ordinano. Una categoria usata non si cancella, perché
// voci e spese passate la citano: si archivia, e sparisce dalle scelte.
// Chi non è amministratore può solo aggiungere categorie.
// ============================================================

const SEZIONI = [
  { tipo: 'listino', titolo: 'Categorie del listino', spiegazione: 'Da dove arriva l\'incasso: ogni voce del listino ne ha una.' },
  { tipo: 'spesa', titolo: 'Categorie delle spese', spiegazione: 'Per dividere le uscite.' },
];

function Configuratore({ categorie, ricaricaCategorie, listino, puoCorreggere }) {
  const [usiSpese, setUsiSpese] = useState({});
  const [nuove, setNuove] = useState({ listino: '', spesa: '' });
  const [nomi, setNomi] = useState({});
  const [inCorso, setInCorso] = useState(false);
  // La categoria del listino di cui si sta scegliendo l'icona.
  const [sceltaIcona, setSceltaIcona] = useState(null);

  const caricaUsi = async () => {
    const { data } = await leggiTutte(() => supabase.from('albatros_spese').select('id, categoria_id').order('id'));
    const conta = {};
    (data || []).forEach(s => { if (s.categoria_id != null) conta[s.categoria_id] = (conta[s.categoria_id] || 0) + 1; });
    setUsiSpese(conta);
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
    const ordine = Math.max(0, ...categorieDi(categorie, tipo, { ancheArchiviate: true }).map(c => c.ordine)) + 1;
    if (await scrivi(() => supabase.from('albatros_categorie').insert([{ tipo, nome, ordine }]))) setNuove({ ...nuove, [tipo]: '' });
  };

  // Il nome in corso di modifica vive in `nomi` finché non è salvato; poi si torna a quello letto.
  const scordaNome = (id) => setNomi(n => { const copia = { ...n }; delete copia[id]; return copia; });
  const rinomina = async (c) => {
    const nome = (nomi[c.id] ?? c.nome).trim().replace(/\s+/g, ' ');
    if (!nome || nome === c.nome) { scordaNome(c.id); return; }
    if (await scrivi(() => supabase.from('albatros_categorie').update({ nome }).eq('id', c.id))) scordaNome(c.id);
  };

  // Sposta di un posto scambiando l'ordine con la vicina: si rinumera tutto, così anche ordini
  // uguali o con buchi tornano in sequenza.
  const sposta = async (tipo, indice, verso) => {
    const elenco = categorieDi(categorie, tipo, { ancheArchiviate: true });
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

  const cambiaAttiva = (c) => scrivi(() => supabase.from('albatros_categorie').update({ attiva: !c.attiva }).eq('id', c.id));

  const elimina = async (c) => {
    if (usiDi(c) > 0) return alert(`"${c.nome}" è usata da ${descriviUsi(c)}: non si può cancellare. Archiviala, e sparirà dalle scelte.`);
    if (!window.confirm(`Cancellare la categoria "${c.nome}"?`)) return;
    await scrivi(() => supabase.from('albatros_categorie').delete().eq('id', c.id));
  };

  return (
    <div className="albatros-pagina no-print">
      {SEZIONI.map(({ tipo, titolo, spiegazione }) => {
        const elenco = categorieDi(categorie, tipo, { ancheArchiviate: true });
        return (
          <div key={tipo} className="albatros-card">
            <h3 className="albatros-titolo">{titolo}</h3>
            <p className="descrizione-pagina" style={{ margin: '0 0 10px 0' }}>{spiegazione}</p>
            {elenco.length === 0 && <p className="albatros-vuoto">Nessuna categoria.</p>}
            {elenco.map((c, i) => (
              <div key={c.id}>
              <div className="albatros-riga" style={{ opacity: c.attiva ? 1 : 0.55 }}>
                {puoCorreggere && <div className="albatros-qta">
                  <button type="button" className="btn-icon-action" title="Più su" disabled={inCorso || i === 0} onClick={() => sposta(tipo, i, -1)}>↑</button>
                  <button type="button" className="btn-icon-action" title="Più giù" disabled={inCorso || i === elenco.length - 1} onClick={() => sposta(tipo, i, 1)}>↓</button>
                </div>}
                {tipo === 'listino' && (
                  <button type="button" className="albatros-scelta-icona" disabled={!puoCorreggere} title={puoCorreggere ? "Scegli l'icona" : undefined}
                    onClick={() => setSceltaIcona(sceltaIcona === c.id ? null : c.id)}>
                    <IconaCategoria categoria={c} size={16} titolo={false} />
                  </button>
                )}
                <div className="albatros-riga-testo">
                  <input type="text" value={nomi[c.id] ?? c.nome} className="albatros-campo" disabled={!puoCorreggere}
                    onChange={(e) => setNomi({ ...nomi, [c.id]: e.target.value })}
                    onBlur={() => rinomina(c)} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
                </div>
                <span className="albatros-tenue" style={{ fontSize: '0.78rem', whiteSpace: 'nowrap' }}>{descriviUsi(c)}{c.attiva ? '' : ' · archiviata'}</span>
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
