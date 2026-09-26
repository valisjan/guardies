# Guàrdies: mejoras 4, 3 y 2

Base de comparación: commit `d2917ba`. Medición local con Chromium desktop,
un trabajador de Playwright, la misma máquina y el mismo escenario antes/después.
Datos sintéticos: 160 profesores, 4.800 sesiones, 5 días y 6 horas por día.
No se escribieron datos en el Firebase de producción.

| Medida | Antes | Después |
| --- | ---: | ---: |
| Trabajo síncrono al cambiar exclusiones: mediana de 10 muestras, tras 2 de calentamiento | 523,8 ms | 61,2 ms |
| Interpretaciones XML durante 12 cambios de exclusiones | 12 | 0 |
| Escrituras al reabrir una jornada cerrada con su proyección pública ya creada | 1 | 0 |

La reducción del trabajo síncrono en este escenario es aproximadamente del
88 %. No es una estimación de la mejora de toda la aplicación, de la latencia
de Firebase ni de la facturación. El benchmark mide la ejecución inicial del
evento; la navegación y actualización asíncrona posterior quedan fuera de ese
tiempo. Los resultados de cada ejecución se adjuntan al informe Playwright.

## Cambios

- Confirmaciones caché/servidor y escrituras pendientes se reciben como
  metadatos. No reconstruyen configuración ni la jornada pública si los datos
  siguen siendo iguales. La versión del directorio se valida aun cuando los
  datos del servidor coincidan con la caché.
- El guardado de la jornada y los cambios de estado realizados desde la
  pantalla diaria escriben su proyección pública en la misma transacción.
  Publicar/cerrar/reabrir/despublicar comprueba también la revisión esperada.
- Consultar una jornada no fuerza su escritura. Se comprueba la proyección
  existente y solo se repara si falta o difiere. Esa comprobación puede añadir
  una lectura pública por jornada consultada; la reparación comprueba la
  revisión privada dentro de una transacción para no sobrescribir cambios de
  otro administrador. El renderizado de la jornada no espera esa comprobación.
- Los resultados de los tres parsers se reutilizan mientras no cambien los
  contenidos de los ficheros. Las exclusiones reconstruyen únicamente el
  conjunto filtrado y sus índices. Los índices por profesor/día y franja,
  las ocupaciones y los IDs base evitan recorridos repetidos. La disponibilidad
  se sigue comprobando contra ausencias y asignaciones actuales.

## Verificación

- Pruebas de dominio y comportamiento en escritorio y perfil móvil Chromium.
- Pruebas del código de servicios de producción con una frontera de SDK
  controlada: confirmación de servidor idéntica, invalidación del directorio,
  desuscripción, desaparición del documento público, fallo de publicación sin
  commit privado, transiciones obsoletas y reparación tras despublicar.
- Build de producción.

Estas pruebas de servicios no sustituyen al emulador, las reglas desplegadas
ni un dispositivo Safari real. Los intervalos iOS no se han modificado.

Repetir medición en PowerShell:

```powershell
$env:GUARDIES_BENCHMARK='1'
npx playwright test tests/visual/guardies-performance.spec.js --project=chromium-desktop --workers=1
```

## Fases posteriores: separar guardado y actualizar la vista incrementalmente

### Fase 1: renderizado sin efectos sobre la jornada

- `renderCoverage()` y la construcción de la proyección pública no normalizan
  asignaciones ni programan guardados. La validación queda en
  `reconcileCoverageState()` y las ediciones explícitas en `commitCoverageEdit()`.
- Añadir/quitar ausencias, asignar, cancelar, cambiar salidas y limpiar el día
  siguen guardando con el debounce existente de 250 ms. Las observaciones
  mantienen su guardado directo sin volver a validar todos los candidatos.
- La normalización de una jornada cargada se realiza tras la confirmación de
  la suscripción, no sobre el primer snapshot local sin confirmar. Las jornadas
  cerradas conservan las asignaciones guardadas.

### Fase 2: reutilización de filas y controles

- La vista compara sus entradas: jornada, horario, directorio, recuentos,
  exclusiones, convivencia, patio y observaciones. Si nada relevante cambia,
  no vuelve a calcular listas de candidatos ni a generar la cobertura.
- Si hay cambios, `createKeyedRenderer()` modifica el DOM existente con claves
  por sesión, fila y control. Mantiene los campos que siguen existiendo, sus
  listeners, el foco y la selección. Cada control recibe un único listener.
- Cambiar de curso, fecha o vista reinicia deliberadamente el ámbito del DOM.
  Los cambios remotos y los controles bloqueados se aplican también a nodos
  reutilizados. Se evita sobrescribir texto durante composición IME.
- No se han añadido lecturas, escrituras ni suscripciones a Firebase.

### Medición de esta fase

Comparación local entre la fase 1 (antes de reutilizar el DOM) y la fase 2,
Chromium desktop con un trabajador. Configuración sintética: 60 profesores,
240 sesiones, 20 filas de ausencia. Se realizan 12 redibujados sin cambios de
datos y se toma la mediana tras descartar los dos primeros.

| Medida | Fase 1 | Fase 2 |
| --- | ---: | ---: |
| Trabajo síncrono por redibujado | 66,6 ms | 2,1 ms |
| Nodos insertados registrados en los 12 redibujados | 204 | 1 |
| Se conserva el mismo editor y su foco | No | Sí |
| Selección del texto conservada | — | Sí |

El único nodo insertado después corresponde a actualizar la representación
del comentario en el primer redibujado. La métrica cuenta los nodos añadidos
en los registros del observador, no todos sus descendientes.

Es una reducción aproximada del 97 % **para redibujados sin cambios**, no para
todas las operaciones. Cuando cambia el modelo se sigue generando el marcado
completo, aunque solo se modifican los nodos necesarios. No es una medición
de red, dispositivos reales ni facturación.

La repetición final del escenario de 4.800 sesiones da 65,5 ms al cambiar
exclusiones, cero reinterpretaciones XML y cero escrituras al reabrir una
jornada cerrada ya proyectada. El 61,2 ms de la tabla inicial corresponde a
la medición anterior de los puntos 4-3-2, no a esta última ejecución.

### Verificación y punto de continuidad

- 39 pruebas de dominio correctas.
- Suite final: 85 pruebas de navegador correctas en escritorio y perfil móvil
  Chromium; 7 omitidas (benchmarks optativos, configuración real no facilitada
  y densidad de impresión solo de escritorio).
- Ejecución optativa adicional: 34 pruebas de escritorio correctas, incluidos
  ambos benchmarks. Build de producción correcto.
- Las regresiones comprueban renderizado sin guardado, limpieza persistente,
  actualización de recuentos mientras se escribe, ausencia de guardados
  duplicados, reordenación de filas con foco, valores remotos, bloqueo e IME.

Estado: todo sigue local y sin commit/push/despliegue. Se conservan también
los cambios anteriores 4-3-2 en servicios, parsers e instrumentación.

Siguiente paso: validar este bloque en un entorno de prueba con autenticación
real y Safari real, y después publicar con autorización. No dar por medido
el tráfico real de Firestore a partir de estos benchmarks ni modificar más
arquitectura antes de comprobar el resultado.
