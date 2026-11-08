import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabaseClient'
import Icona from '../../components/Icona'
import { formattaDataGGMMAAAA } from '../../lib/utils'
import { scaricaExcel } from '../../lib/excel'
import { quadratura, daSpecificare, fondoDiverso, fondoDaSpecificare, euro, r2, periodoIniziale, intervalloPeriodo, accontiConfermati, accontoConfermabile, giornataDiLavoro } from './calcolo'
import FiltroPeriodo from './FiltroPeriodo'
import Acconti from './Acconti'

// ============================================================
// Scheda Chiusure: le giornate di un mese o di una settimana (da lunedì a domenica), con
// incassato e battuto. Toccando una giornata la si
// apre nella scheda Giornata; l'amministratore da qui riapre una giornata chiusa.
// Le giornate chiuse con un residuo non spiegato sono segnate "Da specificare" e si possono
// vedere da sole; quelle partite con un fondo diverso da quello lasciato la sera prima "Fondo diverso".
// Il tasto Excel scarica le giornate che si stanno guardando (periodo e filtro compresi).
// Sopra l'elenco gli acconti: tutti quelli da confermare, più quelli del periodo. Confermato, un
// acconto entra nell'incassato della sua giornata (vedi quadratura).
// ============================================================

// Il giorno della settimana di una data 'YYYY-MM-DD', a mezzogiorno per non farlo spostare dal fuso.
const giornoSettimana = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('it-IT', { weekday: 'short' });
const oraDi = (ts) => new Date(ts).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

