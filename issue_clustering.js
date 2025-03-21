/**
 * Issue Clustering Module
 * Using TensorFlow.js Universal Sentence Encoder for semantic embeddings
 */

// Add more robust initialization with fallback
let tf, use;
try {
  // First, patch the util functions before loading TensorFlow
  try {
    // Add a polyfill for isNullOrUndefined to the global scope
    // Some Node.js versions removed this utility function
    if (!global.isNullOrUndefined) {
      global.isNullOrUndefined = function(value) {
        return value === null || value === undefined;
      };
    }
    
    // Try to directly patch the util module
    const utilPath = require.resolve('util');
    const util = require(utilPath);
    if (typeof util.isNullOrUndefined !== 'function') {
      util.isNullOrUndefined = function(value) {
        return value === null || value === undefined;
      };
      console.log('Added polyfill for util.isNullOrUndefined');
    }
  } catch (patchError) {
    console.error('Error patching util module:', patchError.message);
  }
  
  // Now load TensorFlow.js modules
  tf = require('@tensorflow/tfjs-node');
  use = require('@tensorflow-models/universal-sentence-encoder');
  console.log('TensorFlow.js initialized successfully');
  
  // Add polyfill for the missing isNullOrUndefined function
  // This fixes the issue in Render environment
  try {
    const tfNodeBackend = require('@tensorflow/tfjs-node/dist/nodejs_kernel_backend');
    const tfNodeKernels = require('@tensorflow/tfjs-node/dist/kernels/StridedSlice');
    const util = require('util');
    
    // Check if the function is missing and add it if needed
    if (typeof util.isNullOrUndefined !== 'function') {
      util.isNullOrUndefined = function(value) {
        return value === null || value === undefined;
      };
      
      console.log('Added polyfill for isNullOrUndefined function');
    }
  } catch (polyfillError) {
    console.error('Error adding polyfill:', polyfillError.message);
  }
} catch (error) {
  console.error('Error initializing TensorFlow.js:', error.message);
  // Create dummy functions for fallback
  tf = {
    tensor: (data) => ({ data }),
    tensor2d: (data) => ({ data }),
    variable: (data) => ({ data }),
    layers: { dense: () => ({}) },
    ready: () => Promise.resolve()
  };
}

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
  const simpleHashtagRegex = /#(\d+)/g;  // Simple hashtag reference

  let matches, 
      issueNumbersHttp = new Set(), 
      issueNumbersEdge = new Set(), 
      issueNumbersHashtag = new Set(),
      issueNumbersSimple = new Set();

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
  
  // Extract simple hashtag references
  while ((matches = simpleHashtagRegex.exec(text)) !== null) {
    issueNumbersSimple.add(matches[1]);
  }

  // Combine all sets
  return new Set([...issueNumbersHttp, ...issueNumbersEdge, ...issueNumbersHashtag, ...issueNumbersSimple]);
}

