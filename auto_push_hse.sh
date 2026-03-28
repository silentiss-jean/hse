#!/bin/bash

cd /Volumes/dev-218/dev/preprod/hse || exit

echo "🚀 Auto push HSE lancé..."

fswatch -o . | while read f
do
  echo "📦 Changement détecté..."

  # Ajouter uniquement les fichiers utiles
  git add *.md *.py *.js *.css 2>/dev/null

  # Vérifie s'il y a vraiment des changements
  if ! git diff --cached --quiet; then
    
    # Message de commit intelligent
    FILE=$(git diff --cached --name-only | head -n 1)
    
    git commit -m "update: $FILE"
    git push origin main

    echo "✅ Push effectué : $FILE"
  else
    echo "⚠️ Aucun changement réel"
  fi
done
