import { createClient } from '@supabase/supabase-js';

// --- CONFIGURAZIONE SUPABASE (condivisa tra tutti i moduli) ---
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseKey);
