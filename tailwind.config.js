/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      // Estética "livro-razão claro" — paleta sálvia/verde (ref. Vistiq).
      // NOTE: os nomes dos tokens são herdados do tema escuro original; aqui
      // recebem valores claros. `void` = tinta carvão (texto SOBRE acentos, se
      // preciso); `bone` = texto principal (escuro) e overlay sutil (bg-bone/5).
      // `brass` deixou de ser dourado e passou a ser o VERDE de acento.
      colors: {
        void: '#2C3435', // carvão (swatch 8) — tinta profunda
        pine: '#DCEAE1', // menta pálida (swatch 2) — painéis/realces sutis
        moss: '#FFFFFF', // superfície de cartão
        raised: '#FFFFFF',
        line: 'rgba(44,52,53,0.12)', // filete carvão translúcido
        bone: '#2C3435', // texto principal (carvão, swatch 8)
        'bone-dim': '#4F6157', // texto secundário (sálvia-grafite)
        sage: '#6E8377', // rótulos / texto terciário (verde-grafite suave)
        brass: '#4A7256', // VERDE de acento — ações primárias, filetes, foco
        'brass-bright': '#5C8A68',
        emerald: '#2E8B57', // positivo / crescimento
        clay: '#B24A3E', // negativo / saída (vermelho-tijolo, sem laranja)
      },
      fontFamily: {
        display: ['Fraunces', 'Georgia', 'serif'],
        sans: ['"Hanken Grotesk"', 'system-ui', 'sans-serif'],
        mono: ['"Spline Sans Mono"', 'ui-monospace', 'monospace'],
      },
      keyframes: {
        rise: {
          '0%': { opacity: '0', transform: 'translateY(14px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        fade: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        sheen: {
          '0%': { backgroundPosition: '200% 0' },
          '100%': { backgroundPosition: '-200% 0' },
        },
      },
      animation: {
        rise: 'rise 0.6s cubic-bezier(0.22,1,0.36,1) both',
        fade: 'fade 0.9s ease both',
        sheen: 'sheen 8s linear infinite',
      },
    },
  },
  plugins: [],
}
