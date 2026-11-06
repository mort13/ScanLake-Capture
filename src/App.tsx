import { useState } from 'react'
import { SessionProvider } from './store/SessionStore'
import { SessionList } from './components/SessionList'
import { SessionView } from './components/SessionView'
import { UserSettings } from './components/UserSettings'
import { AboutModal } from './components/AboutModal'
import { DiscordAvatar } from './components/DiscordAvatar'
import { UserStore } from './store/UserStore'
import { useAccount } from './store/AccountStore'
import { accountDisplayName } from './services/AccountService'
import './styles/theme.css'
import './styles/index.css'

export default function App() {
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  // Re-renders the header when the account restores the user ID or profile
  const { state: accountState, dismissNotice } = useAccount()
  const account = accountState.account
  const profile = UserStore.loadProfile()

  const needsSetup = !profile.userName

  return (
    <SessionProvider>
      <div className="app">
        <header className="app-header">
          <h1>
            {/* Back to the landing page; the mark is the same drawing as public/favicon.svg */}
            <a className="brand" href="https://scanlake.rocks/" title="ScanLake home">
              <svg className="logo-mark" width="16" height="16" viewBox="0 0 16 16" shapeRendering="crispEdges" aria-hidden="true">
                <path fill="currentColor" fillRule="evenodd" d="M7 1h2v1h1v1h1v1h1v1h1v1h1v1h1v2h-1v1h-1v1h-1v1h-1v1h-1v1h-1v1H7v-1H6v-1H5v-1H4v-1H3v-1H2V9H1V7h1V6h1V5h1V4h1V3h1V2h1zM7 3h2v1h1v1h1v1h1v1h1v2h-1v1h-1v1h-1v1h-1v1H7v-1H6v-1H5v-1H4V9H3V7h1V6h1V5h1V4h1zM7 5h2v1h1v1h1v2h-1v1h-1v1H7v-1H6V9H5V7h1V6h1z" />
              </svg>
              ScanLake
            </a>{' '}
            Capture
          </h1>
          <div className="header-right">
            {profile.userName && (
              <span className="user-badge">
                {account && (
                  <span className="discord-marker" title={`Linked with Discord as ${accountDisplayName(account)}`}>
                    <DiscordAvatar account={account} size={16} />
                  </span>
                )}
                {profile.userName}{profile.org ? ` (${profile.org})` : ''}
              </span>
            )}
            <button onClick={() => setAboutOpen(true)} className="btn-settings">About</button>
            <button onClick={() => setSettingsOpen(true)} className="btn-settings">Settings</button>
          </div>
        </header>

        <main className="app-main">
          {accountState.notice && (
            <div className="account-notice">
              <span>{accountState.notice}</span>
              <button onClick={dismissNotice} className="btn-icon" aria-label="Dismiss">×</button>
            </div>
          )}

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
