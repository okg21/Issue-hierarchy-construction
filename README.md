- scrape_data/get_repo_names.ipynb: For scraping repositories with issues labeled 'Epic'. Output example is repo_list.txt.
- scrape_data/choose_repo.ipynb: Given repo_list.txt, get repository information, such as stars, issues, issues with label epic. Also the code for scraping a specific repository is here. Output example for repository information can be seen on repos_info.csv.
- clustering.ipynb: For preprocessing raw issue data and clustering. Example outputs can be seen on data/clustered_data_\<repo name\>.csv
- generate_epics.ipynb: Takes clustered sub-issues as input. And generates epic issues. Sample outputs can be seen on data/predicted_epics_\<repo name\>.csv
- new_coming_issues.ipynb: For demonstrating how to handle new coming issues. While clustering, we save cluster centroids. In this notebook, we calculate the distance of the new coming issues to these cluster centroids to assign them to clusters. 

- To run: Make sure you have a config.py with your Github API token defined in it such as 'TOKEN = <YOUR TOKEN HERE>'.
- For epic issue generation create a openai_key.py with you OpenAI API key such as OPEN_AI_KEY = <YOUR TOKEN HERE>