function StoricoChiusure({ user, listino, categorie, puoCorreggere, utenti, onApri }) {
  const [periodo, setPeriodo] = useState(periodoIniziale);
  const [giorni, setGiorni] = useState([]);
  const [acconti, setAcconti] = useState([]);
  // Finché sql/albatros_acconti.sql non è stato eseguito la tabella non c'è.
  const [accontiMancanti, setAccontiMancanti] = useState(null);
  const [inCorso, setInCorso] = useState(false);
  const [soloDaSpecificare, setSoloDaSpecificare] = useState(false);

  const [da, al] = intervalloPeriodo(periodo);
  const oggi = giornataDiLavoro();

  const carica = async () => {
    const [{ data: ch }, attesi, delPeriodo] = await Promise.all([
      supabase.from('albatros_chiusure').select('*').gte('data', da).lte('data', al).order('data', { ascending: false }),
      supabase.from('albatros_acconti').select('*').eq('stato', 'atteso'),
      supabase.from('albatros_acconti').select('*').gte('data_riferimento', da).lte('data_riferimento', al),
    ]);
    const elenco = ch || [];
    const tuttiAcconti = [...new Map([...(attesi.data || []), ...(delPeriodo.data || [])].map(a => [a.id, a])).values()];
    setAcconti(tuttiAcconti);
    setAccontiMancanti(attesi.error?.message || null);
    const [{ data: rg }, { data: prima }] = await Promise.all([
      elenco.length
        ? supabase.from('albatros_righe').select('chiusura_id, quantita, prezzo').in('chiusura_id', elenco.map(c => c.id))
        : Promise.resolve({ data: [] }),
      // Per confrontare il fondo della prima giornata del periodo serve l'ultima chiusura prima.
      supabase.from('albatros_chiusure').select('*').lt('data', da).not('fondo_lasciato', 'is', null)
        .order('data', { ascending: false }).limit(1).maybeSingle(),
    ]);
    // La chiusura precedente di ognuna: la più recente prima di lei con un fondo lasciato.
    const precedenteDi = (c) => elenco.find(x => x.data < c.data && x.fondo_lasciato != null) || prima || null;
    setGiorni(elenco.map(c => ({
      chiusura: c,
      fondoDiverso: fondoDiverso(c, precedenteDi(c)),
      precedente: precedenteDi(c),
      ...quadratura(c, (rg || []).filter(r => r.chiusura_id === c.id), accontiConfermati(tuttiAcconti, c.data)),
    })));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { carica(); }, [da, al]);

  const riapri = async (ch) => {
    if (!window.confirm(`Riaprire la giornata del ${formattaDataGGMMAAAA(ch.data)}?`)) return;
    setInCorso(true);
    const { error } = await supabase.from('albatros_chiusure').update({ chiusa_il: null, chiusa_da: null }).eq('id', ch.id);
    setInCorso(false);
    if (error) return alert(`Errore: ${error.message}`);
    carica();
  };

  const tot = (k) => r2(giorni.reduce((s, g) => s + g[k], 0));
  const incomplete = giorni.filter(g => daSpecificare(g.chiusura, g));
  const visibili = soloDaSpecificare ? incomplete : giorni;

  // Una riga per giornata, con i numeri come numeri così in Excel si sommano; le date in ordine
  // crescente, come si leggono su un foglio.
  const esporta = () => {
    const chiusa = (g) => !!g.chiusura.chiusa_il;
    const righe = [...visibili].reverse().map(g => ({
      Giorno: giornoSettimana(g.chiusura.data),
      Data: formattaDataGGMMAAAA(g.chiusura.data),
      POS: r2(g.pos),
      Contanti: r2(g.contanti),
      Acconti: r2(g.acconti),
      Incassato: r2(g.incassato),
      Battuto: r2(g.specificato),
      'Battuto %': chiusa(g) ? Math.round(g.quota * 100) : null,
      'Non specificato': chiusa(g) ? r2(g.nonSpecificato) : null,
      'Fondo partenza': g.chiusura.fondo_partenza == null ? null : r2(g.fondoPartenza),
      'Fondo lasciato': chiusa(g) && g.chiusura.fondo_lasciato != null ? r2(g.fondoLasciato) : null,
      Ritirati: chiusa(g) ? r2(g.ritirato) : null,
      Stato: chiusa(g) ? 'Chiusa' : 'Aperta',
      Avvisi: [
        daSpecificare(g.chiusura, g) && 'Da specificare',
        chiusa(g) && g.nonSpecificato < 0 && 'Battuto oltre',
        fondoDaSpecificare(g.chiusura) && 'Fondo da specificare',
        g.fondoDiverso && `Fondo diverso dal ${formattaDataGGMMAAAA(g.precedente.data)}`,
      ].filter(Boolean).join(', '),
      'Chiusa da': chiusa(g) ? utenti[g.chiusura.chiusa_da] || '' : '',
      'Chiusa il': chiusa(g) ? oraDi(g.chiusura.chiusa_il) : '',
    }));
    const nome = periodo.tipo === 'settimana' ? `settimana_dal_${formattaDataGGMMAAAA(da).replaceAll('/', '-')}` : periodo.mese;
    scaricaExcel(`Albatros_chiusure_${nome}${soloDaSpecificare ? '_da_specificare' : ''}`, [{ nome: 'Chiusure', righe }]);
  };

  return (
    <div className="albatros-pagina no-print">
      <div className="albatros-card">
        {accontiMancanti ? (
          <p className="albatros-avviso" style={{ margin: 0 }}>Per registrare gli acconti esegui <strong>sql/albatros_acconti.sql</strong> nell'SQL Editor di Supabase.</p>
        ) : (
          <Acconti user={user} listino={listino} categorie={categorie} utenti={utenti} puoCorreggere={puoCorreggere} acconti={acconti} onCambiati={carica}
            conNuovo={false} titolo="Acconti" vuoto="Nessun acconto da confermare né in questo periodo. Un acconto nuovo si registra dalla Giornata." />
        )}
      </div>

      <div className="albatros-card">
        <div className="albatros-testata">
          <FiltroPeriodo periodo={periodo} onChange={setPeriodo} />
          <button type="button" className={`albatros-chip albatros-chip-avviso ${soloDaSpecificare ? 'attivo' : ''}`} style={{ alignSelf: 'flex-end' }}
            disabled={!soloDaSpecificare && incomplete.length === 0} onClick={() => setSoloDaSpecificare(!soloDaSpecificare)}>
            Da specificare ({incomplete.length})
          </button>
          <div style={{ marginLeft: 'auto', textAlign: 'right', fontSize: '0.88rem' }}>
            <div>Incassato {periodo.tipo === 'settimana' ? 'della settimana' : 'del mese'}: <strong>{euro(tot('incassato'))}</strong></div>
            <div className="albatros-tenue">Battuto {euro(tot('specificato'))}</div>
          </div>
          <button type="button" className="btn-outline-annulla albatros-bottone" style={{ alignSelf: 'flex-end', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            disabled={visibili.length === 0} onClick={esporta} title="Scarica in Excel le giornate che vedi">
            <Icona nome="excel" size={16} style={{ marginRight: 0 }} />Excel
          </button>
        </div>

        {visibili.length === 0 && <p className="albatros-vuoto">{soloDaSpecificare ? 'Nessuna giornata da specificare' : 'Nessuna giornata'} in {periodo.tipo === 'settimana' ? 'questa settimana' : 'questo mese'}.</p>}
        {visibili.length > 0 && (
          <div style={{ overflowX: 'auto', marginTop: '12px' }}>
            <table className="albatros-tabella">
              <thead>
                <tr><th>Giornata</th><th className="num">POS</th><th className="num" title="Contanti incassati, senza il fondo cassa">Contanti</th><th className="num" title="POS + contanti + acconti confermati per la giornata">Incassato</th><th className="num">Battuto</th><th className="num" title="Lasciato in cassa per il giorno dopo">Fondo</th><th className="num">Ritirati</th><th>Stato</th><th>Chiusa da</th>{puoCorreggere && <th></th>}</tr>
              </thead>
              <tbody>
                {visibili.map(g => (
                  <tr key={g.chiusura.id} onClick={() => onApri(g.chiusura.data)} title="Apri la giornata">
                    <td style={{ whiteSpace: 'nowrap' }}><span className="albatros-giorno">{giornoSettimana(g.chiusura.data)}</span> {formattaDataGGMMAAAA(g.chiusura.data)}</td>
                    <td className="num">{euro(g.pos)}</td>
                    <td className="num">{euro(g.contanti)}</td>
                    <td className="num"><strong>{euro(g.incassato)}</strong>{g.acconti > 0 && <div className="albatros-tenue" style={{ fontSize: '0.72rem' }}>di cui acconti {euro(g.acconti)}</div>}</td>
                    <td className="num">{euro(g.specificato)}{g.chiusura.chiusa_il && <span className="albatros-tenue"> ({Math.round(g.quota * 100)}%)</span>}</td>
                    <td className="num"><span className="albatros-tenue">{g.chiusura.chiusa_il ? euro(g.fondoLasciato) : '—'}</span></td>
                    <td className="num">{g.chiusura.chiusa_il && g.ritirato > 0
                      ? euro(g.ritirato)
                      : <span className="albatros-tenue">—</span>}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {g.chiusura.chiusa_il ? <span className="albatros-badge chiusa mini">Chiusa</span> : <span className="albatros-badge aperta mini">Aperta</span>}
                      {acconti.some(a => a.data_riferimento === g.chiusura.data && accontoConfermabile(a, oggi)) && <span className="albatros-badge da-specificare mini" title="C'è un acconto per questa giornata da confermare (sopra)">Acconto da confermare</span>}
                      {daSpecificare(g.chiusura, g) && <span className="albatros-badge da-specificare mini" title={`Residuo non spiegato: ${euro(g.nonSpecificato)}`}>Da specificare {euro(g.nonSpecificato)}</span>}
                      {g.chiusura.chiusa_il && g.nonSpecificato < 0 && <span className="albatros-badge oltre mini" title="Il battuto supera l'incassato">Battuto oltre {euro(-g.nonSpecificato)}</span>}
                      {fondoDaSpecificare(g.chiusura) && <span className="albatros-badge da-specificare mini" title="Fondo di partenza e fondo lasciato non sono ancora scritti">Fondo da specificare</span>}
                      {g.fondoDiverso && <span className="albatros-badge oltre mini" title={`Partita con ${euro(g.fondoPartenza)} di fondo, ma il ${formattaDataGGMMAAAA(g.precedente.data)} in cassa erano stati lasciati ${euro(g.precedente.fondo_lasciato)}`}>Fondo diverso dal {formattaDataGGMMAAAA(g.precedente.data).slice(0, 5)} ({euro(g.precedente.fondo_lasciato)})</span>}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {g.chiusura.chiusa_il
                        ? <>{utenti[g.chiusura.chiusa_da] || '—'} <span className="albatros-tenue">· {oraDi(g.chiusura.chiusa_il)}</span></>
                        : <span className="albatros-tenue">—</span>}
                    </td>
                    {puoCorreggere && (
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {g.chiusura.chiusa_il && (
                          <button type="button" className="btn-outline-annulla" style={{ fontSize: '0.75rem', padding: '4px 8px' }} disabled={inCorso}
                            onClick={(e) => { e.stopPropagation(); riapri(g.chiusura); }}><Icona nome="riporta" size={14} />Riapri</button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default StoricoChiusure
