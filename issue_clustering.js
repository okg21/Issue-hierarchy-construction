/**
 * Issue Clustering Module
 * Using TensorFlow.js Universal Sentence Encoder for semantic embeddings
 */

const tf = require('@tensorflow/tfjs-node');
const use = require('@tensorflow-models/universal-sentence-encoder');
const natural = require('natural');
const skmeans = require('skmeans');

// Use the WordTokenizer from natural for text preprocessing
const WordTokenizer = natural.WordTokenizer;
const tokenizer = new WordTokenizer();

// Regular expressions for extracting issue references
function extractIssueRef(text, repoOwner, repoName) {
  if (!text || typeof text !== 'string') {
    return new Set();
  }

  const issueUrlRegex = new RegExp('/' + repoOwner + '/' + repoName + '/issues/(\\d+)', 'g');
  const edgeRegex = new RegExp(repoOwner + '/' + repoName + '#(\\d+)', 'g');
  const taskRegex = /\[([xX]|\s)\]\s?#(\d+)/g;

  let matches, issueNumbersHttp = new Set(), issueNumbersEdge = new Set(), issueNumbersHashtag = new Set();

  // Extract issues mentioned via URL
  while ((matches = issueUrlRegex.exec(text)) !== null) {
    issueNumbersHttp.add(matches[1]);
  }

  // Extract issues mentioned via owner/repo#number
  while ((matches = edgeRegex.exec(text)) !== null) {
    issueNumbersEdge.add(matches[1]);
  }

  // Extract issues mentioned in task lists
  while ((matches = taskRegex.exec(text)) !== null) {
    issueNumbersHashtag.add(matches[2]);
  }

  // Combine all sets
  return new Set([...issueNumbersHttp, ...issueNumbersEdge, ...issueNumbersHashtag]);
}

// Process the issues to extract references
function processIssueReferences(issues, repoOwner, repoName) {
  issues.forEach(issue => {
    const references = extractIssueRef(issue.body, repoOwner, repoName);
    issue.references = Array.from(references);
  });

  return issues;
}

// Identify epic issues based on labels
function identifyEpics(issues) {
  return issues.filter(issue => {
    return issue.labels && issue.labels.some(label => 
      label.name && label.name.toLowerCase().includes('epic')
    );
  });
}

// Extract all unique references from the repository
function getAllReferences(epicIssues) {
  const refSet = new Set();
  
  epicIssues.forEach(issue => {
    issue.references.forEach(ref => refSet.add(ref));
  });
  
  return Array.from(refSet);
}

// Prepare data for embedding by combining title and body
function prepareDataForEmbedding(issues) {
  return issues.map(issue => {
    const title = issue.title || '';
    const body = issue.body || '';
    // Combine title and first 200 words of body for embedding
    const bodyText = body.split(' ').slice(0, 200).join(' ');
    return `${title} ${bodyText}`;
  });
}

// Create embeddings using Universal Sentence Encoder
async function createEmbeddings(issues) {
  try {
    // Load the model
    const model = await use.load();
    
    // Prepare text data
    const texts = prepareDataForEmbedding(issues);
    
    // Generate embeddings
    const embeddings = await model.embed(texts);
    const embeddingArray = await embeddings.array();
    
    // Assign embeddings to issues
    issues.forEach((issue, index) => {
      issue.embedding = embeddingArray[index];
    });
    
    return issues;
  } catch (error) {
    console.error('Error creating embeddings:', error);
    throw error;
  }
}

// Calculate optimal number of clusters using silhouette score
function calculateOptimalClusters(embeddings, maxClusters = 10) {
  let bestScore = -1;
  let optimalK = 2;  // Start with minimum of 2 clusters

  for (let k = 2; k <= Math.min(maxClusters, Math.floor(embeddings.length / 2)); k++) {
    const result = skmeans(embeddings, k);
    const score = calculateSilhouetteScore(embeddings, result.idxs);
    
    if (score > bestScore) {
      bestScore = score;
      optimalK = k;
    }
  }

  return optimalK;
}

