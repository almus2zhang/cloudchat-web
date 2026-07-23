/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bgPrimary: '#0f172a',
        bgSecondary: '#1e293b',
        accentColor: '#6366f1',
        accentHover: '#4f46e5',
        textPrimary: '#f8fafc',
        textSecondary: '#cbd5e1',
        textMuted: '#64748b',
        borderColor: '#334155',
      }
    },
  },
  plugins: [],
}
