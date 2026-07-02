import { useState } from 'react'
import { formattaIndirizzoPulito, parseIndirizzo } from '../lib/utils'

// Campo di ricerca indirizzo riutilizzabile (Nominatim).
// onSelect riceve { indirizzo, cap, citta, provincia }.
function RicercaIndirizzo({ onSelect, placeholder = "Scrivi via, civico, città..." }) {
  const [query, setQuery] = useState("");
  const [risultati, setRisultati] = useState([]);

  const cerca = async () => {
    if (!query) return;
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&addressdetails=1&countrycodes=it&limit=5`);
      setRisultati(await r.json());
    } catch (e) {
      console.error(e);
    }
  };

  const scegli = (luogo) => {
    onSelect(parseIndirizzo(luogo));
    setRisultati([]);
    setQuery("");
  };

  return (
    <div>
      <div className="ricerca-box" style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '8px', alignItems: 'center' }}>
        <input
          type="text"
          placeholder={placeholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), cerca())}
          style={{ width: '100%', minWidth: 0, marginTop: 0 }}
        />
        <button type="button" onClick={cerca} style={{ padding: '8px 14px', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>Cerca</button>
      </div>
      {risultati.length > 0 && (
        <ul className="risultati-ricerca">
          {risultati.map(l => <li key={l.place_id} onClick={() => scegli(l)}>{formattaIndirizzoPulito(l)}</li>)}
        </ul>
      )}
    </div>
  );
}

export default RicercaIndirizzo
