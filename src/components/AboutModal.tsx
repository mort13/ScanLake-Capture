interface Props {
  open: boolean
  onClose: () => void
}

export function AboutModal({ open, onClose }: Props) {
  if (!open) return null

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal about-modal" onClick={e => e.stopPropagation()}>
        <h2>About ScanLake Capture</h2>
        <p className="about-tagline">
          A web-based OCR tool for capturing and recording rock scan data from in-game screenshots.
        </p>

        <h3>How To Use</h3>

        <ol className="about-steps">
          <li>
            <strong>Set up your profile</strong> — Click <em>Settings</em> in the top-right corner.
            Enter your username, organisation, and select the ship profile that matches your ship.
            Optionally configure hotkeys for faster workflow.
          </li>
          <li>
            <strong>Create a session</strong> — Click <em>+ New Session</em>, choose a star system
            and gravity well, then open the session.
          </li>
          <li>
            <strong>Capture a scan</strong> — Inside a session, click <em>Capture Screen</em> to
            select a screen region. Position the capture box over the rock scanner readout, then
            confirm. The OCR pipeline will automatically detect the anchor points, extract ROIs,
            and recognise the values.
          </li>
          <li>
            <strong>Review and correct</strong> — Inspect the detected material rows. Edit any
            field that was mis-read, then click <em>Save Scan</em>. A green validation badge
            confirms the data is valid (amounts sum to 100 %, mass/volume ratio is in range, etc.).
          </li>
          <li>
            <strong>Close or archive a session</strong> — When you are done scanning a cluster,
            close or archive the session from the session list. Archived sessions are uploaded and
            removed from local storage.
          </li>
          <li>
            <strong>Export data</strong> — Download any session as Parquet files (scans +
            compositions) using the download button on the session list.
          </li>
        </ol>

        <h3>Tips</h3>
        <ul className="about-tips">
          <li>Keep the in-game scanner readout fully visible and unobscured before capturing.</li>
          <li>Use the hotkeys (configurable in Settings) to speed up the capture → save loop.</li>
          <li>The preview overlay shows what the OCR sees — use it to diagnose recognition issues.</li>
          <li>Material amounts must sum to 100 %. The validation badge will highlight any errors.</li>
        </ul>

        <div className="modal-actions">
          <button className="btn-primary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
