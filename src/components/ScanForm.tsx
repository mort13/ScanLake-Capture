import { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import { UserStore } from '../store/UserStore'
import { v4 as uuidv4 } from 'uuid'
import { Autocomplete } from './Autocomplete'
import { MaterialRow } from './MaterialRow'
import { ValidationBadge } from './ValidationBadge'
import { OcrStatus } from './OcrStatus'
import { CaptureOverlay } from './CaptureOverlay'
import { CapturePreview } from './CapturePreview'
import { DEPOSIT_TYPES } from '../data/deposits'
import { REGIONS_BY_GRAVITY_WELL } from '../data/regions'
import { useSession } from '../store/SessionStore'
import { IndexedDBCache } from '../store/IndexedDBCache'
import { runPipeline } from '../ocr/OcrPipeline'
import { runPreviewPipeline, type PipelinePreviewResult } from '../ocr/PreviewPipeline'
import { stopStream } from '../ocr/ScreenCapture'
import type { CaptureRegion, OcrStatus as OcrStatusType } from '../ocr/types'
import type { Session, Scan, Material, MaterialFormRow, ScanFormData, ValidationResult } from '../types'

interface Props {
  session: Session
  onSessionUpdated: (session: Session) => void
}

const EMPTY_MATERIAL: MaterialFormRow = { type: '', amount: '', quality: '' }

function isRowFilled(row: MaterialFormRow): boolean {
  return row.type !== '' || row.amount !== '' || row.quality !== ''
}

function isRowComplete(row: MaterialFormRow): boolean {
  return row.type !== '' && row.amount !== '' && row.quality !== ''
}

function validate(form: ScanFormData, _session: Session, getClusterDeposit: (id: string) => string | undefined, clusterId: string): ValidationResult {
  const errors: string[] = []
  const filledRows = form.materials.filter(isRowFilled)
  const completeRows = filledRows.filter(isRowComplete)
  const incompleteRows = filledRows.filter(r => !isRowComplete(r))

  // Material completeness
  if (incompleteRows.length > 0) {
    errors.push(`${incompleteRows.length} material row(s) are incomplete (need type, amount, and quality)`)
  }

  // Amount sum check
  if (completeRows.length > 0) {
    const sum = completeRows.reduce((s, r) => s + parseFloat(r.amount), 0)
    const tolerance = 0.009 * completeRows.length
    if (Math.abs(sum - 100) > tolerance) {
      errors.push(`Material amounts sum to ${sum.toFixed(2)}%, expected 100% (\u00b1${tolerance.toFixed(3)}%)`)
    }
  }

  // Mass / volume ratio
  const mass = parseFloat(form.mass)
  const volume = parseFloat(form.volume)
  if (mass && volume && mass < 100 * volume) {
    errors.push(`Mass (${mass}) must be at least 100\u00d7 volume (${volume}) = ${(100 * volume).toFixed(1)}`)
  }

  // Cluster deposit consistency
  const existingDeposit = getClusterDeposit(clusterId)
  if (existingDeposit && form.deposit && existingDeposit !== form.deposit) {
    errors.push(`Cluster deposit must be "${existingDeposit}", got "${form.deposit}"`)
  }

  // Basic required fields
  if (!form.deposit) errors.push('Deposit type is required')
  if (!form.mass || isNaN(mass)) errors.push('Mass is required')
  if (!form.resistance && form.resistance !== '0') errors.push('Resistance is required')
  if (!form.instability && form.instability !== '0') errors.push('Instability is required')
  if (!form.volume || isNaN(volume)) errors.push('Volume is required')
  if (completeRows.length === 0) errors.push('At least one complete material row is required')

  return { valid: errors.length === 0, errors }
}

export function ScanForm({ session, onSessionUpdated }: Props) {
  const { addScan, getClusterDeposit, state } = useSession()
  const [hotkeys, setHotkeys] = useState(() => UserStore.loadSettings().hotkeys)
  const [clusterId, setClusterId] = useState(session.clusterHistory[session.clusterHistory.length - 1])
  const [clusterHistory, setClusterHistory] = useState([...session.clusterHistory])

  const [form, setForm] = useState<ScanFormData>({
    deposit: '',
    region: '',
    mass: '',
    resistance: '',
    instability: '',
    volume: '',
    materials: [{ ...EMPTY_MATERIAL }],
  })

  const [showErrors, setShowErrors] = useState(false)

  // OCR state
  const [ocrStatus, setOcrStatus] = useState<OcrStatusType>('idle')
  const [ocrMessage, setOcrMessage] = useState(() => `Press ${UserStore.loadSettings().hotkeys.capture} to capture`)
  const [ocrConfidence, setOcrConfidence] = useState<number | undefined>(undefined)
  const [captureRegion, setCaptureRegion] = useState<CaptureRegion | null>(null)
  const [showOverlay, setShowOverlay] = useState(false)
  const [previewResult, setPreviewResult] = useState<PipelinePreviewResult | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const saveRef = useRef<() => Promise<void>>(null)

  // Load stored capture region on mount
  useEffect(() => {
    IndexedDBCache.getCaptureRegion().then(r => {
      if (r) setCaptureRegion(r)
    })
    return () => { stopStream() }
  }, [])

  // Pre-fill deposit from cluster
  const clusterDeposit = getClusterDeposit(clusterId)

  const validation = useMemo(
    () => validate(form, session, getClusterDeposit, clusterId),
    [form, session, getClusterDeposit, clusterId],
  )

  // Individual checks for badges
  const filledRows = form.materials.filter(isRowFilled)
  const completeRows = filledRows.filter(isRowComplete)
  const amountSum = completeRows.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0)
  const tolerance = 0.009 * completeRows.length
  const massVal = parseFloat(form.mass) || 0
  const volVal = parseFloat(form.volume) || 0

  const checks = {
    completeness: filledRows.length > 0 && filledRows.every(isRowComplete),
    amountSum: completeRows.length > 0 && Math.abs(amountSum - 100) <= tolerance,
    massVolume: massVal > 0 && volVal > 0 && massVal >= 100 * volVal,
    clusterDeposit: !clusterDeposit || !form.deposit || clusterDeposit === form.deposit,
  }

  function updateField(field: keyof ScanFormData, value: string) {
    const numericFields: (keyof ScanFormData)[] = ['mass', 'resistance', 'instability', 'volume']
    const v = numericFields.includes(field) ? value.replace(/,/g, '.') : value
    setForm(f => ({ ...f, [field]: v }))
  }

  function updateMaterial(index: number, field: keyof MaterialFormRow, value: string) {
    const numericFields: (keyof MaterialFormRow)[] = ['amount', 'quality']
    const v = numericFields.includes(field) ? value.replace(/,/g, '.') : value
    setForm(f => {
      const mats = [...f.materials]
      mats[index] = { ...mats[index], [field]: v }
      return { ...f, materials: mats }
    })
  }

  function removeMaterial(index: number) {
    setForm(f => ({
      ...f,
      materials: f.materials.filter((_, i) => i !== index),
    }))
  }

  function addMaterialRow() {
    setForm(f => ({ ...f, materials: [...f.materials, { ...EMPTY_MATERIAL }] }))
  }

  const newCluster = useCallback(() => {
    const id = uuidv4()
    setClusterHistory(h => [...h, id])
    setClusterId(id)
    // Clear deposit when switching to new cluster
    setForm(f => ({ ...f, deposit: '' }))
    // Update session cluster history
    const updated = { ...session, clusterHistory: [...clusterHistory, id] }
    onSessionUpdated(updated)
  }, [session, clusterHistory, onSessionUpdated])

  function prevCluster() {
    const idx = clusterHistory.indexOf(clusterId)
    if (idx > 0) {
      setClusterId(clusterHistory[idx - 1])
    }
  }

  function nextCluster() {
    const idx = clusterHistory.indexOf(clusterId)
    if (idx < clusterHistory.length - 1) {
      setClusterId(clusterHistory[idx + 1])
    }
  }

  async function handleSave() {
    setShowErrors(true)
    if (!validation.valid) return

    const captureId = uuidv4()
    const norm = (s: string) => s.replace(/,/g, '.')
    const volume = parseFloat(norm(form.volume))
    const scan: Scan = {
      captureId,
      sessionId: session.sessionId,
      userId: session.userId,
      userName: session.userName,
      org: session.org,
      clusterId,
      timestamp: new Date().toISOString(),
      system: session.system,
      gravityWell: session.gravityWell,
      region: form.region.trim() || 'none',
      place: 'none',
      deposit: form.deposit,
      depositConf: 1.0,
      mass: parseInt(norm(form.mass), 10),
      massConf: 1.0,
      resistance: parseInt(norm(form.resistance), 10),
      resistanceConf: 1.0,
      instability: parseFloat(norm(form.instability)),
      instabilityConf: 1.0,
      volume,
      volumeConf: 1.0,
    }

    const materials: Material[] = completeRows.map((r, i) => {
      const amount = Math.round(parseFloat(norm(r.amount)) * 100) / 100
      return {
        captureId,
        matIndex: i,
        type: r.type,
        amount,
        quality: parseInt(norm(r.quality), 10),
        materialVolume: Math.round((volume * amount / 100) * 100) / 100,
        minConfidence: 1.0,
      }
    })

    await addScan(scan, materials)

    // Reset form but keep deposit if same cluster
    setForm({
      deposit: clusterDeposit || form.deposit,
      region: form.region,
      mass: '',
      resistance: '',
      instability: '',
      volume: '',
      materials: [{ ...EMPTY_MATERIAL }],
    })
    setShowErrors(false)
  }

  // Keep saveRef current for F10 handler
  saveRef.current = handleSave

  // OCR capture handler
  const handleOcrCapture = useCallback(async () => {
    if (!captureRegion) {
      setShowOverlay(true)
      return
    }
    if (ocrStatus === 'capturing' || ocrStatus === 'processing') return

    try {
      setOcrStatus('capturing')
      setOcrMessage('Capturing...')
      setOcrConfidence(undefined)

      const result = await runPipeline(captureRegion, (stage) => {
        setOcrStatus('processing')
        setOcrMessage(stage)
      })

      setForm(result.formData)
      const avgConf = result.confidences.size > 0
        ? [...result.confidences.values()].reduce((a, b) => a + b, 0) / result.confidences.size
        : 0
      setOcrConfidence(avgConf)
      setOcrStatus('success')
      setOcrMessage('Scan captured successfully')
      setShowErrors(false)
    } catch (e) {
      setOcrStatus('error')
      setOcrMessage(e instanceof Error ? e.message : 'OCR failed')
      setOcrConfidence(undefined)
    }
  }, [captureRegion, ocrStatus])

  // Reload hotkeys when settings change (e.g. user saves settings)
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === 'scanlake_user_settings') {
        setHotkeys(UserStore.loadSettings().hotkeys)
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  // Global key listeners (configurable)
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === hotkeys.capture) {
        e.preventDefault()
        handleOcrCapture()
      } else if (e.key === hotkeys.save) {
        e.preventDefault()
        saveRef.current?.()
      } else if (e.key === hotkeys.newCluster) {
        e.preventDefault()
        newCluster()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [hotkeys, handleOcrCapture, newCluster])

  const handlePreviewCapture = useCallback(async () => {
    if (!captureRegion) { setShowOverlay(true); return }
    if (previewLoading) return
    setPreviewLoading(true)
    setOcrMessage('Generating preview...')
    setOcrStatus('processing')
    try {
      const result = await runPreviewPipeline(captureRegion, (msg) => setOcrMessage(msg))
      setPreviewResult(result)
      setOcrStatus('idle')
      setOcrMessage(`Press ${hotkeys.capture} to capture`)
    } catch (e) {
      setOcrStatus('error')
      setOcrMessage(e instanceof Error ? e.message : 'Preview failed')
    } finally {
      setPreviewLoading(false)
    }
  }, [captureRegion, previewLoading, hotkeys])

  function handleRegionSelected(region: CaptureRegion) {
    setCaptureRegion(region)
    IndexedDBCache.saveCaptureRegion(region)
    setShowOverlay(false)
    setOcrMessage(`Region set. Press ${hotkeys.capture} to capture.`)
  }

  // Calculate material_volume preview
  const volume = parseFloat(form.volume) || 0

  return (
    <div className="scan-form">
      {showOverlay && (
        <CaptureOverlay
          onRegionSelected={handleRegionSelected}
          onCancel={() => setShowOverlay(false)}
          existingRegion={captureRegion}
        />
      )}

      {previewResult && (
        <CapturePreview result={previewResult} onClose={() => setPreviewResult(null)} />
      )}

      <div className="ocr-controls">
        <OcrStatus status={ocrStatus} message={ocrMessage} confidence={ocrConfidence} />
        <div className="ocr-buttons">
          <button type="button" onClick={() => setShowOverlay(true)} className="btn-sm">
            {captureRegion ? 'Change OCR Region' : 'Select OCR Region'}
          </button>
          <button type="button" onClick={handlePreviewCapture} className="btn-sm"
            disabled={!captureRegion || previewLoading || ocrStatus === 'capturing' || ocrStatus === 'processing'}>
            {previewLoading ? 'Loading...' : 'Preview'}
          </button>
          <button type="button" onClick={handleOcrCapture} className="btn-primary btn-sm"
            disabled={!captureRegion || ocrStatus === 'capturing' || ocrStatus === 'processing'}>
            Capture ({hotkeys.capture})
          </button>
        </div>
      </div>

      <div className="cluster-control">
        <button type="button" onClick={prevCluster} disabled={clusterHistory.indexOf(clusterId) === 0}>
          &larr; Prev
        </button>
        <span className="cluster-id" title={clusterId}>
          Cluster: {clusterId.slice(0, 8)}&hellip;
        </span>
        <button type="button" onClick={nextCluster} disabled={clusterHistory.indexOf(clusterId) === clusterHistory.length - 1}>
          Next &rarr;
        </button>
        <button type="button" onClick={newCluster} className="btn-new-cluster">+ New Cluster ({hotkeys.newCluster})</button>
      </div>

      <div className="form-grid">
        <label>
          Deposit
          <Autocomplete
            suggestions={DEPOSIT_TYPES}
            value={form.deposit}
            onChange={v => updateField('deposit', v)}
            placeholder="Deposit type"
          />
        </label>
        <label>
          Region
          <Autocomplete
            suggestions={REGIONS_BY_GRAVITY_WELL[session.gravityWell] ?? []}
            value={form.region}
            onChange={v => updateField('region', v)}
            placeholder="Region (optional)"
          />
        </label>
        <label>
          Mass
          <input type="number" step="1" min="0" value={form.mass}
            onChange={e => updateField('mass', e.target.value)} placeholder="Mass (int)" />
        </label>
        <label>
          Resistance
          <input type="number" step="1" min="0" value={form.resistance}
            onChange={e => updateField('resistance', e.target.value)} placeholder="Resistance (int)" />
        </label>
        <label>
          Instability
          <input type="number" step="0.01" min="0" value={form.instability}
            onChange={e => updateField('instability', e.target.value)} placeholder="Instability" />
        </label>
        <label>
          Volume
          <input type="number" step="0.01" min="0" value={form.volume}
            onChange={e => updateField('volume', e.target.value)} placeholder="Volume" />
        </label>
      </div>

      <div className="materials-section">
        <h4>Materials</h4>
        <div className="material-header">
          <span className="mat-index">#</span>
          <span className="mat-type">Type</span>
          <span className="mat-amount">Amount %</span>
          <span className="mat-quality">Quality</span>
          <span className="mat-volume">Vol (calc)</span>
          <span>&nbsp;</span>
        </div>
        {form.materials.map((row, i) => (
          <div key={i} className="material-row-wrap">
            <MaterialRow
              row={row}
              index={i}
              onChange={updateMaterial}
              onRemove={removeMaterial}
              isPartial={isRowFilled(row) && !isRowComplete(row)}
            />
            <span className="mat-volume-calc">
              {isRowComplete(row) ? (volume * parseFloat(row.amount) / 100).toFixed(2) : '-'}
            </span>
          </div>
        ))}
        <button type="button" onClick={addMaterialRow} className="btn-add-row">+ Add Material</button>
      </div>

      <div className="validation-checks">
        <ValidationBadge label="Rows complete" valid={checks.completeness} />
        <ValidationBadge label={`Sum: ${amountSum.toFixed(2)}%`} valid={checks.amountSum} />
        <ValidationBadge label="Mass/Volume" valid={checks.massVolume}
          message={massVal && volVal ? `${massVal} \u2265 ${(100 * volVal).toFixed(1)}` : ''} />
        <ValidationBadge label="Cluster deposit" valid={checks.clusterDeposit} />
      </div>

      {showErrors && !validation.valid && (
        <div className="validation-errors">
          {validation.errors.map((e, i) => <div key={i} className="error">{e}</div>)}
        </div>
      )}

      <button type="button" onClick={handleSave} className="btn-save">
        Save Scan ({hotkeys.save})
      </button>
      <span className="scan-counter">
        Scans in session: {(state.sessions.find(s => s.sessionId === session.sessionId)?.scanCount ?? 0)}
      </span>
    </div>
  )
}
