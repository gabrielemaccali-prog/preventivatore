import { useState, useEffect } from 'react'
import { supabase, leggiTutte } from '../../lib/supabaseClient'
import { puoVedere } from '../../lib/permessi'
import { formattaDataGGMMAAAA } from '../../lib/utils'
import { quadratura, euro, r2, num, nomeCategoria } from './calcolo'

// ============================================================
// Cashflow: dove sono i soldi adesso, ente per ente. Niente filtri: conta tutto dalla prima chiusura. Una sotto-scheda per BFM, Albatros e Lama; chi vede
// quale lo decidono i ruoli (sottoschede cashflow_*).
//   Albatros   entrano gli incassi POS e i contanti ritirati alle chiusure (i ragazzi li ritirano,
//              ma sono di Albatros), escono le spese pagate da Albatros; a parte il fondo cassa.
//   Lama, BFM  solo le spese che hanno pagato.
// Le spese ancora da attribuire non sono di nessuno: si segnalano e basta.
// ============================================================

const SOTTOSCHEDE = [
  { id: 'cashflow_bfm', ente: 'bfm', label: 'BFM' },
  { id: 'cashflow_albatros', ente: 'albatros', label: 'Albatros' },
  { id: 'cashflow_lama', ente: 'lama', label: 'Lama' },
];

// I movimenti di un ente, dalle chiusure e dalle spese: entrate positive, uscite negative.
function movimentiDi(ente, chiusure, spese) {
  const entrate = chiusure.filter(c => c.chiusa_il).flatMap(c => {
    const q = quadratura(c, []);
    if (ente !== 'albatros') return [];
    return [
      ...(q.pos > 0 ? [{ data: c.data, importo: q.pos, descrizione: 'Incasso POS', tipo: 'pos' }] : []),
      ...(q.ritirato > 0 ? [{ data: c.data, importo: q.ritirato, descrizione: 'Contanti ritirati alla chiusura', tipo: 'contanti' }] : []),
    ];
  });
  const uscite = spese.filter(s => s.ente === ente).map(s => ({ data: s.data, importo: -r2(num(s.importo)), descrizione: s.descrizione, spesa: s }));
  return [...entrate, ...uscite].sort((a, b) => b.data.localeCompare(a.data) || a.importo - b.importo);
}
const somma = (mov, segno) => r2(mov.filter(m => Math.sign(m.importo) === segno).reduce((t, m) => t + m.importo, 0));

function Cashflow({ user, categorie }) {
  const visibili = SOTTOSCHEDE.filter(s => puoVedere(user, 'albatros', 'cashflow', s.id));
  const [scelta, setScelta] = useState(null);
  const [chiusure, setChiusure] = useState([]);
  const [spese, setSpese] = useState([]);

  // Si leggono tutte: il saldo parte dalla prima chiusura. Sono poche righe al giorno.
  const carica = async () => {
    const [ch, sp] = await Promise.all([
      leggiTutte(() => supabase.from('albatros_chiusure').select('*').order('id')),
      leggiTutte(() => supabase.from('albatros_spese').select('*').order('id')),
    ]);
    setChiusure(ch.data || []);
    setSpese(sp.data || []);
  };
  useEffect(() => { carica(); }, []);

  if (visibili.length === 0) return null;
  const attiva = visibili.find(s => s.id === scelta) || visibili[0];
  const mov = movimentiDi(attiva.ente, chiusure, spese);
  const entrate = somma(mov, 1);
  const uscite = somma(mov, -1);
  const saldo = r2(entrate + uscite);
  const sommaTipo = (tipo) => r2(mov.filter(m => m.tipo === tipo).reduce((t, m) => t + m.importo, 0));
  const daAttribuire = spese.filter(s => !s.ente);
  const ultimaConFondo = [...chiusure].filter(c => c.chiusa_il && c.fondo_lasciato != null).sort((a, b) => b.data.localeCompare(a.data))[0];

  return (
    <div className="albatros-pagina no-print">
      <div className="albatros-card">
        <div className="albatros-testata">
          <div className="albatros-filtri-listino" style={{ marginBottom: 0, alignSelf: 'flex-end' }}>
            {visibili.map(s => (
              <button key={s.id} type="button" className={`albatros-chip ${attiva.id === s.id ? 'attivo' : ''}`} onClick={() => setScelta(s.id)}>{s.label}</button>
            ))}
          </div>
        </div>

        <div className="albatros-cifre">
          {attiva.ente === 'albatros' ? (
            <>
              <div className="albatros-cifra-saldo"><span>Saldo attuale</span><strong>{euro(saldo)}</strong><small>entrate − uscite</small></div>
              <div><span>Incassi POS</span><strong style={{ color: '#15803d' }}>{euro(sommaTipo('pos'))}</strong><small>entrate</small></div>
              <div><span>Contanti ritirati</span><strong style={{ color: '#15803d' }}>{euro(sommaTipo('contanti'))}</strong><small>entrate, dalle chiusure</small></div>
              <div><span>Spese pagate</span><strong style={{ color: '#b91c1c' }}>{euro(-uscite)}</strong><small>uscite</small></div>
            </>
          ) : (
            <div className="albatros-cifra-saldo"><span>Spese pagate</span><strong>{euro(-uscite)}</strong><small>da {attiva.label}, dalla prima chiusura</small></div>
          )}
          {attiva.ente === 'albatros' && (
            <div><span>Fondo cassa</span><strong>{euro(ultimaConFondo?.fondo_lasciato)}</strong>
              <small>{ultimaConFondo ? `lasciato il ${formattaDataGGMMAAAA(ultimaConFondo.data)}` : 'nessuna chiusura col fondo'}</small></div>
          )}
        </div>

        {daAttribuire.length > 0 && (
          <p className="albatros-avviso" style={{ marginTop: '12px' }}>
            {daAttribuire.length} {daAttribuire.length === 1 ? 'spesa' : 'spese'} da attribuire ({euro(daAttribuire.reduce((t, s) => t + num(s.importo), 0))}): non sono contate per nessuno finché non si sceglie chi le ha pagate.
          </p>
        )}

        {mov.length === 0 && <p className="albatros-vuoto">Nessun movimento.</p>}
        {mov.length > 0 && (
          <div style={{ overflowX: 'auto', marginTop: '12px' }}>
            <table className="albatros-tabella">
              <thead>
                <tr><th>Data</th><th>Movimento</th><th className="num">Entrata</th><th className="num">Uscita</th></tr>
              </thead>
              <tbody>
                {mov.map((m, i) => (
                  <tr key={i} style={{ cursor: 'default' }}>
                    <td style={{ whiteSpace: 'nowrap' }}>{formattaDataGGMMAAAA(m.data)}</td>
                    <td>{m.descrizione}{m.spesa && <span className="albatros-tenue"> · {nomeCategoria(categorie, m.spesa.categoria_id)}</span>}</td>
                    <td className="num" style={{ color: '#15803d' }}>{m.importo > 0 ? euro(m.importo) : ''}</td>
                    <td className="num" style={{ color: '#b91c1c' }}>{m.importo < 0 ? euro(-m.importo) : ''}</td>
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

export default Cashflow
