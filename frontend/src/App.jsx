import { useState, useRef, useEffect } from "react";

// ── CONFIG: Replace with your Render backend URL after deploying ──
const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3001";

// ── Styles ────────────────────────────────────────────────────────
const css = `
  @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Outfit:wght@300;400;500;600&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --red: #ff2b2b;
    --orange: #ff6b00;
    --gold: #ffc844;
    --bg: #080808;
    --surface: #111;
    --surface2: #181818;
    --border: #1f1f1f;
    --muted: #444;
    --text: #e8e8e8;
    --text2: #888;
  }

  body {
    background: var(--bg);
    color: var(--text);
    font-family: 'Outfit', sans-serif;
    min-height: 100vh;
  }

  .noise {
    position: fixed; inset: 0; z-index: 0; pointer-events: none;
    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='0.03'/%3E%3C/svg%3E");
    opacity: 0.4;
  }

  .glow-top {
    position: fixed; top: -200px; left: 50%; transform: translateX(-50%);
    width: 800px; height: 400px;
    background: radial-gradient(ellipse, rgba(255,43,43,0.12) 0%, transparent 70%);
    pointer-events: none; z-index: 0;
  }

  .app { position: relative; z-index: 1; }

  /* Header */
  .header {
    padding: 28px 40px;
    border-bottom: 1px solid var(--border);
    display: flex; align-items: center; justify-content: space-between;
  }

  .brand { display: flex; align-items: baseline; gap: 12px; }

  .logo {
    font-family: 'Bebas Neue', sans-serif;
    font-size: 2.2rem; letter-spacing: 4px;
    background: linear-gradient(120deg, #ff2b2b 0%, #ff6b00 60%, #ffc844 100%);
    -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
  }

  .logo-tag {
    font-size: 0.7rem; letter-spacing: 2px; color: var(--muted);
    text-transform: uppercase; font-weight: 500;
  }

  .beta-badge {
    padding: 4px 10px; border-radius: 4px;
    background: rgba(255,43,43,0.12); border: 1px solid rgba(255,43,43,0.25);
    color: var(--red); font-size: 0.65rem; letter-spacing: 2px; font-weight: 600;
  }

  /* Layout */
  .main {
    max-width: 960px; margin: 0 auto; padding: 48px 24px 80px;
    display: grid; grid-template-columns: 1fr 340px; gap: 32px;
  }

  @media (max-width: 760px) {
    .main { grid-template-columns: 1fr; }
    .header { padding: 20px; }
  }

  /* Left panel */
  .panel-label {
    font-family: 'Bebas Neue', sans-serif;
    font-size: 0.85rem; letter-spacing: 3px; color: var(--red);
    margin-bottom: 10px;
  }

  .block { margin-bottom: 28px; }

  /* Upload zone */
  .upload-zone {
    border: 1.5px dashed var(--border); border-radius: 14px;
    background: var(--surface); padding: 28px 20px;
    text-align: center; cursor: pointer;
    transition: border-color 0.2s, background 0.2s;
  }
  .upload-zone:hover, .upload-zone.drag {
    border-color: var(--red); background: rgba(255,43,43,0.04);
  }
  .upload-zone input { display: none; }
  .upload-icon { font-size: 2rem; margin-bottom: 8px; }
  .upload-text { font-size: 0.85rem; color: var(--text2); line-height: 1.5; }
  .upload-text strong { color: var(--text); }

  /* File list */
  .file-list { margin-top: 12px; display: flex; flex-direction: column; gap: 6px; }

  .file-item {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 8px; padding: 9px 12px;
    display: flex; align-items: center; gap: 10px; font-size: 0.82rem;
  }

  .file-thumb {
    width: 36px; height: 36px; border-radius: 6px; object-fit: cover;
    background: var(--surface2); flex-shrink: 0;
    display: flex; align-items: center; justify-content: center;
    font-size: 1rem; color: var(--muted);
  }

  .file-info { flex: 1; overflow: hidden; }
  .file-name { color: #ccc; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .file-meta { color: var(--muted); font-size: 0.72rem; margin-top: 1px; }

  .file-drag-handle { color: var(--muted); cursor: grab; font-size: 0.9rem; }

  .file-remove {
    background: none; border: none; color: var(--muted); cursor: pointer;
    padding: 3px 7px; border-radius: 4px; font-size: 0.9rem;
    transition: color 0.15s, background 0.15s;
  }
  .file-remove:hover { color: var(--red); background: rgba(255,43,43,0.1); }

  .add-more-btn {
    margin-top: 8px; width: 100%;
    background: none; border: 1px dashed var(--border);
    border-radius: 8px; padding: 8px;
    color: var(--muted); font-size: 0.8rem; cursor: pointer;
    transition: all 0.15s; font-family: 'Outfit', sans-serif;
  }
  .add-more-btn:hover { border-color: var(--red); color: var(--red); }

  /* Music */
  .music-zone {
    border: 1.5px dashed var(--border); border-radius: 12px;
    background: var(--surface); padding: 18px 20px;
    cursor: pointer; display: flex; align-items: center; gap: 14px;
    transition: border-color 0.2s, background 0.2s;
  }
  .music-zone:hover { border-color: var(--orange); background: rgba(255,107,0,0.04); }
  .music-zone input { display: none; }
  .music-icon { font-size: 1.4rem; }
  .music-text { flex: 1; font-size: 0.85rem; }
  .music-text strong { color: var(--text); display: block; }
  .music-text span { color: var(--text2); font-size: 0.78rem; }
  .music-clear {
    background: none; border: none; color: var(--muted); cursor: pointer;
    padding: 4px 8px; border-radius: 4px; font-size: 0.9rem;
    transition: color 0.15s;
  }
  .music-clear:hover { color: var(--red); }

  /* Right panel (settings) */
  .settings-panel {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 16px; padding: 24px; height: fit-content;
    position: sticky; top: 24px;
  }

  .settings-title {
    font-family: 'Bebas Neue', sans-serif;
    font-size: 1.1rem; letter-spacing: 3px; color: var(--text);
    margin-bottom: 20px;
  }

  .setting-block { margin-bottom: 20px; }

  .setting-label {
    font-size: 0.72rem; letter-spacing: 2px; color: var(--muted);
    text-transform: uppercase; font-weight: 600; margin-bottom: 8px;
    display: block;
  }

  .pill-group { display: flex; flex-direction: column; gap: 6px; }

  .pill {
    padding: 10px 14px; border-radius: 8px;
    border: 1.5px solid var(--border); background: transparent;
    color: var(--text2); font-family: 'Outfit', sans-serif;
    font-size: 0.83rem; cursor: pointer; text-align: left;
    transition: all 0.15s; display: flex; align-items: center; gap: 8px;
  }
  .pill:hover { border-color: var(--muted); color: var(--text); }
  .pill.active {
    border-color: var(--red); color: var(--text);
    background: rgba(255,43,43,0.08);
  }
  .pill .pill-icon { font-size: 1rem; }
  .pill .pill-desc { font-size: 0.72rem; color: var(--muted); margin-top: 1px; display: block; }
  .pill.active .pill-desc { color: rgba(255,100,100,0.7); }

  .divider { border: none; border-top: 1px solid var(--border); margin: 20px 0; }

  /* Generate button */
  .gen-btn {
    width: 100%; padding: 15px;
    background: linear-gradient(135deg, #ff2b2b 0%, #ff6b00 100%);
    border: none; border-radius: 10px;
    color: white; font-family: 'Bebas Neue', sans-serif;
    font-size: 1.2rem; letter-spacing: 3px; cursor: pointer;
    transition: opacity 0.2s, transform 0.15s;
    position: relative; overflow: hidden; margin-top: 4px;
  }
  .gen-btn:hover:not(:disabled) { opacity: 0.92; transform: translateY(-1px); }
  .gen-btn:active:not(:disabled) { transform: translateY(0); }
  .gen-btn:disabled { opacity: 0.4; cursor: not-allowed; }

  .gen-btn .shimmer {
    position: absolute; top: 0; left: -100%; width: 100%; height: 100%;
    background: linear-gradient(90deg, transparent, rgba(255,255,255,0.15), transparent);
    animation: shimmer 2s infinite;
  }
  @keyframes shimmer {
    0% { left: -100%; } 100% { left: 100%; }
  }

  /* Progress */
  .progress-card {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 14px; padding: 24px; margin-top: 24px;
    animation: fadeUp 0.3s ease;
  }

  @keyframes fadeUp {
    from { opacity: 0; transform: translateY(12px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .progress-header {
    display: flex; align-items: center; justify-content: space-between;
    margin-bottom: 14px;
  }

  .progress-title {
    font-family: 'Bebas Neue', sans-serif;
    font-size: 1rem; letter-spacing: 2px; color: var(--text);
  }

  .progress-pct {
    font-family: 'Bebas Neue', sans-serif;
    font-size: 1.3rem; letter-spacing: 1px;
    background: linear-gradient(90deg, var(--red), var(--orange));
    -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
  }

  .progress-bar-bg {
    height: 6px; background: var(--border); border-radius: 3px; overflow: hidden;
  }

  .progress-bar-fill {
    height: 100%;
    background: linear-gradient(90deg, var(--red), var(--orange));
    border-radius: 3px;
    transition: width 0.4s ease;
  }

  .progress-msg { font-size: 0.8rem; color: var(--text2); margin-top: 10px; }

  /* Steps */
  .steps {
    display: flex; flex-direction: column; gap: 6px; margin-top: 16px;
  }

  .step {
    display: flex; align-items: center; gap: 10px;
    font-size: 0.8rem; color: var(--muted);
  }

  .step.done { color: #4caf50; }
  .step.active { color: var(--text); }

  .step-dot {
    width: 8px; height: 8px; border-radius: 50%;
    background: var(--muted); flex-shrink: 0;
  }
  .step.done .step-dot { background: #4caf50; }
  .step.active .step-dot {
    background: var(--red);
    box-shadow: 0 0 6px var(--red);
    animation: pulse 1s infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; } 50% { opacity: 0.4; }
  }

  /* Result */
  .result-card {
    background: var(--surface); border: 1px solid rgba(255,200,68,0.2);
    border-radius: 14px; padding: 28px;
    animation: fadeUp 0.4s ease; margin-top: 24px;
  }

  .result-inner { display: flex; align-items: center; gap: 20px; flex-wrap: wrap; }

  .result-icon { font-size: 3rem; }

  .result-info { flex: 1; }

  .result-title {
    font-family: 'Bebas Neue', sans-serif;
    font-size: 1.4rem; letter-spacing: 2px;
    background: linear-gradient(90deg, var(--gold), var(--orange));
    -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
  }

  .result-sub { font-size: 0.82rem; color: var(--text2); margin-top: 4px; }

  .download-btn {
    padding: 12px 24px;
    background: linear-gradient(135deg, var(--gold), var(--orange));
    border: none; border-radius: 8px;
    color: #000; font-family: 'Bebas Neue', sans-serif;
    font-size: 1rem; letter-spacing: 2px; cursor: pointer;
    transition: opacity 0.2s, transform 0.15s; text-decoration: none;
    display: inline-block;
  }
  .download-btn:hover { opacity: 0.9; transform: translateY(-1px); }

  .new-reel-btn {
    margin-top: 14px; width: 100%;
    background: none; border: 1px solid var(--border);
    border-radius: 8px; padding: 9px;
    color: var(--muted); font-family: 'Outfit', sans-serif;
    font-size: 0.82rem; cursor: pointer;
    transition: all 0.15s;
  }
  .new-reel-btn:hover { border-color: var(--red); color: var(--red); }

  /* Error */
  .error-box {
    background: rgba(255,43,43,0.07); border: 1px solid rgba(255,43,43,0.25);
    border-radius: 10px; padding: 14px 18px;
    color: #ff7070; font-size: 0.85rem; margin-top: 16px;
    display: flex; align-items: center; gap: 8px;
  }

  .char-count { font-size: 0.75rem; color: var(--muted); text-align: right; margin-top: 4px; }
`;

