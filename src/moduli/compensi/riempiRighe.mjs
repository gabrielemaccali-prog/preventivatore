// ============================================================
// Riempimento delle righe per partita dei periodi di compensi gia' chiusi.
// Si esegue una volta sola, dopo sql/compensi_righe_partita.sql:
//   npm run riempi:righe            prova senza scrivere, dice cosa farebbe
//   npm run riempi:righe -- --scrivi  scrive davvero
//
// I periodi chiusi prima che le righe esistessero non hanno la ripartizione per partita. Qui si
// ricostruisce con i parametri congelati dentro ognuno, le partite di quel periodo e le voci di
// quelle date, e le trasferte del documento di rimborso quando c'e'. Non e' la stessa cosa di
// averla congelata allora -- se nel frattempo una voce e' stata toccata, il conto la segue -- ma e'
// il meglio che si puo' dire oggi, e da qui in avanti non si muove piu'.
//
// Le credenziali sono quelle dell'app: VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY, dall'ambiente
// oppure da un file .env.local nella radice del progetto.
// ============================================================
import fs from 'fs';
import { createClient } from '@supabase/supabase-js';
import { preventiviPerOperatore, quotePartite, righeConsuntivo, trasfertePerData } from './calcolo.js';
import { STATO_PREN, generaCompenso } from '../../lib/costanti.js';

const scrivi = process.argv.includes('--scrivi');

const daFile = () => {
  try {
    return Object.fromEntries(fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)
      .filter(r => r.includes('=') && !r.trimStart().startsWith('#'))
      .map(r => [r.slice(0, r.indexOf('=')).trim(), r.slice(r.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')]));
  } catch { return {}; }
};
const env = { ...daFile(), ...process.env };
const url = env.VITE_SUPABASE_URL;
const chiave = env.VITE_SUPABASE_ANON_KEY;
if (!url || !chiave) {
  console.error('Mancano VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY: mettile in .env.local o nell\'ambiente.');
  process.exit(1);
}
const db = createClient(url, chiave);

const [periodi, prenotazioni, voci] = await Promise.all([
  db.from('op_periodi').select('*').order('dal'),
  db.from('prenotazioni').select('*').in('stato', [STATO_PREN.CONFERMATO, STATO_PREN.ANNULLATA]).order('data'),
  db.from('op_voci').select('*'),
]);
for (const [nome, risposta] of [['op_periodi', periodi], ['prenotazioni', prenotazioni], ['op_voci', voci]]) {
  if (risposta.error) {
    console.error(`Non riesco a leggere ${nome}: ${risposta.error.message}`);
    if (risposta.error.message.includes('righe')) console.error('Esegui prima sql/compensi_righe_partita.sql.');
    process.exit(1);
  }
}

const daRiempire = (periodi.data || []).filter(p => (p.righe || []).length === 0);
console.log(`${periodi.data.length} periodi, ${daRiempire.length} senza righe.`);

let scritti = 0;
for (const per of daRiempire) {
  const par = per.parametri;
  if (!par || !par.aliquota_ritenuta) {
    console.log(`  ${per.id} (op ${per.operatore_id}, ${per.dal} → ${per.al}): salto, parametri congelati mancanti.`);
    continue;
  }
  const sue = (prenotazioni.data || []).filter(p => generaCompenso(p)
    && p.data >= per.dal && p.data <= per.al
    && (p.operatori || []).some(o => String(o.id) === String(per.operatore_id)));
  const sueVoci = (voci.data || []).filter(v => String(v.operatore_id) === String(per.operatore_id)
    && v.data >= per.dal && v.data <= per.al);
  // Un periodo appartiene a un operatore solo: gli altri restano fuori dal calcolo.
  const preventivo = preventiviPerOperatore(sue, sueVoci, par,
    (opId) => String(opId) !== String(per.operatore_id))[0];
  if (!preventivo) {
    console.log(`  ${per.id} (op ${per.operatore_id}, ${per.dal} → ${per.al}): nessuna partita, resta vuoto.`);
    continue;
  }
  const righe = righeConsuntivo(quotePartite(preventivo), {
    aliquota: per.rimborso?.aliquota ?? par.aliquota_ritenuta,
    trasfertePerData: trasfertePerData(per.rimborso),
  });
  const somma = (campo) => righe.reduce((s, r) => s + r[campo], 0).toFixed(2);
  console.log(`  ${per.id} (op ${per.operatore_id}, ${per.dal} → ${per.al}): ${righe.length} righe,`
    + ` operatore ${somma('incassaOperatore')} (nel periodo ${((+per.compenso_netto || 0) + (+per.spese || 0)).toFixed(2)}),`
    + ` ritenuta ${somma('ritenuta')} (nel documento ${(+per.rimborso?.ritenuta || 0).toFixed(2)})`);
  if (!scrivi || righe.length === 0) continue;
  const { error } = await db.from('op_periodi').update({ righe }).eq('id', per.id);
  if (error) { console.error(`    errore: ${error.message}`); continue; }
  scritti++;
}

console.log(scrivi
  ? `\nScritti ${scritti} periodi.`
  : '\nProva senza scrivere. Confronta gli importi qui sopra con quelli del periodo: se tornano, rilancia con --scrivi.');
