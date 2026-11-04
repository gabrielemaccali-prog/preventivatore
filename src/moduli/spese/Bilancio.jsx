import { useState, useEffect, useMemo } from 'react'
import { supabase, leggiTutte } from '../../lib/supabaseClient'
import { nomeControparte } from '../../lib/banca'
import { costruisciBilancio } from '../../lib/bilancio'
import { leggiCategorieIncassi } from './CategorieIncassi'

// ============================================================
// Bilancio di cassa, dai movimenti della banca: ricavi e costi operativi, poi altri ricavi e costi di
// struttura, poi gli altri costi, ognuno con il suo risultato. Ogni voce si apre nelle sue categorie
// (e le operative nelle controparti). La regola sta in lib/bilancio; qui si sceglie il periodo e si
// disegna. Il risultato finale è la variazione del saldo: se non lo è, qualcosa è da classificare.
// ============================================================

const oggi = new Date();
// Gli importi all'italiana, con le migliaia: in un bilancio si leggono decine di migliaia di euro.
// Il punto anche sotto i 10.000 (per l'italiano il browser lo mette solo da lì in su): €4.398,50.
const FORMATO = new Intl.NumberFormat('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' });
const euro = (n) => `€${FORMATO.format(Math.abs(Number(n) || 0))}`;

