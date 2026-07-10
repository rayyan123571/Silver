/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Classic grey Windows palette
        mint: '#cdebcf',        // light green — ONLY for specific highlighted cells
        mintDark: '#bfe3c2',
        header: '#bfbfbf',       // silver table headers
        headerDark: '#a4a4a4',   // darker silver section headers
        panel: '#d2d2d2',        // neutral silver dialog background
        yellowCell: '#fbf7c8',   // yellow highlight cells
        statusGreen: '#1f9d3a',  // bottom green status bars
        statusGreenText: '#eaffef',
        redX: '#d11a1a',         // red X button
        sunken: '#7f7f7f',       // sunken input border
        line: '#9a9a9a'
      },
      fontFamily: {
        urdu: ["'Noto Nastaliq Urdu'", "'Jameel Noori Nastaleeq'", "'Segoe UI'", 'Tahoma', 'sans-serif'],
        ui: ["'Segoe UI'", 'Tahoma', 'sans-serif']
      },
      fontSize: {
        '2xs': '10px',
        '3xs': '9px'
      }
    }
  },
  plugins: []
}
