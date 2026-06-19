/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      // Estética "livro-razão esmeralda": verde-cédula profundo, tinta pergaminho,
      // acento latão/ouro, esmeralda p/ crescimento, terracota p/ saída.
      colors: {
        void: '#07120D',
        pine: '#0C1C15',
        moss: '#11271C',
        raised: '#163322',
        line: 'rgba(236,227,208,0.12)',
        bone: '#ECE3D0',
        'bone-dim': '#A9B7AC',
        sage: '#7E9384',
        brass: '#C9A24A',
        'brass-bright': '#E6C36A',
        emerald: '#46C08A',
        clay: '#D9694A',
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
