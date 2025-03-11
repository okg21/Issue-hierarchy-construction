/**
 * Issue Clustering Module
 * Based on BERT embeddings and k-means clustering
 */

const tf = require('@tensorflow/tfjs-node');
const natural = require('natural');
const skmeans = require('skmeans');

// Use the WordTokenizer from natural instead of direct Tokenizer
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

// Prepare data for clustering by combining title and body
function prepareDataForClustering(issues) {
  issues.forEach(issue => {
    issue.combinedText = `${issue.title} ${issue.body}`;
  });
  
  return issues;
}

// Create a simple bag-of-words model as a fallback if BERT is not available
function createBagOfWordsEmbeddings(issues) {
  // Create a vocabulary from all terms
  const vocabulary = new Set();
  
  issues.forEach(issue => {
    if (!issue.combinedText) return;
    
    const tokens = tokenizer.tokenize(issue.combinedText.toLowerCase());
    tokens.forEach(token => vocabulary.add(token));
  });
  
  const vocabularyArray = Array.from(vocabulary);
  
  // Create embedding for each issue
  issues.forEach(issue => {
    if (!issue.combinedText) {
      issue.embedding = new Array(vocabularyArray.length).fill(0);
      return;
    }
    
    const tokens = tokenizer.tokenize(issue.combinedText.toLowerCase());
    const tokenCounts = {};
    
    tokens.forEach(token => {
      tokenCounts[token] = (tokenCounts[token] || 0) + 1;
    });
    
    // Create embedding vector (term frequency)
    issue.embedding = vocabularyArray.map(term => tokenCounts[term] || 0);
  });
  
  return issues;
}

// Perform k-means clustering
function performClustering(issues, numClusters = 5) {
  if (issues.length === 0) return [];
  
  // Extract embeddings as a 2D array
  const embeddings = issues.map(issue => issue.embedding);
  
  // Run k-means algorithm
  const result = skmeans(embeddings, numClusters);
  
  // Assign cluster IDs to issues
  issues.forEach((issue, index) => {
    issue.cluster = result.idxs[index];
  });
  
  return issues;
}

// Generate cluster summaries
function generateClusterSummaries(issues) {
  const clusters = {};
  
  issues.forEach(issue => {
    if (typeof issue.cluster !== 'number') return;
    
    if (!clusters[issue.cluster]) {
      clusters[issue.cluster] = {
        issues: [],
        topTerms: null
      };
    }
    
    clusters[issue.cluster].issues.push(issue);
  });
  
  // For each cluster, find most common terms
  Object.keys(clusters).forEach(clusterId => {
    const clusterIssues = clusters[clusterId].issues;
    
    // Combine all text from the cluster
    const combinedText = clusterIssues
      .map(issue => issue.combinedText || '')
      .join(' ');
    
    const tokens = tokenizer.tokenize(combinedText.toLowerCase());
    const termFrequency = {};
    
    tokens.forEach(token => {
      if (token.length < 3) return; // Skip very short terms
      termFrequency[token] = (termFrequency[token] || 0) + 1;
    });
    
    // Get top terms
    const topTerms = Object.entries(termFrequency)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([term, _]) => term);
    
    clusters[clusterId].topTerms = topTerms;
    clusters[clusterId].label = topTerms.join(', ');
  });
  
  return clusters;
}

// Main clustering function
function clusterIssues(issues, repoOwner, repoName, numClusters = 5) {
  // Step 1: Process issue references
  const processedIssues = processIssueReferences(issues, repoOwner, repoName);
  
  // Step 2: Identify epic issues
  const epicIssues = identifyEpics(processedIssues);
  
  // Step 3: Get all references
  const allReferences = getAllReferences(epicIssues);
  
  // Step 4: Prepare data for clustering
  const preparedIssues = prepareDataForClustering(processedIssues);
  
  // Step 5: Create embeddings using bag-of-words
  const issuesWithEmbeddings = createBagOfWordsEmbeddings(preparedIssues);
  
  // Step 6: Perform clustering
  const clusteredIssues = performClustering(issuesWithEmbeddings, numClusters);
  
  // Step 7: Generate cluster summaries
  const clusterSummaries = generateClusterSummaries(clusteredIssues);
  
  return {
    issues: clusteredIssues,
    epics: epicIssues,
    references: allReferences,
    clusters: clusterSummaries
  };
}

module.exports = {
  clusterIssues,
  extractIssueRef,
  processIssueReferences,
  identifyEpics,
  getAllReferences
}; 