// Calculate silhouette score for clustering evaluation
function calculateSilhouetteScore(data, labels) {
  let totalScore = 0;
  
  for (let i = 0; i < data.length; i++) {
    const a = calculateIntraClusterDistance(data[i], data, labels, labels[i]);
    const b = calculateInterClusterDistance(data[i], data, labels, labels[i]);
    const score = (b - a) / Math.max(a, b);
    totalScore += score;
  }
  
  return totalScore / data.length;
}

function calculateIntraClusterDistance(point, data, labels, cluster) {
  let sum = 0;
  let count = 0;
  
  for (let i = 0; i < data.length; i++) {
    if (labels[i] === cluster && i !== data.indexOf(point)) {
      sum += euclideanDistance(point, data[i]);
      count++;
    }
  }
  
  return count > 0 ? sum / count : 0;
}

function calculateInterClusterDistance(point, data, labels, cluster) {
  const otherClusters = [...new Set(labels)].filter(c => c !== cluster);
  let minDistance = Infinity;
  
  for (const otherCluster of otherClusters) {
    let sum = 0;
    let count = 0;
    
    for (let i = 0; i < data.length; i++) {
      if (labels[i] === otherCluster) {
        sum += euclideanDistance(point, data[i]);
        count++;
      }
    }
    
    const avgDistance = count > 0 ? sum / count : Infinity;
    minDistance = Math.min(minDistance, avgDistance);
  }
  
  return minDistance;
}

function euclideanDistance(a, b) {
  return Math.sqrt(a.reduce((sum, val, i) => sum + Math.pow(val - b[i], 2), 0));
}

// Perform k-means clustering with optimal k
async function performClustering(issues, suggestedClusters = null) {
  if (issues.length === 0) return [];
  
  // Extract embeddings as a 2D array
  const embeddings = issues.map(issue => issue.embedding);
  
  // Calculate optimal number of clusters if not suggested
  const numClusters = suggestedClusters || calculateOptimalClusters(embeddings);
  
  // Run k-means algorithm
  const result = skmeans(embeddings, numClusters);
  
  // Assign cluster IDs to issues
  issues.forEach((issue, index) => {
    issue.cluster = result.idxs[index];
  });
  
  return issues;
}

// Generate cluster summaries with improved topic extraction and Epic generation
function generateClusterSummaries(issues) {
  const clusters = {};
  
  issues.forEach(issue => {
    if (typeof issue.cluster !== 'number') return;
    
    if (!clusters[issue.cluster]) {
      clusters[issue.cluster] = {
        issues: [],
        topTerms: null,
        epicIssue: null
      };
    }
    
    clusters[issue.cluster].issues.push(issue);
  });
  
  // For each cluster, find most representative terms using TF-IDF
  Object.keys(clusters).forEach(clusterId => {
    const clusterIssues = clusters[clusterId].issues;
    
    // Create document-term matrix
    const documents = clusterIssues.map(issue => {
      const text = `${issue.title} ${issue.body || ''}`;
      return tokenizer.tokenize(text.toLowerCase());
    });
    
    // Calculate TF-IDF
    const tfidf = new natural.TfIdf();
    documents.forEach(doc => tfidf.addDocument(doc));
    
    // Get top terms using TF-IDF scores
    const termScores = new Map();
    documents[0].forEach(term => {
      if (term.length < 3) return; // Skip very short terms
      const score = tfidf.tfidf(term, 0);
      termScores.set(term, (termScores.get(term) || 0) + score);
    });
    
    // Sort terms by score and get top 5
    const topTerms = Array.from(termScores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([term, _]) => term);
    
    clusters[clusterId].topTerms = topTerms;
    clusters[clusterId].label = topTerms.join(', ');
    
    // Prepare for epic generation
    clusters[clusterId].epicIssue = null; // Will be populated asynchronously
  });
  
  return clusters;
}

