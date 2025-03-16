const express = require('express');
const path = require('path');
const fs = require('fs');
const bodyParser = require('body-parser');
const morgan = require('morgan');
const axios = require('axios'); // For HTTP requests
const session = require('express-session'); // For flash messages
const scraper = require('./github_scraper');
const clustering = require('./issue_clustering');

// GitHub OAuth Configuration
const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID;
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;
const CALLBACK_URL = process.env.CALLBACK_URL || 'http://localhost:3000/auth/github/callback';

// Initialize express app
const app = express();
const port = process.env.PORT || 3000;

// Set up view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Determine if we're in production based on environment
const isProduction = process.env.NODE_ENV === 'production';
const useSecureCookies = isProduction && process.env.ENABLE_HTTPS === 'true';

// Use a more robust session configuration
app.use(session({
  secret: 'github-issue-hierarchy-construction',
  resave: true,                // Force save session even if unmodified
  saveUninitialized: true,     // Save new sessions
  cookie: { 
    secure: useSecureCookies,  // Only use secure cookies in production with HTTPS
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Flash message middleware
app.use((req, res, next) => {
  res.locals.flashMessage = req.session.flashMessage;
  delete req.session.flashMessage;
  next();
});

// Make user available to all views
app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  next();
});

// Custom renderer that uses layout
app.use((req, res, next) => {
  const originalRender = res.render;
  res.render = function(view, options = {}, callback) {
    // Add layout functionality
    options.view_content = view;
    originalRender.call(this, 'layout', options, callback);
  };
  next();
});

// Helper functions available to all views
app.locals.getContrastColor = function(hexcolor) {
    if (!hexcolor) return '#000000';
    
    // Convert hex to RGB
    const r = parseInt(hexcolor.substr(0, 2), 16);
    const g = parseInt(hexcolor.substr(2, 2), 16);
    const b = parseInt(hexcolor.substr(4, 2), 16);
    
    // Calculate luminance
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    
    // Return black for light colors, white for dark colors
    return luminance > 0.5 ? '#000000' : '#ffffff';
};

// Middleware
app.use(morgan('dev')); // Logging
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Ensure data directory exists
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir);
}

// In-memory cache for scraped issues
let cachedIssues = {};
// In-memory cache for clustered issues
let cachedClusters = {};

// Use environment variable for GitHub API token
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

// Authentication middleware
const ensureAuthenticated = (req, res, next) => {
  console.log('AUTH: Checking authentication');
  console.log('AUTH: Session data:', JSON.stringify(req.session));
  console.log('AUTH: User in session?', req.session.user ? 'YES' : 'NO');
  console.log('AUTH: Access token in session?', req.session.accessToken ? 'YES' : 'NO');
  
  if (req.session.user && req.session.accessToken) {
    console.log('AUTH: User is authenticated, proceeding');
    return next();
  }
  
  console.log('AUTH: User is NOT authenticated, redirecting to login');
  req.session.returnTo = req.originalUrl;
  req.session.flashMessage = {
    type: 'warning',
    text: 'Please log in with GitHub to access this page'
  };
  res.redirect('/login');
};

// Routes
app.get('/', (req, res) => {
  res.render('index', { 
    title: 'GitHub Issue Hierarchy Construction',
    error: null,
    recentRepos: Object.keys(cachedIssues)
  });
});

// Login page
app.get('/login', (req, res) => {
  res.render('login', {
    title: 'Login with GitHub',
    clientId: GITHUB_CLIENT_ID,
    redirectUri: CALLBACK_URL
  });
});

// GitHub OAuth routes
app.get('/auth/github', (req, res) => {
  const githubAuthUrl = 'https://github.com/login/oauth/authorize';
  const scope = 'read:user repo'; // Permissions for user info and repos
  
  res.redirect(
    `${githubAuthUrl}?client_id=${GITHUB_CLIENT_ID}&redirect_uri=${CALLBACK_URL}&scope=${scope}`
  );
});

