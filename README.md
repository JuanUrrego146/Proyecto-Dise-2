# Proyecto-Diseño-2

## Simulador web (HTML/JS)

Se agregó una versión autocontenida del simulador que corre directamente en el navegador sin backend ni dependencias de Unity.

- Carpetas: `web-simulator/` (origen) y `HTML/` (copia lista para Live Server o para abrir directo).
- Archivos: `index.html`, `styles.css`, `main.js`
- Cómo probar: abre `index.html` en el navegador o sirve la carpeta con la extensión **Live Server** de VS Code (o cualquier servidor estático). No requiere build ni compilación.
- Características: canvas interactivo con hormigas (triángulos a escala realista y velocidad acorde a su tamaño), comida (rombos), colonia/almacén (hexágono) y hormonas (círculos); generación inicial configurable; slider de escala temporal (de tiempo real a 1 día/min) con recuadro del valor actual que acelera movimiento y envejecimiento; rastros débiles azulados y más delgados durante la exploración que guían de forma tenue al hormiguero para el regreso y rastros densos ámbar de mayor opacidad al hallar comida para que otras sigan el camino hasta el hormiguero sin quedarse en bucles; las feromonas densas asociadas a cada comida se eliminan al agotarse esa fuente para evitar filas vacías; recolección con permanencia de varios segundos en comida, trazo denso de regreso y descanso dentro de la colonia (con opacidad reducida) antes de volver a salir; código de color (rojo al transportar/comer, blanco al morir); botones de pausa/reanudar, reinicio y acciones rápidas para añadir comida o disparar hormonas; selección por clic con información detallada (incluyendo almacén) y métricas en vivo.

Esta versión está pensada como base para un futuro frontend en Angular o similar.
