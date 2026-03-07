import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      colors: {
        surface: '#0a0a0f',
        accent: '#6366f1',
        success: '#10b981',
        warning: '#f59e0b',
        danger: '#ef4444',
        card: 'rgba(255,255,255,0.05)',
        'card-border': 'rgba(255,255,255,0.10)',
      },
      backdropBlur: {
        glass: '20px',
      },
      borderRadius: {
        glass: '16px',
      },
      boxShadow: {
        'glow-green': '0 0 12px rgba(16,185,129,0.5)',
        'glow-red': '0 0 12px rgba(239,68,68,0.5)',
      },
    },
  },
  plugins: [],
};

export default config;
