# Pendientes del try-on

Actualizado: 15 de noviembre de 2026. Próxima revisión: pruebas de marketing del 16 de noviembre en el tema de pruebas **Live_Idony Try-On**.

## Prioridad 1 · Labios

- [ ] Validar juntos anclaje y jitter de **Lipstick y Lip Bloom Oil & Tint** en el build live. Alex confirmó el anclaje inmediato, pero reapareció jitter; el último ajuste contra la imagen está implementado y pendiente de validación visual.
- [ ] Comprobar reposo, giros de cabeza, sonrisa, apertura/cierre, fruncir y apretar los labios. El pigmento debe seguir el contorno sin retraso, vibración ni desplazamiento sobre dientes o piel.
- [ ] Confirmar que cambiar de tono y cerrar/reabrir la cámara conservan la estabilidad y la fluidez.

La intensidad de Lipstick aumentada un 40 % fue validada por Alex: **mantener esa calibración**. La referencia de integración y anclaje es el probador de Violette FR observado en Chrome.

## Prioridad 2 · Flush & Bloom

- [ ] Corregir Temptation: el resultado actual es **demasiado violeta**. Llevarlo hacia un **rosa más fiel al producto** y validar sobre piel antes de cerrar el tono.

## Prioridad 3 · Dream Paint Blush

- [ ] Corregir la aplicación de la nariz: se sigue viendo una franja recta y dura.
- [ ] Hacer gradual la distribución del pigmento desde el centro hacia los bordes, con una transición difuminada que conserve presencia de producto.

## Validación del live de pruebas

- [ ] Marketing: recorrer todos los productos y tonos en iPhone/Safari, Android y Chrome de escritorio, con luz natural e interior.
- [ ] Comprobar que la cámara mantiene movimiento continuo con maquillaje aplicado y tras cambiar de producto.
- [ ] Anotar producto, tono, dispositivo/navegador y condiciones de luz de cada incidencia para retomarla después de las pruebas.
- [ ] Cerrar las correcciones y validar el tema de pruebas antes de publicar el tema para clientes. La publicación de Shopify queda a cargo de Alex.

## Estado técnico de esta entrega

- Un único pipeline mobile para todos los navegadores, con los materiales actuales de Lip Bloom y Ethereal (`ethereal-film-09`).
- Seguimiento de labios compartido por Lipstick y Lip Bloom: anclaje contra imagen, corrección de tamaño/giro y filtrado del ruido residual; los gestos reales liberan el filtro.
- Sin reiniciar el anclaje al cambiar de tono. Un único reloj de cámara y descarte de fotogramas repetidos.
- El pigmento de complexion conserva sus presets y usa WebGL para reducir el trabajo por píxel en CPU; comparación con la referencia CPU verificada con diferencia máxima de 1 nivel por canal en la captura de prueba.
- Las pruebas automáticas y el build complementan la validación visual; el resultado final de labios sigue pendiente de la revisión de marketing.

URLs y procedimiento de despliegue: [DEPLOYMENT.md](DEPLOYMENT.md).
