import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{js,ts,jsx,tsx,mdx}', './components/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        primary: '#2457D6',
        navy: '#172554',
        ink: '#020c1c',
        panel: '#0d1c2d',
        line: '#dfe4ec'
      }
    }
  },
  plugins: []
};

export default config;