// Generate an epic issue for a cluster using Claude API
async function generateEpicForCluster(issues, topTerms, clusterId, repoOwner, repoName) {
  try {
    // Load Claude API key from secrets.json
    const fs = require('fs');
    const secrets = JSON.parse(fs.readFileSync('secrets.json', 'utf8'));
    const apiKey = secrets.claudeKey;
    
    if (!apiKey) {
      console.error('Claude API key not found in secrets.json');
      return createFallbackEpic(issues, topTerms, clusterId);
    }
    
    // Format issue data for the prompt
    const issuesData = issues.map(issue => {
      return `<TITLE> ${issue.title || ''} <BODY> ${issue.body || ''} <LABELS> ${
        issue.labels ? issue.labels.map(l => l.name).join(', ') : ''
      } <ISSUE_NUMBER> ${issue.number}`;
    }).join('\n\n');
    
    // Create the prompt
    const promptText = `You are an expert on software project management. You are given the issue data:

${issuesData}

Given the issues above, create an epic issue that encloses all the issues.
Create a <BODY> section that gives the description for the epic issue very briefly. Don't list the issues in the <BODY> section.
Don't give too much information in the <BODY> section, just enough to describe the epic issue.
Then provide a <TITLE> and <LABELS> for the epic issue.
Give your output in the format of <TITLE>: Epic Issue Title<BODY>: Epic issue body<LABELS>: Labels.
Give newlines when necessary.`;
    
    // Call Claude API using the official SDK
    const Anthropic = require('@anthropic-ai/sdk');
    const anthropic = new Anthropic({
      apiKey: apiKey
    });

    const response = await anthropic.messages.create({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 1024,
      temperature: 0.7,
      messages: [
        {
          role: "user", 
          content: [
            {
              type: "text",
              text: promptText
            }
          ]
        }
      ]
    });
    
    // Parse the response
    const content = response.content[0].text;
    const titleMatch = content.match(/<TITLE>:(.*?)(?=<BODY>:|$)/s);
    const bodyMatch = content.match(/<BODY>:(.*?)(?=<LABELS>:|$)/s);
    const labelsMatch = content.match(/<LABELS>:(.*?)$/s);
    
    const title = titleMatch ? titleMatch[1].trim() : `Epic: ${topTerms.slice(0, 3).join(' ')}`;
    const body = bodyMatch ? bodyMatch[1].trim() : "";
    const labelNames = labelsMatch ? 
      labelsMatch[1].trim().split(',').map(l => l.trim()) 
      : ['epic'];
    
    // Create label objects
    const labels = labelNames.map(name => ({
      name,
      color: getLabelColor(name, issues)
    }));
    
    // Format the task list
    const taskList = issues.map(issue => 
      `- [ ] #${issue.number}: ${issue.title}`
    ).join('\n');
    
    // Create the epic issue
    return {
      title,
      body: `## Epic Description\n${body}\n\n## Related Issues\n${taskList}`,
      labels,
      state: 'OPEN',
      number: `epic-${clusterId}`,
      cluster: parseInt(clusterId),
      createdAt: new Date().toISOString(),
      references: issues.map(issue => issue.number.toString())
    };
  } catch (error) {
    console.error('Error generating epic with Claude:', error);
    console.error('Error details:', error.message);
    // Fallback to local generation if Claude API fails
    return createFallbackEpic(issues, topTerms, clusterId);
  }
}

// Fallback epic generation when Claude API is not available
function createFallbackEpic(issues, topTerms, clusterId) {
  // Extract the most common labels across all issues in this cluster
  const labelCounts = new Map();
  issues.forEach(issue => {
    if (issue.labels && Array.isArray(issue.labels)) {
      issue.labels.forEach(label => {
        const labelName = label.name || '';
        labelCounts.set(labelName, (labelCounts.get(labelName) || 0) + 1);
      });
    }
  });
  
  // Get the top 3 labels
  const topLabels = Array.from(labelCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([label, _]) => ({ name: label, color: getLabelColor(label, issues) }));
  
  // Add 'epic' label if not already present
  if (!topLabels.some(label => label.name.toLowerCase().includes('epic'))) {
    topLabels.push({ name: 'epic', color: '6E49CB' });
  }
  
  // Format issues as task list for the epic body
  const taskList = issues.map(issue => 
    `- [ ] #${issue.number}: ${issue.title}`
  ).join('\n');
  
  // Generate a concise summary of the cluster using TF-IDF terms and key issues
  const summary = extractClusterSummary(issues, topTerms);
  
  // Create the epic issue
  return {
    title: `Epic: ${capitalizeFirstLetter(topTerms.slice(0, 3).join(' '))} Issues`,
    body: `## Cluster Summary\n${summary}\n\n## Related Issues\n${taskList}`,
    labels: topLabels,
    state: 'OPEN',
    number: `epic-${clusterId}`,
    cluster: parseInt(clusterId),
    createdAt: new Date().toISOString(),
    references: issues.map(issue => issue.number.toString())
  };
}

