const { execSync } = require("child_process");
const fs = require("fs");

/**
 * Intelligentes Version-Bumping für switchfast
 * Analysiert Commit-Messages und bestimmt automatisch:
 * - MAJOR: BREAKING CHANGE
 * - MINOR: feat:
 * - PATCH: fix:, chore:, docs:, etc.
 */

function getLastTag() {
  try {
    return execSync("git describe --tags --abbrev=0", {
      encoding: "utf8",
    }).trim();
  } catch (error) {
    return "v0.0.0"; // Fallback für erstes Release
  }
}

function getCommitsSinceLastTag() {
  const lastTag = getLastTag();
  try {
    const commits = execSync(`git log ${lastTag}..HEAD --oneline`, {
      encoding: "utf8",
    });
    return commits.split("\n").filter((line) => line.trim());
  } catch (error) {
    return [];
  }
}

function analyzeCommits(commits) {
  let hasMajor = false;
  let hasMinor = false;
  let hasPatch = false;

  console.log("📝 Analyzing commits since last release:");

  commits.forEach((commit) => {
    console.log(`  - ${commit}`);

    if (commit.includes("BREAKING CHANGE") || commit.includes("!:")) {
      hasMajor = true;
    } else if (commit.startsWith("feat:") || commit.startsWith("feat(")) {
      hasMinor = true;
    } else if (
      commit.startsWith("fix:") ||
      commit.startsWith("chore:") ||
      commit.startsWith("docs:") ||
      commit.startsWith("style:") ||
      commit.startsWith("refactor:") ||
      commit.startsWith("perf:") ||
      commit.startsWith("test:")
    ) {
      hasPatch = true;
    }
  });

  if (hasMajor) return "major";
  if (hasMinor) return "minor";
  if (hasPatch) return "patch";
  return "patch"; // Default fallback
}

function bumpVersion() {
  const commits = getCommitsSinceLastTag();

  if (commits.length === 0) {
    console.log("🔄 No new commits since last tag, skipping version bump");
    return;
  }

  const bumpType = analyzeCommits(commits);
  console.log(`\n🚀 Determined bump type: ${bumpType.toUpperCase()}`);

  const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
  const currentVersion = packageJson.version;

  console.log(`📦 Current version: v${currentVersion}`);

  // Verwende npm version für korrekte semantic versioning
  const newVersion = execSync(`npm version ${bumpType} --no-git-tag-version`, {
    encoding: "utf8",
  }).trim();

  console.log(`✨ New version: ${newVersion}`);
  console.log(`\n🎯 Ready for production deployment!`);

  return newVersion;
}

// Führe aus wenn direkt aufgerufen
if (require.main === module) {
  bumpVersion();
}

module.exports = { bumpVersion, analyzeCommits };
