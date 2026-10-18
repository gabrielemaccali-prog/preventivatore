// Banco di prova dei refusi nelle email. Non fa parte dell'app: si esegue con
//   npm run prova:email
// Gira in Node senza dev server né browser, perché email.js è fatto di sole funzioni pure.
import { suggerimentoEmail } from './email.js';

const esiti = [];
const verifica = (caso, atteso, ottenuto) => esiti.push({ ok: atteso === ottenuto, caso, atteso, ottenuto });

// ---------- refusi da correggere ----------
verifica('lettere scambiate', 'mario@gmail.com', suggerimentoEmail('mario@gmial.com'));
verifica('lettera mancante', 'mario@gmail.com', suggerimentoEmail('mario@gmal.com'));
verifica('finale sbagliato su gmail', 'mario@gmail.com', suggerimentoEmail('mario@gmail.con'));
verifica('gmail.it non esiste', 'mario@gmail.com', suggerimentoEmail('mario@gmail.it'));
verifica('hotmail con refuso', 'mario@hotmail.it', suggerimentoEmail('mario@hotmial.it'));
verifica('libero', 'mario@libero.it', suggerimentoEmail('mario@liberto.it'));
verifica('virgilio', 'mario@virgilio.it', suggerimentoEmail('mario@virgiio.it'));
verifica('yahoo', 'mario@yahoo.com', suggerimentoEmail('mario@yaho.com'));
verifica('maiuscole e spazi', 'mario@gmail.com', suggerimentoEmail(' Mario@GMIAL.com '));
verifica('dominio aziendale con .con', 'info@rossieventi.com', suggerimentoEmail('info@rossieventi.con'));
verifica('dominio aziendale con .ti', 'info@rossieventi.it', suggerimentoEmail('info@rossieventi.ti'));

// ---------- da lasciare stare ----------
verifica('gmail giusto', null, suggerimentoEmail('mario@gmail.com'));
verifica('hotmail.com giusto', null, suggerimentoEmail('mario@hotmail.com'));
verifica('tin.it giusto', null, suggerimentoEmail('mario@tin.it'));
verifica('mail.com è un provider vero', null, suggerimentoEmail('mario@mail.com'));
verifica('hotmail.fr è un provider vero', null, suggerimentoEmail('marie@hotmail.fr'));
verifica('dominio corto aziendale', null, suggerimentoEmail('info@fin.it'));
verifica('dominio aziendale qualsiasi', null, suggerimentoEmail('info@rossieventi.it'));
verifica('email incompleta', null, suggerimentoEmail('mario@gmai'));
verifica('vuota', null, suggerimentoEmail(''));
verifica('null', null, suggerimentoEmail(null));

const falliti = esiti.filter(e => !e.ok);
for (const e of falliti) console.log(`✗ ${e.caso}: atteso ${JSON.stringify(e.atteso)}, ottenuto ${JSON.stringify(e.ottenuto)}`);
console.log(`${esiti.length - falliti.length}/${esiti.length} prove superate`);
if (falliti.length) process.exit(1);
