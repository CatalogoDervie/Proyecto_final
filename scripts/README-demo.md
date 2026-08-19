# Base demo definitiva

La base se genera desde cero y nunca reutiliza pacientes reales.

## Generar y validar

```bash
node scripts/generar-datos-demo.mjs --fecha-demo 2026-08-17
```

El comando escribe:

- `data/demo-cirugias.json`: episodios sintéticos calculados según la actividad histórica y la fecha demo.
- `data/demo-resumen.json`: métricas y validaciones.

La semilla predeterminada es fija. Puede cambiarse con `--seed`, y la fecha relativa de la demostración con `--fecha-demo`. Los meses completos generan entre 60 y 80 cirugías facturadas; el mes en curso se prorratea hasta la fecha indicada. La cartera activa y las alertas se recalculan manteniendo una operación mayormente normal.

Con `fecha_demo = 2026-08-17` el resultado validado es de 591 episodios para 390 personas: 523 facturados y 68 activos. Las alertas no se persisten como una etiqueta arbitraria; se derivan de los estados, las fechas y los umbrales configurados. Los casos por falta de segundo ojo quedan limitados a 12 alertas amarillas y 4 rojas, además de los casos recientes todavía sin alerta.

## Cargar en Firebase

La carga se autentica como el superadministrador existente y respeta las reglas de Firestore. La contraseña se recibe únicamente mediante una variable de entorno y nunca se escribe en el repositorio.

```bash
DEMO_EMAIL='superadmin@clinicaoftalmologica.test' \
DEMO_PASSWORD='definir-en-la-terminal' \
node scripts/cargar-datos-demo.mjs
```

El cargador se detiene si:

- el proyecto no es `proyecto-final-tig`;
- detecta `cirugias-we`;
- el UID no es el UID conocido del superadministrador;
- el perfil no está activo o no tiene rol `superadmin`;
- el volumen o los identificadores generados son inconsistentes;
- `/cirugias` contiene algún documento que no esté marcado explícitamente como sintético.

Al reemplazar una versión anterior, primero se escriben y verifican los nuevos documentos. Solo después se eliminan los documentos sintéticos obsoletos. El script nunca modifica `/usuarios` ni otras colecciones.

No utiliza archivos de cuenta de servicio ni guarda credenciales.

## Migración técnica de programadas compartidas

`programadaHastaDia` es una proyección técnica entera de la fecha quirúrgica: contiene el día siguiente como `AAAAMMDD` en horario argentino y permite que consulta y reglas de Firestore retiren automáticamente una cirugía de la vista compartida cuando vence. No reemplaza ni altera `fechaCir`.

La migración es acotada y actualiza solamente ese campo en las 17 cirugías actualmente programadas. Sin `APPLY_PROGRAMMED_MIGRATION=1` funciona en modo diagnóstico.

```bash
DEMO_EMAIL='superadmin@clinicaoftalmologica.test' \
DEMO_PASSWORD='definir-en-la-terminal' \
APPLY_PROGRAMMED_MIGRATION=1 \
node scripts/migrar-programadas-compartidas.mjs
```

## Verificar permisos

Después de cargar, el siguiente comando inicia sesión con las cinco cuentas y prueba lecturas y escrituras directas contra Firestore:

```bash
DEMO_PASSWORD='definir-en-la-terminal' node scripts/verificar-permisos-demo.mjs
```

La prueba no crea documentos temporales. Los intentos de creación fuera de clínica deben ser rechazados por Firestore y luego se verifica que esos IDs no existan. Las escrituras permitidas sobre episodios existentes son idempotentes y conservan todos sus campos.