app.get('/auth/github/callback', async (req, res) => {
  console.log('CALLBACK: Starting GitHub OAuth callback');
  const code = req.query.code;
  
  if (!code) {
    req.session.flashMessage = {
      type: 'danger',
      text: 'Failed to get authorization code from GitHub'
    };
    return res.redirect('/login');
  }
  
  try {
    // Exchange code for access token
    const tokenResponse = await axios.post(
      'https://github.com/login/oauth/access_token',
      {
        client_id: GITHUB_CLIENT_ID,
        client_secret: GITHUB_CLIENT_SECRET,
        code: code,
        redirect_uri: CALLBACK_URL
      },
      {
        headers: {
          Accept: 'application/json'
        }
      }
    );
    
    const accessToken = tokenResponse.data.access_token;
    
    if (!accessToken) {
      throw new Error('Failed to obtain access token');
    }
    
    // Get user data with the token
    const userResponse = await axios.get('https://api.github.com/user', {
      headers: {
        Authorization: `token ${accessToken}`,
        Accept: 'application/json'
      }
    });
    
    console.log('CALLBACK: User authenticated:', userResponse.data.login);
    console.log('CALLBACK: Setting session data');
    
    // Add this to inspect the session
    console.log('CALLBACK: Session before setting user:', JSON.stringify(req.session));
    
    // Set session data
    req.session.user = userResponse.data;
    req.session.accessToken = accessToken;
    
    // After setting session
    console.log('CALLBACK: Session after setting user:', JSON.stringify(req.session));
    
    // Test if the session data is immediately available
    console.log('CALLBACK: User in session?', req.session.user ? 'YES' : 'NO');
    
    // Explicitly save and wait for completion
    req.session.save((err) => {
      if (err) {
        console.error('CALLBACK: Session save error:', err);
      } else {
        console.log('CALLBACK: Session explicitly saved');
      }
      
      // Redirect to the original page or dashboard
      const returnTo = req.session.returnTo || '/dashboard';
      delete req.session.returnTo;
      
      req.session.flashMessage = {
        type: 'success',
        text: `Welcome, ${userResponse.data.login}!`
      };
      
      res.redirect(returnTo);
    });
  } catch (error) {
    console.error('GitHub OAuth error:', error);
    req.session.flashMessage = {
      type: 'danger',
      text: `Authentication failed: ${error.message}`
    };
    res.redirect('/login');
  }
});

// Logout route
app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

// Dashboard - requires authentication
app.get('/dashboard', ensureAuthenticated, async (req, res) => {
  console.log('DASHBOARD: Request received');
  console.log('DASHBOARD: Session data:', JSON.stringify(req.session));
  console.log('DASHBOARD: User in session?', req.session.user ? 'YES' : 'NO');
  
  try {
    // Fetch user's repositories
    const reposResponse = await axios.get('https://api.github.com/user/repos', {
      headers: {
        Authorization: `token ${req.session.accessToken}`,
        Accept: 'application/json'
      },
      params: {
        sort: 'updated',
        direction: 'desc',
        per_page: 50
      }
    });
    
    res.render('dashboard', {
      title: 'Your GitHub Repositories',
      repositories: reposResponse.data
    });
  } catch (error) {
    console.error('Error fetching repositories:', error);
    req.session.flashMessage = {
      type: 'danger',
      text: `Failed to fetch repositories: ${error.message}`
    };
    res.render('dashboard', {
      title: 'Your GitHub Repositories',
      repositories: []
    });
  }
});

// Protected routes - require authentication
app.post('/scrape', ensureAuthenticated, async (req, res) => {
  const repoUrl = req.body.repoUrl;
  let maxIssues = parseInt(req.body.maxIssues) || 0;
  
  try {
    // Parse GitHub URL to get owner and name
    const { owner, name } = scraper.parseGitHubUrl(repoUrl);
    
    // Fetch issues from GitHub using user's token
    console.log(`Scraping ${maxIssues > 0 ? maxIssues : 'all'} issues from ${owner}/${name}...`);
    
    // Use user's token instead of global token
    const userToken = req.session.accessToken;
    // Set the token temporarily for the scraping operation
    process.env.GITHUB_TOKEN = userToken;
    
    const issues = await scraper.fetchAllIssues(owner, name, maxIssues);
    
    // Reset the token to the original value
    process.env.GITHUB_TOKEN = GITHUB_TOKEN;
    
    if (issues.length === 0) {
      return res.render('index', { 
        title: 'GitHub Issue Scraper',
        error: `No issues found in repository ${owner}/${name}`,
        recentRepos: Object.keys(cachedIssues)
      });
    }
    
    // Process the issues
    const processedIssues = scraper.processIssues(issues, owner, name);
    
    // Optional: Save to CSV
    const csvPath = await scraper.saveIssuesToCsv(processedIssues, name);
    
    // Store in cache with user info
    cachedIssues[`${owner}/${name}`] = {
      owner,
      name,
      issues: processedIssues,
      csvPath,
      timestamp: new Date(),
      userId: req.session.user.id // Store user ID to associate with this data
    };
    
    // Redirect to view issues
    res.redirect(`/repository/${owner}/${name}`);
  } catch (error) {
    console.error('Scraping error:', error);
    res.render('index', { 
      title: 'GitHub Issue Scraper',
      error: `Error: ${error.message}`,
      recentRepos: Object.keys(cachedIssues)
    });
  }
});

