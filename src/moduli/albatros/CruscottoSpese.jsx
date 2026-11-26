import { useState, useEffect, useMemo, Fragment } from 'react'
import { supabase, leggiTutte } from '../../lib/supabaseClient'
import { formattaDataGGMMAAAA } from '../../lib/utils'
import { euro, r2, num, totaleRiga, conVociOneri, alberoCategorie, periodoIniziale, intervalloPeriodo, dicituraPeriodo, etichettaEnte, etichettaMetodoSpesa, nonInBanca, spesePerCategoria, DA_DETTAGLIARE } from './calcolo'
import IconaCategoria from './IconaCategoria'
import FiltroPeriodo from './FiltroPeriodo'

// ============================================================
// Il Cruscotto delle spese: tutte le spese del centro nel periodo, scritte in contanti, arrivate
// dalla banca di Albatros o dal conto di BFM, divise per categoria come gli incassi. La logica è
// quella dell'elenco delle spese (spesePerCategoria): uno scontrino va alle categorie delle sue
// voci, e la parte non ancora dettagliata sta in "Da dettagliare". Toccando una categoria si vedono
// le sue spese. Le categorie sono a due livelli: una categoria somma le sue sottocategorie e,
// aperta, mostra quelle (ognuna con le sue spese) e le spese rimaste sulla categoria.
// Accanto, dove c'è, l'incasso della categoria corrispondente del listino, per metterli a confronto:
// "Spesa bar" va con "Bar" del listino (il "Spesa" davanti non conta) e le loro sottocategorie
// con lo stesso nome (Birre con Birre...). L'incasso è il battuto delle giornate chiuse.
// ============================================================

const SENZA_CATEGORIA = 'senza-categoria';
const COLORE_GRIGIO = '#cbd5e1';
// Da dove arriva una spesa: dal conto di BFM, dalla banca di Albatros, o scritta a mano.
// Il nome con cui una categoria di spesa si accoppia a una del listino.
const chiaveNome = (nome) => String(nome || '').trim().toLowerCase().replace(/^spes[ae]\s+/, '');

const origineDi = (s) => (s.spesa_bfm_id != null ? 'dal conto BFM' : s.movimento_id != null ? 'dalla banca' : 'a mano');

