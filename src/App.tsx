import { useState } from 'react'
import { SessionProvider } from './store/SessionStore'
import { SessionList } from './components/SessionList'
import { SessionView } from './components/SessionView'
import { UserSettings } from './components/UserSettings'
import { AboutModal } from './components/AboutModal'
import { UserStore } from './store/UserStore'
import './styles/index.css'

export default function App() {
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const profile = UserStore.loadProfile()

  const needsSetup = !profile.userName

  return (
    <SessionProvider>
      <div className="app">
        <header className="app-header">
          <h1>ScanLake Capture</h1>
          <div className="header-right">
            {profile.userName && (
              <span className="user-badge">{profile.userName}{profile.org ? ` (${profile.org})` : ''}</span>
            )}
            <button onClick={() => setAboutOpen(true)} className="btn-settings">About</button>
            <button onClick={() => setSettingsOpen(true)} className="btn-settings">Settings</button>
          </div>
        </header>

        <main className="app-main">
          {needsSetup && !settingsOpen && (
            <div className="setup-prompt">
              <p>Welcome to ScanLake Capture. Please set up your profile to get started.</p>
              <button onClick={() => setSettingsOpen(true)} className="btn-primary">Set Up Profile</button>
            </div>
          )}

          {activeSessionId ? (
            <SessionView
              sessionId={activeSessionId}
              onBack={() => setActiveSessionId(null)}
            />
          ) : (
            <SessionList onOpenSession={setActiveSessionId} />
          )}
        </main>

        <UserSettings open={settingsOpen} onClose={() => setSettingsOpen(false)} />
        <AboutModal open={aboutOpen} onClose={() => setAboutOpen(false)} />
      </div>
    </SessionProvider>
  )
}
