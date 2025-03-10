# GitHub Issue Scraper

A simple Node.js application that scrapes issues from a GitHub repository using the GitHub GraphQL API.

## Features

- Fetches all issues from a specified GitHub repository
- Captures issue details including title, body, author, state, comments, labels, and assignees
- Handles pagination to retrieve all issues
- Saves results to a CSV file

## Prerequisites

- Node.js (v14 or higher)
- npm (comes with Node.js)
- GitHub Personal Access Token with appropriate permissions

## Setup

1. Clone this repository
2. Install dependencies:
   ```
   npm install
   ```
3. Make sure you have a `secrets.json` file in the root directory with your GitHub API key:
   ```json
   {
     "apiKey": "your_github_personal_access_token"
   }
   ```

## Usage

Run the application:

```
npm start
```

Or directly with Node.js:

```
node github_issue_scraper.js
```

When prompted, enter a GitHub repository URL in the format:
```
https://github.com/owner/repo
```

The application will:
1. Parse the URL to extract the repository owner and name
2. Fetch all issues from the repository
3. Process the data into a structured format
4. Save the results to a CSV file in the `data` directory

## Output

The results will be saved as a CSV file in the `data` directory with the filename format `repo_name_issues.csv`.

## Notes

- Rate limiting: The application includes basic handling for GitHub API rate limits
- Large repositories: For repositories with many issues, the scraping process may take some time 