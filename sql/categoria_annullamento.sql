-- ============================================================
-- La categoria di un annullamento, per prenotazioni e preventivi.
-- Da eseguire nell'SQL Editor di Supabase, PRIMA di pubblicare il codice che la usa.
--
-- Finora annullando si scriveva solo un motivo a mano, e motivi scritti a mano non si contano:
-- "meteo", "Meteo." e "pioveva" sono tre righe diverse. Adesso si sceglie una categoria da un
-- elenco fisso (src/lib/costanti.js, CATEGORIE_ANNULLAMENTO) e il testo resta come nota.
--
--   "categoriaAnnullamento"  una delle chiavi dell'elenco, null se la riga non e' annullata
--   "motivoAnnullamento"     la colonna che c'era: ora e' la nota, facoltativa
--
-- Nessun vincolo sui valori: le categorie stanno nel codice, e aggiungerne una non deve chiedere
-- una migrazione. Una chiave sconosciuta si vede a schermo come "Non classificato".
--
-- Additiva e nullable. In fondo la classificazione dei 184 annullamenti esistenti al 18/10/2026,
-- fatta leggendo i loro motivi uno per uno. Tocca solo righe ancora annullate e senza categoria:
-- rieseguirla non sovrascrive niente.
--
-- Restano fuori di proposito PRV-2026-1166 e PRV-2026-1167: non sono preventivi persi ma noleggi
-- confermati, gestiti nel vecchio calendario perche' pagati in contanti. Vanno registrati come
-- prenotazioni, non classificati.
-- ============================================================

begin;
set local lock_timeout = '3s';

alter table prenotazioni add column if not exists "categoriaAnnullamento" text;
alter table preventivi add column if not exists "categoriaAnnullamento" text;

