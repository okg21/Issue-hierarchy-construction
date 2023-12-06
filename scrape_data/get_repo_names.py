import requests
from config import TOKEN
import time

# Your personal GitHub access token
token = TOKEN

# The GraphQL query
query = """
query($cursor: String) {
  search(query: "label:epic is:issue", type: ISSUE, first: 100, after: $cursor) {
    issueCount
    pageInfo {
      endCursor
      hasNextPage
    }
    nodes {
      ... on Issue {
        repository {
          name
          owner {
            login
          }
        }
        labels(first: 10) {
          nodes {
            name
          }
        }
        title
        body
        number
        createdAt
        updatedAt
        state
        author {
          login
        }
        comments(first: 10) {
          nodes {
            author {
              login
            }
            createdAt
            bodyText
          }
        }
      }
    }
  }
}
"""

# Header for authorization
headers = {
    "Authorization": f"Bearer {TOKEN}",
    'Content-Type': 'application/json'
}

# Variables for pagination
variables = {"cursor": None}
unique_repos = set()

# Execute paginated queries
has_next_page = True
while has_next_page:
    response = requests.post('https://api.github.com/graphql', json={'query': query, 'variables': variables}, headers=headers)
    if response.status_code == 200:
        result = response.json()
        issues = result['data']['search']['nodes']
        unique_repos.update(issue['repository']['name'] + " " + issue['repository']['owner']['login'] for issue in issues)
        #print(issues[0]['body'])
        #print(f"Found {len(unique_repos)} repositories so far.")
        #print(unique_repos)
        has_next_page = result['data']['search']['pageInfo']['hasNextPage']
        variables["cursor"] = result['data']['search']['pageInfo']['endCursor']
    else:
        raise Exception(f"Query failed to run with a {response.status_code}.")
    time.sleep(1)

print(unique_repos)
#save the list of repos to a file
with open('repo_list.txt', 'w') as f:
  for item in unique_repos:
    f.write("%s\n" % item)