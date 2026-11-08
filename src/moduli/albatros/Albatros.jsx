import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { puoVedere } from '../../lib/permessi'
import Giornata from './Giornata'
import StoricoChiusure from './StoricoChiusure'
import Spese from './Spese'
import Listino from './Listino'
import Configuratore from './Configuratore'
import Cashflow from './Cashflow'
import Incassi from './Incassi'
import Missioni from './Missioni'
import { giornataDiLavoro } from './calcolo'
import { SCHEDE_ALBATROS } from './schede'

// ============================================================
// Albatros: la cassa del centro sportivo (due campi da calcetto e un bar).
// Nella Giornata si toccano le voci del listino e a fine serata si chiude la cassa; Chiusure è
// l'elenco delle giornate. Il listino nasce dalle voci scritte; le spese stanno a parte.
// L'amministratore corregge e riapre; i ragazzi aggiungono.
// Albatros è un mondo a sé: le sue schede sono le voci del menu laterale, e la scheda aperta la
// sceglie App.jsx (scheda / onScheda).
// ============================================================


function Albatros({ user, scheda, onScheda, onMissioniCambiate }) {
  const setScheda = onScheda;
  // La giornata aperta nella scheda Giornata: la sceglie anche l'elenco delle chiusure.
  const [giorno, setGiorno] = useState(giornataDiLavoro);
  // Vero quando la Giornata si apre da una riga dell'elenco delle chiusure: allora resta su quella.
  const apertaDallElenco = useRef(false);
  const [listino, setListino] = useState([]);
  const [categorie, setCategorie] = useState([]);
  const [utenti, setUtenti] = useState({});
  // Finché sql/albatros.sql non è stato eseguito le tabelle non esistono: senza avviso la pagina
  // sembrerebbe solo vuota.
  const [schemaMancante, setSchemaMancante] = useState(null);
  const [categorieMancanti, setCategorieMancanti] = useState(null);

  const ricaricaListino = async () => {
    const { data, error } = await supabase.from('albatros_listino').select('*').order('nome');
    setSchemaMancante(error ? error.message : null);
    setListino(data || []);
    return data || [];
  };

  // Le categorie di listino e spese, decise dal Configuratore.
  const ricaricaCategorie = async () => {
    const { data, error } = await supabase.from('albatros_categorie').select('*').order('ordine').order('nome');
    setCategorieMancanti(error ? error.message : null);
    setCategorie(data || []);
  };

  useEffect(() => {
    ricaricaListino();
    ricaricaCategorie();
    supabase.from('utenti').select('id, nome, cognome, username').then(({ data }) => {
      const mappa = {};
      (data || []).forEach(u => { mappa[u.id] = [u.nome, u.cognome].filter(Boolean).join(' ') || u.username; });
      setUtenti(mappa);
    });
  }, []);

  const schedeVisibili = SCHEDE_ALBATROS.filter(s => puoVedere(user, 'albatros', s.id));
  const attiva = (schedeVisibili.find(s => s.id === scheda) || schedeVisibili[0])?.id;

  // La Giornata si apre sull'ultima giornata non chiusa: se l'ultima giornata lavorata prima di oggi
  // è rimasta aperta (chi chiude la mattina dopo, o il giorno dopo) si va lì, altrimenti su oggi.
  // Non quando la si apre toccando una giornata nell'elenco delle chiusure.
  useEffect(() => {
    if (attiva !== 'chiusure') return;
    if (apertaDallElenco.current) { apertaDallElenco.current = false; return; }
    const oggi = giornataDiLavoro();
    supabase.from('albatros_chiusure').select('data, chiusa_il').lt('data', oggi)
      .order('data', { ascending: false }).limit(1).maybeSingle()
      .then(({ data: ultima }) => setGiorno(ultima && !ultima.chiusa_il ? ultima.data : oggi));
  }, [attiva]);

  if (schedeVisibili.length === 0) return null;
  const puoCorreggere = !!user.isAdmin;
  const comuni = { user, listino, ricaricaListino, categorie, ricaricaCategorie, utenti, puoCorreggere };

  return (
    <>
      {schemaMancante && (
        <p className="albatros-avviso">
          Le tabelle di Albatros non esistono ancora: esegui <strong>sql/albatros.sql</strong> nell'SQL Editor di Supabase. ({schemaMancante})
        </p>
      )}

      {!schemaMancante && categorieMancanti && (
        <p className="albatros-avviso">
          Manca la tabella delle categorie: esegui <strong>sql/albatros_categorie.sql</strong> nell'SQL Editor di Supabase. ({categorieMancanti})
        </p>
      )}

      {!schemaMancante && !categorieMancanti && (
        <>
          {attiva === 'chiusure' && <Giornata {...comuni} data={giorno} setData={setGiorno} />}
          {attiva === 'storico' && <StoricoChiusure {...comuni} onApri={(d) => { apertaDallElenco.current = true; setGiorno(d); setScheda('chiusure'); }} />}
          {attiva === 'spese' && <Spese {...comuni} />}
          {attiva === 'listino' && <Listino {...comuni} />}
          {attiva === 'configuratore' && <Configuratore {...comuni} />}
          {attiva === 'cashflow' && <Cashflow {...comuni} />}
          {attiva === 'incassi' && <Incassi {...comuni} />}
          {attiva === 'missioni' && <Missioni {...comuni} onCambiate={onMissioniCambiate} />}
        </>
      )}
    </>
  );
}

export default Albatros
