const express = require("express");
const multer = require("multer");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");
const ffmpeg = require("fluent-ffmpeg");

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: "*" }));
app.use(express.json());

// ── Directories ──────────────────────────────────────────────
const UPLOAD_DIR = path.join(__dirname, "uploads");
const OUTPUT_DIR = path.join(__dirname, "outputs");
[UPLOAD_DIR, OUTPUT_DIR].forEach(d => fs.mkdirSync(d, { recursive: true }));

// ── Multer storage ────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const jobDir = path.join(UPLOAD_DIR, req.jobId);
    fs.mkdirSync(jobDir, { recursive: true });
    cb(null, jobDir);
  },
  filename: (req, file, cb) => cb(null, file.originalname),
});

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ["video/mp4", "video/quicktime", "video/x-msvideo", "audio/mpeg", "audio/mp4", "audio/wav", "audio/x-wav"];
    cb(null, allowed.includes(file.mimetype));
  },
});

app.use((req, res, next) => {
  req.jobId = uuidv4();
  next();
});

const jobs = {};

// ── Helper: get video duration ────────────────────────────────
function getDuration(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, meta) => {
      if (err) return reject(err);
      resolve(meta.format.duration || 0);
    });
  });
}

// ── Helper: compress + trim a single clip (combined for speed) ─
// Compresses to 720p CRF28 ultrafast — 4-5x faster than 1080p
function compressAndTrim(input, output, start, duration) {
  return new Promise((resolve, reject) => {
    ffmpeg(input)
      .setStartTime(start)
      .setDuration(duration)
      .outputOptions([
        "-vf scale=720:-2",       // Downscale to 720p (keeps aspect ratio)
        "-c:v libx264",
        "-preset ultrafast",      // Much faster encode
        "-crf 28",                // Slightly more compression — fine for social
        "-an",
      ])
      .output(output)
      .on("end", resolve)
      .on("error", reject)
      .run();
  });
}

// ── Helper: scale + pad to target aspect ratio ────────────────
function scaleClip(input, output, aspectRatio) {
  const [w, h] = aspectRatio === "9:16" ? [1080, 1920] : [1080, 1080];
  return new Promise((resolve, reject) => {
    ffmpeg(input)
      .outputOptions([
        `-vf scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:black`,
        "-c:v libx264",
        "-preset ultrafast",
        "-crf 26",
        "-an",
      ])
      .output(output)
      .on("end", resolve)
      .on("error", reject)
      .run();
  });
}

// ── Helper: concatenate clips ─────────────────────────────────
function concatClips(clipPaths, output) {
  return new Promise((resolve, reject) => {
    const listFile = output + ".txt";
    const content = clipPaths.map(p => `file '${p}'`).join("\n");
    fs.writeFileSync(listFile, content);
    ffmpeg()
      .input(listFile)
      .inputOptions(["-f concat", "-safe 0"])
      .outputOptions(["-c:v libx264", "-preset ultrafast", "-crf 26", "-an"])
      .output(output)
      .on("end", () => { fs.unlinkSync(listFile); resolve(); })
      .on("error", (e) => { try { fs.unlinkSync(listFile); } catch {} reject(e); })
      .run();
  });
}

// ── Helper: mix music over video ─────────────────────────────
function mixAudio(videoPath, musicPath, output) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, meta) => {
      if (err) return reject(err);
      const duration = meta.format.duration;
      const fadeStart = Math.max(0, duration - 2);

      ffmpeg()
        .input(videoPath)
        .input(musicPath)
        .complexFilter([
          `[1:a]volume=0.85,afade=t=out:st=${fadeStart}:d=2[music]`,
          `[music]anull[aout]`
        ])
        .outputOptions([
          "-map 0:v",
          "-map [aout]",
          "-c:v copy",
          "-c:a aac",
          "-b:a 192k",
          `-t ${duration}`,
          "-shortest",
        ])
        .output(output)
        .on("end", resolve)
        .on("error", reject)
        .run();
    });
  });
}

