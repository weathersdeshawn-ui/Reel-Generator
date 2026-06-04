const express = require("express");
const multer = require("multer");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");
const ffmpeg = require("fluent-ffmpeg");
const { execSync } = require("child_process");

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
    const allowed = ["video/mp4","video/quicktime","video/x-msvideo","audio/mpeg","audio/mp4","audio/wav","audio/x-wav"];
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

// ── Motion analysis: find high-action moments in a clip ───────
// Uses FFmpeg to measure frame-by-frame scene change scores
// High scores = explosive movements, lifts, jumps
async function detectHighlightMoments(clipPath, duration, clipsPerSource) {
  return new Promise((resolve) => {
    const segments = [];
    const frameData = [];

    // Use ffmpeg to extract scene change scores for every 0.5s
    const tempLog = clipPath + "_motion.txt";

    try {
      // Run ffprobe to get scene scores
      execSync(
        `ffmpeg -i "${clipPath}" -vf "select='gt(scene,0.1)',showinfo" -f null - 2>&1 | grep "showinfo" > "${tempLog}"`,
        { stdio: "pipe", timeout: 30000 }
      );
    } catch (e) {
      // If motion detection fails, fall back to even distribution
    }

    // Parse motion data or use smart distribution
    let highlightTimes = [];

    try {
      if (fs.existsSync(tempLog)) {
        const lines = fs.readFileSync(tempLog, "utf8").split("\n");
        lines.forEach(line => {
          const ptMatch = line.match(/pts_time:([\d.]+)/);
          if (ptMatch) frameData.push(parseFloat(ptMatch[1]));
        });
        fs.unlinkSync(tempLog);
      }
    } catch (e) {}

    if (frameData.length >= clipsPerSource) {
      // Space out highlights evenly from detected motion moments
      const step = Math.floor(frameData.length / clipsPerSource);
      for (let i = 0; i < clipsPerSource; i++) {
        const t = frameData[i * step] || (duration * (i / clipsPerSource));
        highlightTimes.push(Math.min(t, duration - 3));
      }
    } else {
      // Smart fallback: divide clip into sections, pick peak of each section
      // Avoids first 10% (usually setup) and last 5% (rest)
      const usableDuration = duration * 0.85;
      const startOffset = duration * 0.1;
      const sectionSize = usableDuration / clipsPerSource;

      for (let i = 0; i < clipsPerSource; i++) {
        // Pick 60% into each section — usually where the rep/movement peaks
        const sectionStart = startOffset + (i * sectionSize);
        const peakPoint = sectionStart + (sectionSize * 0.6);
        highlightTimes.push(Math.min(peakPoint, duration - 3));
      }
    }

    // Ensure minimum 1.5s gap between highlights
    const filtered = [highlightTimes[0]];
    for (let i = 1; i < highlightTimes.length; i++) {
      if (highlightTimes[i] - filtered[filtered.length - 1] >= 1.5) {
        filtered.push(highlightTimes[i]);
      }
    }

    resolve(filtered.slice(0, clipsPerSource));
  });
}

// ── Extract a single highlight segment ───────────────────────
function extractHighlight(input, output, startTime, duration, pace, clipIndex) {
  return new Promise((resolve, reject) => {
    const colorGrade = "eq=contrast=1.15:saturation=1.3:brightness=0.02:gamma=0.95";
    const vignette = "vignette=PI/4";

    // Alternate between speed ramp styles for variety
    let speedFilter;
    const style = clipIndex % 3;
    if (pace === "fast") {
      if (style === 0) speedFilter = `setpts=if(lt(T-STARTT\\,${duration*0.25})\\,PTS*1.6\\,PTS*0.75)`;
      else if (style === 1) speedFilter = `setpts=PTS*0.8`; // straight fast
      else speedFilter = `setpts=if(gt(T-STARTT\\,${duration*0.6})\\,PTS*1.8\\,PTS*0.9)`; // slow end
    } else if (pace === "medium") {
      speedFilter = style === 0
        ? `setpts=if(lt(T-STARTT\\,${duration*0.3})\\,PTS*1.4\\,PTS*0.9)`
        : `setpts=PTS*1.0`;
    } else {
      speedFilter = `setpts=PTS*1.4`; // cinematic slow
    }

    const scaleFilter = "scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2:black";
    const filterChain = `[0:v]${scaleFilter},${colorGrade},${vignette},${speedFilter},fps=30[v]`;

    ffmpeg(input)
      .setStartTime(startTime)
      .setDuration(duration)
      .complexFilter([filterChain])
      .outputOptions(["-map [v]", "-c:v libx264", "-preset ultrafast", "-crf 26", "-an", "-r 30"])
      .output(output)
      .on("end", resolve)
      .on("error", () => {
        // Simple fallback
        ffmpeg(input)
          .setStartTime(startTime)
          .setDuration(duration)
          .outputOptions([
            `-vf ${scaleFilter},${colorGrade}`,
            "-c:v libx264", "-preset ultrafast", "-crf 26", "-an", "-r 30"
          ])
          .output(output)
          .on("end", resolve)
          .on("error", reject)
          .run();
      })
      .run();
  });
}

