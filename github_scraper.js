const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { createObjectCsvWriter } = require('csv-writer');

// Read API key from environment variable
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

// GitHub GraphQL URL
const GITHUB_GRAPHQL_URL = 'https://api.github.com/graphql';

// GraphQL query template for issues
const queryTemplate = `
query ($repoOwner: String!, $repoName: String!, $cursor: String) {
  repository(owner: $repoOwner, name: $repoName) {
    issues(first: 100, after: $cursor) {
      pageInfo {
        endCursor
        hasNextPage
      }
      nodes {
        title
        number
        state
        body
        createdAt
        updatedAt
        url
        author {
          login
          avatarUrl
        }
        assignees(first: 10) {
          nodes {
            login
            avatarUrl
          }
        }
        comments(first: 100) {
          nodes {
            body
            author {
              login
              avatarUrl
            }
            createdAt
          }
        }
        labels(first: 10) {
          nodes {
            name
            color
          }
        }
      }
    }
  }
}
`;

// Function to run GraphQL query
async function runQuery(query, variables) {
  const headers = {
    'Authorization': `Bearer ${GITHUB_TOKEN}`,
    'Content-Type': 'application/json'
  };

  try {
    const response = await axios.post(
      GITHUB_GRAPHQL_URL,
      { query, variables },
      { headers }
    );
    return response.data;
  } catch (error) {
    console.error(`Query failed: ${error.message}`);
    
    // If we hit rate limit or other temporary error, wait and try again
    if (error.response && (error.response.status === 429 || error.response.status === 502)) {
      console.log('Rate limited or temporary error. Waiting 5 seconds...');
      await new Promise(resolve => setTimeout(resolve, 5000));
      return runQuery(query, variables);
    }
    
    throw error;
  }
}

// Function to fetch all issues from a repository
async function fetchAllIssues(repoOwner, repoName, maxIssues = 0) {
  const issues = [];
  let cursor = null;
  let hasNextPage = true;
  let totalIssuesFetched = 0;

  while (hasNextPage && (maxIssues === 0 || totalIssuesFetched < maxIssues)) {
    const variables = { repoOwner, repoName, cursor };
    
    try {
      const result = await runQuery(queryTemplate, variables);
      const issuesData = result.data.repository.issues;
      const issuesBatch = issuesData.nodes;
      
      issues.push(...issuesBatch);

      // Update total issues fetched and print progress
      totalIssuesFetched += issuesBatch.length;
      console.log(`Repository: ${repoOwner}/${repoName}, Issues fetched so far: ${totalIssuesFetched}`);

      // Pagination handling
      cursor = issuesData.pageInfo.endCursor;
      hasNextPage = issuesData.pageInfo.hasNextPage;
      
      // If we have a maxIssues limit and we're over it, break out
      if (maxIssues > 0 && totalIssuesFetched >= maxIssues) {
        break;
      }
    } catch (error) {
      console.error(`Error fetching issues: ${error.message}`);
      break;
    }
  }

  return issues;
}

// Function to process issues into a structured format
function processIssues(issues, repoOwner, repoName) {
  return issues.map(issue => {
    // Safely extract nested fields
    const authorLogin = issue.author ? issue.author.login : null;
    const authorAvatar = issue.author ? issue.author.avatarUrl : null;
    const assignees = issue.assignees.nodes ? issue.assignees.nodes.map(assignee => ({
      login: assignee.login,
      avatarUrl: assignee.avatarUrl
    })) : [];
    const comments = issue.comments.nodes 
      ? issue.comments.nodes.map(comment => ({
          body: comment.body,
          author: comment.author ? comment.author.login : null,
          authorAvatar: comment.author ? comment.author.avatarUrl : null,
          createdAt: comment.createdAt
        })) 
      : [];
    const labels = issue.labels.nodes ? issue.labels.nodes.map(label => ({
      name: label.name,
      color: label.color
    })) : [];

    return {
      repoOwner,
      repoName,
      state: issue.state,
      number: issue.number,
      title: issue.title,
      body: issue.body,
      createdAt: issue.createdAt,
      updatedAt: issue.updatedAt,
      url: issue.url,
      author: authorLogin,
      authorAvatar,
      assignees,
      comments,
      labels
    };
  });
}

// Function to save issues to CSV
async function saveIssuesToCsv(issues, repoName) {
  // Ensure data directory exists
  const dataDir = path.join(__dirname, 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir);
  }

  const csvWriter = createObjectCsvWriter({
    path: path.join(dataDir, `${repoName}_issues.csv`),
    header: [
      { id: 'repoOwner', title: 'Repo Owner' },
      { id: 'repoName', title: 'Repo Name' },
      { id: 'state', title: 'Issue State' },
      { id: 'number', title: 'Issue Number' },
      { id: 'title', title: 'Issue Title' },
      { id: 'body', title: 'Issue Body' },
      { id: 'createdAt', title: 'Created At' },
      { id: 'updatedAt', title: 'Updated At' },
      { id: 'url', title: 'URL' },
      { id: 'author', title: 'Author' },
      { id: 'assignees', title: 'Assignees' },
      { id: 'comments', title: 'Comments' },
      { id: 'labels', title: 'Labels' }
    ]
  });

  // Convert nested objects to strings for CSV
  const csvIssues = issues.map(issue => ({
    ...issue,
    assignees: JSON.stringify(issue.assignees),
    comments: JSON.stringify(issue.comments),
    labels: JSON.stringify(issue.labels)
  }));

  await csvWriter.writeRecords(csvIssues);
  console.log(`Issues saved to data/${repoName}_issues.csv`);
  return path.join(dataDir, `${repoName}_issues.csv`);
}

// Extract owner and name from GitHub repo URL
function parseGitHubUrl(url) {
  try {
    const urlObj = new URL(url);
    if (urlObj.hostname !== 'github.com') {
      throw new Error('Not a GitHub URL');
    }
    
    const pathParts = urlObj.pathname.split('/').filter(part => part);
    if (pathParts.length < 2) {
      throw new Error('Invalid GitHub repository URL');
    }
    
    return { owner: pathParts[0], name: pathParts[1] };
  } catch (error) {
    throw new Error(`Invalid URL: ${error.message}`);
  }
}

module.exports = {
  fetchAllIssues,
  processIssues,
  saveIssuesToCsv,
  parseGitHubUrl
}; 