function CruscottoSpese({ categorie, listino = [] }) {
  const [periodo, setPeriodo] = useState(periodoIniziale);
  const [spese, setSpese] = useState([]);
  const [vociPer, setVociPer] = useState({});
  // Il battuto delle giornate chiuse del periodo, per il confronto con gli incassi.
  const [righeIncasso, setRigheIncasso] = useState([]);
  // Le righe aperte: categorie e sottocategorie.
  const [aperte, setAperte] = useState(() => new Set());
  const apri = (chiave) => setAperte(prima => { const dopo = new Set(prima); if (dopo.has(chiave)) dopo.delete(chiave); else dopo.add(chiave); return dopo; });
  const [da, al] = intervalloPeriodo(periodo);

  const carica = async () => {
    // In un anno le righe superano il limite di una lettura: si leggono a pagine.
    const { data } = await leggiTutte(() => supabase.from('albatros_spese').select('*').gte('data', da).lte('data', al).order('id'));
    const elenco = data || [];
    const ids = elenco.filter(s => s.multicategoria).map(s => s.id);
    const { data: voci } = ids.length
      ? await leggiTutte(() => supabase.from('albatros_spese_righe').select('*').in('spesa_id', ids).order('id'))
      : { data: [] };
    const mappa = {};
    (voci || []).forEach(v => { (mappa[v.spesa_id] = mappa[v.spesa_id] || []).push(v); });
    // Le commissioni bancarie sommate agli scontrini: sono una voce automatica, non da dettagliare.
    const { data: oneri } = ids.length
      ? await leggiTutte(() => supabase.from('albatros_banca_movimenti').select('id, onere_spesa_id, importo').in('onere_spesa_id', ids).order('id'))
      : { data: [] };
    const oneriPer = new Map();
    (oneri || []).forEach(m => oneriPer.set(m.onere_spesa_id, r2((oneriPer.get(m.onere_spesa_id) || 0) - num(m.importo))));
    setVociPer(conVociOneri(elenco, mappa, oneriPer, categorie));
    const { data: ch } = await leggiTutte(() => supabase.from('albatros_chiusure').select('id').gte('data', da).lte('data', al).not('chiusa_il', 'is', null).order('id'));
    const { data: rg } = (ch || []).length
      ? await leggiTutte(() => supabase.from('albatros_righe').select('voce_id, quantita, prezzo').in('chiusura_id', ch.map(c => c.id)).order('id'))
      : { data: [] };
    setSpese(elenco);
    setRigheIncasso(rg || []);
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { carica(); }, [da, al]);

  const conti = useMemo(() => {
    const gruppi = spesePerCategoria(spese, vociPer);
    const totale = r2([...gruppi.values()].reduce((t, g) => t + g.totale, 0));
    // Le categorie a due livelli, nell'ordine del Configuratore: ogni categoria somma le sue
    // sottocategorie (e le spese rimaste sulla categoria stessa); si mostrano quelle con spese.
    // L'incasso per categoria del listino (una principale somma le sue sottocategorie).
    const voci = new Map(listino.map(v => [v.id, v]));
    const incassoPer = new Map();
    righeIncasso.forEach(r => { const id = voci.get(r.voce_id)?.categoria_id; if (id != null) incassoPer.set(id, r2((incassoPer.get(id) || 0) + totaleRiga(r))); });
    const alberoListino = alberoCategorie(categorie, 'listino', { ancheArchiviate: true });
    const incassoDi = (c) => r2((incassoPer.get(c.id) || 0) + c.figlie.reduce((t, f) => t + (incassoPer.get(f.id) || 0), 0));
    const vuoto = { totale: 0, spese: [] };
    let confronti = 0;
    const elenco = alberoCategorie(categorie, 'spesa', { ancheArchiviate: true }).map(c => {
      // La categoria del listino corrispondente, e le sue sottocategorie per nome.
      const gemella = alberoListino.find(l => chiaveNome(l.nome) === chiaveNome(c.nome));
      const gemellaFiglia = (x) => gemella?.figlie.find(l => chiaveNome(l.nome) === chiaveNome(x.nome));
      const incassoFiglia = (x) => { const l = gemellaFiglia(x); return l ? r2(incassoPer.get(l.id) || 0) : null; };
      const figlie = c.figlie.filter(x => gruppi.has(x.id) || incassoFiglia(x)).map(x => ({ chiave: x.id, categoria: x, nome: x.nome, ...(gruppi.get(x.id) || vuoto), incasso: incassoFiglia(x) }));
      const proprie = gruppi.get(c.id) || vuoto;
      const incasso = gemella ? incassoDi(gemella) : null;
      if (incasso != null) confronti++;
      return { chiave: c.id, categoria: c, nome: c.nome, figlie, spese: proprie.spese, incasso, totale: r2(proprie.totale + figlie.reduce((t, x) => t + x.totale, 0)) };
    }).filter(x => x.totale > 0 || x.incasso);
    if (gruppi.has(null)) elenco.push({ chiave: SENZA_CATEGORIA, nome: 'Senza categoria (da completare)', grigia: true, figlie: [], ...gruppi.get(null) });
    if (gruppi.has(DA_DETTAGLIARE)) elenco.push({ chiave: DA_DETTAGLIARE, nome: 'Da dettagliare (scontrini)', grigia: true, figlie: [], ...gruppi.get(DA_DETTAGLIARE) });
    const valide = spese.filter(s => !nonInBanca(s));
    const perEnte = (ente) => r2(valide.filter(s => (s.ente || null) === ente).reduce((t, s) => t + num(s.importo), 0));
    return { totale, elenco, massimo: Math.max(...elenco.map(x => x.totale), 0), numero: valide.length, perEnte, confronti };
  }, [spese, vociPer, categorie, listino, righeIncasso]);

  // Una riga di categoria (sotto = sottocategoria, rientrata) e le righe delle sue spese.
  const rigaCategoria = (x, sotto, padre) => {
    const quota = conti.totale > 0 ? x.totale / conti.totale : 0;
    return (
      <tr onClick={() => apri(x.chiave)} className={aperte.has(x.chiave) ? 'selezionata' : ''} style={{ cursor: 'pointer' }} title={x.figlie?.length ? 'Vedi le sottocategorie' : 'Vedi le spese'}>
        <td style={{ whiteSpace: 'nowrap', paddingLeft: sotto ? '28px' : undefined }}>
          <span className={`riga-espandibile-chevron ${aperte.has(x.chiave) ? 'aperta' : ''}`}>▸</span>
          <span className="albatros-con-icona">
            {!x.grigia && !sotto && <IconaCategoria categoria={x.categoria} size={13} titolo={false} />}
            <span className={x.grigia ? 'albatros-tenue' : ''} style={sotto ? { fontSize: '0.88rem' } : undefined}>{x.nome}</span>
          </span>
        </td>
        <td>
          <div className="albatros-barra-incasso" title={`${padre ? `${padre.nome} › ` : ''}${x.nome}: ${euro(x.totale)} (${Math.round(quota * 100)}%)`}>
            <div style={{ width: `${conti.massimo > 0 ? (x.totale / conti.massimo) * 100 : 0}%`, background: x.grigia ? COLORE_GRIGIO : sotto ? '#fca5a5' : '#ef4444' }} />
          </div>
        </td>
        <td className="num">{sotto ? euro(x.totale) : <strong>{euro(x.totale)}</strong>}</td>
        <td className="num">{Math.round(quota * 100)}%</td>
        {conti.confronti > 0 && <td className="num" style={{ color: '#047857' }}>{x.incasso != null ? euro(x.incasso) : ''}</td>}
        {conti.confronti > 0 && (
          <td className="num" title={x.incasso ? `Margine ${Math.round(((x.incasso - x.totale) / x.incasso) * 100)}% dell'incasso` : undefined}
            style={{ color: x.incasso == null ? undefined : x.incasso - x.totale >= 0 ? '#047857' : '#b91c1c', fontWeight: sotto ? 400 : 600 }}>
            {x.incasso != null ? euro(r2(x.incasso - x.totale)) : ''}
          </td>
        )}
      </tr>
    );
  };
  const righeSpese = (x) => [...x.spese]
    .sort((a, b) => String(b.spesa.data).localeCompare(String(a.spesa.data)) || b.importo - a.importo)
    .map(({ spesa: s, importo }) => (
      <tr key={`${x.chiave}-${s.id}`} className="albatros-incassi-voce">
        <td colSpan={2}>
          {formattaDataGGMMAAAA(s.data)} · {s.descrizione}
          <span className="albatros-tenue"> · {s.ente ? etichettaEnte(s.ente) : 'da attribuire'}{s.ente === 'albatros' ? `, ${etichettaMetodoSpesa(s)}` : ''} · {origineDi(s)}</span>
        </td>
        <td className="num">{euro(importo)}{importo !== r2(s.importo) && <div className="albatros-tenue" style={{ fontSize: '0.72rem' }}>su {euro(s.importo)}</div>}</td>
        <td className="num albatros-tenue">{x.totale > 0 ? `${Math.round((importo / x.totale) * 100)}%` : ''}</td>
        {conti.confronti > 0 && <td colSpan={2} />}
      </tr>
    ));

  return (
    <div className="albatros-pagina no-print">
      <div className="albatros-card">
        <div className="albatros-testata">
          <FiltroPeriodo periodo={periodo} onChange={setPeriodo} />
        </div>

        <div className="albatros-cifre">
          <div className="albatros-cifra-saldo"><span>Spese {dicituraPeriodo(periodo, 'del')}</span><strong>{euro(conti.totale)}</strong><small>contanti, banca di Albatros e conto di BFM</small></div>
          <div><span>Spese</span><strong>{conti.numero}</strong><small>nel periodo</small></div>
          {['albatros', 'bfm', 'lama'].map(e => conti.perEnte(e) > 0 && (
            <div key={e}><span>Pagate da {etichettaEnte(e)}</span><strong>{euro(conti.perEnte(e))}</strong></div>
          ))}
          {conti.perEnte(null) > 0 && <div><span>Da attribuire</span><strong style={{ color: '#b45309' }}>{euro(conti.perEnte(null))}</strong></div>}
        </div>

        {conti.elenco.length === 0 && <p className="albatros-vuoto">Nessuna spesa {dicituraPeriodo(periodo, 'in')}.</p>}
        {conti.elenco.length > 0 && (
          <div style={{ overflowX: 'auto', marginTop: '14px' }}>
            {conti.confronti > 0 && <p className="albatros-nota" style={{ margin: '0 0 8px 0' }}>Incasso e margine dove la categoria ha una gemella nel listino (Spesa bar con Bar, e le sottocategorie con lo stesso nome). L'incasso è il battuto delle giornate chiuse; la spesa è quella del periodo, anche se la merce si vende dopo.</p>}
            <table className="albatros-tabella albatros-incassi">
              <thead>
                <tr><th>Categoria</th><th style={{ width: '40%' }}></th><th className="num">Spesa</th><th className="num">Quota</th>
                  {conti.confronti > 0 && <><th className="num" title="Il battuto delle giornate chiuse nella categoria corrispondente del listino">Incasso</th><th className="num" title="Incasso meno spesa">Margine</th></>}</tr>
              </thead>
              <tbody>
                {conti.elenco.map(x => (
                  <Fragment key={x.chiave}>
                    {rigaCategoria(x, false)}
                    {aperte.has(x.chiave) && x.figlie.map(f => (
                      <Fragment key={f.chiave}>
                        {rigaCategoria(f, true, x)}
                        {aperte.has(f.chiave) && righeSpese(f)}
                      </Fragment>
                    ))}
                    {aperte.has(x.chiave) && righeSpese(x)}
                  </Fragment>
                ))}
              </tbody>
              <tfoot>
                <tr><td colSpan={2}><strong>Totale</strong></td><td className="num"><strong>{euro(conti.totale)}</strong></td><td className="num">100%</td>{conti.confronti > 0 && <td colSpan={2} />}</tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default CruscottoSpese
