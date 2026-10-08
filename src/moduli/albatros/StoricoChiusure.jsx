import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabaseClient'
import Icona from '../../components/Icona'
import { formattaDataGGMMAAAA } from '../../lib/utils'
import { quadratura, daSpecificare, fondoDiverso, fondoDaSpecificare, ENTI_RITIRO, etichettaEnte, euro, r2, periodoIniziale, intervalloPeriodo } from './calcolo'
import FiltroPeriodo from './FiltroPeriodo'

// ============================================================
// Scheda Chiusure: le giornate di un mese o di una settimana (da lunedì a domenica), con
// incassato e battuto. Toccando una giornata la si
// apre nella scheda Giornata; l'amministratore da qui riapre una giornata chiusa.
// Le giornate chiuse con un residuo non spiegato sono segnate "Da specificare" e si possono
// vedere da sole; quelle partite con un fondo diverso da quello lasciato la sera prima "Fondo diverso".
// ============================================================

const oraDi = (ts) => new Date(ts).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

function StoricoChiusure({ puoCorreggere, utenti, onApri }) {
  const [periodo, setPeriodo] = useState(periodoIniziale);
  const [giorni, setGiorni] = useState([]);
  const [inCorso, setInCorso] = useState(false);
  const [soloDaSpecificare, setSoloDaSpecificare] = useState(false);

  const [da, al] = intervalloPeriodo(periodo);

  const carica = async () => {
    const { data: ch } = await supabase.from('albatros_chiusure').select('*')
      .gte('data', da).lte('data', al).order('data', { ascending: false });
    const elenco = ch || [];
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
      ...quadratura(c, (rg || []).filter(r => r.chiusura_id === c.id)),
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
  const ritiratoDa = (ente) => r2(giorni.filter(g => g.chiusura.ritirato_da === ente).reduce((s, g) => s + g.ritirato, 0));
  const incomplete = giorni.filter(g => daSpecificare(g.chiusura, g));
  const visibili = soloDaSpecificare ? incomplete : giorni;

  return (
    <div className="albatros-pagina no-print">
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
            <div className="albatros-tenue">Ritirati: {ENTI_RITIRO.map(e => `${e.label} ${euro(ritiratoDa(e.id))}`).join(' · ')}</div>
          </div>
        </div>

        {visibili.length === 0 && <p className="albatros-vuoto">{soloDaSpecificare ? 'Nessuna giornata da specificare' : 'Nessuna giornata'} in {periodo.tipo === 'settimana' ? 'questa settimana' : 'questo mese'}.</p>}
        {visibili.length > 0 && (
          <div style={{ overflowX: 'auto', marginTop: '12px' }}>
            <table className="albatros-tabella">
              <thead>
                <tr><th>Giornata</th><th className="num">POS</th><th className="num" title="Contanti contati meno il fondo di partenza">Contanti</th><th className="num">Incassato</th><th className="num">Battuto</th><th className="num" title="Lasciato in cassa per il giorno dopo">Fondo</th><th className="num">Ritirati</th><th>Stato</th><th>Chiusa da</th>{puoCorreggere && <th></th>}</tr>
              </thead>
              <tbody>
                {visibili.map(g => (
                  <tr key={g.chiusura.id} onClick={() => onApri(g.chiusura.data)} title="Apri la giornata">
                    <td>{formattaDataGGMMAAAA(g.chiusura.data)}</td>
                    <td className="num">{euro(g.pos)}</td>
                    <td className="num">{euro(g.contanti)}</td>
                    <td className="num"><strong>{euro(g.incassato)}</strong></td>
                    <td className="num"><span className="albatros-tenue">{g.chiusura.chiusa_il ? euro(g.fondoLasciato) : '—'}</span></td>
                    <td className="num">{g.chiusura.chiusa_il && g.ritirato > 0
                      ? <>{euro(g.ritirato)}{g.chiusura.ritirato_da && <div className="albatros-tenue" style={{ fontSize: '0.75rem' }}>{etichettaEnte(g.chiusura.ritirato_da)}</div>}</>
                      : <span className="albatros-tenue">—</span>}</td>
                    <td className="num">{euro(g.specificato)}{g.chiusura.chiusa_il && <span className="albatros-tenue"> ({Math.round(g.quota * 100)}%)</span>}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {g.chiusura.chiusa_il ? <span className="albatros-badge chiusa mini">Chiusa</span> : <span className="albatros-badge aperta mini">Aperta</span>}
                      {daSpecificare(g.chiusura, g) && <span className="albatros-badge da-specificare mini" title={`Residuo non spiegato: ${euro(g.nonSpecificato)}`}>Da specificare {euro(g.nonSpecificato)}</span>}
                      {g.chiusura.chiusa_il && g.nonSpecificato < 0 && <span className="albatros-badge oltre mini" title="Il battuto supera l'incassato">Battuto oltre {euro(-g.nonSpecificato)}</span>}
                      {fondoDaSpecificare(g.chiusura) && <span className="albatros-badge da-specificare mini" title="Fondo di partenza e fondo lasciato non sono ancora scritti">Fondo da specificare</span>}
                      {g.fondoDiverso && <span className="albatros-badge oltre mini" title="Il fondo di partenza non è quello lasciato alla chiusura prima">Fondo diverso</span>}
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