function Bilancio({ movimenti, spese, categorie, categorieAlbatros, controparti }) {
  const [pagamenti, setPagamenti] = useState([]);
  const [categorieIncassi, setCategorieIncassi] = useState([]);
  const [anno, setAnno] = useState(String(oggi.getFullYear()));
  const [mese, setMese] = useState('');
  // Le voci aperte, per percorso ("costiOperativi/Affitto campi").
  const [aperte, setAperte] = useState(() => new Set());

  useEffect(() => {
    leggiTutte(() => supabase.from('pagamenti').select('tipo, movimento_id').not('movimento_id', 'is', null).order('id'))
      .then(r => setPagamenti(r.data || []));
    leggiCategorieIncassi().then(r => setCategorieIncassi(r.data || []));
  }, []);

  const anni = useMemo(() => [...new Set(movimenti.map(m => m.data_contabile.slice(0, 4)))].sort().reverse(), [movimenti]);
  const [dal, al] = mese ? [`${mese}-01`, `${mese}-31`] : anno ? [`${anno}-01-01`, `${anno}-12-31`] : ['', ''];
  const b = useMemo(() => costruisciBilancio({
    movimenti, spese, pagamenti, categorieSpese: categorie, categorieIncassi, categorieAlbatros,
    nomeControparte: (tipo, id) => nomeControparte(controparti, tipo, id), dal, al,
  }), [movimenti, spese, pagamenti, categorie, categorieIncassi, categorieAlbatros, controparti, dal, al]);

  const apri = (chiave) => setAperte(prima => {
    const n = new Set(prima);
    if (n.has(chiave)) n.delete(chiave); else n.add(chiave);
    return n;
  });

  // Una voce e, se è aperta, i suoi figli, rientrati di un livello. segno: +1 ricavo, -1 costo.
  const righe = (voce, chiave, livello, segno) => {
    const apribile = voce.figli.length > 0;
    const aperta = aperte.has(chiave);
    const out = [(
      <tr key={chiave} onClick={() => apribile && apri(chiave)} style={{ cursor: apribile ? 'pointer' : 'default', background: livello === 0 ? '#f8fafc' : undefined }}>
        <td style={{ padding: '7px 10px', paddingLeft: `${10 + livello * 22}px`, fontWeight: livello === 0 ? 700 : livello === 1 ? 500 : 400, fontSize: livello > 1 ? '0.82rem' : '0.88rem' }}>
          <span className="riga-espandibile-chevron" style={{ visibility: apribile ? 'visible' : 'hidden', transform: aperta ? 'rotate(90deg)' : 'none' }}>›</span>
          {voce.nome}
        </td>
        <td className="num" style={{ padding: '7px 10px', whiteSpace: 'nowrap', fontWeight: livello === 0 ? 700 : 400, fontSize: livello > 1 ? '0.82rem' : '0.88rem', color: segno > 0 ? '#15803d' : '#b91c1c' }}>
          {segno > 0 ? '' : '−'}{euro(voce.importo)}
        </td>
      </tr>
    )];
    if (aperta) voce.figli.forEach(f => out.push(...righe(f, `${chiave}/${f.nome}`, livello + 1, segno)));
    return out;
  };
  const risultato = (nome, importo, finale = false) => (
    <tr key={nome} style={{ cursor: 'default', borderTop: '2px solid #cbd5e1', background: finale ? '#e2e8f0' : '#f1f5f9' }}>
      <td style={{ padding: '9px 10px', fontWeight: 800, textTransform: 'uppercase', fontSize: '0.82rem', letterSpacing: '0.03em' }}>{nome}</td>
      <td className="num" style={{ padding: '9px 10px', fontWeight: 800, whiteSpace: 'nowrap', color: importo >= 0 ? '#15803d' : '#b91c1c' }}>{importo < 0 ? '−' : ''}{euro(Math.abs(importo))}</td>
    </tr>
  );
  const daClassificare = b.entrateDaClassificare.importo > 0 || b.usciteDaClassificare.importo > 0;

  return (
    <div className="albatros-pagina no-print">
      <div className="albatros-card">
        <div className="albatros-testata filtri-telefono">
          <label className="albatros-etichetta" style={{ flex: '0 1 150px' }}>Anno
            <select value={anno} onChange={(e) => { setAnno(e.target.value); setMese(''); }} className="albatros-campo">
              <option value="">Tutto</option>
              {anni.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </label>
          <label className="albatros-etichetta" style={{ flex: '0 1 170px' }}>Mese
            <input type="month" value={mese} onChange={(e) => setMese(e.target.value)} className="albatros-campo" />
          </label>
          {mese && <button type="button" className="albatros-chip" style={{ alignSelf: 'flex-end' }} onClick={() => setMese('')}>Tutto l'anno</button>}
          <p className="albatros-tenue" style={{ margin: '0 0 0 auto', fontSize: '0.8rem', alignSelf: 'flex-end' }}>Di cassa: quello che è entrato e uscito dal conto. Clic su una voce per i dettagli.</p>
        </div>

        <div style={{ overflowX: 'auto', marginTop: '12px' }}>
          <table className="albatros-tabella" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              {righe(b.ricaviOperativi, 'ricaviOperativi', 0, 1)}
              {righe(b.costiOperativi, 'costiOperativi', 0, -1)}
              {risultato('Risultato operativo', b.risultatoOperativo)}
              {righe(b.altriRicavi, 'altriRicavi', 0, 1)}
              {righe(b.costiStruttura, 'costiStruttura', 0, -1)}
              {risultato('Risultato dopo la struttura', b.risultatoStruttura)}
              {righe(b.altriCosti, 'altriCosti', 0, -1)}
              {daClassificare && righe(b.entrateDaClassificare, 'entrateDaClassificare', 0, 1)}
              {daClassificare && righe(b.usciteDaClassificare, 'usciteDaClassificare', 0, -1)}
              {risultato('Risultato finale', b.risultatoFinale, true)}
            </tbody>
          </table>
        </div>

        <p className="albatros-tenue" style={{ margin: '10px 0 0', fontSize: '0.8rem' }}>
          Variazione del saldo in banca nel periodo: {b.variazione < 0 ? '−' : ''}{euro(b.variazione)}
          {b.capitale !== 0 && ` · capitale sociale versato, che non è un ricavo e non è contato: ${euro(b.capitale)}`}
          {Math.abs(b.variazione - b.capitale - b.risultatoFinale) < 0.005 ? ' · torna con il risultato finale' : ''}
          {b.ignorati !== 0 && ` · movimenti ignorati (giroconti e simili) non contati: ${euro(b.ignorati)}`}
          {daClassificare && ' · le voci da classificare si sistemano nelle schede Spese e Incassi'}
        </p>
      </div>
    </div>
  );
}

export default Bilancio
