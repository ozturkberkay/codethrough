#!/usr/bin/env bash

# Brew

function setup_brew() {
  echo "🍺 Installing Homebrew."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/dc89d02c0107d688e089c1683dcda3401719f1f8/install.sh)"
  echo "🍺 Installing formulas from the bundle."
  brew bundle install --file=Brewfile
}

# Javascript

function setup_javascript() {
  echo "📦 Setting up JavaScript toolchain."
  bun run turbo
}

# Git

function setup_precommit() {
  echo "🔧 Installing pre-commit hooks."
  prek install
}

function setup_git_lfs() {
  echo "🔧 Setting up Git LFS."
  git lfs install
  git lfs pull
}

# Complete Setup

function setup() {
  setup_brew
  setup_javascript
  setup_precommit
  setup_git_lfs
}
