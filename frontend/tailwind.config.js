/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        'iim-blue': '#1E3A8A',
        'iim-gold': '#D97706',
        'surface-bg': '#F8FAFC',
      },
      boxShadow: {
        soft: '0 18px 45px rgba(15, 23, 42, 0.08)',
        'glow-blue': '0 0 0 1px rgba(30, 58, 138, 0.25), 0 14px 36px rgba(30, 58, 138, 0.35)',
        'glow-gold': '0 0 0 1px rgba(217, 119, 6, 0.35), 0 16px 40px rgba(217, 119, 6, 0.35)',
      },
      backgroundImage: {
        'hero-mesh':
          'radial-gradient(circle at 20% 20%, rgba(30,58,138,0.24), transparent 52%), radial-gradient(circle at 80% 0%, rgba(217,119,6,0.20), transparent 44%), linear-gradient(135deg, #eaf0ff 0%, #f8fafc 55%, #eef7ff 100%)',
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-6px)' },
        },
      },
      animation: {
        float: 'float 4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
