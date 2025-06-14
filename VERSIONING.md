# 🏷️ Automatisches Versioning mit Semantic Release

## Übersicht

switchfast nutzt **semantic-release** für vollautomatisches Versioning basierend auf Commit-Messages. Keine manuellen Versionsnummern mehr!

## 📋 Commit-Message-Konventionen

### Format

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

### Typen und ihre Auswirkungen

| Type                                              | Version                   | Beispiel                                 | Beschreibung     |
| ------------------------------------------------- | ------------------------- | ---------------------------------------- | ---------------- |
| `fix:`                                            | **PATCH** (1.0.0 → 1.0.1) | `fix: korrigiere Shortcut-Registrierung` | Bugfixes         |
| `feat:`                                           | **MINOR** (1.0.0 → 1.1.0) | `feat: neue Theme-Export-Funktion`       | Neue Features    |
| `feat!:` oder `BREAKING CHANGE:`                  | **MAJOR** (1.0.0 → 2.0.0) | `feat!: neue API für Themes`             | Breaking Changes |
| `docs:`, `style:`, `refactor:`, `test:`, `chore:` | **KEINE**                 | `docs: update README`                    | Keine Version    |

### ✅ Gute Commit-Messages

```bash
# Patch Release (Bugfix)
git commit -m "fix: Theme-Wechsel funktioniert wieder korrekt"
git commit -m "fix(ui): Button-Layout in Settings korrigiert"

# Minor Release (Feature)
git commit -m "feat: neue Autostart-Option hinzugefügt"
git commit -m "feat(shortcuts): Alt+T für Theme-Übersicht"

# Major Release (Breaking Change)
git commit -m "feat!: komplett neue Theme-Verwaltung

BREAKING CHANGE: Theme-Format hat sich geändert, Migration erforderlich"

# Keine Version
git commit -m "docs: README aktualisiert"
git commit -m "chore: Dependencies aktualisiert"
git commit -m "test: neue Unit Tests für Theme-Service"
```

## 🚀 Deployment-Workflow

### Automatischer Ablauf

1. **Push nach `main`** → GitHub Actions startet
2. **Tests laufen** → Unit, Integration, Security Tests
3. **Version ermitteln** → semantic-release analysiert Commits
4. **Build & Deploy** → Nur wenn neue Version verfügbar
5. **S3 Upload** → Alte Versionen bleiben erhalten
6. **GitHub Release** → Automatisch erstellt mit Changelog

### S3 Struktur (alte Versionen bleiben!)

```
switchfast-prod/
├── latest/                    # Für Auto-Updates
│   ├── switchfast-setup.exe
│   └── latest.yml
└── releases/                  # Alle Versionen für Rollbacks
    ├── v1.0.0/
    ├── v1.0.1/
    ├── v1.1.0/
    └── v2.0.0/               # Neueste Version
        ├── switchfast-setup.exe
        └── latest.yml
```

## 🔄 Rollback-Möglichkeiten

1. **Via S3**: Alte Version aus `/releases/vX.Y.Z/` kopieren nach `/latest/`
2. **Via Git**: `git revert` + neuer Commit
3. **Hotfix**: `fix:` Commit für schnelle Korrektur

## 🛠️ Lokale Entwicklung

```bash
# Version vorschau (ohne Deployment)
npm run semantic-release:dry

# Manuelles Release (falls nötig)
npm run semantic-release
```

## 📊 Release-Beispiele

### Szenario 1: Nur Bugfixes

```bash
git commit -m "fix: Shortcut-Registrierung repariert"
git commit -m "fix: Memory Leak behoben"
git push origin main
# → Ergebnis: v1.0.0 → v1.0.1
```

### Szenario 2: Feature + Bugfix

```bash
git commit -m "feat: neue Export-Funktion"
git commit -m "fix: Button-Styles korrigiert"
git push origin main
# → Ergebnis: v1.0.1 → v1.1.0 (feat überschreibt fix)
```

### Szenario 3: Breaking Change

```bash
git commit -m "feat!: neue API

BREAKING CHANGE: Theme-Format geändert, siehe Migration-Guide"
git push origin main
# → Ergebnis: v1.1.0 → v2.0.0
```

## ⚠️ Wichtige Hinweise

- **Keine manuellen package.json-Änderungen** der Version
- **Conventional Commits benutzen** für automatisches Versioning
- **Breaking Changes** immer mit `!` oder `BREAKING CHANGE:` markieren
- **Alte Versionen bleiben im S3** für Rollbacks erhalten
- **Release nur bei Push nach `main`** - Feature-Branches triggern nichts

## 🎯 Vorteile

✅ **Keine manuellen Versionsnummern**  
✅ **Automatische Changelogs**  
✅ **Rollback-Sicherheit** (alte Versionen bleiben)  
✅ **Konsistente Versioning-Regeln**  
✅ **Professioneller CI/CD-Standard**
