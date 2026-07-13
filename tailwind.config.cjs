/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // ── Cool Slate / Silver palette ──────────────────────────────────────
        // The screen used to be white cards on a near-white page, so nothing had
        // depth — everything read as one flat glaring sheet. `panel` is now a soft
        // blue-grey PAGE colour: the white cards sit on top of it and visibly lift.
        // Silver is a cool metal, so the whole scheme is cool-toned.
        panel: '#e8ecf2',        // page background (was #d2d2d2 flat grey)
        cardLine: '#dce2ea',     // hairline border on cards
        // Header strip: a DARK steel slate with white text, so every section
        // header (نیا سودا, the نقد/ادھار table headers, the two receipt titles)
        // reads as a solid band and the structure is immediately obvious. It was a
        // pale #e9edf2, which barely separated from the white card beneath it.
        // Tuned to sit in the same family as `accent` so the screen stays cohesive.
        headStrip: '#3e5871',    // dark header band
        headText: '#ffffff',     // header text on that band
        headBorder: '#32485d',   // slightly darker edge under the band
        accent: '#3b6091',       // steel blue — primary actions (Save, +, focus)
        accentDark: '#2f4d75',   // pressed / hover
        accentSoft: '#e7eef7',   // tinted accent surface

        // Unchanged, deliberately: these carry MEANING, not decoration.
        mint: '#cdebcf',        // green — marks the editable چاندی وزن / کیش cells
        mintDark: '#bfe3c2',
        yellowCell: '#fbf7c8',  // yellow — totals / balance cells
        statusGreen: '#1f9d3a', // bottom status bar metric boxes
        statusGreenText: '#eaffef',
        redX: '#d11a1a',        // destructive / negative

        // Legacy greys kept so nothing that still references them breaks.
        header: '#bfbfbf',
        headerDark: '#a4a4a4',
        sunken: '#7f7f7f',
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
