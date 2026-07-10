import React from 'react'
import { useApp } from './state/store.jsx'
import MainScreen from './screens/MainScreen.jsx'
import Daybook from './screens/Daybook.jsx'
import Udhar from './screens/Udhar.jsx'
import UdharForm from './components/UdharForm.jsx'
import AkhrajatForm from './components/AkhrajatForm.jsx'

export default function App() {
  const { screen, udharOpen, closeUdhar, akhrajatOpen, closeAkhrajat } = useApp()
  return (
    <div className="h-screen w-screen overflow-hidden bg-panel">
      {screen === 'main' && <MainScreen />}
      {screen === 'daybook' && <Daybook />}
      {screen === 'udhar' && <Udhar />}
      {/* ادھار form + report — opened from the top "ادھار" tab, overlays any screen */}
      <UdharForm open={udharOpen} onClose={closeUdhar} />
      {/* اخراجات (expenses) form — opened from the top "اخراجات" tab */}
      <AkhrajatForm open={akhrajatOpen} onClose={closeAkhrajat} />
    </div>
  )
}
