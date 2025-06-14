# 🤖 GitHub App für semantic-release mit Branch Protection

## Warum GitHub App statt Personal Access Token?

✅ **Sicherer** - App-Tokens haben minimale Permissions  
✅ **Unabhängig** - Nicht an User-Account gebunden  
✅ **Professioneller** - Keine persönlichen Tokens in CI/CD  
✅ **Granular** - Präzise Permissions nur für was nötig ist

## Schritt 1: GitHub App erstellen

### 1.1 App registrieren

1. Gehe zu: **https://github.com/settings/apps**
2. Klicke **"New GitHub App"**
3. **GitHub App name:** `switchfast-releaser-bot`
4. **Homepage URL:** `https://github.com/SebSte85/switchfast`
5. **Webhook:** ❌ **Deaktivieren** ("Active" unchecken)

### 1.2 Permissions setzen

**Repository permissions:**

- ✅ **Contents:** `Read and write`
- ✅ **Metadata:** `Read`
- ✅ **Pull requests:** `Read and write`
- ✅ **Issues:** `Read and write`

### 1.3 Installation

- **Where can this GitHub App be installed?** → `Only on this account`
- Klicke **"Create GitHub App"**

## Schritt 2: Private Key & App ID

### 2.1 Private Key generieren

1. Nach App-Erstellung → **"Generate a private key"**
2. **Private Key (.pem Datei) herunterladen** und sicher speichern
3. **App ID** notieren (steht oben auf der App-Settings-Seite)

### 2.2 App installieren

1. In der App → **"Install App"** Tab
2. **Repository auswählen:** `SebSte85/switchfast`
3. **"Install"** klicken

## Schritt 3: Repository Secrets

In **https://github.com/SebSte85/switchfast/settings/secrets/actions**:

1. **`RELEASER_APP_ID`** → [Deine App ID]
2. **`RELEASER_APP_PRIVATE_KEY`** → [Inhalt der .pem Datei]

## Schritt 4: Branch Protection konfigurieren

### 4.1 Aktueller Zustand prüfen

Gehe zu **https://github.com/SebSte85/switchfast/settings/rules**

### 4.2 Ruleset erstellen (empfohlen) ODER Branch Protection anpassen

**Option A: Repository Rulesets (neu & empfohlen):**

1. **"New branch ruleset"**
2. **Name:** `Main Branch Protection`
3. **Enforcement:** `Active`
4. **Bypass list:** `switchfast-releaser-bot` (deine App)
5. **Target branches:** `Include default branch`
6. **Rules:**
   - ✅ `Require a pull request before merging`
   - ✅ `Require status checks to pass`
   - ✅ `Block force pushes`

**Option B: Branch Protection Rules (klassisch):**

1. **https://github.com/SebSte85/switchfast/settings/branches**
2. **"Add rule"** für `main`
3. ✅ `Require a pull request before merging`
4. ✅ `Require status checks to pass before merging`
5. **"Allow specified actors to bypass required pull requests"**
6. **Hinzufügen:** `switchfast-releaser-bot`
7. ❌ **"Do not allow bypassing the above settings"** NICHT aktivieren!

## Schritt 5: Workflow aktualisieren

Die `production-deploy` Job muss die GitHub App nutzen:

```yaml
production-deploy:
  name: 🚀 Production Deploy
  runs-on: windows-latest
  needs: [get-next-version]
  if: needs.get-next-version.outputs.new-release-published == 'true'

  permissions:
    contents: write
    actions: read

  steps:
    - name: Generate GitHub App Token
      id: generate_token
      uses: actions/create-github-app-token@v1
      with:
        app-id: ${{ secrets.RELEASER_APP_ID }}
        private-key: ${{ secrets.RELEASER_APP_PRIVATE_KEY }}

    - name: Checkout code
      uses: actions/checkout@v4
      with:
        fetch-depth: 0
        token: ${{ steps.generate_token.outputs.token }}

    # ... weitere Steps ...

    - name: Create version tag and GitHub release
      run: npx semantic-release
      env:
        GITHUB_TOKEN: ${{ steps.generate_token.outputs.token }}
        GH_TOKEN: ${{ steps.generate_token.outputs.token }}
```

## ✅ Fertig!

Jetzt kann semantic-release:

- ✅ Tags erstellen
- ✅ Releases veröffentlichen
- ✅ Branch Protection umgehen
- ✅ Sicher authentifizieren

Während normale User:

- ❌ Nicht direkt auf `main` pushen können
- ✅ Pull Requests erstellen müssen
- ✅ Status Checks bestehen müssen
