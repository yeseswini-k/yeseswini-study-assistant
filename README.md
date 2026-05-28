# AI Study Assistant Pro 🎓✨

AI Study Assistant Pro is a state-of-the-art GenAI study tool built from scratch using a luxury dark academic design theme. Powered by **FastAPI (Python)**, **React + Vite**, **ChromaDB**, and **Groq Llama 3**, this system provides semantic PDF search, real-time RAG context chat streaming, study flashcards, interactive quizzes, automated formula sheets, and study schedule calendars.

---

## 🛠️ Features

* **Multi-PDF RAG pipeline**: Upload and index multiple textbook chapters, slide decks, or syllabus documents.
* **Ambient Floating Particles UI**: A highly premium canvas-based animated background representing dark academic luxury.
* **Focus Pomodoro Timer**: Switch between Focus sessions and breaks, tracks streak levels, and logs daily goal targets.
* **Explain Modes**: Customize AI response granularity dynamically (Beginner, Intermediate, Expert).
* **AI Study Tools**: Automatically generate summaries, exam study sheets, LaTeX equations, and terms glossaries.
* **AI study scheduler**: Formulate detailed calendar timelines from uploaded files.
* **Export PDF notes**: Compile customized study guides and export them to PDF reports using ReportLab.
* **Streaming AI completions**: Smooth, real-time response generation utilizing server-sent NDJSON lines.

---

## 📂 File Structure

```text
AI-Study-Assistant-Pro/
├── README.md
├── requirements.txt
├── package.json
├── run.sh
├── start_backend.sh
├── start_frontend.sh
├── .env.example
├── backend/
│   ├── main.py
│   ├── config.py
│   ├── rag_service.py
│   └── uploads/ (automatic)
└── frontend/
    ├── package.json
    ├── tailwind.config.js
    ├── postcss.config.js
    ├── index.html
    └── src/
        ├── main.jsx
        ├── App.jsx
        ├── index.css
        ├── components/
        │   ├── Sidebar.jsx
        │   ├── Navbar.jsx
        │   ├── Dashboard.jsx
        │   ├── ChatInterface.jsx
        │   ├── Tools.jsx
        │   ├── StudyPlanner.jsx
        │   ├── SettingsModal.jsx
        │   └── FloatingParticles.jsx
        └── utils/
            └── api.js
```

---

## 🚀 Local Quickstart

### 1. Configure Credentials
Duplicate `.env.example` to `.env` and add your **Groq API Key**:
```bash
cp .env.example .env
```
Open `.env` and set:
```env
GROQ_API_KEY=gsk_your_actual_key_here
```

### 2. Launch
Execute the master launch script at the project root:
```bash
bash run.sh
```
This script will:
1. Build a local Python virtual environment (`venv`).
2. Upgrade `pip` and install all server requirements.
3. Automatically load npm packages.
4. Concurrently boot up the FastAPI server (Port `8000`) and Vite app (Port `5173`).

Open **[http://localhost:5173](http://localhost:5173)** in your browser!

---

## ☁️ Free Deployment Guide

### 1. Backend (FastAPI on Render)
1. Push the code repository to GitHub.
2. Sign in to [Render](https://render.com) and create a new **Web Service**.
3. Link your GitHub repository.
4. Set the following settings:
   * **Runtime**: `Python`
   * **Build Command**: `pip install -r requirements.txt`
   * **Start Command**: `python -m uvicorn backend.main:app --host 0.0.0.0 --port $PORT`
5. Go to the **Environment** tab and add:
   * `GROQ_API_KEY` = *your_groq_api_key*
   * `CHROMA_DB_PATH` = `/opt/render/project/src/backend/chroma_db` (or keep default for ephemeral storage)
   * `UPLOAD_DIR` = `/opt/render/project/src/backend/uploads`

### 2. Frontend (React on Vercel)
1. Sign in to [Vercel](https://vercel.com) and click **Add New Project**.
2. Select your repository.
3. Set the **Root Directory** as `frontend`.
4. In the Environment Variables configuration, add:
   * `VITE_API_URL` = *URL of your deployed FastAPI Render service*
5. Deploy! Vercel will output a secure public HTTPS link accessible from desktop and mobile.
