import { useState } from 'react'
import { CATEGORIE_ANNULLAMENTO } from '../lib/costanti'
import Icona from './Icona'

// Il perche' di un annullamento, chiesto allo stesso modo da prenotazioni e preventivi: una
// categoria dall'elenco, che serve a contare, e una nota libera, che serve a ricordare il caso.
// La nota e' facoltativa tranne che per "Altro", dove la categoria da sola non direbbe niente.
//
// Con dei soldi gia' incassati c'e' una domanda prima di tutte: che fine fanno. Dentro i termini
// di annullamento restano del cliente e diventano un voucher; fuori dai termini restano a noi e
// vanno fatturati. Sono due strade diverse e irreversibili a colpi di clic, quindi si sceglie qui,
// davanti all'importo, e non si danno per scontate: `destinazione` parte da "voucher" perche' e'
// la piu' frequente, ma la si vede scritta.
//
// `iniziale` riapre il dialogo con quello che c'era (annullando di nuovo una riga gia' annullata).
// `onConferma` riceve { categoria, nota, destinazione }; la nota vuota arriva come stringa vuota.
export default function DialogoAnnullamento({ titolo, spiegazione, incassato = 0, iniziale, etichettaConferma = 'Annulla', onConferma, onChiudi }) {
  const [categoria, setCategoria] = useState(iniziale?.categoria || '');
  const [nota, setNota] = useState(iniziale?.nota || '');
  const [destinazione, setDestinazione] = useState('voucher');
  const [salvataggio, setSalvataggio] = useState(false);
  const scelta = CATEGORIE_ANNULLAMENTO.find(c => c.id === categoria);
  const soldi = parseFloat(incassato) || 0;
  const etichetta = soldi > 0
    ? (destinazione === 'trattenuto' ? "Annulla e trattieni l'incasso" : "Annulla e crea il voucher")
    : etichettaConferma;
  const notaMancante = !!scelta?.notaObbligatoria && !nota.trim();
  const pronto = !!scelta && !notaMancante && !salvataggio;

  const conferma = async () => {
    if (!pronto) return;
    setSalvataggio(true);
    try { await onConferma({ categoria, nota: nota.trim(), destinazione }); } finally { setSalvataggio(false); }
  };

  return (
    <div className="modal-form-backdrop" onClick={onChiudi}>
      <div className="modal-form-box" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '560px' }}>
        <button type="button" className="modal-form-close" aria-label="Chiudi" onClick={onChiudi}>✕</button>
        <h3 style={{ margin: '0 0 4px 0', fontSize: '1.1rem', color: '#b91c1c' }}>{titolo}</h3>
        {spiegazione && <p style={{ margin: '0 0 14px 0', fontSize: '0.8rem', color: '#777' }}>{spiegazione}</p>}
        {soldi > 0 && (<>
          <div style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '6px' }}>Che fine fanno i €{soldi.toFixed(2)} già incassati?</div>
          <div role="radiogroup" style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '14px' }}>
            {[
              { id: 'voucher', etichetta: 'Tornano al cliente come voucher', descrizione: 'Siamo nei termini di annullamento: quel denaro resta suo e lo userà quando riprenoterà. Pagamenti e fattura si spostano sul voucher.', colore: '#6d28d9', sfondo: '#f5f3ff', bordo: '#ddd6fe' },
              { id: 'trattenuto', etichetta: 'Restano a noi: termini scaduti', descrizione: 'Fuori dai termini di annullamento: il denaro è nostro e va fatturato. Niente voucher — se il cliente tornerà, riprenoterà da capo.', colore: '#b45309', sfondo: '#fffbeb', bordo: '#fde68a' },
            ].map(o => {
              const attiva = o.id === destinazione;
              return (
                <label key={o.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '8px 12px', border: `1px solid ${attiva ? o.bordo : '#e2e8f0'}`, borderRadius: '6px', background: attiva ? o.sfondo : '#fff', cursor: 'pointer' }}>
                  <input type="radio" name="destinazioneIncasso" checked={attiva} onChange={() => setDestinazione(o.id)} style={{ margin: '3px 0 0 0' }} />
                  <span>
                    <strong style={{ fontSize: '0.88rem', color: attiva ? o.colore : '#0f172a' }}>{o.etichetta}</strong>
                    <span style={{ display: 'block', fontSize: '0.76rem', color: '#64748b' }}>{o.descrizione}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </>)}
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
          <Icona nome="annulla" size={16} style={{ marginRight: '6px' }} />{etichetta}
        </button>
      </div>
    </div>
  );
}
