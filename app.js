const express = require('express');
const path = require('path');
const fs = require('fs');
const bodyParser = require('body-parser');
const morgan = require('morgan');
const scraper = require('./github_scraper');
const clustering = require('./issue_clustering');

// Initialize express app
const app = express();
const port = process.env.PORT || 3000;

// Set up view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

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

// Routes
app.get('/', (req, res) => {
  res.render('index', { 
    title: 'GitHub Issue Scraper',
    error: null,
    recentRepos: Object.keys(cachedIssues)
  });
});

app.post('/scrape', async (req, res) => {
  const repoUrl = req.body.repoUrl;
  let maxIssues = parseInt(req.body.maxIssues) || 0;
  
  try {
    // Parse GitHub URL to get owner and name
    const { owner, name } = scraper.parseGitHubUrl(repoUrl);
    
    // Fetch issues from GitHub
    console.log(`Scraping ${maxIssues > 0 ? maxIssues : 'all'} issues from ${owner}/${name}...`);
    const issues = await scraper.fetchAllIssues(owner, name, maxIssues);
    
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
    
    // Store in cache
    cachedIssues[`${owner}/${name}`] = {
      owner,
      name,
      issues: processedIssues,
      csvPath,
      timestamp: new Date()
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

// Start the server
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
}); 