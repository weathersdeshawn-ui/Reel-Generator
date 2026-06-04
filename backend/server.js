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

const UPLOAD_DIR = path.join(__dirname, "uploads");
const OUTPUT_DIR = path.join(__dirname, "outputs");
[UPLOAD_DIR, OUTPUT_DIR].forEach(d => fs.mkdirSync(d, { recursive: true }));

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

app.use((req, res, next) => { req.jobId = uuidv4(); next(); });

const jobs = {};

function getDuration(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, meta) => {
      if (err) return reject(err);
      resolve(meta.format.duration || 0);
    });
  });
}

// ── Process clip with professional effects ────────────────────
// Each clip gets: compression + trim + color grade + zoom punch
function processClip(input, output, start, duration, clipIndex, totalClips, pace) {
  return new Promise((resolve, reject) => {

    // Color grading: boost contrast, saturation, slight warmth — cinematic look
    const colorGrade = "eq=contrast=1.15:saturation=1.3:brightness=0.02:gamma=0.95";

    // Vignette for cinematic feel
    const vignette = "vignette=PI/4";

    // Zoom punch: slow zoom in from 1.0 to 1.04 over clip duration
    // Creates subtle energy without being distracting
    const zoomPunch = `zoompan=z='min(zoom+0.0008,1.04)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${Math.round(duration * 25)}:s=720x1280:fps=30`;

    // Speed ramp: for fast pace, slow first 20% then speed up rest
    // Creates that satisfying slow-mo into fast cut feel
    let speedFilter = "";
    if (pace === "fast") {
      // Slow mo on first portion, fast on rest — professional speed ramp
      speedFilter = `setpts=if(lt(T-STARTT\\,${duration * 0.3})\\,PTS*1.8\\,PTS*0.7)`;
    } else if (pace === "medium") {
      speedFilter = `setpts=if(lt(T-STARTT\\,${duration * 0.4})\\,PTS*1.4\\,PTS*0.9)`;
    } else {
      // Slow and cinematic — pure slow motion
      speedFilter = "setpts=PTS*1.5";
    }

    // Scale to 720p first for speed, then apply effects
    const scaleFilter = "scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2:black";

    // Full filter chain
    const filterChain = `[0:v]${scaleFilter},${colorGrade},${vignette},${speedFilter},fps=30[v]`;

    ffmpeg(input)
      .setStartTime(start)
      .setDuration(duration)
      .complexFilter([filterChain])
      .outputOptions([
        "-map [v]",
        "-c:v libx264",
        "-preset ultrafast",
        "-crf 26",
        "-an",
        "-r 30",
      ])
      .output(output)
      .on("end", resolve)
      .on("error", (e) => {
        // Fallback: simple compress if effects fail
        console.log("Effects failed, using fallback for clip", clipIndex, e.message);
        const simpleFilter = `scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2:black,${colorGrade}`;
        ffmpeg(input)
          .setStartTime(start)
          .setDuration(duration)
          .outputOptions([
            `-vf ${simpleFilter}`,
            "-c:v libx264", "-preset ultrafast", "-crf 26", "-an", "-r 30",
          ])
          .output(output)
          .on("end", resolve)
          .on("error", reject)
          .run();
      })
      .run();
  });
}

// ── Crossfade transition between two clips ────────────────────
function crossfadeClips(clip1, clip2, output, transitionDuration = 0.3) {
  return new Promise((resolve, reject) => {
    Promise.all([getDuration(clip1), getDuration(clip2)]).then(([d1, d2]) => {
      const offset = Math.max(0.1, d1 - transitionDuration);
      ffmpeg()
        .input(clip1)
        .input(clip2)
        .complexFilter([
          `[0:v]trim=0:${d1},setpts=PTS-STARTPTS[v0]`,
          `[1:v]trim=0:${d2},setpts=PTS-STARTPTS[v1]`,
          `[v0][v1]xfade=transition=fade:duration=${transitionDuration}:offset=${offset}[vout]`
        ])
        .outputOptions(["-map [vout]", "-c:v libx264", "-preset ultrafast", "-crf 24", "-an", "-r 30"])
        .output(output)
        .on("end", resolve)
        .on("error", () => {
          // Fallback: simple concat if xfade fails
          const listFile = output + ".txt";
          fs.writeFileSync(listFile, `file '${clip1}'\nfile '${clip2}'`);
          ffmpeg()
            .input(listFile)
            .inputOptions(["-f concat", "-safe 0"])
            .outputOptions(["-c:v libx264", "-preset ultrafast", "-crf 24", "-an"])
            .output(output)
            .on("end", () => { try { fs.unlinkSync(listFile); } catch {} resolve(); })
            .on("error", reject)
            .run();
        })
        .run();
    }).catch(reject);
  });
}

