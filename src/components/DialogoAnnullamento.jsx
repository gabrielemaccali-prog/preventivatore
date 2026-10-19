import { useState } from 'react'
import { CATEGORIE_ANNULLAMENTO } from '../lib/costanti'
import Icona from './Icona'

// Il perche' di un annullamento, chiesto allo stesso modo da prenotazioni e preventivi: una
// categoria dall'elenco, che serve a contare, e una nota libera, che serve a ricordare il caso.
// La nota e' facoltativa tranne che per "Altro", dove la categoria da sola non direbbe niente.
//
// `iniziale` riapre il dialogo con quello che c'era (annullando di nuovo una riga gia' annullata).
// `onConferma` riceve { categoria, nota }; la nota vuota arriva come stringa vuota.
export default function DialogoAnnullamento({ titolo, spiegazione, iniziale, etichettaConferma = 'Annulla', onConferma, onChiudi }) {
  const [categoria, setCategoria] = useState(iniziale?.categoria || '');
  const [nota, setNota] = useState(iniziale?.nota || '');
  const [salvataggio, setSalvataggio] = useState(false);
  const scelta = CATEGORIE_ANNULLAMENTO.find(c => c.id === categoria);
  const notaMancante = !!scelta?.notaObbligatoria && !nota.trim();
  const pronto = !!scelta && !notaMancante && !salvataggio;

  const conferma = async () => {
    if (!pronto) return;
    setSalvataggio(true);
    try { await onConferma({ categoria, nota: nota.trim() }); } finally { setSalvataggio(false); }
  };

  return (
    <div className="modal-form-backdrop" onClick={onChiudi}>
      <div className="modal-form-box" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '560px' }}>
        <button type="button" className="modal-form-close" aria-label="Chiudi" onClick={onChiudi}>✕</button>
        <h3 style={{ margin: '0 0 4px 0', fontSize: '1.1rem', color: '#b91c1c' }}>{titolo}</h3>
        {spiegazione && <p style={{ margin: '0 0 14px 0', fontSize: '0.8rem', color: '#777' }}>{spiegazione}</p>}
        <div style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '6px' }}>Perché?</div>
        <div role="radiogroup" style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '14px', maxHeight: '48vh', overflowY: 'auto' }}>
          {CATEGORIE_ANNULLAMENTO.map(c => {
            const attiva = c.id === categoria;
            return (
              <label key={c.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '8px 12px', border: `1px solid ${attiva ? '#dc2626' : '#e2e8f0'}`, borderRadius: '6px', background: attiva ? '#fef2f2' : '#fff', cursor: 'pointer' }}>
                <input type="radio" name="categoriaAnnullamento" checked={attiva} onChange={() => setCategoria(c.id)} style={{ margin: '3px 0 0 0' }} />
                <span>
                  <strong style={{ fontSize: '0.88rem' }}>{c.etichetta}</strong>
                  <span style={{ display: 'block', fontSize: '0.76rem', color: '#64748b' }}>{c.descrizione}</span>
                </span>
              </label>
            );
          })}
        </div>
        <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '4px' }}>
          Nota {scelta?.notaObbligatoria ? <span style={{ color: '#b91c1c' }}>(obbligatoria)</span> : <span style={{ fontWeight: 'normal', color: '#94a3b8' }}>(facoltativa)</span>}
        </label>
        <textarea value={nota} onChange={(e) => setNota(e.target.value)} rows="3" style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'inherit', fontSize: '0.85rem', marginBottom: '14px' }}
          placeholder="Es. ha chiamato il 12/10: hanno trovato un'offerta a 900 €" />
        <button type="button" onClick={conferma} disabled={!pronto}
          title={!scelta ? 'Scegli una categoria' : notaMancante ? 'Con "Altro" serve una nota' : undefined}
          style={{ display: 'inline-flex', alignItems: 'center', padding: '9px 18px', background: pronto ? '#dc2626' : '#cbd5e1', color: '#fff', border: 'none', borderRadius: '4px', cursor: pronto ? 'pointer' : 'not-allowed', fontWeight: 'bold', fontSize: '0.85rem' }}>
          <Icona nome="annulla" size={16} style={{ marginRight: '6px' }} />{etichettaConferma}
        </button>
      </div>
    </div>
  );
}
