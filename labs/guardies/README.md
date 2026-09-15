# Gestió de guàrdies

Aplicació integrada amb Quota per preparar les absències diàries, les cobertures i les guàrdies de convivència.

## Fitxers

A l'apartat **Arxius de configuració** es carreguen, en aquest ordre:

1. **XML GestIB**: places, grups, matèries, activitats i aules.
2. **GPU004.TXT**: codis i noms del professorat d'Untis.
3. **GPU001.TXT**: horari complet, classes, grups, activitats i guàrdies.

No cal carregar l'XML complet d'Untis: GPU001 conté les mateixes sessions en un fitxer molt més lleuger. Els noms complets del professorat continuen provenint de GPU004.

Els fitxers i la configuració setmanal queden guardats a Firestore dins el curs acadèmic actiu. Es carreguen automàticament des de qualsevol navegador amb una sessió vàlida de Quota. Un usuari administrador pot substituir o eliminar cada fitxer des del mateix assistent.

## Què valida

- Lectura del XML de referència de GestIB.
- Traducció de plaça, grup, matèria, activitat i aula a noms llegibles.
- Detecció automàtica de l'activitat de guàrdia general.
- Selecció d'una data i conversió al dia setmanal del XML.
- Cerca interactiva del professorat absent.
- Visualització vertical de l'horari del professor seleccionat.
- Marcatge de les sessions concretes que falten.
- Acció ràpida per afegir tot el dia i replicació en un interval de dies lectius.
- Llistat diari amb les hores apilades per anar afegint absències.
- Comentari per cada absència.
- Candidats jerarquitzats per origen: els alliberats pel seu acumulat del curs i els de G pel recompte de la mateixa franja setmanal.
- Preassignació automàtica de tota la jornada: primer alliberats i després G, respectant el recompte propi de cada franja.
- Cerca del professorat que té guàrdia a la mateixa franja.
- Sortides amb decisió completa o parcial independent per a cada grup i selecció dels acompanyants.
- Detecció del professorat que queda alliberat perquè tenia classe amb aquests grups.
- Ús del professorat alliberat com a candidat de cobertura a la mateixa franja.
- Autoguardat, publicació, actualització i tancament de la jornada.
- Implicació automàtica dels acompanyants en totes les seves classes i guàrdies.
- Impressió A3 en una sola pàgina amb compactació adaptativa per a jornades carregades.
- Rotació setmanal i reordenació directa de zones de pati, festius, canvis de zona puntuals i observacions diàries.
- Còmput de cobertures efectivament realitzades: alliberaments acumulats durant el curs i G separades per dia i hora setmanals.
- Vista de professorat en mode lectura amb les jornades publicades i una matriu setmanal del professorat de G amb el recompte propi de cada franja.
- Estadístiques de cap d’estudis amb totals separats, rànquings de professorat i franges setmanals amb més i menys cobertures de G.

## Fases posteriors

- Correu automàtic a les 08:00.
- Altres tasques especials configurables.