// Process the issues to extract references
function processIssueReferences(issues, repoOwner, repoName) {
  issues.forEach(issue => {
    const references = extractIssueRef(issue.body, repoOwner, repoName);
    // Convert references to numbers to ensure consistent comparison
    issue.references = Array.from(references).map(ref => parseInt(ref, 10));
    
    // Log for debugging
    if (issue.references.length > 0) {
      console.log(`Issue #${issue.number} references: ${issue.references.join(', ')}`);
    }
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
    // First try to use TensorFlow.js Universal Sentence Encoder
    try {
      // Check if USE variable is defined
      if (!use) {
        throw new Error('Universal Sentence Encoder module is not properly initialized');
      }
      
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
      
      console.log('Successfully created embeddings using Universal Sentence Encoder');
      return issues;
    } catch (tfError) {
      console.error('TensorFlow.js error creating embeddings:', tfError);
      console.log('Falling back to simple text-based embeddings');
      
      // Fallback to simple text-based embeddings when TensorFlow fails
      return createSimpleEmbeddings(issues);
    }
  } catch (error) {
    console.error('Error in embedding generation:', error);
    // Final fallback - return issues with empty embeddings rather than failing
    issues.forEach(issue => {
      issue.embedding = new Array(512).fill(0); // Empty 512-dim vector
    });
    return issues;
  }
}

// Fallback function for when TensorFlow.js fails
function createSimpleEmbeddings(issues) {
  // Create a vocabulary of all words across all issues
  const vocabulary = new Set();
  const textData = prepareDataForEmbedding(issues);
  
  textData.forEach(text => {
    const words = text.toLowerCase().split(/\W+/).filter(word => word.length > 2);
    words.forEach(word => vocabulary.add(word));
  });
  
  const vocabArray = Array.from(vocabulary);
  const vocabSize = Math.min(vocabArray.length, 512); // Limit vocab size
  
  // For each issue, create a simple bag-of-words vector
  issues.forEach((issue, index) => {
    const text = textData[index].toLowerCase();
    const vector = new Array(vocabSize).fill(0);
    
    for (let i = 0; i < vocabSize; i++) {
      const word = vocabArray[i];
      // Count word occurrences (can be improved with TF-IDF)
      const regex = new RegExp(`\\b${word}\\b`, 'g');
      const matches = text.match(regex);
      if (matches) {
        vector[i] = matches.length;
      }
    }
    
    // Normalize the vector
    const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
    issue.embedding = magnitude === 0 
      ? vector 
      : vector.map(val => val / magnitude);
  });
  
  return issues;
}

// Calculate optimal number of clusters using silhouette score
function calculateOptimalClusters(embeddings, maxClusters = 10) {
  // Edge case: if we have very few data points, don't try to create multiple clusters
  if (embeddings.length <= 3) {
    return 1; // Just one cluster for very small datasets
  }
  
  // Determine range of k to test
  const minK = 2; // Minimum is 2 clusters
  const maxK = Math.min(
    maxClusters, 
    Math.floor(embeddings.length / 2), 
    Math.max(2, Math.floor(Math.sqrt(embeddings.length)))
  );
  
  // Edge case: if maxK < minK, return minK
  if (maxK < minK) {
    return minK;
  }
  
  let bestScore = -1;
  let optimalK = minK;

  for (let k = minK; k <= maxK; k++) {
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
  // Edge case: if all points are in the same cluster, return 0
  const uniqueClusters = [...new Set(labels)];
  if (uniqueClusters.length <= 1) {
    return 0;
  }
  
  let totalScore = 0;
  
  for (let i = 0; i < data.length; i++) {
    const a = calculateIntraClusterDistance(data[i], data, labels, labels[i]);
    const b = calculateInterClusterDistance(data[i], data, labels, labels[i]);
    
    // Prevent division by zero
    if (Math.max(a, b) === 0) {
      totalScore += 0;
    } else {
      const score = (b - a) / Math.max(a, b);
      totalScore += score;
    }
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
  
  // Edge case: if there are no other points in the cluster
  if (count === 0) {
    return 0;
  }
  
  return sum / count;
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
  try {
    if (issues.length === 0) return [];
    
    // Special case: If there are too few issues, just put them all in one cluster
    if (issues.length <= 3) {
      console.log(`Only ${issues.length} issues found - assigning all to the same cluster`);
      issues.forEach(issue => {
        issue.cluster = 0;  // All in cluster 0
      });
      return issues;
    }
    
    // Extract embeddings as a 2D array
    const embeddings = issues.map(issue => issue.embedding);
    
    // Validate embeddings - make sure they're all arrays of the same length
    if (!embeddings.every(e => Array.isArray(e) && e.length === embeddings[0].length)) {
      console.error('Invalid embeddings detected, using fallback grouping');
      return performFallbackClustering(issues, suggestedClusters);
    }
    
    // Calculate optimal number of clusters if not suggested
    const numClusters = suggestedClusters || calculateOptimalClusters(embeddings);
    
    try {
      // Run k-means algorithm
      const result = skmeans(embeddings, numClusters);
      
      // Assign cluster IDs to issues
      issues.forEach((issue, index) => {
        issue.cluster = result.idxs[index];
      });
      
      return issues;
    } catch (clusteringError) {
      console.error('Error during k-means clustering:', clusteringError);
      return performFallbackClustering(issues, suggestedClusters);
    }
  } catch (error) {
    console.error('Error in performClustering:', error);
    return performFallbackClustering(issues, suggestedClusters);
  }
}

// Fallback clustering when k-means fails
function performFallbackClustering(issues, suggestedClusters = null) {
  console.log('Using fallback clustering method');
  
  // Determine number of clusters
  const numClusters = suggestedClusters || 
    Math.min(Math.max(2, Math.floor(Math.sqrt(issues.length / 2))), 5);
  
  // Simple clustering based on issue creation time
  issues.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  
  const issuesPerCluster = Math.ceil(issues.length / numClusters);
  
  issues.forEach((issue, index) => {
    issue.cluster = Math.min(Math.floor(index / issuesPerCluster), numClusters - 1);
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

// Load Claude API key from environment variable
const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY;

// Generate an epic issue for a cluster using Claude API
async function generateEpicForCluster(issues, topTerms, clusterId, repoOwner, repoName) {
  try {
    if (!CLAUDE_API_KEY) {
      console.error('Claude API key not found in environment variables');
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
      apiKey: CLAUDE_API_KEY
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
    console.log(`Starting clustering for ${issues.length} issues from ${repoOwner}/${repoName}`);
    
    // Edge case: If there are no issues, return an empty result
    if (!issues || issues.length === 0) {
      console.log('No issues to cluster');
      return {
        issues: [],
        epics: [],
        references: [],
        clusters: {}
      };
    }
    
    // Edge case: If there are very few issues, put them all in one cluster
    if (issues.length <= 3) {
      console.log(`Only ${issues.length} issues found - creating a single cluster`);
      const singleCluster = {
        '0': {
          issues: issues,
          topTerms: ['issues'],
          label: 'All Issues',
          epicIssue: null
        }
      };
      
      // Ensure issues have cluster property set
      issues.forEach(issue => {
        issue.cluster = 0;
      });
      
      // Generate epic for the single cluster
      try {
        const epicIssue = await generateEpicForCluster(
          issues,
          ['issues'], 
          '0',
          repoOwner,
          repoName
        );
        singleCluster['0'].epicIssue = epicIssue;
      } catch (epicError) {
        console.error('Error generating epic for single cluster:', epicError);
        singleCluster['0'].epicIssue = createFallbackEpic(issues, ['issues'], '0');
      }
      
      return {
        issues: issues,
        epics: [],
        references: [],
        clusters: singleCluster
      };
    }
    
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
    console.error(error.stack);
    
    // Return a fallback response even in case of error
    return {
      issues: issues || [],
      epics: [],
      references: [],
      clusters: {}
    };
  }
}

module.exports = {
  clusterIssues,
  extractIssueRef,
  processIssueReferences,
  identifyEpics,
  getAllReferences
}; 