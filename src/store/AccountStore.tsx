import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import { IndexedDBCache } from './IndexedDBCache'
import { UserStore } from './UserStore'
import * as AccountService from '../services/AccountService'
import { clearToken } from '../services/AuthService'
import type { AccountInfo } from '../types'

type AccountStatus = 'loading' | 'ready' | 'offline'

interface AccountState {
  account: AccountInfo | null // null = logged out (or login service unreachable)
  status: AccountStatus
  notice: string | null // e.g. the local ID is owned by another Discord account
  profileVersion: number // bumped whenever the local profile was changed from the account
}

interface ReconcileResult {
  account: AccountInfo | null
  status: AccountStatus
  notice: string | null
  profileChanged: boolean
}

/** A local ID is worth linking if the account has no primary yet, or if it has sessions on this device. */
async function isWorthLinking(me: AccountInfo, localId: string): Promise<boolean> {
  if (!me.primaryUserId) return true
  try {
    const sessions = await IndexedDBCache.getAllSessions()
    return sessions.some(s => s.userId === localId)
  } catch {
    return false
  }
}

async function reconcile(): Promise<ReconcileResult> {
  let me: AccountInfo | null
  try {
    me = await AccountService.fetchMe()
  } catch (err) {
    // Offline or auth worker down: Capture keeps working with the local profile only
    console.warn('Login service unreachable:', err)
    return { account: null, status: 'offline', notice: null, profileChanged: false }
  }
  if (!me) {
    return { account: null, status: 'ready', notice: null, profileChanged: false }
  }

  let notice: string | null = null

  // 1. Link the local ID unless it is an unused fresh one
  const localId = UserStore.loadProfile().userId
  if (!me.userIds.includes(localId) && await isWorthLinking(me, localId)) {
    try {
      me = await AccountService.linkUserId(localId)
    } catch (err) {
      if (err instanceof AccountService.UserIdConflictError) {
        notice = err.message
      } else {
        console.warn('Linking user ID failed:', err)
      }
    }
  }

  // 2. The primary ID always wins on this device; 3. fill empty name/org from the account.
  // Re-read the profile so edits saved while the requests were in flight are kept.
  const profile = UserStore.loadProfile()
  const next = {
    ...profile,
    userId: me.primaryUserId ?? profile.userId,
    userName: profile.userName || me.profile.userName,
    org: profile.org || me.profile.org,
  }
  const profileChanged = next.userId !== profile.userId
    || next.userName !== profile.userName
    || next.org !== profile.org
  if (profileChanged) {
    UserStore.saveProfile(next)
    // The cached upload token belongs to the previous ID
    if (next.userId !== profile.userId) clearToken()
  }

  // 3. The server's copy is empty: push the local values
  if ((!me.profile.userName && next.userName) || (!me.profile.org && next.org)) {
    try {
      me = await AccountService.pushProfile(next.userName, next.org)
    } catch (err) {
      console.warn('Profile sync failed:', err)
    }
  }

  return { account: me, status: 'ready', notice, profileChanged }
}

// Shared across StrictMode's double-run effect so linking happens once per page load
let reconcilePromise: Promise<ReconcileResult> | null = null

interface AccountContextValue {
  state: AccountState
  login: () => void
  logout: () => Promise<void>
  unlink: () => Promise<void>
  pushProfile: (userName: string, org: string) => Promise<void>
  dismissNotice: () => void
}

const AccountContext = createContext<AccountContextValue | null>(null)

export function AccountProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AccountState>({
    account: null,
    status: 'loading',
    notice: null,
    profileVersion: 0,
  })

  useEffect(() => {
    let cancelled = false
    reconcilePromise ??= reconcile().catch((err): ReconcileResult => {
      console.warn('Account reconcile failed:', err)
      return { account: null, status: 'offline', notice: null, profileChanged: false }
    })
    reconcilePromise.then(result => {
      if (cancelled) return
      setState(s => ({
        account: result.account,
        status: result.status,
        notice: result.notice,
        profileVersion: result.profileChanged ? s.profileVersion + 1 : s.profileVersion,
      }))
    })
    return () => { cancelled = true }
  }, [])

  const login = useCallback(() => {
    window.location.href = AccountService.loginUrl()
  }, [])

  const logout = useCallback(async () => {
    await AccountService.logout()
    setState(s => ({ ...s, account: null, status: 'ready', notice: null }))
  }, [])

  const unlink = useCallback(async () => {
    await AccountService.unlink()
    setState(s => ({ ...s, account: null, status: 'ready', notice: null }))
  }, [])

  const pushProfile = useCallback(async (userName: string, org: string) => {
    const account = await AccountService.pushProfile(userName, org)
    setState(s => ({ ...s, account }))
  }, [])

  const dismissNotice = useCallback(() => {
    setState(s => ({ ...s, notice: null }))
  }, [])

  return (
    <AccountContext.Provider value={{
      state,
      login,
      logout,
      unlink,
      pushProfile,
      dismissNotice,
    }}>
      {children}
    </AccountContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAccount() {
  const ctx = useContext(AccountContext)
  if (!ctx) throw new Error('useAccount must be used within AccountProvider')
  return ctx
}
