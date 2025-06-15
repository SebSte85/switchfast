# 🚀 Manuelles Release für switchfast

## 📋 Release-Prozess

### 1. Version in package.json erhöhen

```bash
# Aktuelle Version prüfen
npm version

# Version erhöhen (wähle eine):
npm version patch    # 0.1.0 → 0.1.1 (Bugfixes)
npm version minor    # 0.1.0 → 0.2.0 (Neue Features)
npm version major    # 0.1.0 → 1.0.0 (Breaking Changes)
```

### 2. Push nach main

```bash
git push origin main
```

**Das war's!** 🎉 GitHub Actions macht automatisch:

- ✅ Alle Tests laufen
- ✅ Windows .exe wird gebaut
- ✅ Upload nach S3 (latest + versioned)
- ✅ GitHub Release wird erstellt

## 📁 S3 Struktur nach Release

```
switchfast-prod/
├── latest/                    # Für Auto-Updates
│   └── switchfast-0.1.1.exe
└── releases/                  # Alle Versionen für Rollbacks
    ├── v0.1.0/
    └── v0.1.1/
        └── switchfast-0.1.1.exe
```

## 🔍 Monitoring

- **GitHub Actions**: https://github.com/SebSte85/switchfast/actions
- **S3 Console**: https://s3.console.aws.amazon.com/s3/buckets/switchfast-prod
- **Releases**: https://github.com/SebSte85/switchfast/releases

## 🎯 Beispiel-Workflow

```bash
# 1. Bugfix gemacht
git add .
git commit -m "fix: shortcut registration bug"

# 2. Version erhöhen
npm version patch  # 0.1.0 → 0.1.1

# 3. Push
git push origin main

# 4. Warten bis GitHub Actions fertig ist ✅
# 5. Users bekommen automatisch Update 🚀
```

## 🚨 Rollback (falls nötig)

```bash
# 1. Alte Version aus S3 holen
aws s3 cp s3://switchfast-prod/releases/v0.1.0/ s3://switchfast-prod/latest/ --recursive

# 2. package.json zurücksetzen
npm version 0.1.0 --no-git-tag-version

# 3. Commit + Push
git add package.json
git commit -m "rollback: zurück zu v0.1.0"
git push origin main
```

**Viel einfacher als semantic-release!** 💪
