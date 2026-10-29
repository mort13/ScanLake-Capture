import { useState, useEffect } from 'react'
import { UserStore } from '../store/UserStore'
import { IndexedDBCache } from '../store/IndexedDBCache'
import { useAccount } from '../store/AccountStore'
import { accountDisplayName } from '../services/AccountService'
import { DiscordAvatar } from './DiscordAvatar'
import type { UserProfile, UserSettings as UserSettingsType } from '../types'

interface ShipProfileEntry {
  key: string
  label: string
  file: string
}

interface Props {
  open: boolean
  onClose: () => void
}

type HotkeyField = 'capture' | 'save' | 'newCluster'

export function UserSettings({ open, onClose }: Props) {
  const [profile, setProfile] = useState<UserProfile>(UserStore.loadProfile)
  const [settings, setSettings] = useState<UserSettingsType>(UserStore.loadSettings)
  const [saved, setSaved] = useState(false)
  const [listeningFor, setListeningFor] = useState<HotkeyField | null>(null)
  const [shipProfiles, setShipProfiles] = useState<ShipProfileEntry[]>([])
  const { state: accountState, login, logout, unlink, pushProfile } = useAccount()
  const account = accountState.account
  const [prevOpen, setPrevOpen] = useState(open)
  const [prevProfileVersion, setPrevProfileVersion] = useState(accountState.profileVersion)

  useEffect(() => {
    fetch('/profiles/manifest.json')
      .then(r => r.ok ? r.json() : [])
      .then((entries: ShipProfileEntry[]) => setShipProfiles(entries))
      .catch(() => setShipProfiles([]))
  }, [])

  // Reload the form each time the modal opens
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) {
      setProfile(UserStore.loadProfile())
      setSettings(UserStore.loadSettings())
      setSaved(false)
      setListeningFor(null)
    }
  }

  // The account restored the user ID or profile: take it over without dropping unsaved edits
  if (accountState.profileVersion !== prevProfileVersion) {
    setPrevProfileVersion(accountState.profileVersion)
    const stored = UserStore.loadProfile()
    setProfile(p => ({
      ...p,
      userId: stored.userId,
      userName: p.userName || stored.userName,
      org: p.org || stored.org,
    }))
  }

  useEffect(() => {
    if (!listeningFor) return
    function onKeyDown(e: KeyboardEvent) {
      e.preventDefault()
      setSettings(s => ({ ...s, hotkeys: { ...s.hotkeys, [listeningFor!]: e.key } }))
      setListeningFor(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [listeningFor])

  function handleSave() {
    UserStore.saveProfile(profile)
    UserStore.saveSettings(settings)
    if (account) {
      pushProfile(profile.userName, profile.org).catch(err => console.warn('Profile sync failed:', err))
    }
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  async function handleLogout() {
    try {
      await logout()
    } catch {
      alert('Could not reach the login service. Please try again.')
    }
  }

  async function handleUnlink() {
    if (!confirm('Unlink Discord?\n\nThis deletes your ScanLake login and the links to all your User IDs. Your current User ID stays on this device, but it can no longer be restored after clearing the cache.')) return
    try {
      await unlink()
    } catch {
      alert('Could not reach the login service. Please try again.')
    }
  }

  const userIdLinked = !!account?.userIds.includes(profile.userId)

  function handleClearCache() {
    const idWarning = userIdLinked
      ? 'You will LOSE all local data. Your User ID is linked with Discord and is restored after you log in.'
      : 'You will LOSE your User ID and all local data. Link with Discord first to get your User ID back afterwards.'
    if (confirm(`⚠️ WARNING: This will clear all cached sessions and scans.\n\n${idWarning}\n\nAre you absolutely sure?`)) {
      localStorage.clear()
      indexedDB.databases().then(dbs => {
        dbs.forEach(db => {
          if (db.name) indexedDB.deleteDatabase(db.name)
        })
      })
      alert('Cache cleared. Page will reload.')
      window.location.reload()
    }
  }

  if (!open) return null

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>User Settings</h2>

        <div className="modal-body">
          <div className="settings-section account-section">
            <h3>Discord account</h3>
            {account ? (
              <div className="account-row">
                <DiscordAvatar account={account} size={40} />
                <div className="account-info">
                  <strong>{accountDisplayName(account)}</strong>
                  <span className="small-text">
                    @{account.discord.username} · {account.userIds.length} linked User ID{account.userIds.length === 1 ? '' : 's'}
                  </span>
                </div>
                <div className="account-actions">
                  <button type="button" onClick={handleLogout} className="btn-cancel">Log out</button>
                  <button type="button" onClick={handleUnlink} className="btn-danger">Unlink Discord</button>
                </div>
              </div>
            ) : (
              <div className="account-row">
                <button type="button" onClick={login} className="btn-discord" disabled={accountState.status === 'loading'}>
                  Link with Discord
                </button>
                <div className="account-info">
                  <span className="small-text">Only your Discord ID and name are stored — no email.</span>
                  <span className="small-text">Your User ID is then restored after clearing the cache or on another PC.</span>
                </div>
              </div>
            )}
            {accountState.status === 'offline' && (
              <p className="small-text">Login service unreachable — Capture keeps working without it.</p>
            )}
            {accountState.notice && <p className="account-notice">{accountState.notice}</p>}
          </div>

          <div className="settings-section">
          <label>
            User ID
            <input type="text" value={profile.userId} readOnly className="readonly" />
          </label>
          <label>
            User Name
            <input type="text" value={profile.userName}
              onChange={e => setProfile(p => ({ ...p, userName: e.target.value }))}
              placeholder="Your display name" />
          </label>
          <label>
            Organization
            <input type="text" value={profile.org}
              onChange={e => setProfile(p => ({ ...p, org: e.target.value }))}
              placeholder="Your organization" />
          </label>
        </div>

        <div className="settings-section">
          <h3>Preferences</h3>
          <label>
            Ship Profile
            <select
              value={settings.selectedShipProfile}
              onChange={e => setSettings(s => ({ ...s, selectedShipProfile: e.target.value }))}
            >
              {shipProfiles.map(p => (
                <option key={p.key} value={p.file}>{p.label}</option>
              ))}
            </select>
          </label>
          <label>
            Capture Resolution
            <select
              value={settings.captureResolution ?? ''}
              onChange={e => setSettings(s => ({ ...s, captureResolution: e.target.value }))}
            >
              <option value="">Auto-detect</option>
              <option value="2560x1440">2560×1440 (1440p — native)</option>
              <option value="1920x1080">1920×1080 (1080p)</option>
              <option value="3840x2160">3840×2160 (4K)</option>
              <option value="1280x720">1280×720 (720p)</option>
              <option value="1600x900">1600×900 (900p)</option>
              <option value="2048x1152">2048×1152</option>
              <option value="3200x1800">3200×1800 (1800p)</option>
              <option value="3440x1440">3440×1440 (ultrawide, same scale as 2560×1440)</option>
              <option value="5120x2880">5120×2880 (5K)</option>
            </select>
          </label>
          <label className="checkbox-label">
            <input type="checkbox" checked={settings.autoDownload}
              onChange={e => setSettings(s => ({ ...s, autoDownload: e.target.checked }))} />
            Auto-download parquets on session close
          </label>
          <label className="checkbox-label">
            <input type="checkbox" checked={settings.autoArchive}
              onChange={e => setSettings(s => ({ ...s, autoArchive: e.target.checked }))} />
            Auto-archive after successful upload
          </label>
        </div>

        <div className="settings-section">
          <h3>Hotkeys</h3>
          {(['capture', 'save', 'newCluster'] as HotkeyField[]).map(field => {
            const labels: Record<HotkeyField, string> = { capture: 'Capture', save: 'Save Scan', newCluster: 'New Cluster' }
            const isListening = listeningFor === field
            return (
              <div key={field} className="hotkey-row">
                <span className="hotkey-label">{labels[field]}</span>
                <button
                  type="button"
                  className={`hotkey-bind-btn${isListening ? ' listening' : ''}`}
                  onClick={() => setListeningFor(isListening ? null : field)}
                >
                  {isListening ? 'Press any key…' : settings.hotkeys[field]}
                </button>
              </div>
            )
          })}
        </div>

        <div className="settings-section danger">
          <h3>Danger Zone</h3>
          <button
            type="button"
            onClick={() => {
              IndexedDBCache.deleteScalingFactor(settings.selectedShipProfile).then(() => {
                alert('Scale cache cleared — will re-detect on next capture.')
              })
            }}
            className="btn-warning"
          >
            Reset Scale Detection
          </button>
          <p className="small-text">Forces scale re-detection on the next capture for the current ship profile. Only relevant when Capture Resolution is set to Auto-detect.</p>
          <button onClick={handleClearCache} className="btn-danger">
            Clear All Cache
          </button>
          <p className="small-text">Clears all sessions, scans, and your User ID from localStorage and IndexedDB. A User ID linked with Discord is restored after logging in (the Discord login itself survives the clear).</p>
          <p className="small-text">Cache size estimate: ~100 scans ≈ 0.2–0.5 MB — store thousands of scans locally before closing the session.</p>
        </div>

        </div>{/* modal-body */}

        <div className="modal-actions">
          <button onClick={handleSave} className="btn-save">
            {saved ? 'Saved!' : 'Save'}
          </button>
          <button onClick={onClose} className="btn-cancel">Close</button>
        </div>
      </div>
    </div>
  )
}

