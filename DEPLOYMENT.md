# Deploy to Render - Step by Step Guide

This guide will help you deploy your ERP/POS system to Render with everything working (backend, database, and frontend).

## What You'll Get
- ✅ Live website with your own URL
- ✅ PostgreSQL database (managed by Neon - free tier)
- ✅ Backend and frontend working together
- ✅ Free hosting on Render

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

## Step 3: Create Your Database on Neon

Your app needs a PostgreSQL database. We'll use Neon's free tier (no credit card required!).

1. **Go to https://neon.tech and sign up** (use GitHub to sign in - easiest)

2. **Create a new project:**
   - Click "Create a project" or "New Project"
   - Give it a name like "ERP POS System"
   - Select a region (choose one closest to your Render region)
   - Click "Create Project"

3. **Copy your connection string:**
   - You'll see a connection string that looks like:
     ```
     postgresql://username:password@ep-xxx-xxx.us-east-2.aws.neon.tech/neondb?sslmode=require
     ```
   - Click "Copy" to copy it
   - **Save this somewhere safe** - you'll need it in the next step!

## Step 4: Deploy on Render

1. Go to https://render.com and sign up (use GitHub to sign in)

2. Click "New +" → "Blueprint"

3. Connect your GitHub repository
   - Render will ask permission to access your repos
   - Select your project repository (erp-pos-system)

4. Render will detect the `render.yaml` file and show:
   - ✅ Web Service: erp-pos-system

5. **IMPORTANT: Add your database connection string**
   - Before clicking "Apply", scroll down to find "Environment Variables"
   - Click "Add Environment Variable"
   - Key: `DATABASE_URL`
   - Value: Paste the Neon connection string you copied in Step 3
   - Click "Save"

6. Click "Apply"

7. Wait 3-5 minutes while Render:
   - Builds your application
   - Deploys everything

8. You'll get a URL like: `https://erp-pos-system.onrender.com`

## Step 5: Set Up Database Tables (One-Time Setup)

After your first deployment, you need to create the database tables:

1. In Render dashboard, click on your **erp-pos-system** web service

2. Click the **"Shell"** tab (in the left sidebar under "MANAGE")

3. Type this command and press Enter:
   ```bash
   npm run db:push
   ```

4. Wait for it to complete (you'll see "Done!" when finished)

That's it! Your database is now set up with all the tables.

## Step 6: Create Your Admin User

Now create your first admin user and company:

1. **Still in the Shell tab**, type this command:
   ```bash
   tsx scripts/create-admin.ts
   ```

2. You'll see a success message with your login credentials:
   ```
   You can now login with:
     Username: admin
     Password: admin123
   
   ⚠️  IMPORTANT: Change this password after first login!
   ```

3. **Write down these credentials!**

## Step 7: Start Using Your App!

Visit your URL (from Step 4) and:
1. Login with the credentials from Step 6:
   - Username: `admin`
   - Password: `admin123`
2. **IMPORTANT:** Change your password immediately after login (Settings page)
3. Set up your locations and inventory
4. Add more users if needed
5. Start managing your business!

## Troubleshooting

**If the build fails:**
- Check the logs in Render's dashboard
- Click "Logs" in the left sidebar to see detailed error messages
- Most common issue: missing DATABASE_URL environment variable

**If you see "Error connecting to database":**
- Make sure you added the DATABASE_URL in Step 4, #5
- Double-check the connection string is correct (no extra spaces)
- Make sure you ran `npm run db:push` in Step 5

**If you need to update the app:**
1. Make changes in Replit
2. Download as ZIP again
3. Push to GitHub (GitHub Desktop will detect changes automatically)
4. Render automatically redeploys (watch the Events tab)

## Free Tier Limits

**Neon (Database):**
- 0.5 GB storage
- Unlimited queries
- No credit card required
- Database pauses after inactivity (resumes instantly when accessed)

**Render (Web Service):**
- 750 hours/month of runtime
- Your service may spin down after inactivity (takes 30-60 seconds to wake up on first visit)
- 512 MB RAM

These limits are more than enough for testing and small business use!

## Upgrading

If you need:
- More storage or always-on database → Upgrade Neon ($19/month)
- Faster performance and no spin-down → Upgrade Render ($7/month)
- Both for production use → Around $26/month total

## Adding DATABASE_URL Later

If you forgot to add the DATABASE_URL in Step 4:

1. Go to your web service in Render dashboard
2. Click "Environment" in the left sidebar
3. Click "Add Environment Variable"
4. Key: `DATABASE_URL`, Value: your Neon connection string
5. Click "Save Changes"
6. Your service will automatically redeploy

## Need Help?

The `render.yaml` file in your project handles the build configuration automatically. If you need to customize:
- Service name
- Build commands
- Environment variables

Edit the `render.yaml` file before deploying.
