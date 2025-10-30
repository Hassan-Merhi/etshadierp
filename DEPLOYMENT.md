# Deploy to Render - Step by Step Guide

This guide will help you deploy your ERP/POS system to Render with everything working (backend, database, and frontend).

## What You'll Get
- ✅ Live website with your own URL
- ✅ PostgreSQL database (managed by Render)
- ✅ Backend and frontend working together
- ✅ Free tier available

## Step 1: Download Your Code (On Your Mac)

1. In Replit, click the three dots (⋮) in the file explorer
2. Select "Download as ZIP"
3. The file downloads to your Downloads folder
4. Double-click to extract it

## Step 2: Push to GitHub

### Option A: Using GitHub Desktop (Easiest)
1. Download GitHub Desktop: https://desktop.github.com
2. Open GitHub Desktop
3. Click "Add" → "Add Existing Repository"
4. Choose your extracted project folder
5. Click "Publish repository" in the top bar
6. Uncheck "Keep this code private" (or keep it private, your choice)
7. Click "Publish Repository"

### Option B: Using Terminal
1. Open Terminal (Applications → Utilities → Terminal)
2. Navigate to your project:
   ```bash
   cd ~/Downloads/your-project-folder
   ```
3. Initialize git and push:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   gh repo create erp-pos-system --public --source=. --remote=origin --push
   ```
   (You'll need GitHub CLI installed: `brew install gh`)

## Step 3: Deploy on Render

1. Go to https://render.com and sign up (use GitHub to sign in)

2. Click "New +" → "Blueprint"

3. Connect your GitHub repository
   - Render will ask permission to access your repos
   - Select your project repository

4. Render will detect the `render.yaml` file and show:
   - ✅ Web Service: erp-pos-system
   - ✅ Database: erp-pos-db

5. Click "Apply"

6. Wait 3-5 minutes while Render:
   - Creates your database
   - Builds your application
   - Runs database migrations
   - Deploys everything

7. Done! You'll get a URL like: `https://erp-pos-system.onrender.com`

## Step 4: Initial Setup

After deployment, visit your URL and:
1. The app should load automatically
2. Set up your first user account
3. Configure your locations and inventory

## Troubleshooting

**If the build fails:**
- Check the logs in Render's dashboard
- Most common issue: database migrations - Render handles this automatically

**If you need to update the app:**
1. Make changes in Replit
2. Download as ZIP again
3. Push to GitHub (GitHub Desktop will detect changes)
4. Render automatically redeploys

## Free Tier Limits

Render's free tier includes:
- 750 hours/month of web service runtime
- PostgreSQL database (90 days, then requires upgrade)
- Your service may spin down after inactivity (takes 30-60 seconds to wake up)

## Upgrading

If you need:
- Faster performance
- No spin-down delays
- Permanent database

Upgrade to Render's paid plans starting at $7/month for the web service.

## Need Help?

The `render.yaml` file in your project handles all the configuration automatically. If you need to customize:
- Database name
- Service name
- Build commands

Edit the `render.yaml` file before deploying.
