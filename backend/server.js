const express = require("express");
const multer = require("multer");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");
const ffmpeg = require("fluent-ffmpeg");

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
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
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB total
  fileFilter: (req, file, cb) => {
    const allowed = ["video/mp4", "video/quicktime", "video/x-msvideo", "audio/mpeg", "audio/mp4", "audio/wav", "audio/x-wav"];
    cb(null, allowed.includes(file.mimetype));
  },
});

// Attach jobId before multer runs
app.use((req, res, next) => {
  req.jobId = uuidv4();
  next();
});

// ── Job status store (in-memory) ──────────────────────────────
const jobs = {};

// ── Helper: get video duration via ffprobe ────────────────────
function getDuration(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, meta) => {
      if (err) return reject(err);
      resolve(meta.format.duration || 0);
    });
  });
}

// ── Helper: trim a single clip ────────────────────────────────
function trimClip(input, output, start, duration) {
  return new Promise((resolve, reject) => {
    ffmpeg(input)
      .setStartTime(start)
      .setDuration(duration)
      .outputOptions(["-c:v libx264", "-preset fast", "-crf 23", "-an"])
      .output(output)
      .on("end", resolve)
      .on("error", reject)
      .run();
  });
}

// ── Helper: scale + pad clip to target aspect ratio ───────────
function scaleClip(input, output, aspectRatio) {
  const [w, h] = aspectRatio === "9:16" ? [1080, 1920] : [1080, 1080];
  return new Promise((resolve, reject) => {
    ffmpeg(input)
      .outputOptions([
        `-vf scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:black`,
        "-c:v libx264",
        "-preset fast",
        "-crf 22",
        "-an",
      ])
      .output(output)
      .on("end", resolve)
      .on("error", reject)
      .run();
  });
}

// ── Helper: concatenate clips via concat demuxer ──────────────
function concatClips(clipPaths, output) {
  return new Promise((resolve, reject) => {
    const listFile = output + ".txt";
    const content = clipPaths.map(p => `file '${p}'`).join("\n");
    fs.writeFileSync(listFile, content);
    ffmpeg()
      .input(listFile)
      .inputOptions(["-f concat", "-safe 0"])
      .outputOptions(["-c:v libx264", "-preset fast", "-crf 22", "-an"])
      .output(output)
      .on("end", () => { fs.unlinkSync(listFile); resolve(); })
      .on("error", (e) => { try { fs.unlinkSync(listFile); } catch {} reject(e); })
      .run();
  });
}

// ── Helper: mix music over video ─────────────────────────────
function mixAudio(videoPath, musicPath, output, fadeOut = true) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, meta) => {
      if (err) return reject(err);
      const duration = meta.format.duration;

      let audioFilter = `[1:a]volume=0.85`;
      if (fadeOut) audioFilter += `,afade=t=out:st=${Math.max(0, duration - 2)}:d=2`;
      audioFilter += `[music]`;

      ffmpeg()
        .input(videoPath)
        .input(musicPath)
        .complexFilter([audioFilter, `[music]anull[aout]`])
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
async function buildReel({ jobId, clips, music, aspectRatio, clipDuration, pace }) {
  const jobUploadDir = path.join(UPLOAD_DIR, jobId);
  const jobOutputDir = path.join(OUTPUT_DIR, jobId);
  fs.mkdirSync(jobOutputDir, { recursive: true });

  const updateJob = (update) => Object.assign(jobs[jobId], update);

  // 1. Determine cut duration per clip based on pace
  const cutDurations = { fast: 2.5, medium: 4, slow: 6 };
  const cutLen = cutDurations[pace] || 3;

  updateJob({ status: "processing", progress: 10, message: "Analyzing clips..." });

  // 2. Trim each clip
  const trimmedPaths = [];
  for (let i = 0; i < clips.length; i++) {
    const clipPath = path.join(jobUploadDir, clips[i]);
    const trimmed = path.join(jobOutputDir, `trimmed_${i}.mp4`);

    let duration;
    try { duration = await getDuration(clipPath); } catch { duration = 10; }

    // Take the most energetic part (middle 60% of clip)
    const start = duration * 0.2;
    const safeLen = Math.min(cutLen, duration * 0.6);

    await trimClip(clipPath, trimmed, start, safeLen);
    trimmedPaths.push(trimmed);

    updateJob({ progress: 10 + Math.round((i / clips.length) * 30) });
  }

  updateJob({ progress: 40, message: "Scaling to format..." });

  // 3. Scale each clip to target aspect ratio
  const scaledPaths = [];
  for (let i = 0; i < trimmedPaths.length; i++) {
    const scaled = path.join(jobOutputDir, `scaled_${i}.mp4`);
    await scaleClip(trimmedPaths[i], scaled, aspectRatio);
    scaledPaths.push(scaled);
    updateJob({ progress: 40 + Math.round((i / trimmedPaths.length) * 25) });
  }

  updateJob({ progress: 65, message: "Cutting the reel..." });

  // 4. Concatenate all clips
  const concatenated = path.join(jobOutputDir, "concat.mp4");
  await concatClips(scaledPaths, concatenated);

  updateJob({ progress: 80, message: "Mixing music..." });

  // 5. Mix music if provided
  let finalVideo = concatenated;
  if (music) {
    const musicPath = path.join(jobUploadDir, music);
    const withMusic = path.join(jobOutputDir, "with_music.mp4");
    await mixAudio(concatenated, musicPath, withMusic);
    finalVideo = withMusic;
  }

  updateJob({ progress: 95, message: "Finalizing..." });

  // 6. Move to final output
  const outputName = `reel_${aspectRatio.replace(":", "x")}_${Date.now()}.mp4`;
  const outputPath = path.join(jobOutputDir, outputName);
  fs.renameSync(finalVideo, outputPath);

  // 7. Cleanup temp files
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

// Health check
app.get("/health", (req, res) => res.json({ status: "ok" }));

// Upload + start job
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

      if (!clips.length) {
        return res.status(400).json({ error: "No clips uploaded." });
      }

      const { aspectRatio = "9:16", pace = "fast" } = req.body;
      const jobId = req.jobId;

      jobs[jobId] = {
        status: "queued",
        progress: 0,
        message: "Job queued...",
        jobId,
        outputFile: null,
      };

      res.json({ jobId });

      // Run async (don't await in handler)
      buildReel({ jobId, clips, music, aspectRatio, pace }).catch(err => {
        jobs[jobId] = {
          ...jobs[jobId],
          status: "error",
          message: err.message || "Processing failed.",
        };
        console.error("Build error:", err);
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error." });
    }
  }
);

// Poll job status
app.get("/api/status/:jobId", (req, res) => {
  const job = jobs[req.params.jobId];
  if (!job) return res.status(404).json({ error: "Job not found." });
  res.json(job);
});

// Download finished reel
app.get("/api/download/:jobId/:filename", (req, res) => {
  const filePath = path.join(OUTPUT_DIR, req.params.jobId, req.params.filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: "File not found." });
  res.download(filePath);
});

// Cleanup old jobs (run every hour)
setInterval(() => {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000; // 2 hours
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
