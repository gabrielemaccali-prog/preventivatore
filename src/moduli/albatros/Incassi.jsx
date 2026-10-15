import { useState, useEffect, useMemo, Fragment } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { quadratura, totaleRiga, euro, r2, num, categorieDi, periodoIniziale, intervalloPeriodo } from './calcolo'
import { ICONE_CATEGORIA } from './iconeCategoria'
import IconaCategoria from './IconaCategoria'
import FiltroPeriodo from './FiltroPeriodo'

// ============================================================
// Incassi per categoria del listino, nel mese o nella settimana. Contano solo le giornate chiuse:
// quelle aperte non hanno ancora un incassato. La parte di incassato che nessuna voce spiega sta
// in "Non specificato", così le righe sommano all'incassato. Toccando una categoria si vedono le
// sue voci.
// ============================================================

const NON_SPECIFICATO = 'non-specificato';
const SENZA_CATEGORIA = 'senza-categoria';

function Incassi({ listino, categorie }) {
  const [periodo, setPeriodo] = useState(periodoIniziale);
  const [chiusure, setChiusure] = useState([]);
  const [righe, setRighe] = useState([]);
  const [aperta, setAperta] = useState(null);
  const [da, al] = intervalloPeriodo(periodo);

  const carica = async () => {
    const { data: ch } = await supabase.from('albatros_chiusure').select('*')
      .gte('data', da).lte('data', al).not('chiusa_il', 'is', null);
    const elenco = ch || [];
    const { data: rg } = elenco.length
      ? await supabase.from('albatros_righe').select('chiusura_id, voce_id, quantita, prezzo').in('chiusura_id', elenco.map(c => c.id))
      : { data: [] };
    setChiusure(elenco);
    setRighe(rg || []);
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { carica(); }, [da, al]);

  const conti = useMemo(() => {
    const voci = new Map(listino.map(v => [v.id, v]));
    const incassato = r2(chiusure.reduce((t, c) => t + quadratura(c, []).incassato, 0));
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
    const elenco = categorieDi(categorie, 'listino', { ancheArchiviate: true })
      .filter(c => c.attiva || perCategoria.has(c.id))
      .map(c => ({ chiave: c.id, categoria: c, nome: c.nome, ...(perCategoria.get(c.id) || { totale: 0, voci: new Map() }) }));
    if (perCategoria.has(SENZA_CATEGORIA)) elenco.push({ chiave: SENZA_CATEGORIA, nome: 'Senza categoria', ...perCategoria.get(SENZA_CATEGORIA) });
    const battuto = r2(elenco.reduce((t, x) => t + x.totale, 0));
    const residuo = r2(incassato - battuto);
    if (residuo > 0) elenco.push({ chiave: NON_SPECIFICATO, nome: 'Non specificato', totale: residuo, voci: new Map() });
    return { incassato, battuto, residuo, elenco, massimo: Math.max(...elenco.map(x => x.totale), 0) };
  }, [chiusure, righe, listino, categorie]);

  const giorni = chiusure.length;
  const periodoTesto = periodo.tipo === 'settimana' ? 'della settimana' : 'del mese';

  return (
    <div className="albatros-pagina no-print">
      <div className="albatros-card">
        <div className="albatros-testata">
          <FiltroPeriodo periodo={periodo} onChange={setPeriodo} />
        </div>

        <div className="albatros-cifre">
          <div className="albatros-cifra-saldo"><span>Incassato {periodoTesto}</span><strong>{euro(conti.incassato)}</strong><small>POS + contanti, giornate chiuse</small></div>
          <div><span>Giornate chiuse</span><strong>{giorni}</strong><small>nel periodo</small></div>
          <div><span>Media per giornata</span><strong>{euro(giorni ? conti.incassato / giorni : 0)}</strong><small>incassato ÷ giornate</small></div>
        </div>

        {conti.residuo < 0 && (
          <p className="albatros-avviso" style={{ marginTop: '12px' }}>
            Il battuto supera l'incassato di {euro(-conti.residuo)}: le percentuali sono calcolate sull'incassato e la loro somma passa il 100%.
          </p>
        )}

        {giorni === 0 && <p className="albatros-vuoto">Nessuna giornata chiusa {periodo.tipo === 'settimana' ? 'in questa settimana' : 'in questo mese'}.</p>}
        {giorni > 0 && (
          <div style={{ overflowX: 'auto', marginTop: '14px' }}>
            <table className="albatros-tabella albatros-incassi">
              <thead>
                <tr><th>Categoria</th><th style={{ width: '40%' }}></th><th className="num">Incasso</th><th className="num">Quota</th></tr>
              </thead>
              <tbody>
                {conti.elenco.map(x => {
                  const quota = conti.incassato > 0 ? x.totale / conti.incassato : 0;
                  const colore = x.chiave === NON_SPECIFICATO ? '#cbd5e1' : (ICONE_CATEGORIA[x.categoria?.icona]?.colore || '#94a3b8');
                  const espandibile = x.voci.size > 0;
                  const vociOrdinate = [...x.voci.values()].sort((a, b) => b.totale - a.totale);
                  return (
                    <Fragment key={x.chiave}>
                      <tr onClick={() => espandibile && setAperta(aperta === x.chiave ? null : x.chiave)} className={aperta === x.chiave ? 'selezionata' : ''}
                        style={{ cursor: espandibile ? 'pointer' : 'default' }} title={espandibile ? 'Vedi le voci' : undefined}>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          {espandibile ? <span className={`riga-espandibile-chevron ${aperta === x.chiave ? 'aperta' : ''}`}>▸</span> : <span className="riga-espandibile-chevron" />}
                          <span className="albatros-con-icona">
                            {x.chiave !== NON_SPECIFICATO && <IconaCategoria categoria={x.categoria} size={13} titolo={false} />}
                            <span className={x.chiave === NON_SPECIFICATO ? 'albatros-tenue' : ''}>{x.nome}</span>
                          </span>
                        </td>
                        <td>
                          <div className="albatros-barra-incasso" title={`${x.nome}: ${euro(x.totale)} (${Math.round(quota * 100)}%)`}>
                            <div style={{ width: `${conti.massimo > 0 ? (x.totale / conti.massimo) * 100 : 0}%`, background: colore }} />
                          </div>
                        </td>
                        <td className="num"><strong>{euro(x.totale)}</strong></td>
                        <td className="num">{Math.round(quota * 100)}%</td>
                      </tr>
                      {aperta === x.chiave && vociOrdinate.map(v => (
                        <tr key={v.nome} className="albatros-incassi-voce">
                          <td colSpan={2}>{v.nome} <span className="albatros-tenue">· {String(v.quantita).replace('.', ',')}</span></td>
                          <td className="num">{euro(v.totale)}</td>
                          <td className="num albatros-tenue">{x.totale > 0 ? `${Math.round((v.totale / x.totale) * 100)}%` : ''}</td>
                        </tr>
                      ))}
                    </Fragment>
                  );
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