app.get('/repository/:owner/:name', (req, res) => {
  const { owner, name } = req.params;
  const repoKey = `${owner}/${name}`;
  
  if (!cachedIssues[repoKey]) {
    return res.redirect('/');
  }
  
  res.render('repository', {
    title: `${owner}/${name} Issues`,
    repoOwner: owner,
    repoName: name,
    issues: cachedIssues[repoKey].issues,
    timestamp: cachedIssues[repoKey].timestamp,
    csvPath: path.relative(__dirname, cachedIssues[repoKey].csvPath)
  });
});

app.get('/issue/:owner/:name/:number', (req, res) => {
  const { owner, name, number } = req.params;
  const repoKey = `${owner}/${name}`;
  const issueNumber = parseInt(number);
  
  if (!cachedIssues[repoKey]) {
    return res.redirect('/');
  }
  
  const issue = cachedIssues[repoKey].issues.find(i => i.number === issueNumber);
  
  if (!issue) {
    return res.redirect(`/repository/${owner}/${name}`);
  }
  
  res.render('issue', {
    title: `Issue #${issue.number}: ${issue.title}`,
    issue,
    repoOwner: owner,
    repoName: name
  });
});

app.get('/download/:owner/:name', (req, res) => {
  const { owner, name } = req.params;
  const repoKey = `${owner}/${name}`;
  
  if (!cachedIssues[repoKey] || !cachedIssues[repoKey].csvPath) {
    return res.redirect('/');
  }
  
  res.download(cachedIssues[repoKey].csvPath);
});

// New routes for clustering
app.get('/clusters/:owner/:name', async (req, res) => {
  const { owner, name } = req.params;
  const repoKey = `${owner}/${name}`;
  
  try {
    // Check if we have cached clusters
    if (!cachedIssues[repoKey]) {
      return res.redirect('/');
    }
    
    // Check if we have cached clusters
    if (!cachedClusters[repoKey]) {
      console.log(`Clustering issues for ${owner}/${name}...`);
      
      // Determine the number of clusters (adjust based on issue count)
      const numIssues = cachedIssues[repoKey].issues.length;
      const numClusters = Math.min(
        Math.max(3, Math.floor(Math.sqrt(numIssues / 2))),
        10
      );
      
      // Perform clustering
      const clusterResults = await clustering.clusterIssues(
        JSON.parse(JSON.stringify(cachedIssues[repoKey].issues)), // Create a deep copy
        owner,
        name,
        numClusters
      );
      
      // Cache the results
      cachedClusters[repoKey] = clusterResults;
    }
    
    // Ensure we have valid cluster data
    if (!cachedClusters[repoKey] || !cachedClusters[repoKey].clusters) {
      throw new Error('Failed to generate clusters');
    }
    
    // Render the clusters view
    res.render('clusters', {
      title: `Issue Clusters - ${owner}/${name}`,
      repoOwner: owner,
      repoName: name,
      issues: cachedClusters[repoKey].issues || [],
      epics: cachedClusters[repoKey].epics || [],
      references: cachedClusters[repoKey].references || [],
      clusters: cachedClusters[repoKey].clusters || {},
      getContrastColor: (hexcolor) => {
        // Convert hex to RGB
        const r = parseInt(hexcolor.substr(0, 2), 16);
        const g = parseInt(hexcolor.substr(2, 2), 16);
        const b = parseInt(hexcolor.substr(4, 2), 16);
        // Calculate luminance
        const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        // Return black or white based on luminance
        return luminance > 0.5 ? '#000000' : '#ffffff';
      }
    });
  } catch (error) {
    console.error('Clustering error:', error);
    res.render('error', {
      title: 'Clustering Error',
      message: `Error clustering issues: ${error.message}`,
      error: error
    });
  }
});

// Route for viewing epic details
app.get('/epic/:owner/:name/:clusterId', async (req, res) => {
  const { owner, name, clusterId } = req.params;
  const repoKey = `${owner}/${name}`;
  
  try {
    // Check if we have cached clusters
    if (!cachedIssues[repoKey] || !cachedClusters[repoKey]) {
      return res.redirect(`/repository/${owner}/${name}`);
    }
    
    // Get the cluster and epic data
    const cluster = cachedClusters[repoKey].clusters[clusterId];
    
    if (!cluster || !cluster.epicIssue) {
      throw new Error('Epic not found');
    }
    
    // Render the epic detail view
    res.render('epic_detail', {
      title: `Epic: ${cluster.epicIssue.title}`,
      repoOwner: owner,
      repoName: name,
      clusterId,
      epic: cluster.epicIssue,
      issues: cluster.issues,
      getContrastColor: (hexcolor) => {
        // Convert hex to RGB
        const r = parseInt(hexcolor.substr(0, 2), 16);
        const g = parseInt(hexcolor.substr(2, 2), 16);
        const b = parseInt(hexcolor.substr(4, 2), 16);
        // Calculate luminance
        const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        // Return black or white based on luminance
        return luminance > 0.5 ? '#000000' : '#ffffff';
      }
    });
  } catch (error) {
    console.error('Epic detail error:', error);
    res.render('error', {
      title: 'Error Viewing Epic',
      message: `Error viewing epic: ${error.message}`,
      error: error
    });
  }
});