// ── Crossfade between two clips ───────────────────────────────
function crossfadeClips(clip1, clip2, output, transitionDuration = 0.25) {
  return new Promise((resolve, reject) => {
    getDuration(clip1).then(d1 => {
      const offset = Math.max(0.1, d1 - transitionDuration);
      ffmpeg()
        .input(clip1)
        .input(clip2)
        .complexFilter([
          `[0:v]trim=0:${d1},setpts=PTS-STARTPTS[v0]`,
          `[1:v]setpts=PTS-STARTPTS[v1]`,
          `[v0][v1]xfade=transition=fade:duration=${transitionDuration}:offset=${offset}[vout]`
        ])
        .outputOptions(["-map [vout]", "-c:v libx264", "-preset ultrafast", "-crf 24", "-an", "-r 30"])
        .output(output)
        .on("end", resolve)
        .on("error", () => {
          // Fallback concat
          const listFile = output + ".txt";
          fs.writeFileSync(listFile, `file '${clip1}'\nfile '${clip2}'`);
          ffmpeg()
            .input(listFile).inputOptions(["-f concat", "-safe 0"])
            .outputOptions(["-c:v libx264", "-preset ultrafast", "-crf 24", "-an", "-r 30"])
            .output(output)
            .on("end", () => { try { fs.unlinkSync(listFile); } catch {} resolve(); })
            .on("error", reject).run();
        })
        .run();
    }).catch(reject);
  });
}

// ── Mix music ─────────────────────────────────────────────────
function mixAudio(videoPath, musicPath, output) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, meta) => {
      if (err) return reject(err);
      const duration = meta.format.duration;
      const fadeStart = Math.max(0, duration - 2);
      ffmpeg()
        .input(videoPath).input(musicPath)
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

  const cutDurations = { fast: 2.0, medium: 3.5, slow: 6 };
  const cutLen = cutDurations[pace] || 2.5;
  const targetSeconds = parseInt(reelDuration) || 30;
  const totalClipsNeeded = Math.ceil(targetSeconds / cutLen);

  // How many highlights to extract per source clip
  const highlightsPerClip = Math.max(2, Math.ceil(totalClipsNeeded / clips.length));

  updateJob({ status: "processing", progress: 5, message: `Analyzing ${clips.length} clips for highlights...` });

  // 1. Analyze each clip and extract multiple highlights
  const allHighlights = [];
  let globalIndex = 0;

  for (let c = 0; c < clips.length; c++) {
    const clipPath = path.join(jobUploadDir, clips[c]);
    let duration;
    try { duration = await getDuration(clipPath); } catch { duration = 10; }

    // Find highlight moments in this clip
    const moments = await detectHighlightMoments(clipPath, duration, highlightsPerClip);

    updateJob({
      progress: 5 + Math.round((c / clips.length) * 20),
      message: `Found ${moments.length} highlights in clip ${c + 1}...`
    });

    // Extract each highlight
    for (let m = 0; m < moments.length; m++) {
      const startTime = moments[m];
      const extracted = path.join(jobOutputDir, `highlight_${c}_${m}.mp4`);
      const safeLen = Math.min(cutLen, Math.max(0.5, duration - startTime - 0.1));

      await extractHighlight(clipPath, extracted, startTime, safeLen, pace, globalIndex);
      allHighlights.push(extracted);
      globalIndex++;

      updateJob({
        progress: 25 + Math.round((globalIndex / (clips.length * highlightsPerClip)) * 35),
        message: `Extracting highlight ${globalIndex} of ${clips.length * highlightsPerClip}...`
      });
    }
  }

  // Trim to target count
  const finalHighlights = allHighlights.slice(0, totalClipsNeeded);

  updateJob({ progress: 60, message: "Stitching highlights with transitions..." });

  // 2. Chain crossfades between all highlights
  let currentClip = finalHighlights[0];
  const transitionDur = pace === "fast" ? 0.2 : pace === "medium" ? 0.3 : 0.5;

  for (let i = 1; i < finalHighlights.length; i++) {
    const merged = path.join(jobOutputDir, `chain_${i}.mp4`);
    await crossfadeClips(currentClip, finalHighlights[i], merged, transitionDur);
    currentClip = merged;
    updateJob({
      progress: 60 + Math.round((i / finalHighlights.length) * 25),
      message: `Merging highlight ${i + 1} of ${finalHighlights.length}...`
    });
  }

  updateJob({ progress: 85, message: "Mixing music..." });

  // 3. Mix music
  let finalVideo = currentClip;
  if (music) {
    const musicPath = path.join(jobUploadDir, music);
    const withMusic = path.join(jobOutputDir, "with_music.mp4");
    await mixAudio(currentClip, musicPath, withMusic);
    finalVideo = withMusic;
  }

  updateJob({ progress: 95, message: "Finalizing..." });

  const outputName = `reel_${aspectRatio.replace(":", "x")}_${targetSeconds}s_${Date.now()}.mp4`;
  const outputPath = path.join(jobOutputDir, outputName);
  fs.renameSync(finalVideo, outputPath);

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
