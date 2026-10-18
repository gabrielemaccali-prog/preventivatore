import { useState } from 'react'
import { puoVedere } from '../../lib/permessi'
import Icona from '../../components/Icona'
import Giochi from './Giochi'
import Clienti from './Clienti'
import Bubbler from './Bubbler'
import Campi from './Campi'

// ============================================================
// Anagrafiche: le cose a cui gli altri moduli fanno riferimento. I giochi, da cui leggono listino
// e prenotazioni; i clienti, ricostruiti da preventivi, prenotazioni e voucher; i bubbler; i campi.
// L'id del modulo resta 'catalogo': è la chiave già salvata nei permessi dei ruoli.
// ============================================================

const SCHEDE = [
  { id: 'giochi', label: 'Giochi', icona: 'giochi' },
  { id: 'clienti', label: 'Clienti', icona: 'clienti' },
  { id: 'bubbler', label: 'Bubbler', icona: 'compensi' },
  { id: 'campi', label: 'Campi', icona: 'campi' },
];

function Anagrafiche({ user }) {
  const [scheda, setScheda] = useState('giochi');

  const schedeVisibili = SCHEDE.filter(s => puoVedere(user, 'catalogo', s.id));
  if (schedeVisibili.length === 0) return null;
  // Chi non vede la scheda scelta per ultima atterra sulla prima che vede.
  const attiva = (schedeVisibili.find(s => s.id === scheda) || schedeVisibili[0]).id;

  return (
    <>
      <nav className="modulo-subnav no-print subnav-segmented">
        {schedeVisibili.map(s => (
          <button key={s.id} className={`nav-btn ${attiva === s.id ? 'active' : ''}`} onClick={() => setScheda(s.id)}><Icona nome={s.icona} />{s.label}</button>
        ))}
      </nav>
      {attiva === 'giochi' && <Giochi user={user} />}
      {attiva === 'clienti' && <Clienti />}
      {attiva === 'bubbler' && <Bubbler />}
      {attiva === 'campi' && <Campi user={user} />}
    </>
  );
}

export default Anagrafiche
