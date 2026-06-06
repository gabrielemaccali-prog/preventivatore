import React, { useState, useEffect } from 'react';

export default function PaginaArchivioPreventivi() {
  const [preventivi, setPreventivi] = useState([]);
  
  // Stati dei Filtri di Ricerca
  const [filtroId, setFiltroId] = useState("");
  const [filtroDestinazione, setFiltroDestinazione] = useState("");
  const [filtroStato, setFiltroStato] = useState("");

  // Carica i dati all'avvio della pagina
  useEffect(() => {
    caricaPreventivi();
  }, []);

  const caricaPreventivi = () => {
    const datiLocali = JSON.parse(localStorage.getItem("db_preventivi") || "[]");
    setPreventivi(datiLocali);
  };

  // Funzione per aggiornare lo stato da "registrato" a "confermato"
  const confermaPreventivo = (idDAConfermare) => {
    const archivioAggiornato = preventivi.map(p => {
      if (p.id === idDAConfermare) {
        return { ...p, stato: "confermato" };
      }
      return p;
    });
    localStorage.setItem("db_preventivi", JSON.stringify(archivioAggiornato));
    setPreventivi(archivioAggiornato);
  };

  // Logica di Filtro combinata
  const preventiviFiltrati = preventivi.filter(p => {
    const matchId = p.id.toLowerCase().includes(filtroId.toLowerCase().trim());
    const matchDestinazione = p.destinazione.toLowerCase().includes(filtroDestinazione.toLowerCase().trim());
    const matchStato = filtroStato === "" || p.stato === filtroStato;
    
    return matchId && matchDestinazione && matchStato;
  });

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif', maxWidth: '1200px', margin: '0 auto', textAlign: 'left' }}>
      <h2 style={{ borderBottom: '2px solid #0288d1', paddingBottom: '10px', color: '#102a43' }}>📋 Archivio e Interrogazione Preventivi</h2>
      
      {/* PANNELLO FILTRI */}
      <div style={{ display: 'flex', gap: '15px', background: '#f0f4f8', padding: '15px', borderRadius: '8px', marginBottom: '20px', boxSizing: 'border-box' }}>
        <div style={{ flex: 1 }}>
          <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '4px', fontSize: '0.85rem' }}>Filtra per ID Preventivo:</label>
          <input 
            type="text" 
            value={filtroId} 
            onChange={(e) => setFiltroId(e.target.value)}
            placeholder="Es: PREV-123"
            style={{ width: '100%', padding: '8px', boxSizing: 'border-box', border: '1px solid #bcccdc', borderRadius: '4px' }}
          />
        </div>
        <div style={{ flex: 1 }}>
          <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '4px', fontSize: '0.85rem' }}>Filtra per Destinazione:</label>
          <input 
            type="text" 
            value={filtroDestinazione} 
            onChange={(e) => setFiltroDestinazione(e.target.value)}
            placeholder="Es: Milano"
            style={{ width: '100%', padding: '8px', boxSizing: 'border-box', border: '1px solid #bcccdc', borderRadius: '4px' }}
          />
        </div>
        <div style={{ flex: 1 }}>
          <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '4px', fontSize: '0.85rem' }}>Filtra per Stato:</label>
          <select 
            value={filtroStato} 
            onChange={(e) => setFiltroStato(e.target.value)}
            style={{ width: '100%', padding: '8px', boxSizing: 'border-box', border: '1px solid #bcccdc', borderRadius: '4px', background: '#fff' }}
          >
            <option value="">-- Tutti gli stati --</option>
            <option value="registrato">Registrato</option>
            <option value="confermato">Confermato</option>
          </select>
        </div>
      </div>

      {/* TABELLA RISULTATI */}
      {preventiviFiltrati.length === 0 ? (
        <p style={{ color: '#627d98', fontStyle: 'italic', textAlign: 'center', marginTop: '30px' }}>Nessun preventivo trovato con i filtri selezionati.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff', boxShadow: '0 2px 5px rgba(0,0,0,0.05)' }}>
          <thead>
            <tr style={{ background: '#102a43', color: '#fff', textAlign: 'left' }}>
              <th style={{ padding: '12px' }}>ID</th>
              <th style={{ padding: '12px' }}>Data</th>
              <th style={{ padding: '12px' }}>Destinazione / Logistica</th>
              <th style={{ padding: '12px' }}>Articoli Inclusi</th>
              <th style={{ padding: '12px', textAlign: 'right' }}>Totale Finalizzato</th>
              <th style={{ padding: '12px', textAlign: 'center' }}>Stato</th>
              <th style={{ padding: '12px', textAlign: 'center' }}>Azioni</th>
            </tr>
          </thead>
          <tbody>
            {preventiviFiltrati.map((prev) => (
              <tr key={prev.id} style={{ borderBottom: '1px solid #e4e7eb', verticalAlign: 'top' }}>
                <td style={{ padding: '12px', fontWeight: 'bold' }}>{prev.id}</td>
                <td style={{ padding: '12px', fontSize: '0.85rem' }}>{prev.dataEmissione}</td>
                <td style={{ padding: '12px', fontSize: '0.85rem' }}>
                  <strong>{prev.destinazione}</strong>
                  <div style={{ color: '#627d98', marginTop: '4px' }}>Dist: {prev.kmCalcolati} KM | Costo Log: €{prev.costiLogistica.toFixed(2)}</div>
                  <div style={{ fontStyle: 'italic', color: '#486581', marginTop: '4px' }}>{prev.periodoRiferimento}</div>
                </td>
                <td style={{ padding: '12px', fontSize: '0.85rem' }}>
                  <ul style={{ margin: 0, paddingLeft: '14px' }}>
                    {prev.gonfiabili.map((g, idx) => (
                      <li key={idx}>
                        <strong>{g.nome}</strong> (Prezzo: €{g.prezzoFinale.toFixed(2)})
                        {g.parametri.dimensioni && <span style={{ color: '#627d98', display: 'block', fontSize: '0.75rem' }}>Dim: {g.parametri.dimensioni} | {g.parametri.alimentazione}</span>}
                      </li>
                    ))}
                    {prev.serviziExtra.map((e, idx) => (
                      <li key={idx} style={{ color: '#0288d1' }}>
                        {e.nome} (Extra: €{e.prezzoFinale.toFixed(2)})
                      </li>
                    ))}
                  </ul>
                  {prev.noteFornitore && (
                    <div style={{ marginTop: '8px', padding: '6px', background: '#fffde7', borderLeft: '3px solid #fbc02d', fontSize: '0.8rem' }}>
                      <strong>Note:</strong> {prev.noteFornitore}
                    </div>
                  )}
                </td>
                <td style={{ padding: '12px', textAlign: 'right', fontWeight: 'bold', color: '#102a43' }}>
                  €{prev.totaleContrattuale.toFixed(2)}
                </td>
                <td style={{ padding: '12px', textAlign: 'center' }}>
                  <span style={{ 
                    padding: '4px 8px', 
                    borderRadius: '12px', 
                    fontSize: '0.75rem', 
                    fontWeight: 'bold',
                    textTransform: 'uppercase',
                    background: prev.stato === 'confermato' ? '#e2f7e3' : '#fff3cd', 
                    color: prev.stato === 'confermato' ? '#1b5e20' : '#b78103' 
                  }}>
                    {prev.stato}
                  </span>
                </td>
                <td style={{ padding: '12px', textAlign: 'center' }}>
                  {prev.stato === 'registrato' && (
                    <button 
                      onClick={() => confermaPreventivo(prev.id)}
                      style={{ background: '#2e7d32', color: '#fff', border: 'none', padding: '6px 10px', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.8rem' }}
                    >
                      ✓ Conferma
                    </button>
                  )}
                  {prev.stato === 'confermato' && (
                    <span style={{ color: '#2e7d32', fontSize: '0.85rem', fontWeight: 'bold' }}>🔒 Gestito</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}