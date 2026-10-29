import { useState } from 'react'
import { accountDisplayName } from '../services/AccountService'
import type { AccountInfo } from '../types'

interface Props {
  account: AccountInfo
  size: number
}

export function DiscordAvatar({ account, size }: Props) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const url = account.discord.avatarUrl

  // No avatar set on Discord, or the CDN image failed: show the name's initial
  if (!url || url === failedUrl) {
    return (
      <span className="discord-avatar fallback" style={{ width: size, height: size, fontSize: size * 0.5 }}>
        {accountDisplayName(account).charAt(0).toUpperCase()}
      </span>
    )
  }
  return (
    <img className="discord-avatar" src={url} alt="" width={size} height={size}
      onError={() => setFailedUrl(url)} />
  )
}
