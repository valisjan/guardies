# Diagnóstico y propuesta: directorio de profesorado

## Situación observada

La página de diagnóstico de Guardies ha permitido medir las lecturas de Firestore
en una sesión de prueba. El resultado relevante es el directorio de profesorado:

| Operación | Lecturas por carga | Lecturas observadas | Motivo |
| --- | ---: | ---: | --- |
| `directoryLoad` | 203 | 1.218 (6 cargas) | Carga el profesorado del curso y los perfiles complementarios. |
| `unclosedDaysLoad` | 15 | 90 (6 cargas) | Lee las jornadas para localizar las que siguen abiertas. |
| `configLoad` | 7 | 14 (2 cargas) | Configuración general de Guardies. |
| `dayLoad` | 1 | 3 (3 cargas) | Jornada seleccionada. |

La cifra de 1.325 lecturas de la captura **no representa una apertura normal de
Guardies**: se realizaron seis cargas manuales de directorio y seis de jornadas
abiertas desde la página de diagnóstico. Aun así, demuestra que la lectura del
directorio es el coste dominante: cada carga vuelve a descargar unos 203
documentos.

## Objetivo

Reducir las lecturas repetidas del directorio sin empeorar la experiencia:

- La interfaz debe seguir mostrando los datos de inmediato.
- Un cambio hecho por un administrador debe llegar a los demás usuarios
  conectados sin esperar a que caduque una caché.
- Una pestaña en segundo plano no debe hacer cargas completas innecesarias.
- La solución no debe depender de que todos los usuarios cierren y vuelvan a
  abrir el navegador.

## Solución propuesta

### 1. Copia local del directorio

Cada navegador conservará una copia del directorio del curso en almacenamiento
del sitio (`IndexedDB`, preferiblemente; `localStorage` sería una alternativa
para un volumen pequeño). La copia se separará por curso y contendrá:

```text
cursoId
datos del directorio
version del directorio
fecha de descarga
```

La copia queda únicamente en el navegador y perfil concretos del usuario. No se
envía a otros equipos ni sustituye a Firestore como fuente de verdad.

Al abrir Guardies:

1. Si hay una copia válida, se utiliza inmediatamente.
2. Si no existe o está marcada como obsoleta, se descarga el directorio actual,
   se actualiza la copia y se continúa sin bloquear la interfaz.
3. Como salvaguarda, una copia que lleve más de 60 minutos sin verificar se
   considera obsoleta.

### 2. Documento de versión compartido

Se añadirá un único documento pequeño bajo el curso al que pertenece el
directorio:

```text
cursos/{cursId}/guardies/directoriVersion
{
  version: 12,
  updatedAt: <timestamp>,
  updatedBy: <uid opcional>
}
```

Los navegadores con Guardies abierto escucharán solamente este documento. Esa
escucha es barata: no descarga el directorio completo, solo avisa cuando hay un
cambio real.

#### Responsabilidad de actualizar la versión

El directorio actual no procede de los ficheros que se suben en Guardies. La
función `loadGuardiesTeacherDirectory` combina tres fuentes:

```text
cursos/{cursId}/professors
usuaris
preautoritzats
```

Por contra, `saveGuardiesFile` solo escribe los ficheros de configuración de
Guardies (`reference`, `untis`, `duties`, etc.). Subir GPU004 o el XML de GestIB
no modifica esas tres fuentes. Por tanto, **no se debe incrementar la versión
simplemente al subir un fichero**: provocaría recargas innecesarias y no
cubriría las modificaciones reales del directorio.

La regla correcta es que el proceso que escriba cualquiera de las fuentes del
directorio actualice `version` y `updatedAt` en el mismo flujo. En particular,
la sincronización externa que alimenta `cursos/{cursId}/professors` debe hacerlo
al finalizar con éxito. Si un cambio de `usuaris` o `preautoritzats` modifica un
correo o identidad usada por el directorio, ese flujo debe incrementar la
versión de los cursos afectados.

El punto principal está confirmado en Quota:
`src/services/sincronitzacio.js` sincroniza
`cursos/{cursId}/professors` y, al final del mismo proceso, actualiza
`preautoritzats`. El incremento de versión debe añadirse ahí, una vez que ambas
operaciones hayan terminado correctamente. Así cubre el flujo ordinario sin
requerir Cloud Functions.

Como respaldo, puede existir un botón discreto de «Actualizar directorio» para
administración; no debe ser el mecanismo ordinario y solo se usaría si alguien
edita manualmente datos de Firestore fuera de la sincronización de Quota.

### 3. Propagación entre personas

El recorrido esperado será:

```text
Sincronizador que modifica el profesorado
        ↓
Firestore actualiza el directorio y cursos/{cursId}/guardies/directoriVersion
        ↓
Las pestañas conectadas reciben el cambio de versión
        ↓
Marcan su copia local como obsoleta
        ↓
Recargan una vez el directorio y sustituyen la copia local
```

Por tanto, si una persona realiza el cambio, otra que tenga Guardies abierto lo
verá al recibir el aviso y actualizar su copia. Una pestaña sin conexión o en
segundo plano se pondrá al día al recuperar conexión o al volver a activarse.

## Decisiones de experiencia de usuario

- No se mostrará una pantalla de espera por leer la caché: se usarán los datos
  disponibles y la actualización ocurrirá en segundo plano.
- Si el directorio cambia mientras alguien está seleccionando una ausencia, no
  se descartará su trabajo. Se aplicará el nuevo directorio antes de la próxima
  búsqueda o se notificará de manera discreta si hiciera falta.
- Se mantendrá una acción explícita de actualización para administración como
  vía de recuperación, aunque no debería ser necesaria habitualmente.
- Las pestañas ocultas no descargarán el directorio al recibir el aviso; lo
  dejarán marcado como obsoleto y lo actualizarán al volver a estar visibles.

## Impacto estimado

Actualmente, abrir o volver a solicitar el directorio cuesta aproximadamente
203 lecturas. Con esta propuesta:

- Aperturas y cambios de día normales con la caché válida: **0 lecturas de
  directorio**.
- Cada cambio real del directorio: aproximadamente **203 lecturas por navegador
  que necesite actualizarse**, una sola vez.
- Verificación continua: una escucha de **un único documento de versión** por
  pestaña activa, con tráfico solo cuando se modifica.

Esto elimina las descargas repetidas sin convertir los datos locales en una
fuente desincronizada.

## Alcance inicial y verificación

La implementación se limitará inicialmente al directorio. No cambiará todavía
la carga de jornadas abiertas ni los intervalos de actualización de la jornada.

Antes y después se medirá con `diagnostics.html?diagnostic=reads`:

1. Abrir Guardies y anotar `directoryLoad`.
2. Cambiar de día y comprobar que no vuelve a aumentar.
3. Abrir una segunda pestaña y comprobar que reutiliza su propia caché tras la
   primera carga.
4. Ejecutar una sincronización de profesorado y comprobar que ambas pestañas
   reciben la nueva versión y hacen una única recarga del directorio.
5. Ocultar una pestaña, cambiar el directorio y verificar que no hace la carga
   hasta volver a mostrarla.

El resultado aceptable es conservar la rapidez actual y que las lecturas de
`directoryLoad` solo crezcan en la primera carga o tras un cambio real.
