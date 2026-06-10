# AI Study Assistant Pro - Deployment Guide

This guide provides step-by-step instructions to deploy the application's frontend and backend services for **100% free** and with **zero memory limits**, using **Vercel** (for the frontend) and **Hugging Face Spaces** (for the backend).

---

## 🌐 1. Frontend Deployment (Vercel)

The React + Vite frontend compiles into static HTML/JS/CSS, making it perfect for hosting on Vercel's free tier.

1. Sign up on [Vercel](https://vercel.com).
2. Click **Add New > Project** and import your GitHub repository.
3. Configure the Project Settings:
   - **Framework Preset:** `Vite`
   - **Root Directory:** `frontend`
   - **Build Command:** `npm run build`
   - **Output Directory:** `dist`
4. Add the following **Environment Variables**:
   - `VITE_API_URL`: *Your Hugging Face Space App URL* (e.g. `https://your-username-space-name.hf.space` - note: do **not** use the embedding iframe URL, use the direct `.hf.space` link).
   - `VITE_SUPABASE_URL`: `https://ickvopxkwdkeinsodeqn.supabase.co`
   - `VITE_SUPABASE_ANON_KEY`: *Your Supabase Anon Key* (starts with `sb_publishable_...`)
5. Click **Deploy**. Vercel will build and serve your frontend for free.

---

## 🐍 2. Backend Deployment (Hugging Face Spaces)

Hugging Face Spaces provides a **16 GB RAM Docker Environment** completely for free. This runs the FastAPI Python backend with plenty of room, preventing any Out-Of-Memory (OOM) crashes.

### Step 1: Create the Space on Hugging Face
1. Sign in or sign up at [Hugging Face](https://huggingface.co).
2. Click on your profile picture in the top-right corner and select **New Space** (or go to [huggingface.co/new-space](https://huggingface.co/new-space)).
3. Fill in the Space settings:
   - **Space Name:** `study-assistant-backend` (or a name of your choice).
   - **License:** `mit`
   - **Select the Space SDK:** Select **Docker** (very important!).
   - **Docker Template:** Choose **Blank** (do not select other templates).
   - **Space Hardware:** Keep the default **CPU Basic (Free, 16GB RAM)**.
   - **Visibility:** **Public** or **Private** (we recommend **Public**; your secrets are secure and hidden from the public).
4. Click **Create Space** at the bottom.

### Step 2: Set Environment Variables / Secrets
To keep your API keys hidden and secure:
1. Inside your newly created Space, navigate to the **Settings** tab.
2. Scroll down to the **Variables and Secrets** section.
3. Add the following **Secrets** (Key-Value pairs) one by one by clicking **New Secret** (copy the values from your local `.env` file):
   * **`HUGGINGFACE_API_KEY`**: *(Copy HUGGINGFACE_API_KEY from your local .env file)*
   * **`GROQ_API_KEY`**: *(Copy GROQ_API_KEY from your local .env file)*
   * **`SUPABASE_URL`**: `https://ickvopxkwdkeinsodeqn.supabase.co`
   * **`SUPABASE_KEY`**: *(Copy SUPABASE_KEY from your local .env file)*
   * **`PYTHONUNBUFFERED`**: `1`

### Step 3: Push Your Code Directly to Hugging Face
You can push your local git repository directly to Hugging Face Spaces:
1. In your local terminal, navigate to your project root and add the Hugging Face Space repository as a new remote:
   ```bash
   git remote add hf https://huggingface.co/spaces/YOUR_USERNAME/YOUR_SPACE_NAME
   ```
   *(Replace `YOUR_USERNAME` and `YOUR_SPACE_NAME` with your Hugging Face username and the name you gave the Space).*
2. Push your `main` branch directly to the Hugging Face remote:
   ```bash
   git push -f hf main
   ```
   *(If prompted, log in with your Hugging Face username and use your **Hugging Face User Access Token** as the password).*

### Step 4: Access Your Deployed API
Once pushed, Hugging Face will automatically read the `Dockerfile`, install the requirements, and boot the FastAPI server on port `7860`.
* The status will change to **Building** -> **Running**.
* Your public API endpoint is:
  `https://YOUR_USERNAME-YOUR_SPACE_NAME.hf.space`
* You can test it by going to `https://YOUR_USERNAME-YOUR_SPACE_NAME.hf.space/api/health` in your browser. It should return `{"status": "healthy", ...}`.

---

## 💾 3. Data Persistence Notes
Since Hugging Face Spaces run inside ephemeral Docker containers, any files created locally on the container's disk are wiped when the container restarts. 

**This is fully expected and handled!** The backend is designed with Supabase integration:
* Every time you upload a document, the backend automatically zips the local storage vectors and pushes them to your Supabase Storage bucket.
* When you request information or chat, the backend automatically pulls your database down from Supabase, updates it, and syncs it back up.
* This ensures that your files and study progress are **100% persistent** regardless of container resets.
