# OralShield AI - Frontend Dashboard

This directory contains the React application built with Vite and Tailwind CSS v3 for the clinical oral lesion screening dashboard.

## Local Development

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Run Dev Server**:
   ```bash
   npm run dev
   ```
   The dashboard will be available at `http://localhost:5173`.

3. **Backend Connection**:
   - Ensure your local FastAPI server is running (usually `http://127.0.0.1:8000`).
   - If deploying, you can dynamically configure the API server URL in the UI by clicking the settings gear in the top-right corner.

---

## Deployment to Vercel

Vercel is the recommended hosting platform for React + Vite static websites.

### Option A: Deploying via Vercel Dashboard (GitHub Integration)

1. **Push Code to Git**:
   - Push this workspace to your GitHub, GitLab, or Bitbucket repository.
2. **Import Project**:
   - Log in to your [Vercel Dashboard](https://vercel.com).
   - Click **Add New** -> **Project**.
   - Import your repository.
3. **Configure Project Settings**:
   - **Framework Preset**: Select **Vite** (Vercel will detect this automatically).
   - **Root Directory**: Select `frontend` (since the workspace contains frontend and backend separately).
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
4. **Deploy**:
   - Click **Deploy**. Vercel will build and assign a production URL to your frontend.

---

### Option B: Deploying via Vercel CLI

If you have the Vercel CLI installed:
1. Navigate to the `frontend/` directory:
   ```bash
   cd frontend
   ```
2. Run the deployment command:
   ```bash
   vercel
   ```
3. Follow the CLI prompts:
   - Set project scope and name.
   - Specify the root directory as current directory (`.`).
   - Confirm build settings.
4. Run `vercel --prod` to deploy to production.
