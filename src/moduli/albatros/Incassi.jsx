import { useState, useEffect, useMemo, Fragment } from 'react'
import { supabase, leggiTutte } from '../../lib/supabaseClient'
import { quadratura, totaleRiga, euro, r2, num, alberoCategorie, oreCampo, testoOre, periodoIniziale, intervalloPeriodo, accontiConfermati, dicituraPeriodo } from './calcolo'
import { ICONE_CATEGORIA } from './iconeCategoria'
import IconaCategoria from './IconaCategoria'
import FiltroPeriodo from './FiltroPeriodo'

// ============================================================
// Incassi per categoria del listino, nel mese o nella settimana. Contano solo le giornate chiuse:
// quelle aperte non hanno ancora un incassato. La parte di incassato che nessuna voce spiega sta
// in "Non specificato", così le righe sommano all'incassato. Toccando una categoria si vedono le
// sue voci.
// Gli acconti confermati sono incasso della giornata per cui erano stati versati; quelli trattenuti
// dopo una disdetta sono incasso senza evento, e hanno una riga loro.
// ============================================================

const NON_SPECIFICATO = 'non-specificato';
const SENZA_CATEGORIA = 'senza-categoria';
const TRATTENUTI = 'acconti-trattenuti';

function Incassi({ listino, categorie }) {
  const [periodo, setPeriodo] = useState(periodoIniziale);
  const [chiusure, setChiusure] = useState([]);
  const [righe, setRighe] = useState([]);
  const [acconti, setAcconti] = useState([]);
  const [aperta, setAperta] = useState(null);
  const [aperte, setAperte] = useState(() => new Set());
  const [da, al] = intervalloPeriodo(periodo);

  const carica = async () => {
    // In un anno le righe superano il limite di una lettura: si leggono a pagine.
    const { data: ch } = await leggiTutte(() => supabase.from('albatros_chiusure').select('*')
      .gte('data', da).lte('data', al).not('chiusa_il', 'is', null).order('id'));
    const elenco = ch || [];
    const { data: rg } = elenco.length
      ? await leggiTutte(() => supabase.from('albatros_righe').select('chiusura_id, voce_id, quantita, prezzo').in('chiusura_id', elenco.map(c => c.id)).order('id'))
      : { data: [] };
    // Senza sql/albatros_acconti.sql la tabella non c'è: si conta senza acconti.
    const { data: ac } = await supabase.from('albatros_acconti').select('*')
      .gte('data_riferimento', da).lte('data_riferimento', al).in('stato', ['confermato', 'trattenuto']);
    setChiusure(elenco);
    setRighe(rg || []);
    setAcconti(ac || []);
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { carica(); }, [da, al]);

  const conti = useMemo(() => {
    const voci = new Map(listino.map(v => [v.id, v]));
    // Un acconto confermato per un giorno senza giornata chiusa conta lo stesso: è un incasso.
    const giorniChiusi = new Set(chiusure.map(c => c.data));
    const accontiSenzaGiornata = r2(acconti.filter(a => a.stato === 'confermato' && !giorniChiusi.has(a.data_riferimento)).reduce((t, a) => t + num(a.importo), 0));
    const trattenuti = r2(acconti.filter(a => a.stato === 'trattenuto').reduce((t, a) => t + num(a.importo), 0));
    const incassatoGiornate = r2(chiusure.reduce((t, c) => t + quadratura(c, [], accontiConfermati(acconti, c.data)).incassato, 0) + accontiSenzaGiornata);
    const incassato = r2(incassatoGiornate + trattenuti);
    const perCategoria = new Map();
    righe.forEach(r => {
      const voce = voci.get(r.voce_id);
      const chiave = voce?.categoria_id ?? SENZA_CATEGORIA;
      const gruppo = perCategoria.get(chiave) || { totale: 0, voci: new Map() };
      gruppo.totale = r2(gruppo.totale + totaleRiga(r));
      const v = gruppo.voci.get(r.voce_id) || { nome: voce?.nome || '?', quantita: 0, totale: 0 };
      v.quantita = r2(v.quantita + num(r.quantita));
      v.totale = r2(v.totale + totaleRiga(r));
      gruppo.voci.set(r.voce_id, v);
      perCategoria.set(chiave, gruppo);
    });
    // Le categorie nell'ordine del Configuratore, anche quelle a zero; poi quelle senza categoria.
    // Una principale somma le sue sottocategorie (e le voci messe direttamente su di lei).
    const vuoto = () => ({ totale: 0, voci: new Map() });
    const elenco = alberoCategorie(categorie, 'listino', { ancheArchiviate: true })
      .map(c => {
        const figlie = c.figlie.filter(f => f.attiva || perCategoria.has(f.id))
          .map(f => ({ chiave: f.id, categoria: f, nome: f.nome, figlie: [], ...(perCategoria.get(f.id) || vuoto()) }));
        const propria = perCategoria.get(c.id) || vuoto();
        if (figlie.length && propria.totale) figlie.unshift({ chiave: `${c.id}-diretta`, categoria: c, nome: `${c.nome} (senza sottocategoria)`, figlie: [], ...propria });
        return { chiave: c.id, categoria: c, nome: c.nome, figlie,
          totale: figlie.length ? r2(figlie.reduce((t, f) => t + f.totale, 0)) : propria.totale,
          voci: figlie.length ? new Map() : propria.voci };
      })
      .filter(x => x.categoria.attiva || x.totale || x.figlie.length);
    if (perCategoria.has(SENZA_CATEGORIA)) elenco.push({ chiave: SENZA_CATEGORIA, nome: 'Senza categoria', figlie: [], ...perCategoria.get(SENZA_CATEGORIA) });
    const battuto = r2(elenco.reduce((t, x) => t + x.totale, 0));
    const residuo = r2(incassatoGiornate - battuto);
    if (residuo > 0) elenco.push({ chiave: NON_SPECIFICATO, nome: 'Non specificato', totale: residuo, voci: new Map(), figlie: [] });
    if (trattenuti > 0) elenco.push({ chiave: TRATTENUTI, nome: 'Acconti trattenuti (disdette)', totale: trattenuti, voci: new Map(), figlie: [] });
    return { incassato, battuto, residuo, elenco, massimo: Math.max(...elenco.map(x => x.totale), 0) };
  }, [chiusure, righe, acconti, listino, categorie]);

  // Le ore campo fatte nelle giornate chiuse del periodo (quantità × ore delle voci del listino).
  const ore = useMemo(() => oreCampo(righe, listino), [righe, listino]);
  const [vediOre, setVediOre] = useState(false);
  const giorni = chiusure.length;
  const periodoTesto = dicituraPeriodo(periodo, 'del');

  return (
    <div className="albatros-pagina no-print">
      <div className="albatros-card">
        <div className="albatros-testata">
          <FiltroPeriodo periodo={periodo} onChange={setPeriodo} />
        </div>

        <div className="albatros-cifre">
          <div className="albatros-cifra-saldo"><span>Incassato {periodoTesto}</span><strong>{euro(conti.incassato)}</strong><small>POS, contanti e acconti, giornate chiuse</small></div>
          <div><span>Giornate chiuse</span><strong>{giorni}</strong><small>nel periodo</small></div>
          <div><span>Media per giornata</span><strong>{euro(giorni ? conti.incassato / giorni : 0)}</strong><small>incassato ÷ giornate</small></div>
          <div onClick={() => ore.perVoce.length && setVediOre(!vediOre)} style={{ cursor: ore.perVoce.length ? 'pointer' : 'default' }} title={ore.perVoce.length ? 'Vedi le ore per voce' : undefined}>
            <span>Ore campo</span><strong>{testoOre(ore.ore)}</strong><small>{ore.perVoce.length ? (vediOre ? 'nascondi il dettaglio' : 'tocca per il dettaglio') : 'giornate chiuse'}</small>
          </div>
          <div><span>A tariffa speciale</span><strong>{testoOre(ore.speciali)}</strong><small>{ore.ore > 0 ? `${Math.round((ore.speciali / ore.ore) * 100)}% delle ore` : 'sconto'}</small></div>
        </div>
        {vediOre && ore.perVoce.length > 0 && (
          <div style={{ overflowX: 'auto', marginTop: '12px' }}>
            <table className="albatros-tabella">
              <thead><tr><th>Voce</th><th className="num">Vendute</th><th className="num">Ore per vendita</th><th className="num">Ore campo</th></tr></thead>
              <tbody>
                {ore.perVoce.map(x => (
                  <tr key={x.voce.id} style={{ cursor: 'default' }}>
                    <td>{x.voce.nome}{x.voce.tariffa_speciale && <span className="albatros-tenue"> · tariffa speciale</span>}</td>
                    <td className="num">{String(r2(x.quantita)).replace('.', ',')}</td>
                    <td className="num">{testoOre(x.voce.ore_campo)}</td>
                    <td className="num"><strong>{testoOre(x.ore)}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {conti.residuo < 0 && (
          <p className="albatros-avviso" style={{ marginTop: '12px' }}>
            Il battuto supera l'incassato di {euro(-conti.residuo)}: le percentuali sono calcolate sull'incassato e la loro somma passa il 100%.
          </p>
        )}

        {giorni === 0 && conti.incassato === 0 && <p className="albatros-vuoto">Nessuna giornata chiusa {dicituraPeriodo(periodo, 'in')}.</p>}
        {(giorni > 0 || conti.incassato > 0) && (
          <div style={{ overflowX: 'auto', marginTop: '14px' }}>
            <table className="albatros-tabella albatros-incassi">
              <thead>
                <tr><th>Categoria</th><th style={{ width: '40%' }}></th><th className="num">Incasso</th><th className="num">Quota</th></tr>
              </thead>
              <tbody>
                {conti.elenco.map(x => {
                  // Una riga: una principale si apre sulle sottocategorie, una categoria senza figlie sulle voci.
                  const riga = (x, sotto) => {
                    const quota = conti.incassato > 0 ? x.totale / conti.incassato : 0;
                    const grigia = x.chiave === NON_SPECIFICATO || x.chiave === TRATTENUTI;
                    const colore = grigia ? '#cbd5e1' : (ICONE_CATEGORIA[x.categoria?.icona]?.colore || '#94a3b8');
                    const gruppo = x.figlie.length > 0;
                    const espandibile = gruppo || x.voci.size > 0;
                    const aperto = gruppo ? aperte.has(x.chiave) : aperta === x.chiave;
                    const apri = () => {
                      if (!espandibile) return;
                      if (gruppo) setAperte(prima => { const n = new Set(prima); if (n.has(x.chiave)) n.delete(x.chiave); else n.add(x.chiave); return n; });
                      else setAperta(aperta === x.chiave ? null : x.chiave);
                    };
                    const vociOrdinate = [...x.voci.values()].sort((a, b) => b.totale - a.totale);
                    return (
                      <Fragment key={x.chiave}>
                        <tr onClick={apri} className={aperto && !gruppo ? 'selezionata' : ''}
                          style={{ cursor: espandibile ? 'pointer' : 'default' }} title={espandibile ? (gruppo ? 'Vedi le sottocategorie' : 'Vedi le voci') : undefined}>
                          <td style={{ whiteSpace: 'nowrap', paddingLeft: sotto ? '26px' : undefined }}>
                            {espandibile ? <span className={`riga-espandibile-chevron ${aperto ? 'aperta' : ''}`}>▸</span> : <span className="riga-espandibile-chevron" />}
                            <span className="albatros-con-icona">
                              {!grigia && !sotto && <IconaCategoria categoria={x.categoria} size={13} titolo={false} />}
                              <span className={grigia ? 'albatros-tenue' : ''} style={{ fontWeight: gruppo ? 700 : undefined }}>{x.nome}</span>
                            </span>
                          </td>
                          <td>
                            <div className="albatros-barra-incasso" title={`${x.nome}: ${euro(x.totale)} (${Math.round(quota * 100)}%)`}>
                              <div style={{ width: `${conti.massimo > 0 ? (x.totale / conti.massimo) * 100 : 0}%`, background: colore, opacity: sotto ? 0.7 : 1 }} />
                            </div>
                          </td>
                          <td className="num">{sotto ? euro(x.totale) : <strong>{euro(x.totale)}</strong>}</td>
                          <td className="num">{Math.round(quota * 100)}%</td>
                        </tr>
                        {aperto && gruppo && x.figlie.map(f => riga(f, true))}
                        {aperto && !gruppo && vociOrdinate.map(v => (
                          <tr key={v.nome} className="albatros-incassi-voce">
                            <td colSpan={2} style={{ paddingLeft: sotto ? '52px' : undefined }}>{v.nome} <span className="albatros-tenue">· {String(v.quantita).replace('.', ',')}</span></td>
                            <td className="num">{euro(v.totale)}</td>
                            <td className="num albatros-tenue">{x.totale > 0 ? `${Math.round((v.totale / x.totale) * 100)}%` : ''}</td>
                          </tr>
                        ))}
                      </Fragment>
                    );
                  };
                  return riga(x, false);
                })}
              </tbody>
              <tfoot>
                <tr><td colSpan={2}><strong>Totale</strong></td><td className="num"><strong>{euro(conti.incassato)}</strong></td><td className="num">100%</td></tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default Incassi
