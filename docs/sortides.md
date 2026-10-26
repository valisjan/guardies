# Sortides de grups

Regles que ha de complir la jornada quan hi ha grups de sortida (`grupsFora`). Les proves són a `tests/visual/guardies.spec.js` (les que parlen de «sortida»).

## Vocabulari

- **Grup que surt sencer**: és fora tot el dia; les seves classes no es fan.
- **Sortida parcial** (`partialGroups`): en surt una part; la classe es fa amb qui es queda.
- **Acompanyant** (`grupProfessorsFora`): professor que va amb un grup. Falta tot el dia.
- **Alliberat** (`grupProfessorsAlliberats`): qui tenia classe només amb grups que són fora sencers. Queda lliure i pot cobrir guàrdies.

## Regles

1. Una classe amb **tots** els grups fora sencers no es cobreix, falti qui falti (`classWithGroupsOut`):
   - les absències dels acompanyants no la inclouen;
   - si algú hi falta, la fila diu «Grup de sortida», sense selector, i no compta com a pendent;
   - l'assignació automàtica no hi posa ningú;
   - la vista del professorat i les pantalles no la mostren;
   - si algú la cobria, la cobertura es treu.
2. Les classes de l'acompanyant amb grups que es queden, o que només surten en part, sí que es cobreixen (`syncOutingAbsences`).
3. L'acompanyant no pot cobrir cap guàrdia aquell dia, tampoc a les hores lliures («No disponible · de sortida»). Si ja en cobria alguna, la deixa.
4. Només queda alliberat qui no és acompanyant i té classe exclusivament amb grups que són fora sencers. Una sortida parcial no allibera ningú.
5. En copiar una sortida a altres dies:
   - es copien els grups, els acompanyants i les sortides parcials;
   - els alliberats es calculen amb l'horari de cada dia;
   - el mateix dia de la setmana conserva el que s'ha triat a mà.
6. En treure grups o acompanyants, les absències derivades marxen amb la seva cobertura i observació.
7. Obrir una jornada recalcula tot això sense desar res. Una jornada publicada actualitza la seva vista pública.
