# Base demo definitiva

La base se genera desde cero y nunca reutiliza pacientes reales.

## Generar y validar

```bash
node scripts/generar-datos-demo.mjs --fecha-demo 2026-08-17
```

El comando escribe:

- `data/demo-cirugias.json`: 350 episodios completos.
- `data/demo-resumen.json`: métricas y validaciones.

La semilla predeterminada es fija. Puede cambiarse con `--seed`, y la fecha relativa de la demostración con `--fecha-demo`.

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
- el dataset no contiene exactamente 200 personas y 350 episodios;
- `/cirugias` contiene documentos ajenos a la base demo.

No utiliza archivos de cuenta de servicio ni guarda credenciales.

## Verificar permisos

Después de cargar, el siguiente comando inicia sesión con las cinco cuentas y prueba lecturas y escrituras directas contra Firestore:

```bash
DEMO_PASSWORD='definir-en-la-terminal' node scripts/verificar-permisos-demo.mjs
```

La prueba no crea documentos temporales. Los intentos de creación fuera de clínica deben ser rechazados por Firestore y luego se verifica que esos IDs no existan. Las escrituras permitidas sobre episodios existentes son idempotentes y conservan todos sus campos.
