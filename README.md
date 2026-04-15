<p align="center">
  <img src="https://raw.githubusercontent.com/GabrielAv0301/DBPredictor/main/assets/icon.png" width="200" alt="QueryGuard Logo" />
</p>

# QueryGuard — Real-time Database Impact & Safety Analyzer

[English](#english-documentation) | [Español](#documentación-en-español)

> **Stop guessing. See the impact of your ORM mutations BEFORE you hit save.**
> 
> QueryGuard is a VS Code extension that predicts the impact of your Prisma, Supabase, and Drizzle queries in real-time. It analyzes your AST as you type to estimate how many rows will be affected, including recursive cascade deletions and potential foreign key violations.

![Damage Detection Demo](https://raw.githubusercontent.com/GabrielAv0301/DBPredictor/main/assets/damage-view.gif)

---

<a name="english-documentation"></a>
## English Documentation

### The Safety Co-pilot (Philosophy)

QueryGuard is designed as a complementary safety layer for your development workflow. It is not a database manager, a GUI, or a schema visualizer. Its sole purpose is to act as a pre-flight check: providing real-time warnings and safe simulations directly where you write your code, helping you avoid accidental "mass-deletes" or unintended data mutations before they even reach your CI/CD or production logs.

### How to Use

1.  **Secure Connection**: Press Ctrl+Shift+P and run QueryGuard: Connect to Database. Enter your PostgreSQL connection string. It is stored in VS Code's SecretStorage and never shared.
2.  **Write Code**: As you type Prisma, Supabase, or Drizzle mutations, a CodeLens will appear above the line showing the estimated affected rows.
3.  **Explore Impact**: Click the CodeLens to open the Impact Analysis Panel. You will see a Blast Radius chart and a tree of cascading deletions.
4.  **Run Simulation**: Click the Simulate button in the panel. QueryGuard executes the real query inside a BEGIN...ROLLBACK transaction to give you a 100% accurate row count without modifying data.

### Key Features

*   **Real-time Row Estimation**: Uses PostgreSQL internal statistics (n_live_tup) for instant "worst-case" calculations as you type.
*   **Visual Cascade Analysis**: Traces Foreign Keys (FKs) recursively to show the full impact on related tables.
*   **Safe Dry-Run Simulation**: Execute real queries against live data with zero risk of modification.
*   **Analysis History**: Keep track of previous estimations in the side panel.

### Technical Requirements & Compatibility

*   **Database Support**: Currently, QueryGuard exclusively supports PostgreSQL (including Supabase, Neon, CockroachDB, and AWS RDS).
*   **ORM Support**:
    *   **Supabase**: .from().delete() and .from().update() chains.
    *   **Prisma**: delete, update, deleteMany, and updateMany.
    *   **Drizzle ORM**: delete(), update(), and insert().
*   **Simulation Note**: While detection is automatic, the Simulation feature requires explicit filters (like .eq() or where: {}) to accurately translate your ORM logic into safe test SQL.

---

<a name="documentación-en-español"></a>
## Documentación en Español

### Tu Copiloto de Seguridad (Filosofía)

QueryGuard está diseñado como una capa de seguridad complementaria para tu flujo de trabajo. No es un gestor de bases de datos ni una interfaz gráfica. Su único propósito es actuar como una inspección previa: proporcionando avisos en tiempo real y simulaciones seguras directamente donde escribes tu código, ayudándote a evitar "borrados masivos" accidentales antes de que lleguen a tus logs de producción.

### Cómo usarlo

1.  **Conexión Segura**: Presiona Ctrl+Shift+P y ejecuta QueryGuard: Connect to Database. Ingresa tu cadena de conexión de PostgreSQL. Se guarda en el SecretStorage de VS Code y nunca se comparte.
2.  **Escribe Código**: Mientras escribes mutaciones de Prisma, Supabase o Drizzle, aparecerá un CodeLens encima de la línea mostrando las filas afectadas estimadas.
3.  **Explora el Impacto**: Haz clic en el CodeLens para abrir el Panel de Análisis de Impacto. Verás un gráfico de Radio de Impacto y un árbol de eliminaciones en cascada.
4.  **Simulación Segura**: Haz clic en el botón Simulate en el panel. QueryGuard ejecutará la consulta real dentro de una transacción BEGIN...ROLLBACK para darte un conteo 100% exacto sin modificar datos.

### Funciones Principales

*   **Estimación en Tiempo Real**: Utiliza estadísticas internas de PostgreSQL (n_live_tup) para cálculos instantáneos del "peor de los casos" mientras escribes.
*   **Análisis Visual de Cascadas**: Rastrea Claves Foráneas (FKs) de forma recursiva para mostrar el impacto total en tablas relacionadas.
*   **Simulación de Prueba Segura**: Ejecuta consultas reales contra datos en vivo con riesgo cero de modificación.
*   **Historial de Análisis**: Mantén un registro de estimaciones anteriores en el panel lateral.

### Requisitos Técnicos y Compatibilidad

*   **Bases de Datos**: Actualmente, QueryGuard soporta exclusivamente PostgreSQL (incluyendo Supabase, Neon, CockroachDB y AWS RDS).
*   **ORMs Soportados**:
    *   **Supabase**: Cadenas .from().delete() and .from().update().
    *   **Prisma**: Soporte para delete, update, deleteMany y updateMany.
    *   **Drizzle ORM**: Detección de delete(), update() e insert().
*   **Nota de Simulación**: Aunque la detección es automática, la función de Simulación requiere filtros explícitos (como .eq() o where: {}) para traducir con precisión la lógica de tu ORM al SQL de prueba seguro.

---

<p align="center">
  <b>Gabriel Silva Avila</b>
</p>

<p align="center">
  <a href="https://mx.linkedin.com/in/gabriel-silva-avila-53b60b270?trk=profile-badge">
    <img src="https://img.shields.io/badge/LinkedIn-Gabriel%20Silva%20Avila-blue?style=for-the-badge&logo=linkedin" alt="LinkedIn Badge" />
  </a>
</p>

<p align="center">
  <a href="https://github.com/GabrielAv0301/DBPredictor">
    <img src="https://img.shields.io/badge/GitHub-DBPredictor-black?style=for-the-badge&logo=github" alt="GitHub Badge" />
  </a>
</p>