// Helper function to extract a summary description for a cluster
function extractClusterSummary(issues, topTerms) {
  // Find the most central/representative issue in the cluster
  // (simplification: use the one with most references to other issues)
  const issuesByReferences = [...issues].sort((a, b) => 
    (b.references?.length || 0) - (a.references?.length || 0)
  );
  
  const centralIssue = issuesByReferences[0];
  
  // Generate a summary using the top terms and central issue
  const termPhrase = topTerms.slice(0, 3).join(', ');
  
  let summary = `This epic represents a group of ${issues.length} related issues `;
  summary += `concerning ${termPhrase}. `;
  
  if (centralIssue) {
    // Extract a short fragment from the central issue description
    const bodyText = centralIssue.body || '';
    const firstSentences = bodyText.split(/[.!?]/).slice(0, 2).join('. ');
    
    if (firstSentences && firstSentences.length > 30) {
      summary += `Key description: "${firstSentences.substring(0, 150)}${firstSentences.length > 150 ? '...' : ''}"`;
    }
  }
  
  return summary;
}

// Helper function to get the color of a label from issue set
function getLabelColor(labelName, issues) {
  for (const issue of issues) {
    if (issue.labels && Array.isArray(issue.labels)) {
      const matchedLabel = issue.labels.find(label => label.name === labelName);
      if (matchedLabel && matchedLabel.color) {
        return matchedLabel.color;
      }
    }
  }
  
  // Default colors if not found
  const defaultColors = {
    'bug': 'D73A4A',
    'feature': '0E8A16',
    'epic': '6E49CB',
    'documentation': '0075CA',
    'enhancement': 'A2EEEF',
    'help wanted': '008672'
  };
  
  // Return a default color based on label name or a generic color
  const lowercaseName = labelName.toLowerCase();
  for (const [key, color] of Object.entries(defaultColors)) {
    if (lowercaseName.includes(key)) {
      return color;
    }
  }
  
  // Return a random color from the default set if no match
  const colors = Object.values(defaultColors);
  return colors[Math.floor(Math.random() * colors.length)];
}

// Helper to capitalize the first letter of each word
function capitalizeFirstLetter(string) {
  return string.split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

// Main clustering function
async function clusterIssues(issues, repoOwner, repoName, numClusters = null) {
  try {
    // Step 1: Process issue references
    const processedIssues = processIssueReferences(issues, repoOwner, repoName);
    
    // Step 2: Identify epic issues
    const epicIssues = identifyEpics(processedIssues);
    
    // Step 3: Get all references
    const allReferences = getAllReferences(epicIssues);
    
    // Step 4: Create embeddings using Universal Sentence Encoder
    const issuesWithEmbeddings = await createEmbeddings(processedIssues);
    
    // Step 5: Perform clustering with optional number of clusters
    const clusteredIssues = await performClustering(issuesWithEmbeddings, numClusters);
    
    // Step 6: Generate cluster summaries
    const clusterSummaries = generateClusterSummaries(clusteredIssues);
    
    // Step 7: Generate epic issues for each cluster using Claude API
    for (const clusterId of Object.keys(clusterSummaries)) {
      try {
        const clusterIssues = clusterSummaries[clusterId].issues;
        const topTerms = clusterSummaries[clusterId].topTerms;
        
        // Generate epic issue for this cluster
        const epicIssue = await generateEpicForCluster(
          clusterIssues, 
          topTerms, 
          clusterId,
          repoOwner,
          repoName
        );
        
        clusterSummaries[clusterId].epicIssue = epicIssue;
      } catch (epicError) {
        console.error(`Error generating epic for cluster ${clusterId}:`, epicError);
        // Let it continue with other clusters even if one fails
      }
    }
    
    return {
      issues: clusteredIssues,
      epics: epicIssues,
      references: allReferences,
      clusters: clusterSummaries
    };
  } catch (error) {
    console.error('Error in clusterIssues:', error);
    throw error;
  }
}

module.exports = {
  clusterIssues,
  extractIssueRef,
  processIssueReferences,
  identifyEpics,
  getAllReferences
}; 