// Matchers extras (toBeInTheDocument, etc.) para os testes de componente React.
// Referenciado em test.setupFiles no vitest.config.ts. Inócuo nos testes de
// banco (ambiente node) — só estende o `expect`.
import '@testing-library/jest-dom/vitest'