// ── Concatenate all clips ─────────────────────────────────────
function concatClips(clipPaths, output) {
  return new Promise((resolve, reject) => {
    const listFile = output + ".txt";
    const content = clipPaths.map(p => `file '${p}'`).join("\n");
    fs.writeFileSync(listFile, content);
    ffmpeg()
      .input(listFile)
      .inputOptions(["-f concat", "-safe 0"])
      .outputOptions(["-c:v libx264", "-preset ultrafast", "-crf 24", "-an", "-r 30"])
      .output(output)
      .on("end", () => { fs.unlinkSync(listFile); resolve(); })
      .on("error", (e) => { try { fs.unlinkSync(listFile); } catch {} reject(e); })
      .run();
  });
}

// ── Mix music with fade in/out ────────────────────────────────
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
          `[1:a]volume=0.88,afade=t=in:st=0:d=0.5,afade=t=out:st=${fadeStart}:d=2[music]`,
          `[music]anull[aout]`
        ])
        .outputOptions(["-map 0:v", "-map [aout]", "-c:v copy", "-c:a aac", "-b:a 192k", `-t ${duration}`, "-shortest"])
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

  const cutDurations = { fast: 2.5, medium: 4, slow: 7 };
  const cutLen = cutDurations[pace] || 3;
  const targetSeconds = parseInt(reelDuration) || 30;
  const clipsNeeded = Math.ceil(targetSeconds / cutLen);

  // Loop clips if needed
  const expandedClips = [];
  while (expandedClips.length < clipsNeeded) expandedClips.push(...clips);
  const finalClips = expandedClips.slice(0, clipsNeeded);

  updateJob({ status: "processing", progress: 5, message: "Applying cinematic effects..." });

  // 1. Process each clip with full effects
  const processedPaths = [];
  for (let i = 0; i < finalClips.length; i++) {
    const clipPath = path.join(jobUploadDir, finalClips[i]);
    const processed = path.join(jobOutputDir, `processed_${i}.mp4`);

    let duration;
    try { duration = await getDuration(clipPath); } catch { duration = 10; }

    const start = duration * 0.15;
    const safeLen = Math.min(cutLen, duration * 0.7);

    await processClip(clipPath, processed, start, safeLen, i, finalClips.length, pace);
    processedPaths.push(processed);

    updateJob({
      progress: 5 + Math.round((i / finalClips.length) * 50),
      message: `Processing clip ${i + 1} of ${finalClips.length}...`
    });
  }

  updateJob({ progress: 55, message: "Adding transitions..." });

  // 2. Add crossfade transitions between clips
  let transitioned = [...processedPaths];
  if (processedPaths.length > 1) {
    const mergedPaths = [];
    let current = processedPaths[0];

    for (let i = 1; i < processedPaths.length; i++) {
      const merged = path.join(jobOutputDir, `merged_${i}.mp4`);
      await crossfadeClips(current, processedPaths[i], merged, pace === "fast" ? 0.2 : 0.4);
      mergedPaths.push(merged);
      current = merged;
      updateJob({ progress: 55 + Math.round((i / processedPaths.length) * 20) });
    }
    transitioned = [current];
  }

  updateJob({ progress: 75, message: "Finalizing reel..." });

  // 3. If only one clip after transitions, use it directly
  let finalVideo = transitioned[0];

  // 4. Mix music
  if (music) {
    updateJob({ progress: 85, message: "Mixing music..." });
    const musicPath = path.join(jobUploadDir, music);
    const withMusic = path.join(jobOutputDir, "with_music.mp4");
    await mixAudio(finalVideo, musicPath, withMusic);
    finalVideo = withMusic;
  }

  updateJob({ progress: 95, message: "Finalizing..." });

  const outputName = `reel_${aspectRatio.replace(":", "x")}_${targetSeconds}s_${Date.now()}.mp4`;
  const outputPath = path.join(jobOutputDir, outputName);
  fs.renameSync(finalVideo, outputPath);

  // Cleanup
  [...processedPaths].forEach(f => { try { fs.unlinkSync(f); } catch {} });

  updateJob({ status: "done", progress: 100, message: "Your reel is ready!", outputFile: outputName, jobId });
}

// ── Routes ────────────────────────────────────────────────────
app.get("/health", (req, res) => res.json({ status: "ok" }));

app.post("/api/generate",
  (req, res, next) => { next(); },
  upload.fields([{ name: "clips", maxCount: 12 }, { name: "music", maxCount: 1 }]),
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
    try {
      fs.readdirSync(dir).forEach(jobId => {
        const jobDir = path.join(dir, jobId);
        try {
          const stat = fs.statSync(jobDir);
          if (stat.mtimeMs < cutoff) fs.rmSync(jobDir, { recursive: true });
        } catch {}
      });
    } catch {}
  });
}, 60 * 60 * 1000);

app.listen(PORT, () => console.log(`🎬 Reel Generator backend running on port ${PORT}`));
