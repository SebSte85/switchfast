module.exports = {
  branches: [
    "main",
    "develop",
    { name: "beta", prerelease: true },
    { name: "alpha", prerelease: true },
  ],
  plugins: [
    "@semantic-release/commit-analyzer",
    "@semantic-release/release-notes-generator",
    "@semantic-release/changelog",
    "semantic-release-export-data",
    [
      "@semantic-release/git",
      {
        assets: ["package.json", "package-lock.json", "CHANGELOG.md"],
        message:
          "chore(release): ${nextRelease.version} [skip ci]\n\n${nextRelease.notes}",
      },
    ],
    [
      "@semantic-release/github",
      {
        assets: [
          {
            path: "release/*.exe",
            label: "Windows Installer (${nextRelease.version})",
          },
          {
            path: "release/*.yml",
            label: "Auto-Update Metadata",
          },
        ],
      },
    ],
  ],
};