update preventivi p set "categoriaAnnullamento" = c.categoria
from (values
  ('PRV-2026-1186', 'nessuna_risposta'),
  ('PRV-2026-1176', 'nessuna_risposta'),
  ('PRV-2026-1175', 'nessuna_risposta'),
  ('PRV-2026-1158', 'nessuna_risposta'),
  ('PRV-2026-1146', 'nessuna_risposta'),
  ('PRV-2026-1143', 'nessuna_risposta'),
  ('PRV-2026-1141', 'nessuna_risposta'),
  ('PRV-2026-1140', 'nessuna_risposta'),
  ('PRV-2026-1139', 'nessuna_risposta'),
  ('PRV-2026-1137', 'nessuna_risposta'),
  ('PRV-2026-1134', 'nessuna_risposta'),
  ('PRV-2026-1132', 'nessuna_risposta'),
  ('PRV-2026-1130', 'nessuna_risposta'),
  ('PRV-2026-1127', 'nessuna_risposta'),
  ('PRV-2026-1126', 'nessuna_risposta'),
  ('PRV-2026-1123', 'nessuna_risposta'),
  ('PRV-2026-1122', 'nessuna_risposta'),
  ('PRV-2026-1121', 'nessuna_risposta'),
  ('PRV-2026-1120', 'nessuna_risposta'),
  ('PRV-2026-1119', 'nessuna_risposta'),
  ('PRV-2026-1115', 'nessuna_risposta'),
  ('PRV-2026-1116', 'nessuna_risposta'),
  ('PRV-2026-1112', 'nessuna_risposta'),
  ('PRV-2026-1110', 'nessuna_risposta'),
  ('PRV-2026-1111', 'nessuna_risposta'),
  ('PRV-2026-1105', 'nessuna_risposta'),
  ('PRV-2026-1107', 'nessuna_risposta'),
  ('PRV-2026-1101', 'nessuna_risposta'),
  ('PRV-2026-1102', 'nessuna_risposta'),
  ('PRV-2026-1103', 'nessuna_risposta'),
  ('PRV-2026-1096', 'nessuna_risposta'),
  ('PRV-2026-1100', 'nessuna_risposta'),
  ('PRV-2026-1099', 'nessuna_risposta'),
  ('PRV-2026-1095', 'nessuna_risposta'),
  ('PRV-2026-1091', 'nessuna_risposta'),
  ('PRV-2026-1092', 'nessuna_risposta'),
  ('PRV-2026-1088', 'nessuna_risposta'),
  ('PRV-2026-1087', 'nessuna_risposta'),
  ('PRV-2026-1085', 'nessuna_risposta'),
  ('PRV-2026-1084', 'nessuna_risposta'),
  ('PRV-2026-1082', 'nessuna_risposta'),
  ('PRV-2026-1081', 'nessuna_risposta'),
  ('PRV-2026-1078', 'nessuna_risposta'),
  ('PRV-2026-1077', 'nessuna_risposta'),
  ('PRV-2026-1079', 'nessuna_risposta'),
  ('PRV-2026-1076', 'nessuna_risposta'),
  ('PRV-2026-1074', 'nessuna_risposta'),
  ('PRV-2026-1075', 'nessuna_risposta'),
  ('PRV-2026-1068', 'nessuna_risposta'),
  ('PRV-2026-1069', 'nessuna_risposta'),
  ('PRV-2026-1070', 'nessuna_risposta'),
  ('PRV-2026-1071', 'nessuna_risposta'),
  ('PRV-2026-1067', 'nessuna_risposta'),
  ('PRV-2026-1066', 'nessuna_risposta'),
  ('PRV-2026-1063', 'nessuna_risposta'),
  ('PRV-2026-1057', 'nessuna_risposta'),
  ('PRV-2026-1060', 'nessuna_risposta'),
  ('PRV-2026-1058', 'nessuna_risposta'),
  ('PRV-2026-1059', 'nessuna_risposta'),
  ('PRV-2026-1056', 'nessuna_risposta'),
  ('PRV-2026-1051', 'nessuna_risposta'),
  ('PRV-2026-1052', 'nessuna_risposta'),
  ('PRV-2026-1053', 'nessuna_risposta'),
  ('PRV-2026-1054', 'nessuna_risposta'),
  ('PRV-2026-1049', 'nessuna_risposta'),
  ('PRV-2026-1045', 'nessuna_risposta'),
  ('PRV-2026-1046', 'nessuna_risposta'),
  ('PRV-2026-1047', 'nessuna_risposta'),
  ('PRV-2026-1044', 'nessuna_risposta'),
  ('PRV-2026-1042', 'nessuna_risposta'),
  ('PRV-2026-1043', 'nessuna_risposta'),
  ('PRV-2026-1040', 'nessuna_risposta'),
  ('PRV-2026-1036', 'nessuna_risposta'),
  ('PRV-2026-1037', 'nessuna_risposta'),
  ('PRV-2026-1029', 'nessuna_risposta'),
  ('PRV-2026-1030', 'nessuna_risposta'),
  ('PRV-2026-1034', 'nessuna_risposta'),
  ('PRV-2026-1026', 'nessuna_risposta'),
  ('PRV-2026-1024', 'nessuna_risposta'),
  ('PRV-2026-1022', 'nessuna_risposta'),
  ('PRV-2026-1019', 'nessuna_risposta'),
  ('PRV-2026-1020', 'nessuna_risposta'),
  ('PRV-2026-1016', 'nessuna_risposta'),
  ('PRV-2026-1017', 'nessuna_risposta'),
  ('PRV-2026-1011', 'nessuna_risposta'),
  ('PRV-2026-1009', 'nessuna_risposta'),
  ('PRV-2026-1008', 'nessuna_risposta'),
  ('PRV-2026-1153', 'nessuna_risposta'),
  ('PRV-2026-1144', 'nessuna_risposta'),
  ('PRV-2026-1190', 'prezzo'),
  ('PRV-2026-1189', 'prezzo'),
  ('PRV-2026-1173', 'prezzo'),
  ('PRV-2026-1165', 'prezzo'),
  ('PRV-2026-1149', 'prezzo'),
  ('PRV-2026-1142', 'prezzo'),
  ('PRV-2026-1129', 'prezzo'),
  ('PRV-2026-1109', 'prezzo'),
  ('PRV-2026-1108', 'prezzo'),
  ('PRV-2026-1104', 'prezzo'),
  ('PRV-2026-1098', 'prezzo'),
  ('PRV-2026-1093', 'prezzo'),
  ('PRV-2026-1083', 'prezzo'),
  ('PRV-2026-1080', 'prezzo'),
  ('PRV-2026-1073', 'prezzo'),
  ('PRV-2026-1039', 'prezzo'),
  ('PRV-2026-1027', 'prezzo'),
  ('PRV-2026-1021', 'prezzo'),
  ('PRV-2026-1171', 'prezzo'),
  ('PRV-2026-1161', 'prezzo'),
  ('PRV-2026-1169', 'evento_annullato'),
  ('PRV-2026-1168', 'evento_annullato'),
  ('PRV-2026-1163', 'evento_annullato'),
  ('PRV-2026-1159', 'evento_annullato'),
  ('PRV-2026-1151', 'evento_annullato'),
  ('PRV-2026-1150', 'evento_annullato'),
  ('PRV-2026-1138', 'evento_annullato'),
  ('PRV-2026-1128', 'evento_annullato'),
  ('PRV-2026-1118', 'evento_annullato'),
  ('PRV-2026-1106', 'evento_annullato'),
  ('PRV-2026-1089', 'evento_annullato'),
  ('PRV-2026-1065', 'evento_annullato'),
  ('PRV-2026-1061', 'evento_annullato'),
  ('PRV-2026-1050', 'evento_annullato'),
  ('PRV-2026-1048', 'evento_annullato'),
  ('PRV-2026-1031', 'evento_annullato'),
  ('PRV-2026-1188', 'evento_annullato'),
  ('PRV-2026-1185', 'alternativa'),
  ('PRV-2026-1174', 'alternativa'),
  ('PRV-2026-1172', 'alternativa'),
  ('PRV-2026-1162', 'alternativa'),
  ('PRV-2026-1154', 'alternativa'),
  ('PRV-2026-1097', 'alternativa'),
  ('PRV-2026-1064', 'alternativa'),
  ('PRV-2026-1025', 'alternativa'),
  ('PRV-2026-1181', 'non_valida'),
  ('PRV-2026-1133', 'non_valida'),
  ('PRV-2026-1010', 'non_valida'),
  ('PRV-2026-1055', 'non_valida'),
  ('PRV-2026-1023', 'non_valida'),
  ('PRV-2026-1147', 'non_valida'),
  ('PRV-2026-1145', 'non_valida'),
  ('PRV-2026-1125', 'non_valida'),
  ('PRV-2026-1124', 'non_valida'),
  ('PRV-2026-1155', 'altra_formula'),
  ('PRV-2026-1038', 'altra_formula'),
  ('PRV-2026-1177', 'ripensamento'),
  ('PRV-2026-1160', 'ripensamento'),
  ('PRV-2026-1156', 'ripensamento'),
  ('PRV-2026-1148', 'ripensamento'),
  ('PRV-2026-1113', 'ripensamento'),
  ('PRV-2026-1072', 'ripensamento'),
  ('PRV-2026-1041', 'ripensamento')
) as c(codice, categoria)
where p.codice::text = c.codice and p.stato = 'Annullato' and p."categoriaAnnullamento" is null;

