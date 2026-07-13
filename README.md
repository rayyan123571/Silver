# Silver

Chaudhry Silver — desktop app (Electron + React + Vite + Tailwind).

A SEPARATE application from the Gold Lab app: its own `appId`, installer,
shortcut and Electron `userData` folder, so both can be installed side by side on
one PC without sharing or overwriting each other's data.

- Database: `silver.sqlite` in the Electron `userData` folder (`%APPDATA%\silver-app`)
- Automatic backups: `D:\Silver Backup` (`SilverAutoBackup.sqlite`)
- Trial / licence state: `trial.dat`, `install.id`, `license.dat` — all inside the
  same per-app `userData` folder, so Silver's trial is independent of Gold's.

## Scripts

- `npm run dev` — Vite + Electron in development
- `npm run build` — build the renderer
- `npm run dist:win` — packaged Windows installer
