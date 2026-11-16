import { useState, useEffect } from 'react'

// ============================================================
// Le pagine di una tabella lunga: 50 righe per volta, con prima, precedente, successiva e ultima.
// Uguale in Prenotazioni, Preventivatore, Voucher, Fatture e Cruscotto.
//
// La pagina si taglia dopo l'ordinamento, così l'ordine per colonna vale su tutto l'elenco e non
// solo sulle righe a video; e torna alla prima quando cambiano i filtri, perché l'elenco è un altro.
// ============================================================

export const RIGHE_PER_PAGINA = 50;

// `totale`: quante righe ha l'elenco. `dipendenze`: i filtri, al cui cambio si riparte da pagina 1.
export function usePaginazione(totale, dipendenze = []) {
  const [pagina, setPagina] = useState(1);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setPagina(1); }, dipendenze);
  const pagine = Math.max(1, Math.ceil(totale / RIGHE_PER_PAGINA));
  const corrente = Math.min(pagina, pagine);
  return {
    pagina: corrente, pagine, totale,
    vai: (n) => setPagina(Math.min(Math.max(1, n), pagine)),
    // Le righe della pagina, da un elenco già ordinato.
    fetta: (righe) => righe.slice((corrente - 1) * RIGHE_PER_PAGINA, corrente * RIGHE_PER_PAGINA),
  };
}

const stileBottone = { float: 'none', padding: '6px 12px' };

// La barra sotto la tabella. Con una pagina sola non compare.
function Paginazione({ pagina, pagine, totale, vai }) {
  if (totale <= RIGHE_PER_PAGINA) return null;
  return (
    <div className="no-print" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px', marginTop: '12px', fontSize: '0.85rem', color: '#475569', flexWrap: 'wrap' }}>
      <button type="button" className="btn-chiudi" style={stileBottone} disabled={pagina === 1} title="Prima pagina" onClick={() => vai(1)}>«</button>
      <button type="button" className="btn-chiudi" style={stileBottone} disabled={pagina === 1} title="Pagina precedente" onClick={() => vai(pagina - 1)}>‹</button>
      <span>Pagina <strong>{pagina}</strong> di {pagine} · righe {(pagina - 1) * RIGHE_PER_PAGINA + 1}–{Math.min(pagina * RIGHE_PER_PAGINA, totale)} di {totale}</span>
      <button type="button" className="btn-chiudi" style={stileBottone} disabled={pagina === pagine} title="Pagina successiva" onClick={() => vai(pagina + 1)}>›</button>
      <button type="button" className="btn-chiudi" style={stileBottone} disabled={pagina === pagine} title="Ultima pagina" onClick={() => vai(pagine)}>»</button>
    </div>
  );
}

export default Paginazione
