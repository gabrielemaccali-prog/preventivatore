import { createClient } from '@supabase/supabase-js';

// --- CONFIGURAZIONE SUPABASE (condivisa tra tutti i moduli) ---
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseKey);

// Supabase tronca ogni risposta al limite "Max rows" del progetto (di default 1000 righe) e non
// segnala nulla: una select su una tabella più grande restituisce un risultato parziale che sembra
// completo. Per le tabelle che possono superarlo si legge a pagine finché non arriva una pagina vuota.
//
// `creaQuery` deve essere una FUNZIONE che costruisce la query da capo a ogni chiamata: i query
// builder di supabase-js si consumano una volta sola e non sono riutilizzabili.
// La query deve avere un .order() stabile (di norma sulla chiave primaria), altrimenti l'ordine fra
// una pagina e l'altra non è garantito e si rischia di saltare o ripetere righe.
//
// L'avanzamento usa le righe effettivamente ricevute, non la dimensione richiesta: così funziona
// anche se il limite del progetto è più basso di `dimensionePagina`.
export async function leggiTutte(creaQuery, dimensionePagina = 1000) {
  const righe = [];
  // Limite di sicurezza: evita un ciclo infinito se il server continuasse a restituire righe.
  for (let pagina = 0; pagina < 200; pagina++) {
    const { data, error } = await creaQuery().range(righe.length, righe.length + dimensionePagina - 1);
    if (error) return { data: null, error };
    if (!data || data.length === 0) return { data: righe, error: null };
    righe.push(...data);
  }
  return { data: righe, error: null };
}
