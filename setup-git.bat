@echo off
echo node_modules/ > .gitignore
echo .env >> .gitignore
echo rankks-api/media >> .gitignore
git rm -r --cached rankks-api/node_modules
git rm -r --cached rankks-frontend/node_modules
git rm -r --cached rankks-ingest/node_modules
git rm -r --cached rankks-ingestion/node_modules
git add .
git commit -m "chore: clean v1.0 stable"
git tag v1.0-stable
git remote add origin https://github.com/mazzedd/rankks.git
git branch -M main
git push -u origin main
git push origin v1.0-stable
git checkout -b v2.0
git push -u origin v2.0
echo DONE
pause