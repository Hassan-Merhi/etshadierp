# Deploy to Render - Step by Step Guide

This guide will help you deploy your ERP/POS system to Render with everything working (backend, database, and frontend) at a **fixed monthly price of $14**.

## What You'll Get
- ✅ Live website with your own URL
- ✅ PostgreSQL database with automatic backups
- ✅ Backend and frontend working together
- ✅ Fixed monthly cost: **$14** (Web $7 + Database $7)
- ✅ No surprises - predictable pricing

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

## Step 3: Deploy on Render (Includes Database Setup)

Render will automatically create and configure your PostgreSQL database using the `render.yaml` blueprint.

1. Go to https://render.com and sign up (use GitHub to sign in)

2. Click "New +" → "Blueprint"

3. Connect your GitHub repository
   - Render will ask permission to access your repos
   - Select your project repository (erp-pos-system)

4. Render will detect the `render.yaml` file and show:
   - ✅ Web Service: erp-pos-system (Starter Plan - $7/month)
   - ✅ PostgreSQL Database: erp-database (basic-256mb - $7/month)
   - **Total: $14/month**

5. Review the plan details:
   - **Web Service ($7/month):**
     - 512 MB RAM
     - Shared CPU
     - Automatic deployments
     - Free SSL certificate
     - Custom domain support
   
   - **Database ($7/month):**
     - 256 MB RAM
     - 1 GB storage
     - Daily automatic backups
     - Connection pooling

6. Click "Apply" to start deployment

7. **Add your payment method** when prompted (required for paid plans)
   - You'll be charged $14/month starting now
   - First month is prorated if you start mid-month

8. Wait 3-5 minutes while Render:
   - Creates your PostgreSQL database
   - Builds your application
   - Runs database migrations
   - Deploys everything

9. You'll get a URL like: `https://erp-pos-system.onrender.com`

## Step 4: Verify Database Setup

The database tables are automatically created during deployment (via the build command in `render.yaml`). To verify:

1. In Render dashboard, click on your **erp-pos-system** web service

2. Click the **"Logs"** tab and look for:
   ```
   ✓ Database schema created successfully
   ```

If you see any errors, you can manually run migrations:
1. Click the **"Shell"** tab
2. Type: `npm run db:push`
3. Wait for completion

## Step 5: Create Your Admin User

You'll need to create your first admin user and company manually:

1. In Render dashboard, go to your **erp-database** PostgreSQL service

2. Click **"Connect"** → Copy the **External Connection String**

3. Use a PostgreSQL client (like TablePlus, pgAdmin, or psql) to connect

4. Run these SQL commands:

```sql
-- Create initial company
INSERT INTO companies (code, name, active) 
VALUES ('COMP001', 'Your Company Name', true);

-- Create admin user (password is SHA256 hash of 'admin123')
INSERT INTO users (username, password, active) 
VALUES ('admin', '240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9', true);

-- Link user to company with Admin role  
INSERT INTO user_company_roles (user_id, company_id, role) 
VALUES (
  (SELECT id FROM users WHERE username = 'admin'), 
  (SELECT id FROM companies WHERE code = 'COMP001'), 
  'Admin'
);
```

**Default login credentials:**
- Username: `admin`
- Password: `admin123`

⚠️ **IMPORTANT:** Change this password immediately after first login!

## Step 6: Start Using Your App!

Visit your URL (from Step 3, #9) and:
1. Login with the credentials from Step 5:
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
- Verify database was created successfully

**If you see "Error connecting to database":**
- Check that both web service and database are running
- Verify DATABASE_URL is automatically set (it should be)
- Check database connection in Shell: `echo $DATABASE_URL`

**If you need to update the app:**
1. Make changes in your code
2. Push to GitHub (GitHub Desktop will detect changes automatically)
3. Render automatically redeploys (watch the Events tab)
4. Updates are free - no extra charges

## What's Included in $14/Month

**Web Service ($7/month):**
- 512 MB RAM
- Shared CPU
- Automatic deployments from GitHub
- Free SSL certificate (HTTPS)
- Custom domain support
- DDoS protection
- Always-on (no spin down)
- Automatic restarts if crashes

**PostgreSQL Database ($7/month):**
- 256 MB RAM
- 1 GB storage
- Daily automatic backups (7-day retention)
- Connection pooling
- Always-on (no pauses)
- High availability
- Monitoring and metrics

## Upgrading for More Resources

If your business grows and you need more capacity:

**Web Service Plans:**
- Starter: $7/month (current plan)
- Standard: $25/month (2 GB RAM, 1 CPU)
- Pro: $85/month (4 GB RAM, 2 CPUs)

**Database Plans:**
- basic-256mb: $7/month (256 MB RAM, 1 GB storage - current plan)
- basic-512mb: ~$14/month (512 MB RAM)
- standard-1gb: ~$25/month (1 GB RAM, 10+ GB storage)
- Higher plans available for production workloads

You can upgrade/downgrade anytime from the Render dashboard.

## Technical Notes

### Database Driver Configuration

This application uses the native PostgreSQL driver (`pg` with `drizzle-orm/node-postgres`), which is compatible with:
- ✅ Render's managed PostgreSQL databases
- ✅ Neon serverless PostgreSQL
- ✅ Any standard PostgreSQL database

**SSL Configuration:**
- Production (Render): SSL is enabled with `rejectUnauthorized: false`
- Development: SSL is disabled for local databases

The configuration automatically adapts based on `NODE_ENV`. No manual configuration needed.

### Database Connection

The app connects to PostgreSQL using a connection pool for optimal performance:
- Connection pooling for efficient resource usage
- Automatic reconnection on failures
- SSL support for secure production connections

## Need Help?

The `render.yaml` file in your project handles the build configuration automatically. If you need to customize:
- Service name
- Build commands
- Environment variables

Edit the `render.yaml` file before deploying.
