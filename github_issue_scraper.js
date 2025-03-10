const fs = require('fs');
const path = require('path');
const readline = require('readline');
const axios = require('axios');
const { createObjectCsvWriter } = require('csv-writer');

// Read API key from secrets.json
const secrets = JSON.parse(fs.readFileSync('secrets.json', 'utf8'));
const ACCESS_TOKEN = secrets.apiKey;

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
        author {
          login
        }
        assignees(first: 10) {
          nodes {
            login
          }
        }
        comments(first: 100) {
          nodes {
            body
            author {
              login
            }
          }
        }
        labels(first: 10) {
          nodes {
            name
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
    'Authorization': `Bearer ${ACCESS_TOKEN}`,
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
async function fetchAllIssues(repoOwner, repoName) {
  const issues = [];
  let cursor = null;
  let hasNextPage = true;
  let totalIssuesFetched = 0;

  while (hasNextPage) {
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
    const assignees = issue.assignees.nodes ? issue.assignees.nodes.map(assignee => assignee.login) : [];
    const comments = issue.comments.nodes 
      ? issue.comments.nodes.map(comment => ({
          body: comment.body,
          author: comment.author ? comment.author.login : null
        })) 
      : [];
    const labels = issue.labels.nodes ? issue.labels.nodes.map(label => label.name) : [];

    return {
      'Repo Owner': repoOwner,
      'Repo Name': repoName,
      'Issue State': issue.state,
      'Issue Number': issue.number,
      'Issue Title': issue.title,
      'Issue Body': issue.body,
      'Author': authorLogin,
      'Assignees': JSON.stringify(assignees),
      'Comments': JSON.stringify(comments),
      'Labels': JSON.stringify(labels)
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
      { id: 'Repo Owner', title: 'Repo Owner' },
      { id: 'Repo Name', title: 'Repo Name' },
      { id: 'Issue State', title: 'Issue State' },
      { id: 'Issue Number', title: 'Issue Number' },
      { id: 'Issue Title', title: 'Issue Title' },
      { id: 'Issue Body', title: 'Issue Body' },
      { id: 'Author', title: 'Author' },
      { id: 'Assignees', title: 'Assignees' },
      { id: 'Comments', title: 'Comments' },
      { id: 'Labels', title: 'Labels' }
    ]
  });

  await csvWriter.writeRecords(issues);
  console.log(`Issues saved to data/${repoName}_issues.csv`);
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

// Main function to run the app
async function main() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  try {
    const repoUrl = await new Promise(resolve => {
      rl.question('Enter GitHub repository URL (e.g., https://github.com/owner/repo): ', resolve);
    });
    
    const { owner, name } = parseGitHubUrl(repoUrl);
    console.log(`Scraping issues from ${owner}/${name}...`);
    
    const issues = await fetchAllIssues(owner, name);
    console.log(`Fetched ${issues.length} issues`);
    
    const processedIssues = processIssues(issues, owner, name);
    await saveIssuesToCsv(processedIssues, name);
    
    console.log('Done!');
  } catch (error) {
    console.error(`Error: ${error.message}`);
  } finally {
    rl.close();
  }
}

// Run the app
main(); 