// Route for creating an epic on GitHub
app.post('/create-epic/:owner/:name/:clusterId', ensureAuthenticated, async (req, res) => {
  const { owner, name, clusterId } = req.params;
  const repoKey = `${owner}/${name}`;
  
  try {
    // Check if we have cached clusters
    if (!cachedIssues[repoKey] || !cachedClusters[repoKey]) {
      return res.redirect(`/repository/${owner}/${name}`);
    }
    
    // Get the cluster and epic data
    const cluster = cachedClusters[repoKey].clusters[clusterId];
    
    if (!cluster || !cluster.epicIssue) {
      throw new Error('Epic not found');
    }
    
    const epicIssue = cluster.epicIssue;
    const relatedIssues = cluster.issues;
    
    // Check if epic body already contains a "Related Issues" section in a case-insensitive manner
    let issueBody = epicIssue.body;
    
    if (!issueBody.toLowerCase().includes("related issues") && !issueBody.toLowerCase().includes("## related issues")) {
      // Only add our related issues section if it doesn't already exist
      issueBody += '\n\n### Related Issues\n';
      relatedIssues.forEach(issue => {
        issueBody += `- #${issue.number}: ${issue.title}\n`;
      });
    }
    
    // Prepare labels array
    const labels = epicIssue.labels ? epicIssue.labels.map(label => label.name) : [];
    // Always add an "Epic" label if not present
    if (!labels.includes('epic')) {
      labels.push('epic');
    }
    
    // Use the user's token instead of the global token
    const userToken = req.session.accessToken;
    
    // Create the GitHub API request using axios
    const response = await axios({
      method: 'post',
      url: `https://api.github.com/repos/${owner}/${name}/issues`,
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'Authorization': `token ${userToken}`,  // Using user's token
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'Issue-Hierarchy-Construction-App'
      },
      data: {
        title: epicIssue.title,
        body: issueBody,
        labels: labels
      }
    });
    
    // Check response status
    if (response.status !== 201) {
      throw new Error(`Unexpected status code: ${response.status}`);
    }
    
    const createdIssue = response.data;
    
    // Update the epic in our cache with the real issue number
    cluster.epicIssue.githubIssueNumber = createdIssue.number;
    cluster.epicIssue.githubIssueUrl = createdIssue.html_url;
    
    // Set flash message for success
    req.session.flashMessage = {
      type: 'success',
      text: `Epic successfully created on GitHub as issue #${createdIssue.number}. <a href="${createdIssue.html_url}" target="_blank">View on GitHub</a>`
    };
    
    res.redirect(`/epic/${owner}/${name}/${clusterId}`);
  } catch (error) {
    console.error('Error creating epic on GitHub:', error);
    
    // Provide more helpful error messages based on status code
    let errorMessage = 'Error creating epic on GitHub';
    
    if (error.response) {
      const statusCode = error.response.status;
      const responseData = error.response.data;
      
      switch (statusCode) {
        case 401:
          errorMessage = 'GitHub API authentication failed. You may need to log in again.';
          break;
        case 403:
          errorMessage = 'GitHub API permission denied. Your account needs permission to create issues in this repository.';
          break;
        case 404:
          errorMessage = 'Repository not found or API endpoint does not exist.';
          break;
        case 422:
          errorMessage = 'Validation failed: ' + (responseData.message || 'Unknown error');
          break;
        default:
          errorMessage = `GitHub API error (${statusCode}): ${responseData.message || 'Unknown error'}`;
      }
    }
    
    // Set flash message for error
    req.session.flashMessage = {
      type: 'danger',
      text: errorMessage
    };
    
    res.redirect(`/epic/${owner}/${name}/${clusterId}`);
  }
});

// Start the server
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
  console.log(`GitHub OAuth Callback URL: ${CALLBACK_URL}`);
  if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET) {
    console.warn('Warning: GitHub OAuth credentials not configured. Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET environment variables.');
  }
}); 