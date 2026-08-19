# Proyecto Final TIG

Aplicación web académica para gestionar y analizar el circuito de cirugías de cataratas de dos clínicas oftalmológicas ficticias: **Clínica A** y **Clínica B**.

## Objetivo

El proyecto aborda el seguimiento de pedidos de lentes, demoras de recepción, programación quirúrgica, facturación pendiente y continuidad del segundo ojo. La interfaz prioriza cantidades, excepciones operativas y acceso progresivo al detalle.

## Alcance

- Circuito de cataratas desde el pedido de lente hasta la facturación.
- Agenda quirúrgica combinada para ambas clínicas.
- Seguimiento del segundo ojo.
- Alertas operativas amarillas y rojas calculadas a partir de estados, fechas y umbrales.
- Indicadores mensuales y acumulados de 2026.
- Comparación Clínica A / Clínica B / Total.

No incluye integraciones reales con PAMI, recetas, Lentess, facturación externa ni otros sistemas clínicos.

## Roles

- **Administrativo:** opera únicamente los registros de su clínica.
- **Médico:** consulta un tablero agregado de ambas clínicas y accede a datos personales solo dentro de la agenda quirúrgica.
- **Supervisor:** controla ambas clínicas, accede al detalle progresivo y configura umbrales operativos.
- **Superadmin:** conserva el control integral y la administración de usuarios.

## Tecnología

- HTML, CSS y JavaScript ES Modules.
- Firebase Authentication con correo y contraseña.
- Cloud Firestore.
- GitHub Pages.
- IndexedDB y almacenamiento local aislados para el Proyecto Final.

## Firebase y seguridad

El único proyecto Firebase autorizado es `proyecto-final-tig`. `js/firebase.js` contiene un bloqueo explícito que impide usar `cirugias-we`.

Las reglas de Firestore restringen el acceso por usuario, rol, clínica y estado activo. Los umbrales de `/configuracion/alertas_operativas` pueden ser modificados únicamente por Supervisor y Superadmin.

## Datos

Todos los nombres, DNI, teléfonos, fechas y episodios incluidos en la demo son sintéticos. El repositorio no contiene datos clínicos reales ni debe conectarse con aplicaciones de producción.

## Estructura principal

```text
css/                 estilos de la aplicación
data/                base demostrativa sintética
js/                  interfaz, autorización, estado y Firebase
scripts/             generación y validaciones de la demo
firestore.rules      reglas de seguridad de Firestore
firebase.json        configuración local de Firebase
index.html           entrada de la aplicación
```

Algunos campos y módulos heredados permanecen en el código únicamente para compatibilidad con la estructura anterior. Las funciones externas y las referencias exclusivas de vitrectomía no se exponen en la interfaz del Proyecto Final.

## Ejecución local

Al usar módulos ES y Firebase, debe servirse mediante HTTP:

```bash
python -m http.server 8000
```

Luego abrir `http://localhost:8000/`.

## Advertencia

Este proyecto es una demostración académica. No utiliza datos reales, no ejecuta conectores externos y no debe reutilizar credenciales, configuraciones ni información de la aplicación real.
