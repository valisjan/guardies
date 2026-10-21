# Servei de correu de Guàrdies

Envia al professorat els correus que Guàrdies posa a la cua `guardiesCorreus` de
Firestore (projecte `quota-e1424`). N'hi ha de dos tipus:

- **Guàrdia com a alliberat/da**: quan a algú se li assigna una guàrdia perquè està
  alliberat/da (el seu grup és de sortida).
- **Canvi de zona de pati**: quan es canvia a mà la zona de pati d'algú per a un dia.

Els textos i el remitent es configuren a Guàrdies › Configuració › Correus al professorat.

## Quan surt cada correu

- Si el canvi es fa entre les 8:00 i les 15:00 d'un dia feiner, al cap de 2 minuts.
- Si es fa fora d'aquest horari, a les 8:00 del següent dia feiner.
- Abans d'enviar-lo es comprova que el canvi encara és vigent. Si la guàrdia o la zona ja no
  són les mateixes, el dia ja ha passat o aquell tipus de correu s'ha desactivat, no s'envia.
- Cada correu s'envia com a molt una vegada. Si alguna cosa falla a mig enviament, queda com
  a «Enviant» a la llista de Guàrdies i no es torna a enviar.

## Instal·lació (una sola vegada)

1. Entra a <https://script.google.com> amb el compte del centre des del qual han de sortir
   els correus.
2. Crea un projecte nou i anomena'l «Correus de Guàrdies».
3. A ⚙ Configuració del projecte, marca «Mostra el fitxer de manifest "appsscript.json" a
   l'editor».
4. A l'editor, substitueix el contingut de `Codi.gs` i el de `appsscript.json` pels
   d'aquest directori. Desa.
5. Tria la funció `installa` i prem «Executa». Google demanarà permisos. Com que és un
   script propi, cal anar a «Opcions avançades» i continuar.
6. Al registre d'execució ha de sortir «Activador creat».
7. A Guàrdies › Configuració › Correus al professorat ha de sortir «Servei de correu
   actiu». El botó «Envia'm una prova» ha de fer arribar un correu en un minut.

El compte ha de poder llegir i escriure a Firestore del projecte `quota-e1424`. Si n'és
propietari ja pot fer-ho. Si no, cal donar-li el rol «Usuari de Cloud Datastore» a IAM.

## Funcionament

- L'activador revisa la cua cada minut, de 7:00 a 22:00 (hora de Madrid). Cada revisió
  costa una lectura de Firestore si no hi ha res pendent.
- Cada 10 minuts deixa un senyal a `config/guardies-correus` perquè Guàrdies pugui mostrar
  que el servei funciona i des de quin compte envia.
- Gmail limita els enviaments a 1.500 destinataris al dia en els comptes del centre.

Per aturar-lo, executa `desinstalla`.
