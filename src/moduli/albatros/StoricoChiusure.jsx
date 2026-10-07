import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabaseClient'
import Icona from '../../components/Icona'
import { formattaDataGGMMAAAA } from '../../lib/utils'
import { quadratura, euro, periodoIniziale, intervalloPeriodo } from './calcolo'
import FiltroPeriodo from './FiltroPeriodo'

// ============================================================
// Scheda Chiusure: le giornate di un mese o di una settimana (da lunedì a domenica), con
// incassato e battuto. Toccando una giornata la si
// apre nella scheda Giornata; l'amministratore da qui riapre una giornata chiusa.
// ============================================================

function StoricoChiusure({ puoCorreggere, onApri }) {
  const [periodo, setPeriodo] = useState(periodoIniziale);
  const [giorni, setGiorni] = useState([]);
  const [inCorso, setInCorso] = useState(false);

  const [da, al] = intervalloPeriodo(periodo);

  const carica = async () => {
    const { data: ch } = await supabase.from('albatros_chiusure').select('*')
      .gte('data', da).lte('data', al).order('data', { ascending: false });
    const elenco = ch || [];
    const { data: rg } = elenco.length
      ? await supabase.from('albatros_righe').select('chiusura_id, quantita, prezzo').in('chiusura_id', elenco.map(c => c.id))
      : { data: [] };
    setGiorni(elenco.map(c => ({ chiusura: c, ...quadratura(c, (rg || []).filter(r => r.chiusura_id === c.id)) })));
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

  const tot = (k) => giorni.reduce((s, g) => s + g[k], 0);

  return (
    <div className="albatros-pagina no-print">
      <div className="albatros-card">
        <div className="albatros-testata">
          <FiltroPeriodo periodo={periodo} onChange={setPeriodo} />
          <div style={{ marginLeft: 'auto', textAlign: 'right', fontSize: '0.88rem' }}>
            <div>Incassato {periodo.tipo === 'settimana' ? 'della settimana' : 'del mese'}: <strong>{euro(tot('incassato'))}</strong></div>
            <div className="albatros-tenue">Battuto {euro(tot('specificato'))}</div>
          </div>
        </div>

        {giorni.length === 0 && <p className="albatros-vuoto">Nessuna giornata in {periodo.tipo === 'settimana' ? 'questa settimana' : 'questo mese'}.</p>}
        {giorni.length > 0 && (
          <div style={{ overflowX: 'auto', marginTop: '12px' }}>
            <table className="albatros-tabella">
              <thead>
                <tr><th>Giornata</th><th className="num">POS</th><th className="num">Contanti</th><th className="num">Incassato</th><th className="num">Battuto</th><th>Stato</th>{puoCorreggere && <th></th>}</tr>
              </thead>
              <tbody>
                {giorni.map(g => (
                  <tr key={g.chiusura.id} onClick={() => onApri(g.chiusura.data)} title="Apri la giornata">
                    <td>{formattaDataGGMMAAAA(g.chiusura.data)}</td>
                    <td className="num">{euro(g.pos)}</td>
                    <td className="num">{euro(g.contanti)}</td>
                    <td className="num"><strong>{euro(g.incassato)}</strong></td>
                    <td className="num">{euro(g.specificato)} <span className="albatros-tenue">({Math.round(g.quota * 100)}%)</span></td>
                    <td>{g.chiusura.chiusa_il ? <span className="albatros-badge chiusa mini">Chiusa</span> : <span className="albatros-badge aperta mini">Aperta</span>}</td>
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
