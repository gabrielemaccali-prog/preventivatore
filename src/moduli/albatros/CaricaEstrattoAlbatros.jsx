import { useState, useRef } from 'react'
import * as XLSX from 'xlsx'
import { formattaDataGGMMAAAA } from '../../lib/utils'
import { leggiEstrattoConto } from '../../lib/banca'
import { euro } from './calcolo'
import { DATA_INIZIO_BANCA, saldoAllInizio } from './banca'
import { impronteGiaPresenti, importaEstratto, elaboraMovimenti, movimentiDelFile } from './operazioniBanca'

// ============================================================
// Il caricamento dell'estratto conto di Albatros, come quello del modulo Spese di BFM: la "Lista
// Movimenti" esportata in Excel dalla banca. Si carica quante volte si vuole, anche su periodi già
// caricati: entrano solo le righe nuove, dal 1 ottobre 2026. Prima di importare si vede
// un'anteprima (periodo, saldi, quante righe sono nuove); dopo, cosa è successo: le uscite diventano
// spese (o prelievi, o commissioni sommate al loro bonifico). I saldi e i movimenti si controllano
// nella vista Banca.
// ============================================================

function CaricaEstrattoAlbatros({ user, categorie, ultimoConto, onCaricato }) {
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
      const delPeriodo = movimentiDelFile(estratto);
      const presenti = await impronteGiaPresenti(delPeriodo.map(m => m.impronta));
      setAnteprima({ estratto, nome: file.name, delPeriodo, nuove: delPeriodo.filter(m => !presenti.has(m.impronta)) });
    } catch (err) {
      alert(`Non riesco a leggere il file: ${err.message}`);
    }
  };

  const importa = async () => {
    setInCorso(true);
    try {
      const { nuove, contabilizzate } = await importaEstratto(anteprima.estratto, anteprima.nome, user);
      const elaborate = await elaboraMovimenti({ categorie, user });
      setEsito({ movimentiNuovi: nuove, contabilizzate, ...elaborate });
      setAnteprima(null);
      await onCaricato();
    } catch (err) {
      alert(`Errore nell'importazione: ${err.message}`);
    } finally {
      setInCorso(false);
    }
  };

  const a = anteprima;
  const fuori = a ? a.estratto.movimenti.length - a.delPeriodo.length : 0;
  const altroConto = a && ultimoConto && a.estratto.conto && a.estratto.conto !== ultimoConto;
  const nonTorna = a && a.estratto.differenzaFile !== 0;

  return (
    <div className="albatros-card">
      <div className="albatros-testata" style={{ alignItems: 'center' }}>
        <div style={{ flex: '1 1 300px' }}>
          <div className="albatros-titolo" style={{ fontWeight: 700, color: '#0f172a' }}>Carica l'estratto conto</div>
          <p className="albatros-nota" style={{ marginTop: '4px' }}>La "Lista Movimenti" del conto di Albatros esportata in Excel dalla banca. Puoi ricaricare anche periodi già caricati: entrano solo i movimenti nuovi, dal {formattaDataGGMMAAAA(DATA_INIZIO_BANCA)}.</p>
        </div>
        <input ref={inputFile} type="file" accept=".xlsx,.xls" onChange={scegliFile} style={{ display: 'none' }} />
        <button type="button" className="btn-accent-inline albatros-bottone" disabled={inCorso} onClick={() => inputFile.current?.click()}>Scegli il file…</button>
      </div>

      {a && (
        <div style={{ marginTop: '14px', padding: '12px 14px', border: '1px solid #e2e8f0', borderRadius: '8px', background: '#f8fafc', fontSize: '0.88rem' }}>
          <div><strong>{a.nome}</strong>{a.estratto.conto ? ` · conto ${a.estratto.conto}` : ''}</div>
          <div style={{ marginTop: '4px' }}>
            Dal {formattaDataGGMMAAAA(a.estratto.dal)} al {formattaDataGGMMAAAA(a.estratto.al)} · saldo iniziale {euro(a.estratto.saldoIniziale)} · saldo finale {euro(a.estratto.saldoFinale)}
            {saldoAllInizio(a.estratto) != null && <> · saldo al 30/09/2026 {euro(saldoAllInizio(a.estratto))}</>}
          </div>
          <div style={{ marginTop: '4px' }}>
            {a.delPeriodo.length} movimenti dal {formattaDataGGMMAAAA(DATA_INIZIO_BANCA)}: <strong>{a.nuove.length} nuovi</strong>, {a.delPeriodo.length - a.nuove.length} già caricati.
            {fuori > 0 && <> {fuori} prima del {formattaDataGGMMAAAA(DATA_INIZIO_BANCA)}, lasciati fuori.</>}
            {a.estratto.nonContabilizzati > 0 && <> Fra questi {a.estratto.nonContabilizzati} non ancora contabilizzati: entrano come gli altri, segnati NC, e diventano definitivi quando un prossimo file li contabilizza.</>}
          </div>
          {(altroConto || nonTorna) && (
            <div className="albatros-avviso" style={{ marginTop: '8px' }}>
              <strong>Import bloccato</strong>:
              {altroConto && <div style={{ marginTop: '4px' }}>non è il conto di Albatros caricato finora ({ultimoConto}).</div>}
              {nonTorna && <div style={{ marginTop: '4px' }}>il file non torna con se stesso (saldo iniziale + movimenti − saldo finale = {euro(a.estratto.differenzaFile)}).</div>}
            </div>
          )}
          <div style={{ display: 'flex', gap: '10px', marginTop: '10px', justifyContent: 'flex-end' }}>
            <button type="button" className="btn-outline-annulla albatros-bottone" onClick={() => setAnteprima(null)}>{altroConto || nonTorna ? 'Chiudi' : 'Annulla'}</button>
            <button type="button" className="btn-accent-inline albatros-bottone" disabled={inCorso || altroConto || nonTorna} onClick={importa}>
              {inCorso ? 'Importazione…' : a.nuove.length ? `Importa ${a.nuove.length} movimenti` : 'Registra il caricamento'}
            </button>
          </div>
        </div>
      )}

      {esito && (
        <div className="albatros-nota" style={{ marginTop: '12px', fontSize: '0.88rem', color: '#166534', display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          <span>
            {esito.movimentiNuovi} movimenti nuovi.{' '}{esito.contabilizzate > 0 && <>{esito.contabilizzate} operazioni NC ora contabilizzate. </>}
            {esito.nuove + esito.collegate + esito.oneri + esito.prelievi === 0
              ? 'Nessuna spesa da creare.'
              : <>Spese create: <strong>{esito.nuove}</strong>{esito.daCompletare > 0 && <> (<strong>{esito.daCompletare}</strong> da completare)</>} · collegate a spese scritte a mano: {esito.collegate} · commissioni sommate ai bonifici: {esito.oneri}{esito.prelievi > 0 && <> · prelievi: {esito.prelievi}</>}.</>}
          </span>
          <button type="button" className="albatros-chip" style={{ padding: '2px 10px' }} onClick={() => setEsito(null)}>Ok</button>
        </div>
      )}
    </div>
  );
}

export default CaricaEstrattoAlbatros
