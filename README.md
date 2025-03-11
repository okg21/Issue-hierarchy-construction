# GitHub Issue Hierarchy Construction

A web application for performing semantic clustering, and generating hierarchical epic relationships using AI.

## Project Summary

1. **Scraping Issues**: Fetch issues from any public GitHub repository
2. **Semantic Clustering**: Group related issues using TensorFlow.js Universal Sentence Encoder
3. **Epic Generation**: Automatically create epic issues for each cluster using Claude AI
4. **To-Do: Interactive Visualization**: Implement interactive graph for issue relationships
4. **To-Do: Apply to Github**: Create the generated epic issues in the repo


## Requirements

- Node.js (v14 or higher)
- GitHub API token
- Anthropic Claude API key

## Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/Issue-hierarchy-construction.git
cd Issue-hierarchy-construction
```

2. Install dependencies:
```bash
npm install
```

3. Create a `secrets.json` file in the root directory with your API keys:
```json
{
    "apiKey": "YOUR_GITHUB_API_TOKEN",
    "claudeKey": "YOUR_CLAUDE_API_KEY"
}
```

## Usage

1. Start the application:
```bash
node app.js
```

2. Access the application at http://localhost:3000

3. Enter a GitHub repository (owner/name) to begin scraping issues

4. Navigate to the "Cluster Issues" button to view automatically generated clusters

5. Click on any generated Epic to see its full details

## Features

- **Semantic Clustering**: Groups issues based on semantic similarity rather than simple keyword matching
- **AI-Generated Epics**: Creates meaningful epic issues for each cluster with titles, descriptions, and labels
- **CSV Export**: Download issues as CSV for further analysis

## Screenshots

### Issue Clusters View
![Issue Clusters](screenshots/clusters.png)
*Automatically grouped issues with AI-generated epics*

### Epic Detail View
![Epic Detail](screenshots/epic_detail.png)
*Detailed view of an AI-generated epic with related issues*

### Relationship Graph
![Relationship Graph](screenshots/graph.png)
*Interactive visualization of issue relationships*

## Technologies

- Node.js & Express.js for the backend
- TensorFlow.js with Universal Sentence Encoder for semantic embeddings
- Claude AI for intelligent epic generation
- D3.js for interactive visualizations
- Bootstrap for the UI