update prenotazioni p set "categoriaAnnullamento" = c.categoria
from (values
  ('PRN-2026-1022', 'nessuna_risposta'),
  ('PRN-2026-1104', 'nessuna_risposta'),
  ('PRN-2026-1122', 'nessuna_risposta'),
  ('PRN-2026-1087', 'nessuna_risposta'),
  ('PRN-2026-1037', 'nessuna_risposta'),
  ('PRN-2026-1018', 'nessuna_risposta'),
  ('PRN-2026-1024', 'nessuna_risposta'),
  ('PRN-2026-1096', 'evento_annullato'),
  ('PRN-2026-1052', 'evento_annullato'),
  ('PRN-2026-1040', 'evento_annullato'),
  ('PRN-2026-1075', 'evento_annullato'),
  ('PRN-2026-1112', 'alternativa'),
  ('PRN-2026-1135', 'partecipanti'),
  ('PRN-2026-1076', 'partecipanti'),
  ('PRN-2026-1057', 'partecipanti'),
  ('PRN-2026-1079', 'partecipanti'),
  ('PRN-2026-1109', 'non_disponibile'),
  ('PRN-2026-1063', 'non_valida'),
  ('PRN-2026-1121', 'non_valida'),
  ('PRN-2026-1039', 'non_valida'),
  ('PRN-2026-1084', 'ripensamento'),
  ('PRN-2026-1082', 'ripensamento'),
  ('PRN-2026-1050', 'ripensamento'),
  ('PRN-2026-1072', 'ripensamento'),
  ('PRN-2026-1034', 'ripensamento'),
  ('PRN-2026-1035', 'ripensamento'),
  ('PRN-2026-1053', 'ripensamento'),
  ('PRN-2026-1036', 'ripensamento'),
  ('PRN-2026-1117', 'altro'),
  ('PRN-2026-1051', 'altro')
) as c(id, categoria)
where p.id::text = c.id and p.stato in ('ANNULLATA', 'POSTICIPATA') and p."categoriaAnnullamento" is null;

commit;

-- Controllo: quanti annullamenti per categoria. Le righe con categoria vuota sono annullamenti
-- fatti dopo l'export del 18/10, o i due noleggi qui sopra: si classificano dall'app, con la
-- matita sulla riga annullata.
select 'preventivi' as tabella, "categoriaAnnullamento", count(*) from preventivi where stato = 'Annullato' group by 2
union all
select 'prenotazioni', "categoriaAnnullamento", count(*) from prenotazioni where stato in ('ANNULLATA', 'POSTICIPATA') group by 2
order by 1, 3 desc;