function formatBytes(b) {
  if (b < 1048576) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1048576).toFixed(1)} MB`;
}

const ASPECT_OPTIONS = [
  { value: "9:16", label: "9:16 Vertical", icon: "📱", desc: "Instagram Reels & TikTok" },
  { value: "1:1", label: "1:1 Square", icon: "⬛", desc: "Works on all platforms" },
];

const PACE_OPTIONS = [
  { value: "fast", label: "Fast Cuts", icon: "⚡", desc: "Every ~2.5s — high energy" },
  { value: "medium", label: "Medium", icon: "🔥", desc: "Every ~4s — balanced" },
  { value: "slow", label: "Slow & Cinematic", icon: "🎥", desc: "Every ~6s — dramatic" },
];

const STEPS_LIST = [
  "Analyzing clips",
  "Trimming highlights",
  "Scaling to format",
  "Cutting the reel",
  "Mixing music",
  "Finalizing",
];

function getStepIndex(progress) {
  if (progress < 15) return 0;
  if (progress < 40) return 1;
  if (progress < 65) return 2;
  if (progress < 80) return 3;
  if (progress < 95) return 4;
  return 5;
}

export default function ReelGenerator() {
  const [clips, setClips] = useState([]);
  const [music, setMusic] = useState(null);
  const [aspectRatio, setAspectRatio] = useState("9:16");
  const [pace, setPace] = useState("fast");
  const [drag, setDrag] = useState(false);
  const [jobId, setJobId] = useState(null);
  const [jobStatus, setJobStatus] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const clipRef = useRef();
  const moreRef = useRef();
  const musicRef = useRef();
  const pollRef = useRef();

  function addClips(files) {
    const vids = Array.from(files).filter(f => f.type.startsWith("video/"));
    setClips(prev => [...prev, ...vids].slice(0, 12));
  }

  function removeClip(i) {
    setClips(prev => prev.filter((_, idx) => idx !== i));
  }

  function handleDrop(e) {
    e.preventDefault(); setDrag(false);
    addClips(e.dataTransfer.files);
  }

  // Poll job status
  useEffect(() => {
    if (!jobId) return;
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/api/status/${jobId}`);
        const data = await res.json();
        setJobStatus(data);
        if (data.status === "done" || data.status === "error") {
          clearInterval(pollRef.current);
          setLoading(false);
        }
      } catch {
        clearInterval(pollRef.current);
        setLoading(false);
        setError("Lost connection to server. Please try again.");
      }
    }, 1500);
    return () => clearInterval(pollRef.current);
  }, [jobId]);

  async function generate() {
    if (!clips.length) { setError("Add at least one gym clip."); return; }
    setError(null);
    setLoading(true);
    setJobStatus(null);
    setJobId(null);

    const form = new FormData();
    clips.forEach(c => form.append("clips", c));
    if (music) form.append("music", music);
    form.append("aspectRatio", aspectRatio);
    form.append("pace", pace);

    try {
      const res = await fetch(`${API_BASE}/api/generate`, { method: "POST", body: form });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Upload failed.");
      }
      const { jobId: id } = await res.json();
      setJobId(id);
    } catch (e) {
      setError(e.message || "Upload failed. Is the backend running?");
      setLoading(false);
    }
  }

  function reset() {
    setClips([]); setMusic(null); setJobId(null);
    setJobStatus(null); setError(null); setLoading(false);
  }

  const isProcessing = loading || (jobStatus && jobStatus.status === "processing");
  const isDone = jobStatus?.status === "done";
  const isError = jobStatus?.status === "error";
  const progress = jobStatus?.progress || 0;
  const activeStep = getStepIndex(progress);

  return (
    <>
      <style>{css}</style>
      <div className="noise" />
      <div className="glow-top" />
      <div className="app">
        <div className="header">
          <div className="brand">
            <div className="logo">REEL GENERATOR</div>
            <div className="logo-tag">Powered by FFmpeg + AI</div>
          </div>
          <div className="beta-badge">BETA</div>
        </div>

        <div className="main">
          {/* ── Left Column ── */}
          <div>
            {/* Clips */}
            <div className="block">
              <div className="panel-label">01 — GYM CLIPS</div>
              {clips.length === 0 ? (
                <div
                  className={`upload-zone${drag ? " drag" : ""}`}
                  onClick={() => clipRef.current.click()}
                  onDragOver={e => { e.preventDefault(); setDrag(true); }}
                  onDragLeave={() => setDrag(false)}
                  onDrop={handleDrop}
                >
                  <input ref={clipRef} type="file" accept="video/*" multiple onChange={e => addClips(e.target.files)} />
                  <div className="upload-icon">🎬</div>
                  <div className="upload-text">
                    <strong>Drop your gym clips here</strong><br />
                    MP4, MOV — up to 12 clips
                  </div>
                </div>
              ) : (
                <>
                  <div className="file-list">
                    {clips.map((c, i) => (
                      <div className="file-item" key={i}>
                        <div className="file-thumb">🎥</div>
                        <div className="file-info">
                          <div className="file-name">{c.name}</div>
                          <div className="file-meta">{formatBytes(c.size)}</div>
                        </div>
                        <button className="file-remove" onClick={() => removeClip(i)}>✕</button>
                      </div>
                    ))}
                  </div>
                  {clips.length < 12 && (
                    <>
                      <input ref={moreRef} type="file" accept="video/*" multiple style={{ display: "none" }} onChange={e => addClips(e.target.files)} />
                      <button className="add-more-btn" onClick={() => moreRef.current.click()}>
                        + Add more clips ({clips.length}/12)
                      </button>
                    </>
                  )}
                </>
              )}
            </div>

            {/* Music */}
            <div className="block">
              <div className="panel-label">02 — MUSIC TRACK</div>
              <div className="music-zone" onClick={() => !music && musicRef.current.click()}>
                <input ref={musicRef} type="file" accept="audio/*" onChange={e => setMusic(e.target.files[0] || null)} />
                <div className="music-icon">{music ? "🎵" : "🎶"}</div>
                <div className="music-text">
                  <strong>{music ? music.name : "Upload your track"}</strong>
                  <span>{music ? formatBytes(music.size) : "MP3, WAV — auto-mixed over your clips"}</span>
                </div>
                {music && (
                  <button className="music-clear" onClick={e => { e.stopPropagation(); setMusic(null); }}>✕</button>
                )}
              </div>
            </div>

            {/* Progress / Result */}
            {isProcessing && (
              <div className="progress-card">
                <div className="progress-header">
                  <div className="progress-title">BUILDING YOUR REEL</div>
                  <div className="progress-pct">{progress}%</div>
                </div>
                <div className="progress-bar-bg">
                  <div className="progress-bar-fill" style={{ width: `${progress}%` }} />
                </div>
                <div className="progress-msg">{jobStatus?.message || "Starting..."}</div>
                <div className="steps">
                  {STEPS_LIST.map((s, i) => (
                    <div key={i} className={`step${i < activeStep ? " done" : i === activeStep ? " active" : ""}`}>
                      <div className="step-dot" />
                      {i < activeStep ? `✓ ${s}` : s}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {isDone && (
              <div className="result-card">
                <div className="result-inner">
                  <div className="result-icon">🔥</div>
                  <div className="result-info">
                    <div className="result-title">YOUR REEL IS READY</div>
                    <div className="result-sub">
                      {aspectRatio} · {pace} cuts · {clips.length} clip{clips.length !== 1 ? "s" : ""}
                      {music ? " · With music" : ""}
                    </div>
                  </div>
                  <a
                    className="download-btn"
                    href={`${API_BASE}/api/download/${jobId}/${jobStatus.outputFile}`}
                    download
                  >
                    ⬇ DOWNLOAD
                  </a>
                </div>
                <button className="new-reel-btn" onClick={reset}>+ Make another reel</button>
              </div>
            )}

            {(isError || error) && (
              <div className="error-box">
                ⚠️ {jobStatus?.message || error}
              </div>
            )}
          </div>

          {/* ── Right Column: Settings ── */}
          <div className="settings-panel">
            <div className="settings-title">⚙ SETTINGS</div>

            <div className="setting-block">
              <span className="setting-label">Aspect Ratio</span>
              <div className="pill-group">
                {ASPECT_OPTIONS.map(o => (
                  <button
                    key={o.value}
                    className={`pill${aspectRatio === o.value ? " active" : ""}`}
                    onClick={() => setAspectRatio(o.value)}
                  >
                    <span className="pill-icon">{o.icon}</span>
                    <span>
                      {o.label}
                      <span className="pill-desc">{o.desc}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="divider" />

            <div className="setting-block">
              <span className="setting-label">Cut Pace</span>
              <div className="pill-group">
                {PACE_OPTIONS.map(o => (
                  <button
                    key={o.value}
                    className={`pill${pace === o.value ? " active" : ""}`}
                    onClick={() => setPace(o.value)}
                  >
                    <span className="pill-icon">{o.icon}</span>
                    <span>
                      {o.label}
                      <span className="pill-desc">{o.desc}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="divider" />

            <button className="gen-btn" onClick={generate} disabled={isProcessing || !clips.length}>
              {isProcessing ? "GENERATING..." : "⚡ GENERATE REEL"}
              {!isProcessing && <div className="shimmer" />}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
