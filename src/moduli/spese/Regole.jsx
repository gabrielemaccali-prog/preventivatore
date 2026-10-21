import { useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import Icona from '../../components/Icona'
import { regolaPer, esitoRegola, percorsoCategoria, etichetta, nomeControparte, OPERATIVE, REGOLA_VUOTA } from '../../lib/banca'
import { applicaRegola, descriviEsito, caricaTutto } from './operazioni'
import ModuloRegola from './ModuloRegola'

// ============================================================
// Regole: classificano da sole le uscite ricorrenti dell'estratto conto. Si provano in ordine e
// vale la prima che corrisponde; le condizioni scritte valgono tutte insieme, e ognuna accetta più
// alternative separate da "|". Il modo più rapido per farne una è dalla spesa: la si classifica a
// mano e da lì "Crea una regola"; qui si rivedono, si ordinano e si spengono.
// I costi dei bonifici non hanno bisogno di regole: si sommano da soli alla spesa del bonifico.
// ============================================================

function Regole(props) {
  const { user, regole, categorie, categorieAlbatros, controparti, spese, movimenti, ricaricaConfigurazione, ricaricaDati } = props;
  const [modulo, setModulo] = useState(null);
  const [inCorso, setInCorso] = useState(false);
  // Per regola, quante transazioni prende la cui spesa è ancora da completare: quelle che la
  // bandierina completerebbe. Si calcola col pulsante "Ricalcola"; null = non ancora calcolato.
  const [daAssociare, setDaAssociare] = useState(null);
  const contaDaAssociare = (dati) => Object.fromEntries(regole.filter(r => r.azione === 'spesa').map(r => [r.id,
    esitoRegola({ regola: r, regole, spese: dati.spese, movimenti: dati.movimenti, controparti, categorie }).filter(x => x.esito === 'completa').length]));
  const ricalcola = () => setDaAssociare(contaDaAssociare({ spese, movimenti }));
  // Dopo una scrittura i dati si rileggono, e il conteggio (se c'era) si rifà su quelli nuovi.
  const aggiorna = async () => {
    await ricaricaDati();
    if (daAssociare) {
      const letti = await caricaTutto();
      setDaAssociare(contaDaAssociare({ spese: letti.spese.data || [], movimenti: letti.movimenti.data || [] }));
    }
  };

  const ordinate = [...regole].sort((a, b) => a.ordine - b.ordine || a.id - b.id);
  // Quante uscite già caricate prende ciascuna regola, così come sono ordinate adesso.
  const usi = {};
  movimenti.forEach(m => { const r = regolaPer(m, regole, controparti); if (r) usi[r.id] = (usi[r.id] || 0) + 1; });
  // Quanti movimenti ciascuna regola riconosce da sola, e quali regole più in alto (o lei stessa,
  // se è spenta) le tolgono quelli che non prende: una regola giusta può prenderne zero solo perché
  // un'altra arriva prima. { [id]: { riconosce, presiDa: { [idAltra]: quanti } } }
  const copertura = {};
  for (const r of regole) {
    const sola = [{ ...r, attiva: true }];
    const c = { riconosce: 0, presiDa: {} };
    for (const m of movimenti) {
      if (!regolaPer(m, sola, controparti)) continue;
      c.riconosce++;
      const vince = regolaPer(m, regole, controparti);
      if (vince && vince.id !== r.id) c.presiDa[vince.id] = (c.presiDa[vince.id] || 0) + 1;
    }
    copertura[r.id] = c;
  }
  const nomeRegola = (id) => regole.find(x => x.id === Number(id) || String(x.id) === String(id))?.nome || '?';

  const scrivi = async (fn) => {
    setInCorso(true);
    try {
      const { error } = await fn();
      if (error) { alert(`Errore: ${error.message}`); return false; }
      await ricaricaConfigurazione();
      return true;
    } finally {
      setInCorso(false);
    }
  };

  const elimina = (r) => window.confirm(`Eliminare la regola "${r.nome}"? Le spese che ha già classificato restano come sono.`)
    && scrivi(() => supabase.from('spese_regole').delete().eq('id', r.id));
  const accendi = (r) => scrivi(() => supabase.from('spese_regole').update({ attiva: !r.attiva }).eq('id', r.id));

  // Su e giù: si scambia l'ordine con la vicina. Le regole si rinumerano 1..n, così due con lo
  // stesso ordine non restano mai pari.
  const sposta = async (i, verso) => {
    const nuove = [...ordinate];
    const j = i + verso;
    if (j < 0 || j >= nuove.length) return;
    [nuove[i], nuove[j]] = [nuove[j], nuove[i]];
    await scrivi(async () => {
      for (const [k, r] of nuove.entries()) {
        if (r.ordine === k + 1) continue;
        const { error } = await supabase.from('spese_regole').update({ ordine: k + 1 }).eq('id', r.id);
        if (error) return { error };
      }
      return { error: null };
    });
  };

  // Una regola sola, sui movimenti già caricati che prende. Prima si dice quante spese toccherà:
  // solo quelle da completare, e solo nei campi vuoti.
  const applica = async (r) => {
    const prova = esitoRegola({ regola: r, regole, spese, movimenti, controparti, categorie });
    const daToccare = prova.filter(x => x.esito === 'completa').length;
    // Niente da completare: si dice perché (nessun movimento, già classificate, una regola più in alto…).
    if (daToccare === 0) return alert(descriviEsito(prova));
    if (!window.confirm(`"${r.nome}" completerà ${daToccare} ${daToccare === 1 ? 'spesa' : 'spese'} ancora da completare, riempiendo solo i campi vuoti. Le spese già classificate non si toccano. Procedere?`)) return;
    setInCorso(true);
    try {
      await applicaRegola({ regola: r, regole, spese, movimenti, controparti, categorie, user });
      await aggiorna();
    } catch (e) {
      alert(`Errore: ${e.message}`);
    } finally {
      setInCorso(false);
    }
  };

  // La copia si apre nell'editor e nasce solo se la si salva: in fondo all'elenco, da spostare dove serve.
  const duplica = (r) => setModulo({
    ...REGOLA_VUOTA, ...r, id: null, nome: `${r.nome} (copia)`,
    tipo_contiene: r.tipo_contiene || '', testo_contiene: r.testo_contiene || '', descrizione: r.descrizione || '',
  });

  const descriviCondizioni = (r) => [
    r.tipo_contiene && <>tipo contiene <strong>{r.tipo_contiene}</strong></>,
    r.testo_contiene && <>descrizione contiene <strong>{r.testo_contiene}</strong></>,
    r.richiede_controparte && <>riconosco il <strong>{(OPERATIVE.find(o => o.id === r.operativa)?.controparte || '').toLowerCase()}</strong></>,
  ].filter(Boolean).reduce((acc, x, i) => (i ? [...acc, ' e ', x] : [x]), []);
  const descriviClassificazione = (r) => {
    if (r.azione === 'ignora') return 'Ignora il movimento';
    const daCompletare = <span className="albatros-tenue">da completare</span>;
    if (r.ente === 'albatros') return <>Albatros · {categorieAlbatros.find(c => c.id === r.albatros_categoria_id)?.nome || daCompletare}</>;
    if (r.ente !== 'bfm') return daCompletare;
    if (r.natura === 'operativa') {
      const chi = r.operativa && r.controparte_id ? nomeControparte(controparti, r.operativa, r.controparte_id) : null;
      return <>BFM · operativa · {etichetta(OPERATIVE, r.operativa) || daCompletare}{r.operativa && <> · {chi ? <strong>{chi}</strong> : <span className="albatros-tenue">dal movimento</span>}</>}</>;
    }
    if (r.natura === 'generale') return <>BFM · {percorsoCategoria(categorie, r.categoria_id) || daCompletare}</>;
    return <>BFM · {daCompletare}</>;
  };

  return (
    <div className="albatros-pagina no-print">
      <div className="albatros-card">
        <div className="albatros-testata" style={{ alignItems: 'center' }}>
          <p className="albatros-nota" style={{ flex: '1 1 320px', margin: 0 }}>
            Si provano dall'alto in basso e vale la prima che corrisponde. Più alternative in una condizione si separano con "|" (es. OVH|SITEGROUND).
            Per le uscite che si ripetono, il modo più rapido è classificarne una nelle Spese e da lì "Crea una regola".
            La bandierina applica una regola sola ai movimenti già caricati: completa le spese da completare e non tocca le altre.
          </p>
          <button type="button" className="btn-outline-annulla albatros-bottone" disabled={inCorso} onClick={ricalcola} title="Conta, per ogni regola, le transazioni che prende con la spesa ancora da completare">Ricalcola</button>
          <button type="button" className="btn-accent-inline albatros-bottone" onClick={() => setModulo({ ...REGOLA_VUOTA })}>+ Nuova regola</button>
        </div>
        {ordinate.length === 0 && <p className="albatros-vuoto" style={{ marginTop: '12px' }}>Nessuna regola.</p>}
        {ordinate.length > 0 && (
          <div style={{ overflowX: 'auto', marginTop: '12px' }}>
            <table className="albatros-tabella tabella-schede">
              <thead><tr><th></th><th>Regola</th><th>Quando</th><th>Allora</th><th className="num">Movimenti</th><th className="num" title="Transazioni che la regola prende, con la spesa ancora da completare">Da associare</th><th>Attiva</th><th></th></tr></thead>
              <tbody>
                {ordinate.map((r, i) => (
                  <tr key={r.id} onClick={() => setModulo({ ...REGOLA_VUOTA, ...r, tipo_contiene: r.tipo_contiene || '', testo_contiene: r.testo_contiene || '', descrizione: r.descrizione || '' })} style={{ opacity: r.attiva ? 1 : 0.5 }}>
                    <td className="sk-sx" style={{ whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
                      <button type="button" className="btn-icon-action" title="Su" disabled={inCorso || i === 0} onClick={() => sposta(i, -1)}>▲</button>
                      <button type="button" className="btn-icon-action" title="Giù" disabled={inCorso || i === ordinate.length - 1} onClick={() => sposta(i, 1)}>▼</button>
                    </td>
                    <td className="sk-testo">
                      <strong>{r.nome}</strong>{r.segno === 'entrata' && <div className="albatros-tenue" style={{ fontSize: '0.75rem' }}>sulle entrate</div>}
                    </td>
                    <td data-etichetta="Quando" style={{ fontSize: '0.82rem' }}>{descriviCondizioni(r)}</td>
                    <td data-etichetta="Allora" style={{ fontSize: '0.82rem' }}>{descriviClassificazione(r)}{r.descrizione && <div className="albatros-tenue">come "{r.descrizione}"</div>}</td>
                    <td className="num sk-mezzo" data-etichetta="Movimenti" style={{ whiteSpace: 'nowrap' }}
                      title="Movimenti che la regola prende così come le regole sono ordinate adesso; sotto, quanti ne riconosce da sola e chi le prende gli altri">
                      {usi[r.id] || 0}
                      {(() => {
                        const c = copertura[r.id];
                        if (!c || c.riconosce === (usi[r.id] || 0)) return null;
                        const altri = Object.entries(c.presiDa).sort((a, b) => b[1] - a[1]);
                        return (
                          <div style={{ fontSize: '0.72rem', fontWeight: 400, color: '#9a3412', whiteSpace: 'normal', textAlign: 'right', minWidth: '140px' }}>
                            ne riconosce {c.riconosce}
                            {!r.attiva && <div>è spenta</div>}
                            {altri.map(([id, n]) => <div key={id}>{n} presi da «{nomeRegola(id)}»</div>)}
                          </div>
                        );
                      })()}
                    </td>
                    <td className="num sk-mezzo" data-etichetta="Da associare" style={{ fontWeight: daAssociare?.[r.id] ? 700 : 400, color: daAssociare?.[r.id] ? '#9a3412' : '#94a3b8' }}
                      title="Transazioni che la regola prende, con la spesa ancora da completare: la bandierina le completa">
                      {r.azione !== 'spesa' || !daAssociare || daAssociare[r.id] == null ? '—' : daAssociare[r.id]}
                    </td>
                    <td className="sk-mezzo" data-etichetta="Attiva" onClick={(e) => e.stopPropagation()}>
                      <label className="albatros-interruttore"><input type="checkbox" checked={!!r.attiva} disabled={inCorso} onChange={() => accendi(r)} /><span></span></label>
                    </td>
                    <td className="sk-dx" style={{ textAlign: 'right', whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
                      {r.azione === 'spesa' && <button type="button" className="btn-icon-action" title="Applica questa regola alle spese ancora da completare" style={{ marginRight: '4px' }} disabled={inCorso} onClick={() => applica(r)}><Icona nome="applica" size={14} style={{ marginRight: 0 }} /></button>}
                      <button type="button" className="btn-icon-action" title="Duplica" style={{ marginRight: '4px' }} disabled={inCorso} onClick={() => duplica(r)}><Icona nome="duplica" size={14} style={{ marginRight: 0 }} /></button>
                      <button type="button" className="btn-icon-action danger" title="Elimina" disabled={inCorso} onClick={() => elimina(r)}><Icona nome="elimina" size={14} style={{ marginRight: 0 }} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modulo && (
        <ModuloRegola {...props} iniziale={modulo} onChiudi={() => setModulo(null)}
          onSalvata={async () => {
            setModulo(null);
            await ricaricaConfigurazione();
            // Le regole sono cambiate: il conteggio di prima non vale più, si rifà con "Ricalcola".
            setDaAssociare(null);
            await ricaricaDati();
          }} />
      )}
    </div>
  );
}

export default Regole
