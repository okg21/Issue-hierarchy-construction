scrape_data/get_repo_names.ipynb: For scraping repositories with issues labeled 'Epic'. Output example is repo_list.txt.
                                  []Not sure if the search is case-sensitive. Need to check.
scrape_data/choose_repo.ipynb: Given repo_list.txt, get repository information, such as stars, issues, issues with label epic. Also the code for scraping a specific repository is here. Output example for repository information can be seen on repos_info.csv.
                                []Scrape more repositories after manually inspecting the repository informations.
preprocess_data/preprocess_data.ipynb: For preprocessing raw issue data to, structured data. An example output can be seen on ckeditor5_issues.csv

To run: Make sure you have a config.py with your Github API token defined in it such as 'TOKEN=<YOUR TOKEN HERE>'.
