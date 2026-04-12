import { useState, useEffect } from 'react'
import { UserStore } from '../store/UserStore'
import { IndexedDBCache } from '../store/IndexedDBCache'
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

  useEffect(() => {
    fetch('/profiles/manifest.json')
      .then(r => r.ok ? r.json() : [])
      .then((entries: ShipProfileEntry[]) => setShipProfiles(entries))
      .catch(() => setShipProfiles([]))
  }, [])

  useEffect(() => {
    if (open) {
      setProfile(UserStore.loadProfile())
      setSettings(UserStore.loadSettings())
      setSaved(false)
      setListeningFor(null)
    }
  }, [open])

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
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  function handleClearCache() {
    if (confirm('⚠️ WARNING: This will clear all cached sessions and scans.\n\nYou will LOSE your User ID and all local data.\n\nAre you absolutely sure?')) {
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
          <p className="small-text">Clears all sessions, scans, and your User ID from localStorage and IndexedDB.</p>
        </div>

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

