export const GUARDIES_VERSION = '1.9.3';

export const GUARDIES_RELEASES = [
  {
    version: '1.9.3',
    date: '28 d’octubre de 2026',
    changes: [
      'Correus al professorat més senzills: cada tipus d’avís torna a tenir el seu assumpte i el seu text sencers, en dues columnes, amb un sol botó de prova. Ja no hi ha salutació, comiat ni assumpte comuns.',
      'Quan un professor té més d’un avís el mateix dia, el correu els porta tots i la salutació i el comiat hi surten una sola vegada.',
    ],
  },
  {
    version: '1.9.2',
    date: '28 d’octubre de 2026',
    changes: [
      'Correus al professorat: «Darrers correus» només mostra els previstos (per ordre de sortida) i els enviats.',
    ],
  },
  {
    version: '1.9.1',
    date: '28 d’octubre de 2026',
    changes: [
      'Correus al professorat: el correu surt el mateix dia de l’avís. Els canvis per a avui, al cap de 2 minuts (dies feiners de 8:00 a 15:00); els d’un altre dia, a les 8:00 d’aquell dia.',
      'Si un professor té més d’un avís per al mateix dia, rep un sol correu amb tots, per ordre d’hora.',
      'Interruptor general «Enviament al professorat»: mentre està aturat no s’envia res al professorat (les proves sí) i els avisos surten a «Darrers correus» com a no enviats.',
      'Panell nou: una columna per a cada tipus d’avís, amb la previsualització com un correu; la salutació i el comiat són comuns. Les proves poden anar a una altra adreça del centre.',
    ],
  },
  {
    version: '1.9.0',
    date: '28 d’octubre de 2026',
    changes: [
      'Correus al professorat: qui queda alliberat/ada per una sortida i ha de cobrir una guàrdia, o té per a un dia una zona de pati diferent de la seva, en rep un correu des de guardies@iesjosepsuredaiblanes.com.',
      'Entre les 8:00 i les 15:00 dels dies feiners, el correu surt al cap de 2 minuts; fora d’aquest horari, a les 8:00 del següent dia feiner. Abans d’enviar-lo es comprova que el canvi encara és vigent; si s’ha desfet o el dia ja ha passat, no s’envia.',
      'Les plantilles es poden editar a Configuració › Correus al professorat, on també es veuen els darrers correus, l’estat del servei i el botó «Envia’m una prova».',
    ],
  },
  {
    version: '1.8.3',
    date: '28 d’octubre de 2026',
    changes: [
      'Quan el company de codocència es fa càrrec de la classe, ara diu «Queden amb el seu grup» (abans, «Queda amb el grup»).',
    ],
  },
  {
    version: '1.8.2',
    date: '26 d’octubre de 2026',
    changes: [
      'Sortides: les classes dels grups que surten sencers ja no surten com a absències per cobrir, tampoc les de qui els acompanya. Sí que es cobreixen les classes de l’acompanyant amb grups que es queden o que només surten en part.',
      'Si falta algú que tenia classe amb un grup que és fora, la fila diu «Grup de sortida» i no s’hi assigna ningú; a la vista del professorat i a les pantalles no surt.',
      'En copiar una sortida a altres dies, cada dia allibera el professorat que hi tenia classe segons el seu horari.',
      'En treure tots els grups de sortida, les absències dels acompanyants marxen juntament amb qui les cobria.',
    ],
  },
  {
    version: '1.8.1',
    date: '25 d’octubre de 2026',
    changes: [
      'El professorat que acompanya una sortida ja no surt com a disponible per cobrir guàrdies aquell dia, tampoc a les hores que tenia lliures: apareix com a «No disponible · de sortida». Si ja cobria alguna guàrdia, en afegir-lo com a acompanyant aquella fila torna a quedar sense cobrir.',
    ],
  },
  {
    version: '1.8.0',
    date: '25 d’octubre de 2026',
    changes: [
      'Vista del professorat: les guàrdies que et toquen surten a dalt («Avui et toca», amb l’hora, el grup i l’aula) i marcades amb «Tu» a la seva fila i a la zona de pati. Cada una porta a la seva hora.',
      'En el mòbil, el full d’avui s’obre a l’hora en curs, i el resum de les teves guàrdies queda fix a dalt.',
      'Gestió diària: files més baixes. El codi del professorat va en una etiqueta al costat del nom i la matèria i l’aula van en una sola línia.',
    ],
  },
  {
    version: '1.7.1',
    date: '23 d’octubre de 2026',
    changes: [
      'El botó «Avui» respon sempre: també amb la pàgina oberta des del dia anterior i quan es prem mentre la jornada encara es desa o es carrega.',
    ],
  },
  {
    version: '1.7.0',
    date: '22 d’octubre de 2026',
    changes: [
      'Vista del professorat: l’hora en curs es destaca amb «Ara», cada hora diu quantes guàrdies queden sense cobrir i qui cobreix s’indica com a Pantalles («Guàrdia», «Alliberat/ada», «Queda amb el grup»).',
      'Vista del professorat: les hores sense absències són discretes i ja no surten el pati buit ni el panell de grups de sortida quan no n’hi ha.',
      'Gestió diària: només «Publica» (o «Tanca jornada») és el botó principal; «Assigna automàticament» i «Aplica interval» passen a ser secundaris.',
      'El desplegable de qui cobreix té més espai i «Queda amb el grup» ja no es repeteix sota el desplegable.',
      'La × per treure una absència és al final de la fila.',
      'Cap text de l’aplicació és més petit de 12 px, tampoc als panells de configuració.',
      'Les estadístiques tenen l’estil nou: totals com el resum del dia, noms més llegibles i una barra que mostra el repartiment.',
    ],
  },
  {
    version: '1.6.0',
    date: '22 d’octubre de 2026',
    changes: [
      'Historial de cada jornada: es guarden les 30 darreres versions i, des del botó «Historial» (al costat de l’estat del dia), se’n pot recuperar qualsevol. La restauració també es pot desfer.',
      'Pujar o treure els fitxers d’horari ja no buida la jornada oberta. Si una classe ha canviat d’aula, l’absència hi passa amb qui la cobreix; les que ja no encaixen es conserven i un avís permet revisar-les o descartar-les.',
      'Un dia sense cap absència es pot publicar i tancar.',
      'Les observacions del pati i de la 7a hora ja es desen sempre.',
      'Qui cobreix la classe d’un acompanyant de sortida es conserva en tornar a obrir la jornada.',
    ],
  },
  {
    version: '1.5.0',
    date: '18 d’octubre de 2026',
    changes: [
      'La jornada mostra com avança la cobertura: barra de progrés, punt d’estat i guàrdies pendents a cada hora.',
      'Animacions suaus en canviar de vista i en aparèixer hores i absències noves.',
      'Les observacions ocupen una sola línia que creix amb el text, amb les frases preestablertes en un botó al costat.',
      'Les hores sense absències es mostren com una línia discreta perquè destaquin les que tenen feina.',
      'L’assignació automàtica i les llistes de candidats responen molt més de pressa.',
    ],
  },
  {
    version: '1.4.0',
    date: '15 d’octubre de 2026',
    changes: [
      'L’activitat PALIC es pot marcar com a absència, igual que una guàrdia, i entra a «Totes les hores».',
      'La impressió en A3 deixa marges segurs i ja no comença amb pàgines en blanc.',
    ],
  },
  {
    version: '1.3.0',
    date: '29 de setembre de 2026',
    changes: [
      'El torn de pati el decideix la configuració de l’aplicació (no les files GP d’Untis) i surt a les 10:45 a l’horari del professor absent.',
      'La vista del professorat és compacta i es llegeix bé al mòbil.',
      'La vista del professorat i les pantalles mostren qui cobreix cada guàrdia i marquen el professorat de guàrdia.',
      'Desdoblaments flexibles: si falta un docent, l’alumnat torna al seu grup sense demanar guàrdia, i es preassigna el company de la mateixa matèria.',
      'Es reconeix la codificació dels fitxers d’Untis (accents) i s’avisa si un fitxer pujat abans els havia perdut.',
      'En copiar un interval, les jornades ja publicades actualitzen també la vista del professorat.',
    ],
  },
  {
    version: '1.2.0',
    date: '26 de setembre de 2026',
    changes: [
      'Nou disseny: colors, tipografia, barra superior compacta i noves pantalles de gestió diària i de recompte de guàrdies.',
      'Es pot instal·lar com una aplicació i s’obre més de pressa.',
      'Es passa de Guàrdies a Professorat sense recarregar.',
      'Les jornades pendents es tanquen directament des de l’avís «Dies no tancats».',
      '«Desfés» després d’eliminar una absència o d’assignar guàrdies automàticament.',
      'Els errors s’expliquen en català i diuen què cal fer. Sense data, s’obre el proper dia lectiu.',
      'Les observacions es desen quan es fa una pausa, no a cada paraula, i el guardat s’atura sol si una pestanya entra en bucle.',
      'L’horari es llegeix unes 30 vegades més de pressa.',
    ],
  },
  {
    version: '1.1.0',
    date: '25 de setembre de 2026',
    changes: [
      'Historial de guàrdies de cada professor (dates i grups) i recompte amb colors per franja.',
      'Els dies no tancats s’obren amb un clic i hi ha un botó per tornar a provar la connexió.',
      'Estat de sincronització amb colors i resum diari més clar.',
      'Es poden imprimir jornades sense guàrdies.',
      'Es recupera sol quan falla la connexió i fa moltes menys lectures a Firebase; nova pestanya de diagnòstic.',
      'Es poden editar les preassignacions de codocència, i hi ha un menú comú per canviar d’aplicació.',
    ],
  },
  {
    version: '1.0.0',
    date: '13 de setembre de 2026',
    changes: [
      'Primera versió estable de Guàrdies.',
      'Configuració de les vistes de pantalla més clara i ordenada.',
      'Indicadors de guàrdies per hora i enfocament automàtic de la sessió actual.',
      'Els caps de setmana s’identifiquen correctament com a dies no lectius.',
    ],
  },
  {
    version: '0.9.4',
    date: '12 de setembre de 2026',
    changes: [
      'Nova gestió de pantalles amb previsualització.',
      'Contingut de Google Drive i Canva a les pantalles informatives.',
      'Reproducció automàtica de diverses vistes.',
      'Controls tàctils per canviar de dia i mida del text.',
    ],
  },
  {
    version: '0.9.3',
    date: '10 de setembre de 2026',
    changes: [
      'Impressió A3 més clara, compacta i adaptada al contingut del dia.',
      'Possibilitat de crear diverses observacions preestablertes.',
      'Noms del professorat més clars a la consulta pública.',
    ],
  },
  {
    version: '0.9.2',
    date: '9 de setembre de 2026',
    changes: [
      'Nou resum setmanal i estadístiques de guàrdies.',
      'Ordenació manual de les zones de pati.',
      'Opcions per despublicar, tornar a publicar i reobrir jornades.',
      'Conservació de l’historial encara que canviï l’horari.',
    ],
  },
  {
    version: '0.9.1',
    date: '7 de setembre de 2026',
    changes: [
      'El professorat només veu les jornades que ja s’han publicat.',
      'Autocompleció de professorat i millor tractament de grups compartits.',
      'Aules i observacions mostrades amb noms més entenedors.',
    ],
  },
  {
    version: '0.9.0',
    date: '3–6 de setembre de 2026',
    changes: [
      'Primera versió de prova del flux complet de planificació de guàrdies.',
      'Assignació automàtica i manual de guàrdies.',
      'Gestió de pati, convivència i sortides de grup.',
      'Consulta del professorat adaptada a mòbil.',
      'Sincronització dels canvis entre dispositius.',
    ],
  },
];
