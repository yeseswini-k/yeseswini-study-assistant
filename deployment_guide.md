# Yeseswini's AI Study Assistant - Deployment Guide

This guide provides step-by-step instructions to deploy the application's frontend and backend services for free.

---

## 💻 1. Frontend Deployment (Vercel or Netlify)

The React + Vite frontend is completely static and can be deployed for free.

### Options A: Vercel (Recommended)
1. Install Vercel CLI globally or use the [Vercel Dashboard](https://vercel.com).
2. Connect your Git Repository.
3. Configure the Project Settings:
   - **Framework Preset:** `Vite`
   - **Build Command:** `npm run build`
   - **Output Directory:** `dist`
4. Add the following Environment Variables in the Vercel Dashboard:
   - `VITE_API_URL`: *The URL of your deployed backend service (e.g. `https://your-backend.onrender.com`)*
   - `VITE_SUPABASE_URL`: `https://ickvopxkwdkeinsodeqn.supabase.co`
   - `VITE_SUPABASE_ANON_KEY`: *Your Supabase Anon Public Key* (starts with `sb_publishable_...`)
5. The `vercel.json` rewrite file is already configured in the folder to handle React client-side routing.

### Options B: Netlify
1. Connect your Git repository to [Netlify Dashboard](https://app.netlify.com).
2. Set Build Settings:
   - **Build Command:** `npm run build`
   - **Publish Directory:** `frontend/dist`
   - **Base Directory:** `frontend`
3. Add Environment Variables:
   - `VITE_API_URL`: *Your deployed backend service URL*
4. To support routing in Netlify, create a file named `_redirects` in your `public` folder with:
   ```text
   /*   /index.html   200
   ```

---

## 🐍 2. Backend Deployment (Render or Railway)

The backend is built with FastAPI and runs on Uvicorn. Since it embeds text local-embedding vectors with sentence-transformers and stores vectors in ChromaDB, make sure to provision a service disk or use persistent disk mounts if you want uploaded files to persist across redeployments.

### Option A: Render.com (Free Web Service)
1. Sign up on [Render](https://render.com) and click **New > Web Service**.
2. Connect your Git repository.
3. Configure settings:
   - **Runtime:** `Python`
   - **Build Command:** `pip install -r requirements.txt`
   - **Start Command:** `uvicorn backend.main:app --host 0.0.0.0 --port $PORT`
4. Set Environment Variables in **Environment** tab:
   - `GROQ_API_KEY`: *Your active Groq key*
   - `BACKEND_PORT`: `8000`
   - `BACKEND_HOST`: `0.0.0.0`
   - `FRONTEND_URL`: *The URL of your deployed frontend (e.g., `https://your-app.vercel.app`)*
   - `SUPABASE_URL`: `https://ickvopxkwdkeinsodeqn.supabase.co`
   - `SUPABASE_KEY`: *Your Supabase Service Role Secret Key* (starts with `sb_secret_...`)
   - `CHROMA_DB_PATH`: `./backend/chroma_db`
   - `UPLOAD_DIR`: `./backend/uploads`

### Option B: Railway.app (Free / Developer Plan)
1. Connect your GitHub repository to [Railway](https://railway.app).
2. Add a new service from your repo.
3. Railway automatically detects the Python environment and Uvicorn. If needed, configure the start command in variables or create a `Procfile` at the root:
   ```text
   web: uvicorn backend.main:app --host 0.0.0.0 --port $PORT
   ```
4. Define variables:
   - `GROQ_API_KEY`: *Your active Groq key*
   - `FRONTEND_URL`: *Your frontend Vercel URL*
