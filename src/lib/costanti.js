// --- CONFIGURAZIONI INTERNE DEL MODULO PREVENTIVATORE ---
export const COSTO_AL_KM = 1.20; // Valore di fallback se una sede non ha un €/km configurato
export const MOLTIPLICATORE_TARGET = 1.35;
// Validità dichiarata sul documento di offerta: oltre questa soglia un preventivo non ancora
// confermato viene considerato scaduto (stato derivato, non salvato a database).
export const GIORNI_VALIDITA_PREVENTIVO = 10;

// --- PROVINCE ITALIANE ---
// Le province si scrivono sempre con la sigla (è il formato che vuole la fattura elettronica e che
// si aspetta il gestionale). Qui la tabella nome -> sigla serve a convertire quello che arriva dalla
// ricerca indirizzo, che restituisce il nome per esteso.
export const SIGLE_PROVINCE = {
  'Agrigento': 'AG', 'Alessandria': 'AL', 'Ancona': 'AN', 'Aosta': 'AO', 'Arezzo': 'AR',
  'Ascoli Piceno': 'AP', 'Asti': 'AT', 'Avellino': 'AV', 'Bari': 'BA', 'Barletta-Andria-Trani': 'BT',
  'Belluno': 'BL', 'Benevento': 'BN', 'Bergamo': 'BG', 'Biella': 'BI', 'Bologna': 'BO',
  'Bolzano': 'BZ', 'Brescia': 'BS', 'Brindisi': 'BR', 'Cagliari': 'CA', 'Caltanissetta': 'CL',
  'Campobasso': 'CB', 'Caserta': 'CE', 'Catania': 'CT', 'Catanzaro': 'CZ', 'Chieti': 'CH',
  'Como': 'CO', 'Cosenza': 'CS', 'Cremona': 'CR', 'Crotone': 'KR', 'Cuneo': 'CN',
  'Enna': 'EN', 'Fermo': 'FM', 'Ferrara': 'FE', 'Firenze': 'FI', 'Foggia': 'FG',
  'Forlì-Cesena': 'FC', 'Frosinone': 'FR', 'Genova': 'GE', 'Gorizia': 'GO', 'Grosseto': 'GR',
  'Imperia': 'IM', 'Isernia': 'IS', 'La Spezia': 'SP', "L'Aquila": 'AQ', 'Latina': 'LT',
  'Lecce': 'LE', 'Lecco': 'LC', 'Livorno': 'LI', 'Lodi': 'LO', 'Lucca': 'LU',
  'Macerata': 'MC', 'Mantova': 'MN', 'Massa-Carrara': 'MS', 'Matera': 'MT', 'Messina': 'ME',
  'Milano': 'MI', 'Modena': 'MO', 'Monza e della Brianza': 'MB', 'Napoli': 'NA', 'Novara': 'NO',
  'Nuoro': 'NU', 'Oristano': 'OR', 'Padova': 'PD', 'Palermo': 'PA', 'Parma': 'PR',
  'Pavia': 'PV', 'Perugia': 'PG', 'Pesaro e Urbino': 'PU', 'Pescara': 'PE', 'Piacenza': 'PC',
  'Pisa': 'PI', 'Pistoia': 'PT', 'Pordenone': 'PN', 'Potenza': 'PZ', 'Prato': 'PO',
  'Ragusa': 'RG', 'Ravenna': 'RA', 'Reggio Calabria': 'RC', 'Reggio Emilia': 'RE', 'Rieti': 'RI',
  'Rimini': 'RN', 'Roma': 'RM', 'Rovigo': 'RO', 'Salerno': 'SA', 'Sassari': 'SS',
  'Savona': 'SV', 'Siena': 'SI', 'Siracusa': 'SR', 'Sondrio': 'SO', 'Sud Sardegna': 'SU',
  'Taranto': 'TA', 'Teramo': 'TE', 'Terni': 'TR', 'Torino': 'TO', 'Trapani': 'TP',
  'Trento': 'TN', 'Treviso': 'TV', 'Trieste': 'TS', 'Udine': 'UD', 'Varese': 'VA',
  'Venezia': 'VE', 'Verbano-Cusio-Ossola': 'VB', 'Vercelli': 'VC', 'Verona': 'VR', 'Vibo Valentia': 'VV',
  'Vicenza': 'VI', 'Viterbo': 'VT',
  // Varianti in cui la stessa provincia si presenta a seconda della fonte
  "Reggio nell'Emilia": 'RE', 'Reggio di Calabria': 'RC', 'Monza e Brianza': 'MB',
  "Valle d'Aosta": 'AO', 'Bolzano/Bozen': 'BZ', 'Alto Adige': 'BZ', 'Roma Capitale': 'RM',
};

// --- STATO DI APPARTENENZA DEL CLIENTE (fatturazione) ---
// Un cliente privato non straniero è sempre italiano: questo valore finisce in "fattStato".
export const STATO_ITALIA = 'Italia';

// Codici ISO 3166-1 alpha-2 di tutti gli stati esteri (l'Italia sta a parte, sopra). I nomi non
// sono scritti a mano ma ricavati dai codici, così l'elenco resta in italiano e non va mantenuto.
const CODICI_STATI_ESTERI = 'AD,AE,AF,AG,AI,AL,AM,AO,AR,AS,AT,AU,AW,AX,AZ,BA,BB,BD,BE,BF,BG,BH,BI,BJ,BL,BM,BN,BO,BQ,BR,BS,BT,BW,BY,BZ,CA,CC,CD,CF,CG,CH,CI,CK,CL,CM,CN,CO,CR,CU,CV,CW,CX,CY,CZ,DE,DJ,DK,DM,DO,DZ,EC,EE,EG,EH,ER,ES,ET,FI,FJ,FK,FM,FO,FR,GA,GB,GD,GE,GF,GG,GH,GI,GL,GM,GN,GP,GQ,GR,GT,GU,GW,GY,HK,HN,HR,HT,HU,ID,IE,IL,IM,IN,IO,IQ,IR,IS,JE,JM,JO,JP,KE,KG,KH,KI,KM,KN,KP,KR,KW,KY,KZ,LA,LB,LC,LI,LK,LR,LS,LT,LU,LV,LY,MA,MC,MD,ME,MF,MG,MH,MK,ML,MM,MN,MO,MP,MQ,MR,MS,MT,MU,MV,MW,MX,MY,MZ,NA,NC,NE,NF,NG,NI,NL,NO,NP,NR,NU,NZ,OM,PA,PE,PF,PG,PH,PK,PL,PM,PN,PR,PS,PT,PW,PY,QA,RE,RO,RS,RU,RW,SA,SB,SC,SD,SE,SG,SH,SI,SJ,SK,SL,SM,SN,SO,SR,SS,ST,SV,SX,SY,SZ,TC,TD,TG,TH,TJ,TK,TL,TM,TN,TO,TR,TT,TV,TW,TZ,UA,UG,US,UY,UZ,VA,VC,VE,VG,VI,VN,VU,WF,WS,YE,YT,ZA,ZM,ZW'.split(',');

export const STATI_ESTERI = (() => {
  let nomeDi = (codice) => codice;
  try {
    const nomi = new Intl.DisplayNames(['it'], { type: 'region' });
    nomeDi = (codice) => nomi.of(codice) || codice;
  } catch {
    // Browser senza Intl.DisplayNames: nell'elenco restano i codici, meglio di un elenco vuoto.
  }
  return CODICI_STATI_ESTERI.map(nomeDi).sort((a, b) => a.localeCompare(b, 'it'));
})();
