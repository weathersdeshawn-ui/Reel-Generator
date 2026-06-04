# 🎬 REEL GENERATOR — DEPLOY GUIDE
### From zero to live in ~20 minutes

---

## WHAT YOU HAVE
```
reel-generator/
├── backend/        ← Node.js + FFmpeg server (deploy to Render)
│   ├── server.js
│   ├── package.json
│   └── render.yaml
└── frontend/       ← React app (deploy to Vercel or Render Static)
    ├── src/App.jsx
    ├── src/main.jsx
    ├── index.html
    ├── package.json
    └── vite.config.js
```

---

## STEP 1 — Push code to GitHub

1. Go to github.com → New repository → name it `reel-generator`
2. On your computer, open Terminal and run:

```bash
cd reel-generator
git init
git add .
git commit -m "initial commit"
git remote add origin https://github.com/YOUR_USERNAME/reel-generator.git
git push -u origin main
```

---

## STEP 2 — Deploy Backend to Render

1. Go to **render.com** → Sign up (free)
2. Click **New** → **Web Service**
3. Connect your GitHub account → select `reel-generator`
4. Fill in:
   - **Name:** `reel-generator-backend`
   - **Root Directory:** `backend`
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
5. Under **Advanced** → Add **Disk**:
   - Name: `reel-storage`
   - Mount Path: `/app/uploads`
   - Size: 1 GB (free tier)
6. Click **Create Web Service**
7. Wait ~3 minutes for deploy
8. Copy your backend URL — looks like: `https://reel-generator-backend.onrender.com`

> ⚠️ FREE TIER NOTE: Render free tier spins down after 15min of inactivity.
> First request after idle takes ~30 seconds to wake up. Upgrade to $7/mo Starter
> to keep it always-on once you're using it regularly.

---

## STEP 3 — Deploy Frontend to Vercel (free, fast)

1. Go to **vercel.com** → Sign up with GitHub
2. Click **New Project** → Import `reel-generator`
3. Set **Root Directory** to `frontend`
4. Under **Environment Variables**, add:
   - Key: `VITE_API_URL`
   - Value: `https://reel-generator-backend.onrender.com` ← your Render URL
5. Click **Deploy**
6. Done — you get a URL like `https://reel-generator.vercel.app`

---

## STEP 4 — Test It

1. Open your Vercel URL
2. Upload 3-5 gym clips
3. Add a music track (optional)
4. Pick 9:16 + Fast Cuts
5. Hit Generate → watch the progress bar
6. Download your reel

---

## HOW IT WORKS (what FFmpeg does)

```
Your clips uploaded
      ↓
Each clip: trimmed to the most energetic section
      ↓
All clips: scaled + padded to 9:16 or 1:1
      ↓
All clips: concatenated in order
      ↓
Music: mixed in at 85% volume with 2s fade-out
      ↓
Final .mp4 ready to download
```

---

## UPGRADING LATER (when you turn this into a product)

| Feature              | How                                      |
|----------------------|------------------------------------------|
| Beat detection       | Install `aubio` — sync cuts to the beat  |
| Auto captions        | OpenAI Whisper API                       |
| User accounts        | Add Supabase auth                        |
| Stripe payments      | $19/mo for 20 reels                     |
| Custom text overlays | FFmpeg drawtext filter                   |
| Transition effects   | FFmpeg xfade filter                      |

---

## TROUBLESHOOTING

**"Upload failed" error**
→ Make sure your Render backend URL in Vercel env vars has no trailing slash

**Render backend not responding**
→ Free tier may be sleeping — wait 30s and try again

**Video processing fails**
→ FFmpeg is pre-installed on Render. If missing, add to build command:
  `apt-get install -y ffmpeg && npm install`

**File too large**
→ Backend accepts up to 500MB total. Compress clips in CapCut first if needed.

---

## QUICK REFERENCE

| Thing         | Where                                      |
|---------------|--------------------------------------------|
| Backend code  | `backend/server.js`                        |
| Frontend UI   | `frontend/src/App.jsx`                     |
| Backend URL   | Your Render dashboard                      |
| Frontend URL  | Your Vercel dashboard                      |
| Change cut duration | Edit `cutDurations` in `server.js`   |
| Change max clips    | Edit `maxCount: 12` in `server.js`   |
