import { suggerimentoEmail } from '../lib/email'

// Sotto un campo email: "Intendevi mario@gmail.com?", e un clic corregge. Non blocca il
// salvataggio, perché un dominio che non conosciamo può essere giusto.
function SuggerimentoEmail({ email, onCorreggi }) {
  const proposta = suggerimentoEmail(email)
  if (!proposta) return null
  return (
    <span style={{ marginTop: '4px', fontSize: '0.8rem', fontWeight: 400, color: '#92400e' }}>
      Intendevi{' '}
      <button type="button" onClick={() => onCorreggi(proposta)}
        style={{ padding: 0, border: 'none', background: 'none', color: '#b45309', fontWeight: 600, textDecoration: 'underline', cursor: 'pointer', fontSize: 'inherit' }}>
        {proposta}
      </button>?
    </span>
  )
}

export default SuggerimentoEmail
