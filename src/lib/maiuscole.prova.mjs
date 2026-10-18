// Banco di prova delle maiuscole nei campi anagrafici. Non fa parte dell'app: si esegue con
//   npm run prova:maiuscole
// Gira in Node senza dev server né browser, perché maiuscole.js è fatto di sole funzioni pure.
import { formaNome, formaLuogo, formaRagioneSociale, formaEmail, formaCodice, formaTelefono } from './maiuscole.js';

const esiti = [];
const verifica = (caso, atteso, ottenuto) => esiti.push({ ok: atteso === ottenuto, caso, atteso, ottenuto });

// ---------- persone ----------
verifica('nome tutto maiuscolo', 'Mario Rossi', formaNome('MARIO ROSSI'));
verifica('nome tutto minuscolo', 'Mario Rossi', formaNome('mario rossi'));
verifica('spazi in eccesso', 'Mario Rossi', formaNome('  mario   rossi '));
verifica('apostrofo', "Gianni D'Angelo", formaNome("GIANNI D'ANGELO"));
verifica('doppio cognome', 'Anna Rossi-Bianchi', formaNome('anna rossi-bianchi'));
verifica('particelle nei cognomi', 'Luigi Di Maio', formaNome('luigi di maio'));
verifica('accenti', 'Niccolò Forlì', formaNome('NICCOLÒ FORLÌ'));
verifica('già misto: non si tocca', 'Ronald McDonald', formaNome('Ronald McDonald'));
verifica('già misto con errori: non si tocca', 'mario Rossi', formaNome('mario Rossi'));
verifica('vuoto', '', formaNome(''));
verifica('null resta null', null, formaNome(null));
verifica('congiunzione fra due nomi', 'Rossi Mario e Bianchi Anna', formaNome('ROSSI MARIO E BIANCHI ANNA'));
verifica('forma societaria nel nominativo', 'Pro Sport ASD', formaNome('pro sport asd'));

// ---------- indirizzi e città ----------
verifica('via con preposizione', 'Via della Repubblica 12/A', formaLuogo('VIA DELLA REPUBBLICA 12/a'));
verifica('articolo con apostrofo', "Via dell'Orto 3", formaLuogo("via dell'orto 3"));
verifica('numero romano', 'Via XX Settembre 5', formaLuogo('via xx settembre 5'));
verifica('primo maggio', 'Piazza I Maggio', formaLuogo('PIAZZA I MAGGIO'));
verifica('lettera del civico staccata', 'Via Belluno 22 A', formaLuogo('via belluno 22 a'));
verifica('senza civico', 'Via Roma SNC', formaLuogo('via roma snc'));
verifica('strada statale', 'SS 36 Km 12', formaLuogo('ss 36 km 12'));
verifica('città composta', 'San Donato Milanese', formaLuogo('SAN DONATO MILANESE'));
verifica('città con apostrofo', "Cassano d'Adda", formaLuogo("CASSANO D'ADDA"));
verifica('città che inizia con apostrofo', "L'Aquila", formaLuogo("l'aquila"));
verifica('preposizione in testa resta maiuscola', 'Della Valle', formaLuogo('della valle'));
verifica('"di" non è un numero romano', 'Via di Vittorio', formaLuogo('via di vittorio'));
verifica('indirizzo da Google: non si tocca', 'Via Roma, 12', formaLuogo('Via Roma, 12'));

// ---------- ragioni sociali ----------
verifica('srl', 'Rossi Eventi SRL', formaRagioneSociale('rossi eventi srl'));
verifica('s.r.l. coi punti', 'Rossi Eventi SRL', formaRagioneSociale('ROSSI EVENTI S.R.L.'));
verifica('congiunzione', 'Rossi e Figli SNC', formaRagioneSociale('ROSSI E FIGLI SNC'));
verifica('associazione', 'ASD Polisportiva San Luigi', formaRagioneSociale('asd polisportiva san luigi'));
verifica('già misto: non si tocca', 'Rossi Eventi S.r.l.', formaRagioneSociale('Rossi Eventi S.r.l.'));

// ---------- email ----------
verifica('email', 'mario.rossi@email.it', formaEmail(' Mario.Rossi@Email.IT '));
verifica('email da copia-incolla', 'mario@email.it', formaEmail('<Mario@Email.it>'));
verifica('email con mailto', 'mario@email.it', formaEmail('mailto:mario@email.it;'));
verifica('email con spazi dentro', 'mario.rossi@email.it', formaEmail('mario.rossi @email.it'));

// ---------- codici ----------
verifica('codice fiscale', 'RSSMRA80A01F205X', formaCodice(' rss mra 80a01 f205x '));
verifica('partita IVA', '01234567890', formaCodice('012 3456 7890'));
verifica('SDI', 'ABC1234', formaCodice('abc1234'));
verifica('codice null resta null', null, formaCodice(null));

// ---------- telefono ----------
verifica('telefono con spazi', '3331234567', formaTelefono('333 123 4567'));
verifica('prefisso internazionale', '+393331234567', formaTelefono('+39 333.123-4567'));
verifica('parentesi e barre', '023456789', formaTelefono('(02) 345/6789'));
verifica('telefono null resta null', null, formaTelefono(null));

const falliti = esiti.filter(e => !e.ok);
for (const e of falliti) console.log(`✗ ${e.caso}: atteso ${JSON.stringify(e.atteso)}, ottenuto ${JSON.stringify(e.ottenuto)}`);
console.log(`${esiti.length - falliti.length}/${esiti.length} prove superate`);
if (falliti.length) process.exit(1);
