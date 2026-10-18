// ============================================================
// Maiuscole, email, telefoni e codici dei dati già salvati, con le stesse regole che da ora
// valgono negli inserimenti (maiuscole.js). Si esegue una volta sola:
//   npm run sistema:anagrafiche              prova senza scrivere, prepara l'anteprima
//   npm run sistema:anagrafiche -- --scrivi  scrive davvero
//
// L'anteprima è anteprima_anagrafiche.xlsx nella radice del progetto: un foglio con ogni
// modifica (tabella, record, campo, prima, dopo) e uno con le email dal dominio sospetto, che
// non si toccano da sole perché lì serve un occhio umano. Il file contiene dati dei clienti:
// non va committato, e conviene cancellarlo finito il lavoro.
//
// Si scrivono solo i campi che cambiano, record per record. Le credenziali sono quelle dell'app:
// VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY, dall'ambiente oppure da .env.local.
// ============================================================
import fs from 'fs';
import * as XLSX from 'xlsx';
import { createClient } from '@supabase/supabase-js';
import { formaNome, formaLuogo, formaRagioneSociale, formaEmail, formaCodice, formaTelefono } from './maiuscole.js';
import { suggerimentoEmail } from './email.js';

const scrivi = process.argv.includes('--scrivi');

const daFile = () => {
  try {
    return Object.fromEntries(fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)
      .filter(r => r.includes('=') && !r.trimStart().startsWith('#'))
      .map(r => [r.slice(0, r.indexOf('=')).trim(), r.slice(r.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')]));
  } catch { return {}; }
};
const env = { ...daFile(), ...process.env };
if (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_ANON_KEY) {
  console.error('Mancano VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY: mettile in .env.local o nell\'ambiente.');
  process.exit(1);
}
const db = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);

// Per ogni tabella: la chiave e la regola di ogni campo, le stesse dei salvataggi nei moduli.
const TABELLE = [
  { tabella: 'preventivi', chiave: 'codice', etichetta: r => r.nomeReferente, campi: {
    nomeReferente: formaNome, emailReferente: formaEmail, telefonoReferente: formaTelefono,
  } },
  { tabella: 'voucher', chiave: 'codice', etichetta: r => r.nominativo, campi: {
    nominativo: formaNome, email: formaEmail, telefono: formaTelefono,
    fattNome: formaNome, fattCognome: formaNome, fattIndirizzo: formaLuogo, fattCitta: formaLuogo, fattCF: formaCodice,
  } },
  { tabella: 'prenotazioni', chiave: 'id', etichetta: r => r.nominativo, campi: {
    nominativo: formaNome, email: formaEmail, telefono: formaTelefono,
    locationNome: formaRagioneSociale, locationIndirizzo: formaLuogo, locationCitta: formaLuogo,
    fattNome: formaNome, fattCognome: formaNome, fattIndirizzo: formaLuogo, fattCitta: formaLuogo, fattCF: formaCodice,
    ragioneSociale: formaRagioneSociale, aziIndirizzo: formaLuogo, aziCitta: formaLuogo,
    pIva: formaCodice, cfAzienda: formaCodice, sdi: formaCodice,
  } },
  { tabella: 'pagamenti', chiave: 'id', etichetta: r => `${r.tipo} ${r.riferimento}`, campi: {
    nominativo: formaNome,
  } },
];
const CAMPI_EMAIL = new Set(['email', 'emailReferente']);

// Lettura a pagine: Supabase tronca le risposte oltre il limite del progetto senza dirlo.
const leggiTutte = async (tabella, chiave) => {
  const righe = [];
  for (let pagina = 0; pagina < 200; pagina++) {
    const { data, error } = await db.from(tabella).select('*').order(chiave).range(righe.length, righe.length + 999);
    if (error) throw new Error(`Non riesco a leggere ${tabella}: ${error.message}`);
    if (!data || data.length === 0) return righe;
    righe.push(...data);
  }
  return righe;
};

const modifiche = [];
const sospette = [];
const daScrivere = [];

for (const { tabella, chiave, etichetta, campi } of TABELLE) {
  const righe = await leggiTutte(tabella, chiave);
  let cambiate = 0;
  for (const r of righe) {
    const nuovi = {};
    for (const [campo, regola] of Object.entries(campi)) {
      if (!(campo in r) || r[campo] == null || typeof r[campo] !== 'string') continue;
      const dopo = regola(r[campo]);
      if (dopo !== r[campo]) {
        nuovi[campo] = dopo;
        modifiche.push({ Tabella: tabella, Record: r[chiave], Cliente: etichetta(r) || '', Campo: campo, Prima: r[campo], Dopo: dopo });
      }
      if (CAMPI_EMAIL.has(campo)) {
        const proposta = suggerimentoEmail(dopo);
        if (proposta) sospette.push({ Tabella: tabella, Record: r[chiave], Cliente: etichetta(r) || '', Email: dopo, 'Forse intendeva': proposta });
      }
    }
    if (Object.keys(nuovi).length) { cambiate++; daScrivere.push({ tabella, chiave, id: r[chiave], nuovi }); }
  }
  console.log(`${tabella}: ${righe.length} record, ${cambiate} da sistemare.`);
}

const libro = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(libro, XLSX.utils.json_to_sheet(modifiche.length ? modifiche : [{ Nota: 'Nessuna modifica' }]), 'Modifiche');
XLSX.utils.book_append_sheet(libro, XLSX.utils.json_to_sheet(sospette.length ? sospette : [{ Nota: 'Nessuna email sospetta' }]), 'Email sospette');
XLSX.writeFile(libro, 'anteprima_anagrafiche.xlsx');
console.log(`\n${modifiche.length} campi da cambiare in ${daScrivere.length} record, ${sospette.length} email sospette (non si toccano).`);
console.log('Anteprima: anteprima_anagrafiche.xlsx');

if (!scrivi) {
  console.log('\nNon ho scritto nulla. Controllata l\'anteprima: npm run sistema:anagrafiche -- --scrivi');
  process.exit(0);
}

let scritti = 0;
const errori = [];
for (const { tabella, chiave, id, nuovi } of daScrivere) {
  // Il select dice se la riga è stata davvero aggiornata: se i permessi la escludono, Supabase
  // non dà errore ma non scrive nulla.
  const { data, error } = await db.from(tabella).update(nuovi).eq(chiave, id).select(chiave);
  if (error) errori.push(`${tabella} ${id}: ${error.message}`);
  else if (!data || data.length === 0) errori.push(`${tabella} ${id}: nessuna riga aggiornata (permessi?)`);
  else scritti++;
}
console.log(`\nScritti ${scritti} record su ${daScrivere.length}.`);
if (errori.length) { console.error(`${errori.length} errori:\n  ${errori.join('\n  ')}`); process.exit(1); }