// ── Core reel builder ─────────────────────────────────────────
async function buildReel({ jobId, clips, music, aspectRatio, pace, reelDuration }) {
  const jobUploadDir = path.join(UPLOAD_DIR, jobId);
  const jobOutputDir = path.join(OUTPUT_DIR, jobId);
  fs.mkdirSync(jobOutputDir, { recursive: true });

  const updateJob = (update) => Object.assign(jobs[jobId], update);

  // Cut length per clip based on pace
  const cutDurations = { fast: 2.5, medium: 4, slow: 6 };
  const cutLen = cutDurations[pace] || 3;

  // How many clips we need to fill the target reel duration
  const targetSeconds = parseInt(reelDuration) || 30;
  const clipsNeeded = Math.ceil(targetSeconds / cutLen);
  
  // Repeat clips if we don't have enough to fill duration
  const expandedClips = [];
  while (expandedClips.length < clipsNeeded) {
    expandedClips.push(...clips);
  }
  const finalClips = expandedClips.slice(0, clipsNeeded);

  updateJob({ status: "processing", progress: 5, message: "Compressing clips for fast processing..." });

  // 1. Compress + trim each clip (combined step = much faster)
  const trimmedPaths = [];
  for (let i = 0; i < finalClips.length; i++) {
    const clipPath = path.join(jobUploadDir, finalClips[i]);
    const trimmed = path.join(jobOutputDir, `trimmed_${i}.mp4`);

    let duration;
    try { duration = await getDuration(clipPath); } catch { duration = 10; }

    const start = duration * 0.2;
    const safeLen = Math.min(cutLen, duration * 0.6);

    await compressAndTrim(clipPath, trimmed, start, safeLen);
    trimmedPaths.push(trimmed);

    updateJob({ progress: 5 + Math.round((i / finalClips.length) * 35), message: `Compressing clip ${i + 1} of ${finalClips.length}...` });
  }

  updateJob({ progress: 40, message: "Scaling to format..." });

  // 2. Scale to aspect ratio
  const scaledPaths = [];
  for (let i = 0; i < trimmedPaths.length; i++) {
    const scaled = path.join(jobOutputDir, `scaled_${i}.mp4`);
    await scaleClip(trimmedPaths[i], scaled, aspectRatio);
    scaledPaths.push(scaled);
    updateJob({ progress: 40 + Math.round((i / trimmedPaths.length) * 25) });
  }

  updateJob({ progress: 65, message: "Cutting the reel..." });

  // 3. Concatenate
  const concatenated = path.join(jobOutputDir, "concat.mp4");
  await concatClips(scaledPaths, concatenated);

  updateJob({ progress: 80, message: "Mixing music..." });

  // 4. Mix music
  let finalVideo = concatenated;
  if (music) {
    const musicPath = path.join(jobUploadDir, music);
    const withMusic = path.join(jobOutputDir, "with_music.mp4");
    await mixAudio(concatenated, musicPath, withMusic);
    finalVideo = withMusic;
  }

  updateJob({ progress: 95, message: "Finalizing..." });

  // 5. Output
  const outputName = `reel_${aspectRatio.replace(":", "x")}_${targetSeconds}s_${Date.now()}.mp4`;
  const outputPath = path.join(jobOutputDir, outputName);
  fs.renameSync(finalVideo, outputPath);

  // 6. Cleanup
  [...trimmedPaths, ...scaledPaths, concatenated].forEach(f => {
    try { fs.unlinkSync(f); } catch {}
  });

  updateJob({
    status: "done",
    progress: 100,
    message: "Your reel is ready!",
    outputFile: outputName,
    jobId,
  });
}

// ── Routes ────────────────────────────────────────────────────
app.get("/health", (req, res) => res.json({ status: "ok" }));

app.post(
  "/api/generate",
  (req, res, next) => { next(); },
  upload.fields([
    { name: "clips", maxCount: 12 },
    { name: "music", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const clips = (req.files["clips"] || []).map(f => f.filename);
      const musicFiles = req.files["music"] || [];
      const music = musicFiles.length > 0 ? musicFiles[0].filename : null;

      if (!clips.length) return res.status(400).json({ error: "No clips uploaded." });

      const { aspectRatio = "9:16", pace = "fast", reelDuration = "30" } = req.body;
      const jobId = req.jobId;

      jobs[jobId] = { status: "queued", progress: 0, message: "Job queued...", jobId, outputFile: null };
      res.json({ jobId });

      buildReel({ jobId, clips, music, aspectRatio, pace, reelDuration }).catch(err => {
        jobs[jobId] = { ...jobs[jobId], status: "error", message: err.message || "Processing failed." };
        console.error("Build error:", err);
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error." });
    }
  }
);

app.get("/api/status/:jobId", (req, res) => {
  const job = jobs[req.params.jobId];
  if (!job) return res.status(404).json({ error: "Job not found." });
  res.json(job);
});

app.get("/api/download/:jobId/:filename", (req, res) => {
  const filePath = path.join(OUTPUT_DIR, req.params.jobId, req.params.filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: "File not found." });
  res.download(filePath);
});

setInterval(() => {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  [UPLOAD_DIR, OUTPUT_DIR].forEach(dir => {
    fs.readdirSync(dir).forEach(jobId => {
      const jobDir = path.join(dir, jobId);
      try {
        const stat = fs.statSync(jobDir);
        if (stat.mtimeMs < cutoff) fs.rmSync(jobDir, { recursive: true });
      } catch {}
    });
  });
}, 60 * 60 * 1000);

app.listen(PORT, () => console.log(`🎬 Reel Generator backend running on port ${PORT}`));