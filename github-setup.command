#!/bin/bash
cd "$(dirname "$0")"

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║   Vaarbewijs → GitHub Upload Script     ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# Check git
if ! command -v git &>/dev/null; then
  echo "❌ Git is niet geïnstalleerd."
  echo "   Download van: https://git-scm.com/download/mac"
  read -p "Druk Enter om te sluiten..."
  exit 1
fi

echo "📋 Stap 1: Ga naar https://github.com/new"
echo "   - Naam: vaarbewijs-quiz"
echo "   - Zet op 'Private'"
echo "   - GEEN vinkje bij 'Add README'"
echo "   - Klik 'Create repository'"
echo ""
read -p "Plak hier de GitHub URL (bijv. https://github.com/jouw-naam/vaarbewijs-quiz.git): " REPO_URL

if [ -z "$REPO_URL" ]; then
  echo "❌ Geen URL ingevoerd. Script gestopt."
  read -p "Druk Enter om te sluiten..."
  exit 1
fi

echo ""
echo "⚙️  Git instellen..."
git config --global user.email "ralph.looyens@gmail.com" 2>/dev/null
git config --global user.name "Ralph Looyens" 2>/dev/null

# Init
if [ ! -d ".git" ]; then
  git init
  git branch -M main
fi

# Voeg remote toe (of update)
git remote remove origin 2>/dev/null
git remote add origin "$REPO_URL"

echo "📦 Bestanden toevoegen..."
git add -A
git commit -m "Vaarbewijs quiz platform - eerste upload" 2>/dev/null || git commit --allow-empty -m "Update"

echo "🚀 Uploaden naar GitHub..."
git push -u origin main

if [ $? -eq 0 ]; then
  echo ""
  echo "✅ Klaar! Code staat nu op GitHub."
  echo ""
  echo "Volgende stap: ga naar https://railway.app"
  echo "en verbind dit GitHub-project."
else
  echo ""
  echo "❌ Upload mislukt. Mogelijk moet je inloggen bij GitHub."
  echo "   Open GitHub Desktop of log in via: gh auth login"
fi

echo ""
read -p "Druk Enter om te sluiten..."
