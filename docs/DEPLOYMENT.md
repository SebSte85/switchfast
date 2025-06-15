# 🚀 switchfast Production Deployment

## Überblick

Automatisches CI/CD System für switchfast Desktop App mit:

- ✅ Vollständige Test-Pipeline
- 🏷️ Semantic Versioning
- 📦 Automatischer .exe Build
- ☁️ S3 Upload für Updates
- 🔄 electron-updater Integration

## 🎯 Deployment Flow

```
Push to main → Tests → Build → Version → S3 Upload → Users get update
```

### 1. Quality Gates (Alle müssen ✅ sein)

- **Unit Tests**: 33 Business Logic Tests
- **Integration Tests**: Supabase Backend Verbindung
- **Security Tests**: npm audit + dependency check
- **Windows Build**: Native Addon compilation

### 2. Automatic Versioning

- **MAJOR** (v1.0.0 → v2.0.0): `BREAKING CHANGE` in commit
- **MINOR** (v1.0.0 → v1.1.0): `feat:` commits
- **PATCH** (v1.0.0 → v1.0.1): `fix:`, `chore:`, etc.

### 3. S3 Deployment Structure

```
switchfast-prod/
├── latest/
│   ├── switchfast Setup 1.2.3.exe
│   └── latest.yml                # electron-updater metadata
└── releases/
    ├── v1.0.0/
    ├── v1.1.0/
    └── v1.2.3/
```

## 📝 Conventional Commits

Verwende diese Commit-Message-Formate für automatisches Versioning:

```bash
# Minor Version Bump (neue Features)
git commit -m "feat: add new theme shortcuts"
git commit -m "feat(ui): redesign settings panel"

# Patch Version Bump (Bugfixes)
git commit -m "fix: trial calculation error"
git commit -m "fix(shortcuts): Alt+C not working"

# Major Version Bump (Breaking Changes)
git commit -m "feat!: new license system requires migration"
git commit -m "fix: user data migration

BREAKING CHANGE: existing settings will be reset"

# Andere (Patch)
git commit -m "chore: update dependencies"
git commit -m "docs: improve installation guide"
git commit -m "test: add trial expiry tests"
```

## 🔧 Setup Requirements

### GitHub Secrets

```bash
AWS_ACCESS_KEY_ID=<your-aws-access-key>
AWS_SECRET_ACCESS_KEY=<your-aws-secret-key>
GITHUB_TOKEN=<automatically-provided>
```

### S3 Bucket Policy

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::switchfast-prod/latest/*"
    }
  ]
}
```

## 🎮 Manual Deployment (Falls nötig)

```bash
# 1. Build lokal
npm run build:prod:ci
npm run package:prod

# 2. Upload zu S3
aws s3 cp release/ s3://switchfast-prod/latest/ --recursive

# 3. Tag erstellen
git tag v1.2.3
git push origin v1.2.3
```

## 🔄 electron-updater Integration

Users erhalten automatisch Updates wenn sie die App starten:

```javascript
// In main.ts bereits konfiguriert
import { autoUpdater } from "electron-updater";

autoUpdater.setFeedURL({
  provider: "s3",
  bucket: "switchfast-prod",
  region: "eu-west-1",
  path: "/latest",
});
```

## 📊 Monitoring

### Deployment Status

- GitHub Actions: https://github.com/SebSte85/switchfast/actions
- S3 Console: https://s3.console.aws.amazon.com/s3/buckets/switchfast-prod

### Release Analytics

- GitHub Releases: Zeigt Download-Statistiken
- S3 CloudWatch: Upload/Download Metriken

## 🚨 Troubleshooting

### Build Failures

```bash
# Windows-spezifische Build-Probleme
npm run build:addon  # Native Addon neu kompilieren
```

### S3 Upload Issues

```bash
# AWS CLI Konfiguration prüfen
aws configure list
aws s3 ls s3://switchfast-prod/
```

### Version Conflicts

```bash
# Git Tags aufräumen
git tag -d v1.2.3
git push origin :refs/tags/v1.2.3
```

## 🎯 Best Practices

1. **Nur main branch** deployed automatisch
2. **Feature branches** werden getestet aber nicht deployed
3. **Hotfixes** bekommen PATCH version
4. **Breaking changes** werden in Release Notes dokumentiert
5. **Tests müssen ✅ sein** für Deployment

## 📈 Roadmap

- [ ] Beta Channel (develop → beta bucket)
- [ ] Rollback System
- [ ] A/B Testing für Updates
- [ ] Crash Reporting Integration
- [ ] Update Scheduling (off-peak hours)
