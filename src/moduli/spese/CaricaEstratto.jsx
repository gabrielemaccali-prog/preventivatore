import { useState, useRef } from 'react'
import * as XLSX from 'xlsx'
import { formattaDataGGMMAAAA } from '../../lib/utils'
import { leggiEstrattoConto, euro } from '../../lib/banca'
import { impronteGiaPresenti, importaEstratto, elaboraMovimenti } from './operazioni'

// ============================================================
// Il caricamento dell'estratto conto ("Lista Movimenti" esportata in Excel dalla banca), in cima
// alla scheda Spese. Il file si carica quante volte si vuole e su qualunque periodo, anche
// sovrapposto ai precedenti: entrano solo le righe nuove. Prima di importare si vede un'anteprima
// (periodo, saldi, quante righe sono nuove); dopo, cosa è successo: le uscite nuove diventano spese
// (classificate dalle regole, o da completare) e i costi dei bonifici si sommano alla spesa del
// bonifico. I saldi e i movimenti si controllano nella scheda Banca.
// ============================================================

function CaricaEstratto({ user, regole, controparti, categorie, ricaricaDati }) {
  const [anteprima, setAnteprima] = useState(null);
  const [inCorso, setInCorso] = useState(false);
  const [esito, setEsito] = useState(null);
  const inputFile = useRef(null);

  const scegliFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setEsito(null);
    try {
      const estratto = leggiEstrattoConto(XLSX, new Uint8Array(await file.arrayBuffer()));
      const presenti = await impronteGiaPresenti(estratto.movimenti.map(m => m.impronta));
      setAnteprima({ estratto, nome: file.name, nuove: estratto.movimenti.filter(m => !presenti.has(m.impronta)) });
    } catch (err) {
      alert(`Non riesco a leggere il file: ${err.message}`);
    }
  };

  const importa = async () => {
    setInCorso(true);
    try {
      const { nuove } = await importaEstratto(anteprima.estratto, anteprima.nome, user);
      const elaborate = await elaboraMovimenti({ regole, controparti, categorie, user });
      setEsito({ movimentiNuovi: nuove, ...elaborate });
      setAnteprima(null);
      await ricaricaDati();
    } catch (err) {
      alert(`Errore nell'importazione: ${err.message}`);
    } finally {
      setInCorso(false);
    }
  };

  return (
    <div className="albatros-card">
      <div className="albatros-testata" style={{ alignItems: 'center' }}>
        <div style={{ flex: '1 1 300px' }}>
          <div className="albatros-titolo" style={{ fontWeight: 700, color: '#0f172a' }}>Carica l'estratto conto</div>
          <p className="albatros-nota" style={{ marginTop: '4px' }}>La "Lista Movimenti" esportata in Excel dalla banca. Puoi ricaricare anche periodi già caricati: entrano solo i movimenti nuovi.</p>
        </div>
        <input ref={inputFile} type="file" accept=".xlsx,.xls" onChange={scegliFile} style={{ display: 'none' }} />
        <button type="button" className="btn-accent-inline albatros-bottone" disabled={inCorso} onClick={() => inputFile.current?.click()}>Scegli il file…</button>      </div>

      {anteprima && (
        <div style={{ marginTop: '14px', padding: '12px 14px', border: '1px solid #e2e8f0', borderRadius: '8px', background: '#f8fafc', fontSize: '0.88rem' }}>
          <div><strong>{anteprima.nome}</strong>{anteprima.estratto.conto ? ` · conto ${anteprima.estratto.conto}` : ''}</div>
          <div style={{ marginTop: '4px' }}>
            Dal {formattaDataGGMMAAAA(anteprima.estratto.dal)} al {formattaDataGGMMAAAA(anteprima.estratto.al)} · saldo iniziale {euro(anteprima.estratto.saldoIniziale)} · saldo finale {euro(anteprima.estratto.saldoFinale)}
          </div>
          <div style={{ marginTop: '4px' }}>
            {anteprima.estratto.movimenti.length} movimenti nel file: <strong>{anteprima.nuove.length} nuovi</strong>, {anteprima.estratto.movimenti.length - anteprima.nuove.length} già caricati.
            {anteprima.estratto.nonContabilizzati > 0 && <> {anteprima.estratto.nonContabilizzati} non ancora contabilizzati, lasciati fuori: arriveranno col prossimo file.</>}
          </div>
          {anteprima.estratto.differenzaFile !== 0 && (
            <p className="albatros-avviso" style={{ marginTop: '8px' }}>Il file non torna con se stesso: saldo iniziale più movimenti fa {euro(anteprima.estratto.differenzaFile)} di differenza dal saldo finale. Qualche riga non è stata letta: meglio non importarlo.</p>
          )}
          <div style={{ display: 'flex', gap: '10px', marginTop: '10px', justifyContent: 'flex-end' }}>
            <button type="button" className="btn-outline-annulla albatros-bottone" onClick={() => setAnteprima(null)}>Annulla</button>
            <button type="button" className="btn-accent-inline albatros-bottone" disabled={inCorso} onClick={importa}>
              {inCorso ? 'Importazione…' : anteprima.nuove.length ? `Importa ${anteprima.nuove.length} movimenti` : 'Registra il caricamento'}
            </button>
          </div>
        </div>
      )}

      {esito && (
        <div className="albatros-nota" style={{ marginTop: '12px', fontSize: '0.88rem', color: '#166534', display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          <span>
            {esito.movimentiNuovi != null && <>{esito.movimentiNuovi} movimenti nuovi. </>}
            {esito.nuove + esito.collegate + esito.oneri + esito.ignorati === 0
              ? 'Nessuna spesa da creare.'
              : <>Spese create: <strong>{esito.nuove}</strong>{esito.daCompletare > 0 && <> (<strong>{esito.daCompletare}</strong> da completare)</>} · collegate a spese scritte a mano: {esito.collegate} · oneri sommati ai bonifici: {esito.oneri}{esito.ignorati > 0 && <> · ignorati: {esito.ignorati}</>}.</>}
          </span>
          <button type="button" className="albatros-chip" style={{ padding: '2px 10px' }} onClick={() => setEsito(null)}>Ok</button>
        </div>
      )}
    </div>
  );
}

export default CaricaEstratto
